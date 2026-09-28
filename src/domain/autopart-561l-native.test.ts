import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectNative561lLayout,
  diagnose561lRows,
  parseAutopart561l,
  parseNative561lDataLine,
} from "@/domain/autopart-561l";
import { extractReportCustomerSelection } from "@/domain/autopart-report-money";

const fixtureDir = resolve(import.meta.dirname, "fixtures");
const nativeTxt = readFileSync(resolve(fixtureDir, "autopart-561l-native.txt"), "utf8");

const NATIVE_HEADER =
  ".Acct. Inv & Ln    Part Number   Description              Units     Sales";

describe("native 561L fixed-width layout", () => {
  it("detects 7-character .Acct. field from header labels", () => {
    const layout = detectNative561lLayout(NATIVE_HEADER);
    expect(layout).not.toBeNull();
    expect(layout!.accountFieldWidth).toBe(7);
    expect(layout!.account).toEqual({ start: 0, end: 7 });
    expect(layout!.invLn.start).toBe(7);
    expect(layout!.part.start).toBe(19);
  });

  it("parses adjacent YORKMOTC/SC500093/127113 without whitespace", () => {
    const layout = detectNative561lLayout(NATIVE_HEADER)!;
    const row =
      "YORKMOTC/SC500093/127113         Red 13ml Threadlocker       -1     -8.98";
    const parsed = parseNative561lDataLine(row, layout)!;
    expect(parsed.accountRaw.trim()).toBe("YORKMOT");
    expect(parsed.invLnRaw).toBe("C/SC500093/1");
    expect(parsed.partRaw).toBe("27113");
    expect(parsed.descriptionRaw).toBe("Red 13ml Threadlocker");
    expect(parsed.unitsRaw).toBe("-1");
    expect(parsed.salesRaw).toBe("-8.98");
  });

  it("parses YORKMOTC/SC501700/1SS adjacency", () => {
    const layout = detectNative561lLayout(NATIVE_HEADER)!;
    const row =
      "YORKMOTC/SC501700/1SS            Steel Seal Head Gasket       -1    -16.38";
    const parsed = parseNative561lDataLine(row, layout)!;
    expect(parsed.accountRaw.trim()).toBe("YORKMOT");
    expect(parsed.invLnRaw).toBe("C/SC501700/1");
    expect(parsed.partRaw).toBe("SS");
  });

  it("never turns YORKMOT into ORKMOT (off-by-one regression)", () => {
    const layout = detectNative561lLayout(NATIVE_HEADER)!;
    const row =
      "YORKMOTI/SS100818/1SS            Steel Seal Head Gasket       24    622.80";
    const parsed = parseNative561lDataLine(row, layout)!;
    expect(parsed.accountRaw).toBe("YORKMOT");
    expect(parsed.accountRaw).not.toBe("ORKMOT");
    expect(parsed.accountRaw.startsWith("Y")).toBe(true);
    // Mis-sliced account starting at index 1 would be ORKMOTC — must not happen
    expect(parsed.accountRaw.includes("C/")).toBe(false);
  });

  it("parses native fixture: credits, invoices, report customer, long SKU", () => {
    const result = parseAutopart561l(nativeTxt);
    expect(result.layout).toBe("NATIVE_FIXED");
    expect(result.headerFound).toBe(true);
    expect(result.accountFieldWidth).toBe(7);
    expect(result.reportStartCustomer).toBe("YORKMOTO");
    expect(result.detectedAccounts).toEqual(["YORKMOT"]);
    expect(result.detectedAccounts).not.toContain("ORKMOT");
    expect(result.detectedAccounts).not.toContain("ENTIHM");
    expect(result.detectedAccounts).not.toContain("IPKART");
    expect(result.detectedAccounts).not.toContain("UNAS");
    expect(result.detectedAccounts).not.toContain("YORKMOTO YORK MOTOR FACTORS");

    expect(result.creditLines).toBe(4);
    expect(result.invoiceLines).toBe(4);
    expect(result.lines).toHaveLength(8);

    const c1 = result.lines.find((l) => l.documentReference === "SC500093");
    expect(c1).toMatchObject({
      accountCode: "YORKMOT",
      documentType: "CREDIT",
      sourceLineNumber: 1,
      partNumber: "27113",
      units: -1,
      salesNet: "-8.98",
    });

    const inv = result.lines.find(
      (l) => l.documentReference === "SS100818" && l.sourceLineNumber === 1,
    );
    expect(inv).toMatchObject({
      documentType: "INVOICE",
      partNumber: "SS",
      units: 24,
      salesNet: "622.80",
    });

    const longSku = result.lines.find((l) => l.documentReference === "SS100900");
    expect(longSku?.partNumber).toBe("PMXLWHEELBRUSH");

    expect(result.diagnostics.uniqueCreditRefs).toEqual(
      expect.arrayContaining(["SC500093", "SC500117", "SC501239", "SC501700"]),
    );
  });

  it("ignores repeated page headers and parses continued lines once", () => {
    const result = parseAutopart561l(nativeTxt);
    const pageHeaders = result.rows.filter(
      (r) =>
        r.rowKind === "PAGE_HEADER" ||
        r.rowKind === "COLUMN_HEADER" ||
        r.rowKind === "SELECTION_PARAM" ||
        r.rowKind === "REPORT_TITLE",
    );
    expect(pageHeaders.length).toBeGreaterThan(3);
    // Page-2 line present exactly once
    expect(
      result.lines.filter((l) => l.documentReference === "SS100901"),
    ).toHaveLength(1);
    // No duplicate of first credit from re-reading headers
    expect(
      result.lines.filter((l) => l.documentReference === "SC500093"),
    ).toHaveLength(1);
  });

  it("extracts Start Customer from selection parameters", () => {
    expect(extractReportCustomerSelection(nativeTxt)).toEqual({
      startCustomer: "YORKMOTO",
      endCustomer: null, // ALL is ignored
    });
  });

  it("diagnose561lRows returns structural fields for selected lines", () => {
    const result = parseAutopart561l(nativeTxt);
    const diag = diagnose561lRows(result, { kinds: ["DATA_LINE"], limit: 3 });
    expect(diag[0]).toMatchObject({
      accountCode: "YORKMOT",
      documentReference: "SC500093",
      partNumber: "27113",
    });
  });

  it("does not invent accounts from report title fragments", () => {
    const toxic = `CUSTOMER SALES FOR PART NUMBERS BY INVOICE LINE (561L)
IDENTIFY IPKART ENTIHM UNAS FRAGMENTS HERE
[Start Customer YORKMOTO] [End Customer ALL]
${NATIVE_HEADER}
YORKMOTC/SC500093/127113         Red 13ml Threadlocker       -1     -8.98
`;
    const result = parseAutopart561l(toxic);
    expect(result.detectedAccounts).toEqual(["YORKMOT"]);
    expect(result.reportStartCustomer).toBe("YORKMOTO");
  });
});
