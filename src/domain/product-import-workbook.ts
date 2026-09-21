import ExcelJS from "exceljs";
import { PRODUCT_IMPORT_FIELDS, PRODUCT_CSV_IMPORT_TEMPLATE } from "@/domain/product-import";
import { csvEscape } from "@/domain/catalogue-csv";
import { PRODUCT_STATUSES } from "@/domain/catalogue";

export const IMPORT_TEMPLATE_SHEET = "Products";
export const IMPORT_LISTS_SHEET = "Lists";
const DATA_ROWS = 2000;

export type ImportWorkbookLists = {
  categories: string[];
  subcategories: string[];
  brands: string[];
};

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

function columnLetter(index: number): string {
  let n = index + 1;
  let letter = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null || value === "") return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("hyperlink" in value && "text" in value) return String(value.text ?? "");
  }
  return String(value);
}

export function splitTaxonomyLists(input: {
  categories: Array<{ name: string; parentId: string | null }>;
  brands: Array<{ name: string }>;
}): ImportWorkbookLists {
  return {
    categories: uniqueNames(input.categories.filter((row) => !row.parentId).map((row) => row.name)),
    subcategories: uniqueNames(input.categories.filter((row) => row.parentId).map((row) => row.name)),
    brands: uniqueNames(input.brands.map((row) => row.name)),
  };
}

function addListColumn(sheet: ExcelJS.Worksheet, column: number, title: string, values: string[]) {
  sheet.getCell(1, column).value = title;
  sheet.getCell(1, column).font = { bold: true };
  values.forEach((name, i) => {
    sheet.getCell(i + 2, column).value = name;
  });
}

function listFormula(column: number, count: number): string | null {
  if (count < 1) return null;
  const letter = columnLetter(column - 1);
  return `${IMPORT_LISTS_SHEET}!$${letter}$2:$${letter}$${count + 1}`;
}

function applyListValidation(sheet: ExcelJS.Worksheet, field: (typeof PRODUCT_IMPORT_FIELDS)[number], formula: string | null) {
  if (!formula) return;
  const index = PRODUCT_IMPORT_FIELDS.indexOf(field);
  if (index < 0) return;
  const letter = columnLetter(index);
  const target = sheet as ExcelJS.Worksheet & {
    dataValidations: { add: (range: string, spec: Record<string, unknown>) => void };
  };
  target.dataValidations.add(`${letter}2:${letter}${DATA_ROWS + 1}`, {
    type: "list",
    allowBlank: true,
    formulae: [formula],
    showErrorMessage: false,
    showInputMessage: true,
    promptTitle: "Catalogue list",
    prompt: "Pick a value from the list, or type a new one.",
  });
}

export async function buildProductImportWorkbook(lists: ImportWorkbookLists): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Automotive Brands";
  const products = workbook.addWorksheet(IMPORT_TEMPLATE_SHEET, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  const listSheet = workbook.addWorksheet(IMPORT_LISTS_SHEET);

  PRODUCT_IMPORT_FIELDS.forEach((field, index) => {
    const cell = products.getCell(1, index + 1);
    cell.value = field;
    cell.font = { bold: true };
    products.getColumn(index + 1).width = Math.max(14, field.length + 4);
  });

  const sample = {
    sku: "PM-4410",
    externalRef: "",
    ean: "",
    mpn: "",
    name: "Ceramic Brake Disc Kit 310mm",
    brand: lists.brands[0] ?? "Power Maxed",
    category: lists.categories[0] ?? "Braking",
    subcategory: lists.subcategories[0] ?? "Brake Discs",
    shortDescription: "",
    description: "Example row — replace with your catalogue",
    trade: 46.8,
    rrp: 61.2,
    vat: "standard",
    packQty: 2,
    caseQty: 8,
    minimumOrderQty: "",
    orderIncrement: "",
    unit: "",
    weight: "",
    length: "",
    width: "",
    height: "",
    status: "ACTIVE",
    active: "true",
    tradeVisible: "true",
    featured: "false",
    newProduct: "false",
    slug: "",
    metaTitle: "",
    metaDescription: "",
    primaryImage: "",
  } satisfies Record<(typeof PRODUCT_IMPORT_FIELDS)[number], string | number>;

  PRODUCT_IMPORT_FIELDS.forEach((field, index) => {
    products.getCell(2, index + 1).value = sample[field];
  });

  const categories = uniqueNames(lists.categories);
  const subcategories = uniqueNames(lists.subcategories);
  const brands = uniqueNames(lists.brands);
  addListColumn(listSheet, 1, "category", categories);
  addListColumn(listSheet, 2, "subcategory", subcategories);
  addListColumn(listSheet, 3, "brand", brands);
  addListColumn(listSheet, 4, "status", [...PRODUCT_STATUSES]);
  addListColumn(listSheet, 5, "vat", ["standard", "zero"]);
  addListColumn(listSheet, 6, "yesNo", ["true", "false"]);
  listSheet.columns.forEach((col) => {
    col.width = 28;
  });
  listSheet.state = "veryHidden";

  applyListValidation(products, "category", listFormula(1, categories.length));
  applyListValidation(products, "subcategory", listFormula(2, subcategories.length));
  applyListValidation(products, "brand", listFormula(3, brands.length));
  applyListValidation(products, "status", listFormula(4, PRODUCT_STATUSES.length));
  applyListValidation(products, "vat", listFormula(5, 2));
  for (const field of ["active", "tradeVisible", "featured", "newProduct"] as const) {
    applyListValidation(products, field, listFormula(6, 2));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

export async function workbookToCsv(bytes: Uint8Array): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  const sheet =
    workbook.getWorksheet(IMPORT_TEMPLATE_SHEET) ??
    workbook.worksheets.find((row) => row.name !== IMPORT_LISTS_SHEET) ??
    workbook.worksheets[0];
  if (!sheet) return "";

  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    const last = Math.max(row.cellCount, PRODUCT_IMPORT_FIELDS.length);
    for (let i = 1; i <= last; i += 1) {
      cells.push(cellText(row.getCell(i).value).trim());
    }
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (cells.some((c) => c !== "")) rows.push(cells);
  });
  if (!rows.length) return "";
  return `${rows.map((row) => row.map((cell) => csvEscape(cell)).join(",")).join("\n")}\n`;
}

export function fallbackImportCsvTemplate(): string {
  return PRODUCT_CSV_IMPORT_TEMPLATE;
}
