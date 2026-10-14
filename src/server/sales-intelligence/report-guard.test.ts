import { describe, expect, it, beforeEach } from "vitest";
import {
  mapReportFailure,
  reportGuardActiveCount,
  resetReportGuardForTests,
  runBoundedReport,
  SALES_ENQUIRY_MAX_CONCURRENT,
} from "@/server/sales-intelligence/report-guard";
import { isRetryCoolingDown, retryAvailableAt, salesEnquiryErrorText } from "@/domain/sales-enquiry-report";

beforeEach(() => {
  resetReportGuardForTests();
});

describe("sales enquiry report guard", () => {
  it("runs one shared query for identical in-flight reports", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runBoundedReport("customer:1", async () => {
      calls += 1;
      await gate;
      return "totals";
    });
    const second = runBoundedReport("customer:1", async () => {
      calls += 1;
      return "other";
    });
    expect(reportGuardActiveCount()).toBe(1);
    release?.();
    await expect(first).resolves.toBe("totals");
    await expect(second).resolves.toBe("totals");
    expect(calls).toBe(1);
    expect(reportGuardActiveCount()).toBe(0);
  });

  it("rejects a report past the concurrency limit without queueing it", async () => {
    const gates: Array<(value: string) => void> = [];
    const blockers = Array.from({ length: SALES_ENQUIRY_MAX_CONCURRENT }, () =>
      new Promise<string>((resolve) => {
        gates.push(resolve);
      }),
    );
    const pending = blockers.map((blocker, index) =>
      runBoundedReport(`customer:${index}`, () => blocker),
    );
    expect(reportGuardActiveCount()).toBe(SALES_ENQUIRY_MAX_CONCURRENT);
    expect(() => runBoundedReport("customer:extra", async () => "no")).toThrow(
      expect.objectContaining({ code: "SALES_ENQUIRY_BUSY" }),
    );
    expect(reportGuardActiveCount()).toBe(SALES_ENQUIRY_MAX_CONCURRENT);
    for (const finish of gates) finish("done");
    await Promise.all(pending);
    expect(reportGuardActiveCount()).toBe(0);
    await expect(runBoundedReport("customer:later", async () => "yes")).resolves.toBe("yes");
  });

  it("frees a slot when a report fails so a retry can run", async () => {
    await expect(
      runBoundedReport("customer:fail", async () => {
        throw new Error("cancelled");
      }),
    ).rejects.toThrow("cancelled");
    expect(reportGuardActiveCount()).toBe(0);
    await expect(runBoundedReport("customer:fail", async () => "retried")).resolves.toBe("retried");
  });

  it("turns statement timeouts and pool exhaustion into safe errors", () => {
    const timeout = mapReportFailure({
      code: "P2010",
      meta: { code: "57014" },
      message: "canceling statement due to statement timeout",
    });
    expect(timeout).toMatchObject({ code: "SALES_ENQUIRY_TIMEOUT" });
    expect(timeout.message).not.toMatch(/select|prisma|connection/i);

    const pool = mapReportFailure(
      new Error("Timed out fetching a new connection from the connection pool. Connection limit: 5"),
    );
    expect(pool).toMatchObject({ code: "SALES_ENQUIRY_BUSY" });
    expect(pool.message).not.toMatch(/pool|limit: 5/i);

    const shm = mapReportFailure({
      meta: { code: "53100" },
      message: "could not resize shared memory segment",
    });
    expect(shm).toMatchObject({ code: "SALES_ENQUIRY_TIMEOUT" });
  });
});

describe("sales enquiry retry", () => {
  it("blocks a rapid retry and allows one after the cooldown", () => {
    const available = retryAvailableAt(1_000, 2_000);
    expect(isRetryCoolingDown(1_500, available)).toBe(true);
    expect(isRetryCoolingDown(3_000, available)).toBe(false);
    expect(salesEnquiryErrorText("Timed out fetching a new connection from the connection pool")).toBe(
      "Sales enquiry could not be loaded. Try again.",
    );
    expect(salesEnquiryErrorText("ignored", "SALES_ENQUIRY_BUSY")).toMatch(/already running/);
  });
});
