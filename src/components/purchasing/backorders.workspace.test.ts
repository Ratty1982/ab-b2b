import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeBackorderFilterChips,
  mergeBackorderSearch,
  parseBackorderSearch,
  stockPositionHeadline,
} from "@/components/purchasing/backorders";

const src = readFileSync(join(process.cwd(), "src/routes/purchasing.backorders.tsx"), "utf8");

describe("backorder workspace UX structure", () => {
  it("keeps feed/admin controls in Backorder Settings rather than the main toolbar", () => {
    expect(src).toContain("Backorder Settings");
    expect(src).toContain("aria-label=\"Open backorder settings\"");
    expect(src).toContain("Automatic import");
    expect(src).toContain("Export current view CSV");
    expect(src).toContain("function SettingsBody");
    expect(src).toContain("Upload 216V");
    expect(src).toContain("Poll mailbox");
    expect(src.indexOf("function SettingsBody")).toBeLessThan(src.indexOf("Upload 216V"));
  });

  it("exposes operational view counts, attention summary, and search copy", () => {
    expect(src).toContain("Needs attention");
    expect(src).toContain("Search order, customer, account, SKU or reference…");
    expect(src).toContain("STOCK AVAILABLE — REVIEW");
    expect(src).toContain("NO STOCK / NO INCOMING");
    expect(src).toContain("purchasing.manage");
  });

  it("gates upload, poll, and auto-import on purchasing.manage while leaving export visible", () => {
    expect(src).toContain("data?.canManage");
    expect(src).toContain("Upload and mailbox poll require purchasing.manage");
    expect(src).toContain("Export current view CSV");
    const uploadIdx = src.indexOf("Upload 216V");
    const canManageIdx = src.lastIndexOf("data?.canManage", uploadIdx);
    expect(canManageIdx).toBeGreaterThan(0);
    expect(canManageIdx).toBeLessThan(uploadIdx);
  });
});

describe("backorder filter chips", () => {
  it("builds chips from existing search params and clears them", () => {
    const search = parseBackorderSearch({
      position: "NO_STOCK_NO_INCOMING",
      ageDays: "7",
      q: "TFR25000",
    });
    const chips = activeBackorderFilterChips(search);
    expect(chips.some((c) => c.label.includes("NO STOCK"))).toBe(true);
    expect(chips.some((c) => c.label.includes("7+"))).toBe(true);
    const cleared = mergeBackorderSearch(search, { position: undefined, ageDays: undefined, q: undefined });
    expect(activeBackorderFilterChips(cleared)).toEqual([]);
  });

  it("uses review wording for stock available without changing the position enum", () => {
    expect(stockPositionHeadline("STOCK_AVAILABLE")).toBe("STOCK AVAILABLE — REVIEW");
    expect(stockPositionHeadline("NO_STOCK_NO_INCOMING")).toBe("NO STOCK / NO INCOMING");
    expect(stockPositionHeadline("INCOMING_COVERS")).toBe("INCOMING COVERS");
  });
});
