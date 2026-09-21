import { describe, expect, it } from "vitest";
import {
  buildProductImportWorkbook,
  splitTaxonomyLists,
  workbookToCsv,
  IMPORT_TEMPLATE_SHEET,
} from "@/domain/product-import-workbook";
import { parseMappedRows } from "@/domain/product-import";
import ExcelJS from "exceljs";

describe("product import Excel template", () => {
  it("puts live categories and brands in dropdown lists", async () => {
    const lists = splitTaxonomyLists({
      categories: [
        { name: "Braking", parentId: null },
        { name: "Brake Discs", parentId: "p1" },
        { name: "Engine Chemicals", parentId: null },
      ],
      brands: [{ name: "Power Maxed" }, { name: "Steel Seal" }],
    });
    expect(lists.categories).toEqual(["Braking", "Engine Chemicals"]);
    expect(lists.subcategories).toEqual(["Brake Discs"]);

    const buffer = await buildProductImportWorkbook(lists);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(buffer) as unknown as ArrayBuffer);
    const products = workbook.getWorksheet(IMPORT_TEMPLATE_SHEET) as
      | (ExcelJS.Worksheet & {
          dataValidations: { model: Record<string, { formulae?: string[]; type?: string }> };
        })
      | undefined;
    const validations = products?.dataValidations.model ?? {};
    expect(validations["G2"]?.formulae?.[0]).toBe("Lists!$A$2:$A$3");
    expect(validations["G2"]?.type).toBe("list");
    expect(validations["H2"]?.formulae?.[0]).toBe("Lists!$B$2:$B$2");
    expect(validations["F2"]?.formulae?.[0]).toBe("Lists!$C$2:$C$3");

    const csv = await workbookToCsv(buffer);
    const parsed = parseMappedRows(csv, { sku: 0, name: 4, brand: 5, category: 6, subcategory: 7 });
    expect(parsed.rows[0]?.values.category).toBe("Braking");
    expect(parsed.rows[0]?.values.subcategory).toBe("Brake Discs");
    expect(parsed.rows[0]?.values.brand).toBe("Power Maxed");
  });
});
