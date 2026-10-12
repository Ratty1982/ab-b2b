import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  buildCustomerPriceImportPreview,
  customerPriceFileIssue,
  customerPriceImportTemplateCsv,
  exportNegotiatedPricesCsv,
  parseCustomerPriceCsv,
  parseCustomerPriceXlsx,
  parseImportPriceNumber,
  parseImportPriceText,
} from "@/domain/customer-price-import";

const headers = "SKU,Customer Price Ex VAT,Valid From,Valid Until";

function preview(
  csv: string,
  variants: Array<{ id: string; sku: string; productName: string; tradePrice: string | null }> = [],
  existing: Array<{
    variantId: string;
    unitPrice: string;
    startsAt: string | null;
    endsAt: string | null;
    updatedAt: string;
  }> = [],
) {
  const parsed = parseCustomerPriceCsv(csv);
  expect(parsed.fileIssues).toEqual([]);
  return buildCustomerPriceImportPreview({
    companyId: "company-1",
    rows: parsed.rows,
    variants,
    existingPrices: existing,
    priceListPrices: [],
  });
}

describe("customer price file checks", () => {
  it("accepts csv and xlsx and rejects other types, empty files, and oversized files", () => {
    expect(customerPriceFileIssue({ filename: "prices.csv", byteLength: 20 })).toBeNull();
    expect(customerPriceFileIssue({ filename: "prices.XLSX", byteLength: 20 })).toBeNull();
    expect(customerPriceFileIssue({ filename: "prices.xls", byteLength: 20 })).toMatch(/csv or .xlsx/);
    expect(customerPriceFileIssue({ filename: "prices.csv", byteLength: 0 })).toMatch(/empty/);
    expect(customerPriceFileIssue({ filename: "prices.csv", byteLength: 2_000_001 })).toMatch(/2 MB/);
  });

  it("provides the example template", () => {
    expect(customerPriceImportTemplateCsv()).toContain("SS473,16.50,,");
    expect(customerPriceImportTemplateCsv()).toContain("PM1000,10.50,,");
  });
});

describe("customer price csv and xlsx parsing", () => {
  const catalogue = [
    { id: "v-ss", sku: "SS473", productName: "Screen Wash", tradePrice: "20.0000" },
    { id: "v-pm", sku: "PM500", productName: "Polish", tradePrice: "10.0000" },
  ];

  it("parses a valid csv without trusting any customer column", () => {
    const result = preview(`${headers}\nSS473,16.50,,\nPM500,7.25,2026-01-01,2026-12-31\n`, catalogue);
    expect(result.productsFound).toBe(2);
    expect(result.newCount).toBe(2);
    expect(result.invalidCount).toBe(0);
    expect(result.lines[0]).toMatchObject({
      sku: "SS473",
      productName: "Screen Wash",
      normalPrice: "20.0000",
      proposedPrice: "16.5000",
      action: "NEW",
      percentChange: "-17.5%",
    });
    expect(result.lines[1]?.startsAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.lines[1]?.endsAt).toBe("2026-12-31T00:00:00.000Z");
  });

  it("rejects a customer id column instead of using it", () => {
    const parsed = parseCustomerPriceCsv(`SKU,Customer Price Ex VAT,Customer ID\nSS473,16.50,OTHER\n`);
    expect(parsed.rows).toEqual([]);
    expect(parsed.fileIssues[0]?.message).toMatch(/Unexpected column header/);
    expect(parsed.fileIssues[0]?.message).toContain("customer id");
  });

  it("reports empty, unknown, and duplicate SKUs with row numbers", () => {
    const parsed = parseCustomerPriceCsv(`${headers}\n,16.50,,\nNOPE,4.00,,\nSS473,16.50,,\nSS473,15.00,,\n`);
    const result = buildCustomerPriceImportPreview({
      companyId: "company-1",
      rows: parsed.rows,
      variants: catalogue,
      existingPrices: [],
      priceListPrices: [],
    });
    expect(result.lines.map((line) => [line.rowNumber, line.messages])).toEqual([
      [2, ["SKU is empty"]],
      [3, ["Unknown SKU"]],
      [4, ["Duplicate SKU"]],
      [5, ["Duplicate SKU"]],
    ]);
    expect(result.invalidCount).toBe(4);
    expect(result.newCount).toBe(0);
  });

  it("rejects missing, invalid, zero, negative, and over-precise prices", () => {
    expect(parseImportPriceText("")).toMatchObject({ message: "Missing price" });
    expect(parseImportPriceText("abc")).toMatchObject({ message: "Invalid price" });
    expect(parseImportPriceText("0")).toMatchObject({ message: "Price must be greater than zero" });
    expect(parseImportPriceText("-1.50")).toMatchObject({ message: "Price must be greater than zero" });
    expect(parseImportPriceText("16.50001")).toMatchObject({ message: "Price has more than 4 decimal places" });
    expect(parseImportPriceText("16.5000")).toEqual({ price: "16.5000", message: null });
    expect(parseImportPriceText("£1,234.50")).toEqual({ price: "1234.5000", message: null });
    expect(parseImportPriceNumber(16.5)).toEqual({ price: "16.5000", message: null });
    expect(parseImportPriceNumber(16.12345).message).toMatch(/exact 4 decimal/);
    expect(parseImportPriceNumber(0).message).toMatch(/greater than zero/);
  });

  it("rejects formulas, bad dates, and malformed spreadsheets", async () => {
    const formula = parseCustomerPriceCsv(`${headers}\n=SS473,16.50,,\nPM500,=1+1,,\n`);
    expect(formula.rows[0]?.messages).toContain("Formula values are not allowed");
    expect(formula.rows[1]?.messages).toContain("Formula values are not allowed");
    expect(formula.rows[1]?.proposedPrice).toBeNull();

    const dates = parseCustomerPriceCsv(`${headers}\nSS473,16.50,01/02/2026,\nPM500,7.25,2026-02-31,\nSS473,8.00,2026-05-02,2026-05-01\n`);
    expect(dates.rows[0]?.messages.join(" ")).toMatch(/YYYY-MM-DD/);
    expect(dates.rows[1]?.messages.join(" ")).toMatch(/not a real calendar date/);
    expect(dates.rows[2]?.messages).toContain("Valid Until is before Valid From");

    const broken = await parseCustomerPriceXlsx(new Uint8Array([1, 2, 3, 4]));
    expect(broken.fileIssues[0]?.message).toMatch(/malformed/);
  });

  it("reads xlsx values and refuses formula cells without using their result", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Prices");
    sheet.addRow(["SKU", "Customer Price Ex VAT", "Valid From", "Valid Until"]);
    sheet.addRow(["SS473", 16.5, "2026-03-01", ""]);
    const formulaRow = sheet.addRow(["PM500", null, "", ""]);
    formulaRow.getCell(2).value = { formula: "1+1", result: 99 };
    const bytes = await workbook.xlsx.writeBuffer();
    const parsed = await parseCustomerPriceXlsx(new Uint8Array(bytes));
    expect(parsed.fileIssues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ sku: "SS473", proposedPrice: "16.5000", startsAt: "2026-03-01T00:00:00.000Z" });
    expect(parsed.rows[1]?.proposedPrice).toBeNull();
    expect(parsed.rows[1]?.messages).toContain("Formula values are not allowed");
  });

  it("keeps the worksheet row number when a blank excel row is present", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Prices");
    sheet.getCell("A1").value = "SKU";
    sheet.getCell("B1").value = "Customer Price Ex VAT";
    sheet.getCell("A3").value = "SS473";
    sheet.getCell("B3").value = "12.3456";
    const bytes = await workbook.xlsx.writeBuffer();
    const parsed = await parseCustomerPriceXlsx(new Uint8Array(bytes));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.rowNumber).toBe(3);
    expect(parsed.rows[0]?.proposedPrice).toBe("12.3456");
  });

  it("rejects more than 2000 data rows and duplicate headers", () => {
    const body = Array.from({ length: 2001 }, (_, index) => `SKU${index},1.00,,`).join("\n");
    const tooMany = parseCustomerPriceCsv(`${headers}\n${body}\n`);
    expect(tooMany.fileIssues[0]?.message).toMatch(/2000/);
    expect(tooMany.rows).toEqual([]);
    const duplicate = parseCustomerPriceCsv("SKU,SKU,Customer Price Ex VAT\nA,B,1\n");
    expect(duplicate.fileIssues[0]?.message).toMatch(/Duplicate column header/);
  });
});

