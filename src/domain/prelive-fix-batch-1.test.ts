/**
 * PRE-LIVE FIX BATCH 1 — static + unit regressions for PL-001..006, PL-007, PL-008.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TRADE_DELIVERY_CHARGE_EX_VAT,
  TRADE_FREE_DELIVERY_THRESHOLD_EX_VAT,
} from "@/domain/trade-delivery";
import { moneyToString } from "@/domain/money";

const root = process.cwd();

describe("PL-001 / PL-002 — mock commerce routes removed", () => {
  it("removes public mock /quote/$id and /sales/order/$id route modules", () => {
    expect(existsSync(join(root, "src/routes/quote.$id.tsx"))).toBe(false);
    expect(existsSync(join(root, "src/routes/sales.order.$id.tsx"))).toBe(false);
    const tree = readFileSync(join(root, "src/routeTree.gen.ts"), "utf8");
    expect(tree).not.toContain("routes/quote.$id");
    expect(tree).not.toContain("routes/sales.order.$id");
    expect(tree).not.toContain("'/quote/$id'");
    expect(tree).not.toContain("'/sales/order/$id'");
  });

  it("does not leave production mock commerce modules", () => {
    expect(existsSync(join(root, "src/lib/data.ts"))).toBe(false);
    expect(existsSync(join(root, "src/lib/crm-data.ts"))).toBe(false);
  });
});

describe("PL-004 — Settings honesty", () => {
  it("Trading / Ordering panels are read-only and show £100 / £5.95", () => {
    const src = readFileSync(join(root, "src/routes/admin.settings.tsx"), "utf8");
    expect(src).toMatch(/Read-only platform rules/i);
    expect(src).toContain("£100.00");
    expect(src).toContain("£5.95");
    expect(src).not.toMatch(/Free delivery threshold[\s\S]{0,120}<input/);
    expect(src).not.toMatch(/Standard carriage charge[\s\S]{0,120}<input/);
    expect(src).not.toMatch(/type="checkbox"[\s\S]{0,80}defaultChecked/);
    expect(moneyToString(TRADE_FREE_DELIVERY_THRESHOLD_EX_VAT)).toBe("100.00");
    expect(moneyToString(TRADE_DELIVERY_CHARGE_EX_VAT)).toBe("5.95");
  });
});

describe("PL-005 — Brand logo strip uses catalogue brands", () => {
  it("CmsSectionRenderer no longer imports mock lib/data brands", () => {
    const src = readFileSync(join(root, "src/components/cms/CmsSectionRenderer.tsx"), "utf8");
    expect(src).not.toContain('from "@/lib/data"');
    expect(src).not.toContain("from '@/lib/data'");
    expect(src).toContain("catalogueBrands");
  });

  it("CMS assemble attaches catalogueBrands from listPublicBrands", () => {
    const src = readFileSync(join(root, "src/server/cms/service.ts"), "utf8");
    expect(src).toContain("listPublicBrands");
    expect(src).toContain("catalogueBrands");
  });
});

describe("PL-006 — CMS media public eligibility", () => {
  it("anonymous media path checks public eligibility and supports staff preview", () => {
    const media = readFileSync(join(root, "src/server/cms/media.ts"), "utf8");
    expect(media).toContain("isCmsMediaPubliclyEligible");
    expect(media).toContain("actorMayPreviewCmsMedia");
    expect(media).toContain("collectMediaIds");
    const route = readFileSync(join(root, "src/routes/api/cms-media/$id.ts"), "utf8");
    expect(route).toContain("resolveOptionalRequestUserId");
    expect(route).toContain("actorUserId");
  });
});

describe("PL-007 — free delivery business confirmation", () => {
  it("keeps £100 ex VAT threshold (not £150)", () => {
    expect(moneyToString(TRADE_FREE_DELIVERY_THRESHOLD_EX_VAT)).toBe("100.00");
    expect(moneyToString(TRADE_DELIVERY_CHARGE_EX_VAT)).toBe("5.95");
  });
});

describe("PL-008 — 504C test isolation helper", () => {
  it("uses uniqueAbOrderNumber for AB references", () => {
    const src = readFileSync(
      join(root, "src/server/orders/autopart-504c.integration.test.ts"),
      "utf8",
    );
    expect(src).toContain("uniqueAbOrderNumber");
    expect(src).toMatch(/await uniqueAbOrderNumber\(\)/);
    expect(src).not.toMatch(/970000 \+ \(Date\.now\(\) % 20000\)/);
  });
});
