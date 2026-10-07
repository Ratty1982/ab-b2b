import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeBackorderFilterChips,
  backorderFilterIgnoredByMovement,
  mergeBackorderSearch,
  parseBackorderSearch,
  stockPositionHeadline,
  toggleBackorderMovement,
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

  it("parses the product condition filter without dropping existing filters", () => {
    const search = parseBackorderSearch({
      condition: "O",
      status: "NEW",
      position: "NO_STOCK_NO_INCOMING",
    });
    expect(search.condition).toBe("O");
    expect(search.status).toBe("NEW");
    expect(activeBackorderFilterChips(search).map((chip) => chip.label)).toEqual([
      "Status: NEW",
      "Stock: NO STOCK / NO INCOMING",
      "Condition: Obsolete",
    ]);
    expect(parseBackorderSearch({ condition: "HAS" }).condition).toBe("HAS");
    expect(parseBackorderSearch({ condition: "NONE" }).condition).toBe("NONE");
    expect(parseBackorderSearch({ condition: "Z" }).condition).toBeUndefined();
    const cleared = mergeBackorderSearch(search, { condition: undefined });
    expect(cleared.condition).toBeUndefined();
    expect(cleared.status).toBe("NEW");
  });

  it("keeps existing filters functional when no movement is selected", () => {
    const search = parseBackorderSearch({ status: "NEW", position: "STOCK_AVAILABLE", ageDays: "7" });
    expect(search.movement).toBeUndefined();
    expect(backorderFilterIgnoredByMovement(search, "status")).toBe(false);
    expect(backorderFilterIgnoredByMovement(search, "position")).toBe(false);
    expect(backorderFilterIgnoredByMovement(search, "ageDays")).toBe(false);
    expect(activeBackorderFilterChips(search).map((c) => c.key)).toEqual(["status", "position", "ageDays"]);
  });

  it("uses review wording for stock available without changing the position enum", () => {
    expect(stockPositionHeadline("STOCK_AVAILABLE")).toBe("STOCK AVAILABLE — REVIEW");
    expect(stockPositionHeadline("NO_STOCK_NO_INCOMING")).toBe("NO STOCK / NO INCOMING");
    expect(stockPositionHeadline("INCOMING_COVERS")).toBe("INCOMING COVERS");
  });
});

describe("backorder movement drill-down controls", () => {
  it("parses only valid movement ids from the URL", () => {
    expect(parseBackorderSearch({ movement: "CLEARED" }).movement).toBe("CLEARED");
    expect(parseBackorderSearch({ movement: "UNCHANGED" }).movement).toBeUndefined();
    expect(parseBackorderSearch({ movement: "bogus" }).movement).toBeUndefined();
  });

  it("selects, switches directly between, and clears movements", () => {
    let search = parseBackorderSearch({ q: "TFR", page: 3 });
    search = mergeBackorderSearch(search, toggleBackorderMovement(search, "CLEARED"));
    expect(search.movement).toBe("CLEARED");
    expect(search.page).toBeUndefined();
    expect(search.q).toBe("TFR");
    search = mergeBackorderSearch(search, toggleBackorderMovement(search, "NEW"));
    expect(search.movement).toBe("NEW");
    search = mergeBackorderSearch(search, toggleBackorderMovement(search, "NEW"));
    expect(search.movement).toBeUndefined();
    expect(search.q).toBe("TFR");
  });

  it("shows a visible movement chip that clears back to the current view", () => {
    const search = parseBackorderSearch({ movement: "CLEARED", q: "ABC" });
    const chips = activeBackorderFilterChips(search);
    expect(chips[0]).toEqual({ key: "movement", label: "Movement: Cleared" });
    const cleared = mergeBackorderSearch(search, { movement: undefined });
    expect(cleared.movement).toBeUndefined();
    expect(activeBackorderFilterChips(cleared).map((c) => c.key)).toEqual(["q"]);
  });

  it("disables current-state filters for cleared history but keeps them for current movements", () => {
    const cleared = parseBackorderSearch({ movement: "CLEARED", position: "STOCK_AVAILABLE", ageDays: "7" });
    expect(backorderFilterIgnoredByMovement(cleared, "position")).toBe(true);
    expect(backorderFilterIgnoredByMovement(cleared, "ageDays")).toBe(true);
    expect(backorderFilterIgnoredByMovement(cleared, "status")).toBe(true);
    const fresh = parseBackorderSearch({ movement: "NEW", position: "STOCK_AVAILABLE" });
    expect(backorderFilterIgnoredByMovement(fresh, "position")).toBe(false);
    expect(backorderFilterIgnoredByMovement(fresh, "ageDays")).toBe(false);
    expect(backorderFilterIgnoredByMovement(fresh, "status")).toBe(true);
  });

  it("renders movement KPI cards as accessible controls with a drill-down panel", () => {
    expect(src).toContain('movementCard("NEW", "New Today"');
    expect(src).toContain('movementCard("INCREASED", "Increased"');
    expect(src).toContain('movementCard("REDUCED", "Reduced"');
    expect(src).toContain('movementCard("CLEARED", "Cleared"');
    expect(src).toContain("aria-pressed={Boolean(selected)}");
    expect(src).toContain("focus-visible:ring-2");
    expect(src).toContain("cursor-pointer");
    expect(src).toContain("All current");
    expect(src).toContain("function MovementPanel");
    expect(src).toContain("autopart216vMovementEmptyCopy");
    expect(src).toContain("function ClearedDetailBody");
    expect(src).toContain("movement: search.movement ?? null");
  });
});