describe("customer price preview classification", () => {
  const variant = { id: "v1", sku: "SS473", productName: "Screen Wash", tradePrice: "20.0000" };

  it("classifies new, update, and unchanged rows and leaves the comparison exact at 4dp", () => {
    const result = preview(`${headers}\nSS473,10.0000,,\n`, [variant], [
      {
        variantId: "v1",
        unitPrice: "10.0000",
        startsAt: null,
        endsAt: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(result.unchangedCount).toBe(1);
    expect(result.updateCount).toBe(0);

    const updated = preview(`${headers}\nSS473,12.3456,2026-04-01,\n`, [variant], [
      {
        variantId: "v1",
        unitPrice: "10.0000",
        startsAt: null,
        endsAt: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(updated.lines[0]).toMatchObject({
      action: "UPDATE",
      proposedPrice: "12.3456",
      existingPrice: "10.0000",
      percentChange: "23.5%",
      existingUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("flags an ambiguous product match", () => {
    const result = preview(`${headers}\nSS473,16.50,,\n`, [
      variant,
      { ...variant, id: "v2", productName: "Other" },
    ]);
    expect(result.lines[0]?.messages).toContain("Ambiguous product match");
    expect(result.lines[0]?.variantId).toBeNull();
    expect(result.invalidCount).toBe(1);
  });

  it("uses the assigned price list amount as the normal price when one exists", () => {
    const parsed = parseCustomerPriceCsv(`${headers}\nSS473,8.00,,\n`);
    const result = buildCustomerPriceImportPreview({
      companyId: "company-1",
      rows: parsed.rows,
      variants: [variant],
      existingPrices: [],
      priceListPrices: [{ variantId: "v1", unitPrice: "9.0000" }],
    });
    expect(result.lines[0]?.normalPrice).toBe("9.0000");
    expect(result.lines[0]?.percentChange).toBe("-11.1%");
  });
});

describe("customer price csv export", () => {
  it("prefixes formula-like text so a spreadsheet will not execute it", () => {
    const csv = exportNegotiatedPricesCsv([
      {
        sku: '=HYPERLINK("http://example.invalid")',
        productName: "Safe name",
        unitPrice: "16.5000",
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: null,
      },
    ]);
    expect(csv).toContain(`"'=HYPERLINK(""http://example.invalid"")"`);
    expect(csv.startsWith("SKU,Product,Customer Price Ex VAT")).toBe(true);
    expect(csv).not.toMatch(/^=HYPERLINK/m);
  });
});
