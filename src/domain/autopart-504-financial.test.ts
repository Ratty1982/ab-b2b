import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AUTOPART_504_DAYEND_HEADER,
  AUTOPART_504_DAYEND_TITLE,
} from "@/domain/autopart-504-dayend-fixture";
import {
  autopart504TripleBalances,
  isAutopart504ImportableRow,
  parseAutopart504Report,
} from "@/domain/autopart-504";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/autopart-504-20261019.sanitised.txt"),
  "utf8",
);

const TRUNCATED = {
  SC506126: { goods: "-44.16", vat: "-8.83", value: "-52.99", storedGoods: "44.16" },
  SC506127: { goods: "-31.66", vat: "-6.33", value: "-37.99", storedGoods: "31.66" },
  SS306549: { goods: "107.48", vat: "21.49", value: "128.97", storedGoods: "7.48" },
  SS306576: { goods: "187.01", vat: "37.40", value: "224.41", storedGoods: "87.01" },
  SS306579: { goods: "237.12", vat: "47.42", value: "284.54", storedGoods: "37.12" },
  SS306591: { goods: "399.20", vat: "79.84", value: "479.04", storedGoods: "99.20" },
  SS306594: { goods: "657.60", vat: "131.52", value: "789.12", storedGoods: "57.60" },
  SS306595: { goods: "231.60", vat: "46.32", value: "277.92", storedGoods: "31.60" },
} as const;

function minor(raw: string | null): number {
  return Math.round(Number(raw) * 100);
}

function productionRow(args: {
  type?: string;
  document: string;
  name?: string;
  goods: string;
  vat: string;
  value: string;
  inits?: string;
  order?: string;
  omitVat?: boolean;
}): string {
  const chars = Array.from({ length: 140 }, () => " ");
  const put = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) chars[at + i] = text[i]!;
  };
  const putRight = (end: number, text: string) => put(end - text.length + 1, text);
  put(0, (args.type ?? "ACCOUNT").padEnd(10, " ").slice(0, 10));
  put(10, args.document.padEnd(9, " ").slice(0, 9));
  put(19, "19 Oct 26".padEnd(10, " ").slice(0, 10));
  put(29, "12:00".padEnd(6, " ").slice(0, 6));
  put(35, (args.name ?? "Example Customer").padEnd(34, " ").slice(0, 34));
  putRight(75, args.goods);
  if (!args.omitVat) putRight(84, args.vat);
  putRight(96, args.value);
  put(98, (args.inits ?? "RS").padEnd(2, " ").slice(0, 2));
  put(105, args.order ?? "REF-EXAMPLE");
  return chars.join("").trimEnd();
}

function report(rows: string[]): string {
  return [AUTOPART_504_DAYEND_TITLE, AUTOPART_504_DAYEND_HEADER, ...rows].join("\n");
}

describe("504 fixed-width financial parsing — 19 October 2026", () => {
  const parsed = parseAutopart504Report(fixture);
  const docs = parsed.rows.filter(isAutopart504ImportableRow);

  it("parses all 60 sanitised document rows and reconciles the report footer", () => {
    expect(fixture).not.toMatch(/eBay|Amazon|Fluiconnecto|Halfords|Redditch|Vertu|Power Maxed/i);
    expect(fixture).not.toMatch(/\d{2}-\d{5}-\d{5}/);
    expect(parsed.layoutMode).toBe("fixed-width");
    expect(parsed.headerFound).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(docs).toHaveLength(60);
    expect(parsed.creditRows).toHaveLength(2);
    expect(parsed.invoiceRows).toHaveLength(58);
    expect(parsed.grandTotal).toEqual({ goods: "2958.30", vat: "591.54", value: "3549.84" });
    expect(docs.reduce((sum, row) => sum + minor(row.goods), 0)).toBe(295830);
    expect(docs.reduce((sum, row) => sum + minor(row.vat), 0)).toBe(59154);
    expect(docs.reduce((sum, row) => sum + minor(row.value), 0)).toBe(354984);
    expect(docs.every((row) => autopart504TripleBalances(row.goods, row.vat, row.value))).toBe(true);
    expect(parsed.rows.some((row) => row.classification === "HEADER")).toBe(true);
    expect(parsed.rows.some((row) => row.classification === "SUBTOTAL")).toBe(true);
    expect(parsed.rows.some((row) => row.classification === "TOTAL")).toBe(true);
    expect(docs.some((row) => row.goods === "2958.30")).toBe(false);
  });

  it("keeps both credit notes negative and restores the eight truncated goods amounts", () => {
    for (const [reference, expected] of Object.entries(TRUNCATED)) {
      const row = docs.find((candidate) => candidate.documentNumber === reference);
      expect(row?.goods, reference).toBe(expected.goods);
      expect(row?.vat, reference).toBe(expected.vat);
      expect(row?.value, reference).toBe(expected.value);
      expect(row?.goods, reference).not.toBe(expected.storedGoods);
    }
    expect(docs.find((row) => row.documentNumber === "SC506126")?.kind).toBe("CREDIT");
    expect(docs.find((row) => row.documentNumber === "SC506127")?.kind).toBe("CREDIT");
    expect(docs.find((row) => row.documentNumber === "SS306591")).toMatchObject({
      classification: "AB_INVOICE",
      abOrderNumber: "AB-000013",
      customerName: "Cust SS306591",
      documentDate: "2026-10-19",
    });
    expect(docs.find((row) => row.documentNumber === "SS306590")).toMatchObject({
      goods: "0.00",
      vat: "0.00",
      value: "0.00",
      customerOrderNumber: "",
      kind: "INVOICE",
    });
  });
});

