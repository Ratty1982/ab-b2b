import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTOPART_PRODUCT_CONDITIONS,
  autopartConditionLabel,
  autopartConditionTitle,
  autopartConditionTone,
  isKnownAutopartConditionCode,
} from "@/domain/autopart-product-condition";

describe("Autopart product condition mapping", () => {
  it("maps each recognised code once and treats blank as no condition", () => {
    expect(AUTOPART_PRODUCT_CONDITIONS.map((row) => row.code)).toEqual(["S", "N", "O", "W", "D", "M"]);
    expect(autopartConditionLabel("S")).toBe("Superseded");
    expect(autopartConditionLabel("N")).toBe("Not Yet Available");
    expect(autopartConditionLabel("O")).toBe("Obsolete");
    expect(autopartConditionLabel("W")).toBe("While Stocks Last");
    expect(autopartConditionLabel("D")).toBe("Delete");
    expect(autopartConditionLabel("M")).toBe("Made to Order");
    expect(autopartConditionLabel(null)).toBeNull();
    expect(autopartConditionLabel("")).toBeNull();
    expect(autopartConditionLabel("X")).toBe("Unknown (X)");
    expect(isKnownAutopartConditionCode("X")).toBe(false);
    expect(autopartConditionTitle("O")).toBe("Autopart condition: O — Obsolete");
  });

  it("uses stronger tones only for Obsolete and Delete", () => {
    expect(autopartConditionTone("O")).toBe("bad");
    expect(autopartConditionTone("D")).toBe("bad");
    expect(autopartConditionTone("S")).not.toBe("bad");
    expect(autopartConditionTone("N")).not.toBe("bad");
    expect(autopartConditionTone("W")).not.toBe("bad");
    expect(autopartConditionTone("M")).not.toBe("bad");
    expect(autopartConditionTone("X")).toBe("neutral");
    expect(autopartConditionTone(null)).toBe("neutral");
  });

  it("does not feed condition into purchasing quantity rules or 216V movement", () => {
    const root = process.cwd();
    const planner = readFileSync(join(root, "src/domain/purchasing-planner.ts"), "utf8");
    const forecast = readFileSync(join(root, "src/domain/purchasing-forecast.ts"), "utf8");
    const movement = readFileSync(join(root, "src/domain/autopart-216v-movement.ts"), "utf8");
    const report = readFileSync(join(root, "src/domain/autopart-216v.ts"), "utf8");
    for (const source of [planner, forecast, movement, report]) {
      expect(source).not.toContain("conditionCode");
      expect(source).not.toContain("autopart-product-condition");
    }
  });
});
