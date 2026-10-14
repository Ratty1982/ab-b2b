import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HIDDEN_PORTAL_CAPABILITIES } from "@/domain/portal-gaps";
import { TRADE_PORTAL_NAV, collectNavDefs } from "@/lib/app-nav";

describe("hidden portal capabilities", () => {
  it("keeps unfinished items out of the trade navigation", () => {
    const items = collectNavDefs(TRADE_PORTAL_NAV);
    for (const gap of HIDDEN_PORTAL_CAPABILITIES) {
      const item = items.find((entry) => entry.id === gap.id);
      expect(item?.implemented, gap.id).toBe(false);
      expect(gap.dependency.toLowerCase()).not.toContain("coming soon");
    }
  });

  it("does not leave a coming-soon page on a hidden route", () => {
    for (const gap of HIDDEN_PORTAL_CAPABILITIES) {
      if (!gap.route) continue;
      const text = readFileSync(join(process.cwd(), gap.route), "utf8");
      expect(text.toLowerCase()).not.toContain("coming soon");
      expect(text.toLowerCase()).not.toContain("later phase");
      expect(text).toContain("redirect");
    }
  });
});