describe("504 fixed-width overflow, VAT-free rows, and rejection", () => {
  it("parses five-figure and six-figure amounts that overflow into adjacent columns", () => {
    const parsed = parseAutopart504Report(
      report([
        productionRow({
          document: "SS500001",
          goods: "12345.67",
          vat: "2469.13",
          value: "14814.80",
          order: "PO-504199",
          name: "Unit 12 Garage",
        }),
        productionRow({
          document: "SS500002",
          goods: "123456.78",
          vat: "24691.36",
          value: "148148.14",
        }),
        productionRow({
          type: "ACCOUNT",
          document: "SC500003",
          goods: "-123456.78",
          vat: "-9999.99",
          value: "-133456.77",
        }),
      ]),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.find((row) => row.documentNumber === "SS500001")).toMatchObject({
      goods: "12345.67",
      vat: "2469.13",
      value: "14814.80",
      customerName: "Unit 12 Garage",
      customerOrderNumber: "PO-504199",
      classification: "NON_AB",
    });
    expect(parsed.rows.find((row) => row.documentNumber === "SS500002")).toMatchObject({
      goods: "123456.78",
      vat: "24691.36",
      value: "148148.14",
    });
    expect(parsed.rows.find((row) => row.documentNumber === "SC500003")).toMatchObject({
      kind: "CREDIT",
      goods: "-123456.78",
      vat: "-9999.99",
      value: "-133456.77",
    });
  });

  it("accepts a VAT-free pair and a 1p rounding difference, and rejects an unbalanced or collided row", () => {
    const parsed = parseAutopart504Report(
      report([
        productionRow({ document: "SS500010", goods: "50.00", vat: "", value: "50.00", omitVat: true }),
        productionRow({ document: "SS500011", goods: "10.00", vat: "2.00", value: "12.01" }),
        productionRow({ document: "SS500012", goods: "10.00", vat: "2.00", value: "12.02" }),
        collidedRow(),
      ]),
    );
    expect(parsed.rows.find((row) => row.documentNumber === "SS500010")).toMatchObject({
      goods: "50.00",
      vat: "0.00",
      value: "50.00",
      classification: "NON_AB",
    });
    expect(parsed.rows.find((row) => row.documentNumber === "SS500011")).toMatchObject({
      goods: "10.00",
      vat: "2.00",
      value: "12.01",
    });
    for (const reference of ["SS500012", "SS500013"]) {
      const row = parsed.rows.find((candidate) => candidate.documentNumber === reference);
      expect(row?.classification, reference).toBe("MALFORMED");
      expect(row?.goods, reference).toBeNull();
      expect(row?.malformedReason, reference).toMatch(/refusing truncated or ambiguous values/i);
      expect(isAutopart504ImportableRow(row!)).toBe(false);
    }
  });

  it("rejects an unbalanced CSV triple instead of importing it", () => {
    const parsed = parseAutopart504Report(
      [
        "Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number",
        "ACCOUNT,SS500020,19/10/2026,10:00,Example,50.00,,50.00,WR,WEB-1",
        "ACCOUNT,SS500021,19/10/2026,10:00,Example,50.00,5.00,60.00,WR,WEB-2",
        "ACCOUNT,SS500022,19/10/2026,10:00,Example,10.00,2.00,12.01,WR,WEB-3",
      ].join("\n"),
    );
    expect(parsed.rows.find((row) => row.documentNumber === "SS500020")).toMatchObject({
      goods: "50.00",
      vat: "0.00",
      value: "50.00",
    });
    expect(parsed.rows.find((row) => row.documentNumber === "SS500022")?.value).toBe("12.01");
    const bad = parsed.rows.find((row) => row.documentNumber === "SS500021");
    expect(bad?.classification).toBe("MALFORMED");
    expect(bad?.goods).toBeNull();
    expect(isAutopart504ImportableRow(bad!)).toBe(false);
  });
});

function collidedRow(): string {
  const chars = Array.from({ length: 140 }, () => " ");
  const put = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) chars[at + i] = text[i]!;
  };
  put(0, "ACCOUNT".padEnd(10, " "));
  put(10, "SS500013".padEnd(9, " "));
  put(19, "19 Oct 26 ");
  put(29, "12:00 ");
  put(35, "Collapsed Money");
  put(75 - "99999.99".length + 1, "99999.99");
  put(76, "999999.99");
  put(96 - "100.00".length + 1, "100.00");
  put(98, "RS");
  put(105, "REF-COLLISION");
  return chars.join("").trimEnd();
}
