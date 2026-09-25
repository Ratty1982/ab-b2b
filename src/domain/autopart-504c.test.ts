import { describe, expect, it } from "vitest";
import { parseAutopart504cReport } from "@/domain/autopart-504c";
import { buildAutopart504cSampleFixture } from "@/domain/autopart-504c-fixture";
import { customerOrderStatusLabel, isAbOrderNumber } from "@/domain/order-status";

describe("order status customer labels", () => {
  it("maps lifecycle labels", () => {
    expect(customerOrderStatusLabel("SUBMITTED")).toBe("Received");
    expect(customerOrderStatusLabel("CONFIRMED")).toBe("Processing");
    expect(customerOrderStatusLabel("PICKING")).toBe("Processing");
    expect(customerOrderStatusLabel("DISPATCHED")).toBe("Despatched");
  });

  it("detects AB order numbers only", () => {
    expect(isAbOrderNumber("AB-000002")).toBe(true);
    expect(isAbOrderNumber("ab-000003")).toBe(true);
    expect(isAbOrderNumber("PO696969")).toBe(false);
    expect(isAbOrderNumber("026-1234567-8901234")).toBe(false);
    expect(isAbOrderNumber("WEB-998877")).toBe(false);
  });
});

describe("autopart 504C parser", () => {
  it("parses the supplied-style fixture", () => {
    const parsed = parseAutopart504cReport(buildAutopart504cSampleFixture());
    expect(parsed.headerFound).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.abInvoiceRows).toHaveLength(2);
    expect(parsed.abCreditRows).toHaveLength(1);
    expect(parsed.nonAbRows).toBeGreaterThanOrEqual(4);

    const first = parsed.abInvoiceRows[0]!;
    expect(first.documentNumber).toBe("I123456");
    expect(first.documentDate).toBe("2026-09-25");
    expect(first.documentTime).toBe("14:12");
    expect(first.accountCode).toBe("AB001");
    expect(first.goods).toBe("44.28");
    expect(first.vat).toBe("10.05");
    expect(first.value).toBe("60.28");
    expect(first.abOrderNumber).toBe("AB-000002");
    expect(first.classification).toBe("AB_INVOICE");
  });

  it("does not treat Amazon/eBay/web/PO rows as AB matches or errors", () => {
    const parsed = parseAutopart504cReport(buildAutopart504cSampleFixture());
    const refs = parsed.rows
      .filter((r) => r.classification === "NON_AB")
      .map((r) => r.customerOrderNumber);
    expect(refs).toEqual(
      expect.arrayContaining(["026-1234567-8901234", "12-34567-89012", "WEB-998877", "PO696969"]),
    );
    expect(parsed.errors).toEqual([]);
  });

  it("classifies credits separately and does not list them as invoices", () => {
    const parsed = parseAutopart504cReport(buildAutopart504cSampleFixture());
    expect(parsed.abCreditRows[0]!.kind).toBe("CREDIT");
    expect(parsed.abCreditRows[0]!.abOrderNumber).toBe("AB-000002");
    expect(parsed.abInvoiceRows.every((r) => r.kind !== "CREDIT")).toBe(true);
  });

  it("reports missing header", () => {
    const parsed = parseAutopart504cReport("not a report\n");
    expect(parsed.headerFound).toBe(false);
    expect(parsed.errors[0]).toMatch(/header/i);
  });
});
