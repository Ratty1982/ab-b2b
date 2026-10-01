import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attentionActionLabel,
  buildDashboardGreeting,
  emailHealthFromState,
  feed504cHealthFromState,
  firstNameFromDisplayName,
  formatGbpIncVat,
  greetingForLondonHour,
  ongoingSalesHealthFromState,
  PROTOTYPE_ADMIN_DASHBOARD_STRINGS,
  resolveAttentionTone,
  sharePointSdsHealthFromState,
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

  it("builds London greeting and first name without inventing names", () => {
    expect(greetingForLondonHour(8)).toBe("Good morning");
    expect(greetingForLondonHour(14)).toBe("Good afternoon");
    expect(greetingForLondonHour(19)).toBe("Good evening");
    expect(firstNameFromDisplayName("Wayne Radford")).toBe("Wayne");
    expect(firstNameFromDisplayName(null)).toBeNull();
    expect(firstNameFromDisplayName("  ")).toBeNull();
    const g = buildDashboardGreeting({
      name: "Vicki Smith",
      at: new Date("2026-10-01T12:00:00.000Z"),
    });
    expect(g.displayName).toBe("Vicki");
    expect(g.dateLabel).toMatch(/October 2026/);
    expect(["Good morning", "Good afternoon", "Good evening"]).toContain(g.greeting);
  });

  it("maps attention action labels and tones", () => {
    expect(attentionActionLabel("applications")).toBe("REVIEW");
    expect(attentionActionLabel("export-blocked")).toBe("FIX");
    expect(attentionActionLabel("export-ready")).toBe("VIEW");
    expect(resolveAttentionTone("critical", "export-blocked")).toBe("critical");
    expect(resolveAttentionTone("attention", "applications")).toBe("attention");
    expect(resolveAttentionTone("info", "504c-not-configured")).toBe("info");
    expect(resolveAttentionTone("action", "export-blocked")).toBe("critical");
    expect(resolveAttentionTone("action", "applications")).toBe("attention");
  });

  it("derives system health without labelling configured-only as Healthy", () => {
    expect(emailHealthFromState({ configured: true, enabled: true, recentFailures: 0 })).toEqual({
      statusLabel: "Operational",
      tone: "operational",
    });
    expect(emailHealthFromState({ configured: true, enabled: true, recentFailures: 2 }).tone).toBe(
      "attention",
    );
    expect(feed504cHealthFromState({ configured: false, enabled: false, statusLabel: "NOT_CONFIGURED" })).toEqual({
      statusLabel: "Not configured",
      tone: "not_configured",
    });
    expect(feed504cHealthFromState({ configured: true, enabled: true, statusLabel: "ENABLED" })).toEqual({
      statusLabel: "Running",
      tone: "running",
    });
    expect(
      ongoingSalesHealthFromState({
        configured: true,
        enabled: true,
        salesDataUpdatedAt: null,
        feedsAligned: false,
      }).tone,
    ).toBe("no_data");
    expect(
      ongoingSalesHealthFromState({
        configured: true,
        enabled: true,
        salesDataUpdatedAt: "2026-10-01T12:00:00.000Z",
        feedsAligned: true,
      }),
    ).toEqual({ statusLabel: "Healthy", tone: "healthy" });
    expect(
      sharePointSdsHealthFromState({
        configured: true,
        connected: false,
        lastConnectionTestOk: null,
      }).tone,
    ).toBe("no_data");
    expect(
      sharePointSdsHealthFromState({
        configured: true,
        connected: true,
        lastConnectionTestOk: true,
      }),
    ).toEqual({ statusLabel: "Connected", tone: "connected" });
  });

  it("admin dashboard route source contains no prototype demo data", () => {
    const source = readFileSync(join(process.cwd(), "src/routes/admin.index.tsx"), "utf8");
    expect(source).not.toContain('from "@/lib/data"');
    expect(source).not.toContain("from '@/lib/data'");
    expect(source).not.toContain('from "@/lib/crm-data"');
    expect(source).not.toContain("from '@/lib/crm-data'");
    expect(source).not.toContain("managerTotals");
    expect(source).toContain("getAdminDashboardFn");
    expect(source).toContain("DashboardSkeleton");
    expect(source).toContain("NeedsAttentionPanel");
    expect(source).toContain("SystemHealthPanel");
    for (const banned of PROTOTYPE_ADMIN_DASHBOARD_STRINGS) {
      expect(source).not.toContain(banned);
    }
  });
});
