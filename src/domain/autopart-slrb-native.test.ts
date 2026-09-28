import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectNativeSlrbLayout,
  parseAutopartSlrb,
  parseNativeSlrbDataLine,
} from "@/domain/autopart-slrb";
import { parseAutopart561l } from "@/domain/autopart-561l";

const fixtureDir = resolve(import.meta.dirname, "fixtures");
const nativeSlrb = readFileSync(resolve(fixtureDir, "autopart-slrb-native.txt"), "utf8");
const native561 = readFileSync(resolve(fixtureDir, "autopart-561l-native.txt"), "utf8");

const NATIVE_HEADER =
  "A/C        Name                               Sacct      Type Ref         Date         Tot Goods     Tot VAT       Total   Run Bal";

describe("native SLRB fixed-width layout", () => {
  it("separates A/C from Name", () => {
    const layout = detectNativeSlrbLayout(NATIVE_HEADER);
    expect(layout).not.toBeNull();
    const row =
      "YORKMOTO   YORK MOTOR FACTORS                            CRN  SC500093    01 Oct 14        -8.98       -1.80      -10.78    613.25";
    const parsed = parseNativeSlrbDataLine(row, layout!)!;
    expect(parsed.accountRaw).toBe("YORKMOTO");
    expect(parsed.nameRaw).toBe("YORK MOTOR FACTORS");
    expect(parsed.typeRaw).toBe("CRN");
    expect(parsed.refRaw).toBe("SC500093");
    expect(parsed.dateRaw).toBe("01 Oct 14");
    expect(parsed.goods).toBe("-8.98");
    expect(parsed.vat).toBe("-1.80");
    expect(parsed.total).toBe("-10.78");
    expect(parsed.runBal).toBe("613.25");
  });

  it("parses native fixture without concatenating account+name", () => {
    const result = parseAutopartSlrb(nativeSlrb);
    expect(result.layout).toBe("NATIVE_FIXED");
    expect(result.reportStartCustomer).toBe("YORKMOTO");
    expect(result.reportEndCustomer).toBe("YORKMOTO");
    expect(result.detectedAccounts).toEqual(["YORKMOTO"]);
    expect(result.detectedAccounts).not.toContain("YORKMOTO YORK MOTOR FACTORS");
    expect(result.invoiceDocuments).toBe(3);
    expect(result.creditDocuments).toBe(4);
    expect(result.ledgerRecords).toBe(1);

    const crn = result.documents.find((d) => d.documentReference === "SC500093");
    expect(crn).toMatchObject({
      accountCode: "YORKMOTO",
      customerName: "YORK MOTOR FACTORS",
      documentType: "CREDIT",
      documentDate: "2014-10-01",
      goodsNet: "-8.98",
    });
  });

  it("ignores repeated page headers", () => {
    const result = parseAutopartSlrb(nativeSlrb);
    expect(
      result.documents.filter((d) => d.documentReference === "SS100901"),
    ).toHaveLength(1);
    expect(result.rows.some((r) => r.rowKind === "COLUMN_HEADER")).toBe(true);
  });

  it("exact-matches credit refs between native 561L and SLRB", () => {
    const l561 = parseAutopart561l(native561);
    const slrb = parseAutopartSlrb(nativeSlrb);
    const refs561 = new Set(l561.diagnostics.uniqueDocumentRefs);
    const refsSlrb = new Set(
      slrb.documents.map((d) => d.documentReference!).filter(Boolean),
    );
    for (const ref of ["SC500093", "SC500117", "SC501239", "SC501700", "SS100818"]) {
      expect(refs561.has(ref), `561L missing ${ref}`).toBe(true);
      expect(refsSlrb.has(ref), `SLRB missing ${ref}`).toBe(true);
    }
    const matched = [...refs561].filter((r) => refsSlrb.has(r));
    expect(matched.length).toBeGreaterThanOrEqual(7);
  });
});
