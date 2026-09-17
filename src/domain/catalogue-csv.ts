import { productDraftSchema, type ProductDraftInput } from "@/domain/catalogue";

export const PRODUCT_CSV_HEADERS = [
  "sku",
  "name",
  "brand",
  "category",
  "subcategory",
  "trade",
  "rrp",
  "packQty",
  "caseQty",
  "vat",
  "description",
  "active",
] as const;

export type ProductCsvHeader = (typeof PRODUCT_CSV_HEADERS)[number];

const HEADER_ALIASES: Record<string, ProductCsvHeader> = {
  sku: "sku",
  "product sku": "sku",
  name: "name",
  product: "name",
  "product name": "name",
  brand: "brand",
  category: "category",
  subcategory: "subcategory",
  "sub category": "subcategory",
  "sub-category": "subcategory",
  trade: "trade",
  "trade list": "trade",
  "trade price": "trade",
  rrp: "rrp",
  packqty: "packQty",
  "pack qty": "packQty",
  pack: "packQty",
  caseqty: "caseQty",
  "case qty": "caseQty",
  case: "caseQty",
  vat: "vat",
  description: "description",
  active: "active",
};

export function parseCsvRecords(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export type ProductCsvParseResult = {
  rows: ProductDraftInput[];
  errors: Array<{ line: number; message: string }>;
};

export function parseProductCsv(text: string): ProductCsvParseResult {
  const table = parseCsvRecords(text);
  if (!table.length) {
    return { rows: [], errors: [{ line: 1, message: "File is empty" }] };
  }
  const header = table[0]!.map((h) => h.trim().toLowerCase());
  const index: Partial<Record<ProductCsvHeader, number>> = {};
  header.forEach((h, i) => {
    const key = HEADER_ALIASES[h];
    if (key) index[key] = i;
  });
  if (index.sku === undefined || index.name === undefined || index.brand === undefined) {
    return {
      rows: [],
      errors: [{ line: 1, message: "CSV must include sku, name and brand columns" }],
    };
  }

  const rows: ProductDraftInput[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  const seen = new Set<string>();

  for (let r = 1; r < table.length; r += 1) {
    const line = r + 1;
    const cells = table[r]!;
    const get = (key: ProductCsvHeader) => {
      const i = index[key];
      return i === undefined ? "" : (cells[i] ?? "").trim();
    };
    const raw = {
      sku: get("sku"),
      name: get("name"),
      brand: get("brand"),
      category: get("category") || "Uncategorised",
      subcategory: get("subcategory") || null,
      trade: get("trade") || "0",
      rrp: get("rrp") || "0",
      packQty: get("packQty") || "1",
      caseQty: get("caseQty") || "1",
      vat: get("vat") || "standard",
      description: get("description"),
      active: get("active") === "" ? true : !["false", "0", "no", "n"].includes(get("active").toLowerCase()),
    };
    const parsed = productDraftSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({
        line,
        message: parsed.error.issues.map((i) => i.message).join("; "),
      });
      continue;
    }
    const skuKey = parsed.data.sku.toUpperCase();
    if (seen.has(skuKey)) {
      errors.push({ line, message: `Duplicate SKU ${parsed.data.sku} in file` });
      continue;
    }
    seen.add(skuKey);
    rows.push(parsed.data);
  }

  return { rows, errors };
}

export function serializeProductCsv(
  products: Array<{
    sku: string;
    name: string;
    brand: string;
    category: string;
    subcategory?: string | null;
    trade: number;
    rrp: number;
    packQty: number;
    caseQty: number;
    vat?: string;
    description?: string | null;
    isActive?: boolean;
  }>,
): string {
  const header = PRODUCT_CSV_HEADERS.join(",");
  const lines = products.map((p) =>
    [
      p.sku,
      p.name,
      p.brand,
      p.category,
      p.subcategory ?? "",
      String(p.trade),
      String(p.rrp),
      String(p.packQty),
      String(p.caseQty),
      p.vat === "ZERO_RATED" || p.vat === "zero" ? "zero" : "standard",
      p.description ?? "",
      p.isActive === false ? "false" : "true",
    ]
      .map((v) => csvEscape(String(v)))
      .join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

export const PRODUCT_CSV_TEMPLATE = serializeProductCsv([
  {
    sku: "PM-4410",
    name: "Ceramic Brake Disc Kit 310mm",
    brand: "Power Maxed",
    category: "Braking",
    subcategory: "Brake Discs",
    trade: 46.8,
    rrp: 61.2,
    packQty: 2,
    caseQty: 8,
    vat: "standard",
    description: "Example row — replace with your catalogue",
    isActive: true,
  },
]);
