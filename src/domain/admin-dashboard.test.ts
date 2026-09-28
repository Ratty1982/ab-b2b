import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatGbpIncVat,
  PROTOTYPE_ADMIN_DASHBOARD_STRINGS,
  stockHealthLabel,
} from "@/domain/admin-dashboard";

describe("admin dashboard helpers", () => {
  it("formats GBP inc VAT", () => {
    expect(formatGbpIncVat("19.81")).toBe("£19.81");
    expect(formatGbpIncVat("0")).toBe("£0.00");
  });

  it("classifies stock health from actionable issues only — ignored diagnostics stay Healthy", () => {
    expect(
      stockHealthLabel({ hasSuccess: true, actionableIssueCount: 0, status: "SUCCESS" }),
    ).toBe("Healthy");
    // Historical PARTIAL with only ignored INVALID/DUPLICATE must not force Attention.
    expect(
      stockHealthLabel({
        hasSuccess: true,
        actionableIssueCount: 0,
        invalid: 69,
        duplicates: 0,
        status: "PARTIAL",
      }),
    ).toBe("Healthy");
    expect(
      stockHealthLabel({ hasSuccess: true, actionableIssueCount: 2, status: "PARTIAL" }),
    ).toBe("Attention required");
    expect(
      stockHealthLabel({ hasSuccess: true, actionableIssueCount: 0, status: "FAILED" }),
    ).toBe("Attention required");
    expect(
      stockHealthLabel({ hasSuccess: false, actionableIssueCount: 0, status: null }),
    ).toBe("No sync yet");
  });

  it("admin dashboard route source contains no prototype demo data", () => {
    const source = readFileSync(join(process.cwd(), "src/routes/admin.index.tsx"), "utf8");
    expect(source).not.toContain('from "@/lib/data"');
    expect(source).not.toContain("from '@/lib/data'");
    expect(source).not.toContain('from "@/lib/crm-data"');
    expect(source).not.toContain("from '@/lib/crm-data'");
    expect(source).not.toContain("managerTotals");
    expect(source).toContain("getAdminDashboardFn");
    for (const banned of PROTOTYPE_ADMIN_DASHBOARD_STRINGS) {
      expect(source).not.toContain(banned);
    }
  });
});
