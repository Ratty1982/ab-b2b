import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAutopart504Report } from "@/domain/autopart-504";
import { detectOngoingSalesAttachmentType } from "@/domain/autopart-ongoing-sales-attachment";

const root = process.cwd();
const LEGACY = "LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)\n";

function src(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

describe("legacy 504C is not an active pathway", () => {
  it("rejects a 504C attachment as a 504 report", () => {
    expect(isAutopart504Report(LEGACY)).toBe(false);
    expect(detectOngoingSalesAttachmentType("504.txt", LEGACY)).toBe("LEGACY_504C");
    expect(detectOngoingSalesAttachmentType("504C.CSV", LEGACY)).toBe("LEGACY_504C");
  });

  it("has no 504-to-504C despatch bridge", () => {
    const ongoing = src("src/server/companies/autopart-ongoing-sales.ts");
    expect(ongoing).not.toContain("applyAutopart504c");
    expect(ongoing).not.toContain("build504cBridgeText");
    expect(ongoing).not.toContain("shouldBridge504To504c");
    expect(ongoing).toContain("run504TrmFulfilmentAfterImport");
  });

  it("does not gate 504 + TRM fulfilment on a 504C runtime", () => {
    const fulfilment = src("src/server/orders/autopart-504-trm-fulfilment.ts");
    expect(fulfilment).not.toContain("shouldBridge504To504c");
    expect(fulfilment).not.toContain("runtime504c");
    expect(fulfilment).not.toContain("retire504c");
    expect(fulfilment).toContain('fulfilmentMode === "OFF"');
    expect(fulfilment).toContain("runtimeMode: \"RETIRED\"");
    expect(fulfilment).not.toContain("autopart504cFeedSettings.create");
    expect(fulfilment).not.toContain("autopart504cFeedSettings.upsert");
  });

  it("removes the settings panel, server functions, and scheduler", () => {
    expect(existsSync(join(root, "src/components/ab/Autopart504cFeedPanel.tsx"))).toBe(false);
    expect(existsSync(join(root, "src/server/orders/autopart-504c.ts"))).toBe(false);
    expect(existsSync(join(root, "src/server/orders/autopart-504c-scheduler.ts"))).toBe(false);
    expect(existsSync(join(root, "src/domain/autopart-504c.ts"))).toBe(false);
    expect(src("src/routes/admin.settings.tsx")).not.toContain("Autopart504cFeedPanel");
    expect(src("src/server.ts")).not.toContain("autopart-504c-scheduler");
    expect(src("src/server/phase2/fns.ts")).not.toContain("getAutopart504cFeedSettingsFn");
    expect(src("src/server/phase2/fns.ts")).not.toContain("pollAutopart504cMailboxFn");
    expect(src("src/server/phase2/fns.ts")).not.toContain("dryRunAutopart504cFn");
  });

  it("keeps historical tables and only retires the settings flag", () => {
    const sql = src("prisma/migrations/20261020120000_retire_autopart_504c_feed/migration.sql");
    expect(sql).toContain("SET DEFAULT 'RETIRED'");
    expect(sql).toContain('"enabled" = false');
    expect(sql.toUpperCase()).not.toMatch(/\bDELETE\b|\bDROP\b/);
    expect(existsSync(join(root, "prisma/migrations/20260925190000_autopart_504c_feed/migration.sql"))).toBe(
      true,
    );
  });
});
