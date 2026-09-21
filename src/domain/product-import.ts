import { parseCsvRecords, csvEscape } from "@/domain/catalogue-csv";
import { normalizeVatCode, PRODUCT_STATUSES, slugifyCatalogue } from "@/domain/catalogue";

export const PRODUCT_IMPORT_FIELDS = [
  "sku",
  "externalRef",
  "ean",
  "mpn",
  "name",
  "brand",
  "category",
  "subcategory",
  "shortDescription",
  "description",
  "trade",
  "rrp",
  "vat",
  "packQty",
  "caseQty",
  "minimumOrderQty",
  "orderIncrement",
  "unit",
  "weight",
  "length",
  "width",
  "height",
  "status",
  "active",
  "tradeVisible",
  "featured",
  "newProduct",
  "slug",
  "metaTitle",
  "metaDescription",
  "primaryImage",
] as const;

export type ProductImportField = (typeof PRODUCT_IMPORT_FIELDS)[number];

export type ColumnMapping = Partial<Record<ProductImportField, number | null>>;

const FIELD_ALIASES: Record<string, ProductImportField> = {
  sku: "sku",
  "product sku": "sku",
  "product code": "sku",
  externalref: "externalRef",
  "external ref": "externalRef",
  autopart: "externalRef",
  "autopart sku": "externalRef",
  ean: "ean",
  gtin: "ean",
  barcode: "ean",
  mpn: "mpn",
  "part number": "mpn",
  name: "name",
  product: "name",
  "product name": "name",
  brand: "brand",
  category: "category",
  subcategory: "subcategory",
  "sub category": "subcategory",
  "sub-category": "subcategory",
  shortdescription: "shortDescription",
  "short description": "shortDescription",
  description: "description",
  trade: "trade",
  "trade list": "trade",
  "trade price": "trade",
  rrp: "rrp",
  vat: "vat",
  packqty: "packQty",
  "pack qty": "packQty",
  pack: "packQty",
  caseqty: "caseQty",
  "case qty": "caseQty",
  case: "caseQty",
  minimumorderqty: "minimumOrderQty",
  "minimum order qty": "minimumOrderQty",
  moq: "minimumOrderQty",
  orderincrement: "orderIncrement",
  "order increment": "orderIncrement",
  multiple: "orderIncrement",
  unit: "unit",
  uom: "unit",
  weight: "weight",
  weightkg: "weight",
  length: "length",
  width: "width",
  height: "height",
  status: "status",
  active: "active",
  tradevisible: "tradeVisible",
  "trade visible": "tradeVisible",
  featured: "featured",
  newproduct: "newProduct",
  "new product": "newProduct",
  slug: "slug",
  metatitle: "metaTitle",
  "meta title": "metaTitle",
  metadescription: "metaDescription",
  "meta description": "metaDescription",
  primaryimage: "primaryImage",
  "primary image": "primaryImage",
  image: "primaryImage",
};

export function autoMapHeaders(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  headers.forEach((raw, index) => {
    const key = FIELD_ALIASES[raw.trim().toLowerCase()];
    if (key && mapping[key] === undefined) mapping[key] = index;
  });
  return mapping;
}

function parseBoolean(raw: string): { ok: true; value: boolean } | { ok: false } {
  const v = raw.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(v)) return { ok: true, value: true };
  if (["false", "0", "no", "n"].includes(v)) return { ok: true, value: false };
  return { ok: false };
}

export function parseImportNumber(raw: string): number | null {
  let t = raw.replace(/£/g, "").replace(/\s/g, "").trim();
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) {
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) {
      t = t.replace(/\./g, "").replace(",", ".");
    } else {
      t = t.replace(/,/g, "");
    }
  } else if (/^\d+,\d+$/.test(t)) {
    t = t.replace(",", ".");
  } else {
    t = t.replace(/,/g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseStatus(raw: string): (typeof PRODUCT_STATUSES)[number] | null {
  const v = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if ((PRODUCT_STATUSES as readonly string[]).includes(v)) return v as (typeof PRODUCT_STATUSES)[number];
  const asBool = parseBoolean(raw);
  if (asBool.ok) return asBool.value ? "ACTIVE" : "INACTIVE";
  return null;
}

export type ImportCellIssue = {
  line: number;
  sku?: string;
  field?: string;
  level: "error" | "warning";
  message: string;
};

export type ImportParsedRow = {
  line: number;
  sku: string;
  present: ProductImportField[];
  values: Partial<Record<ProductImportField, string>>;
};

export function parseMappedRows(
  csv: string,
  mapping: ColumnMapping,
): { headers: string[]; rows: ImportParsedRow[]; issues: ImportCellIssue[] } {
  const table = parseCsvRecords(csv);
  if (!table.length) {
    return { headers: [], rows: [], issues: [{ line: 1, level: "error", message: "File is empty" }] };
  }
  const headers = table[0]!.map((h) => h.trim());
  const skuIndex = mapping.sku;
  const issues: ImportCellIssue[] = [];
  const rows: ImportParsedRow[] = [];
  const seen = new Set<string>();
  const barcodes = new Map<string, number>();

  if (skuIndex == null) {
    return {
      headers,
      rows: [],
      issues: [{ line: 1, level: "error", message: "Map a SKU column before importing" }],
    };
  }

  for (let r = 1; r < table.length; r += 1) {
    const line = r + 1;
    const cells = table[r]!;
    const sku = (cells[skuIndex] ?? "").trim().toUpperCase();
    const present: ProductImportField[] = [];
    const values: Partial<Record<ProductImportField, string>> = {};
    for (const field of PRODUCT_IMPORT_FIELDS) {
      const idx = mapping[field];
      if (idx == null) continue;
      const raw = (cells[idx] ?? "").trim();
      if (raw === "") continue;
      present.push(field);
      values[field] = raw;
    }
    if (!sku) {
      issues.push({ line, level: "error", message: "SKU is required" });
      continue;
    }
    if (seen.has(sku)) {
      issues.push({ line, sku, level: "error", message: `Duplicate SKU ${sku} in file` });
      continue;
    }
    seen.add(sku);

    if (!present.includes("name") && mapping.name != null && !values.name) {
      // name mapped but empty — only an error for *new* products, handled in preview
    }

    if (values.trade) {
      const n = parseImportNumber(values.trade);
      if (n == null || n < 0) issues.push({ line, sku, field: "trade", level: "error", message: "Invalid trade price" });
    }
    if (values.rrp) {
      const n = parseImportNumber(values.rrp);
      if (n == null || n < 0) issues.push({ line, sku, field: "rrp", level: "error", message: "Invalid RRP" });
    }
    for (const field of ["packQty", "caseQty", "minimumOrderQty", "orderIncrement", "weight", "length", "width", "height"] as const) {
      if (!values[field]) continue;
      const n = parseImportNumber(values[field]!);
      if (n == null || n < 0) {
        issues.push({ line, sku, field, level: "error", message: `Invalid numeric value for ${field}` });
      }
    }
    if (values.vat && !["standard", "zero", "STANDARD", "ZERO", "ZERO_RATED", "zero_rated"].includes(values.vat)) {
      issues.push({ line, sku, field: "vat", level: "error", message: "Invalid VAT (use standard or zero)" });
    }
    for (const field of ["active", "tradeVisible", "featured", "newProduct"] as const) {
      if (!values[field]) continue;
      if (!parseBoolean(values[field]!).ok) {
        issues.push({ line, sku, field, level: "error", message: `Invalid boolean for ${field}` });
      }
    }
    if (values.status && !parseStatus(values.status)) {
      issues.push({ line, sku, field: "status", level: "error", message: "Invalid status" });
    }
    if (values.ean) {
      const key = values.ean.replace(/\s+/g, "");
      const prev = barcodes.get(key);
      if (prev) {
        issues.push({
          line,
          sku,
          field: "ean",
          level: "warning",
          message: `Barcode ${key} also appears on line ${prev}`,
        });
      } else {
        barcodes.set(key, line);
      }
    }
    rows.push({ line, sku, present, values: { ...values, sku } });
  }

  return { headers, rows, issues };
}

export type TaxonomyResolution = {
  name: string;
  matchId: string | null;
  action: "existing" | "create" | "map";
  mapToId?: string | null;
};

export function matchTaxonomyName(
  name: string,
  existing: Array<{ id: string; name: string; slug: string }>,
): string | null {
  const needle = name.trim().toLowerCase();
  const slug = slugifyCatalogue(name);
  const hit = existing.find((row) => row.name.toLowerCase() === needle || row.slug === slug);
  return hit?.id ?? null;
}

export function coerceImportValues(values: Partial<Record<ProductImportField, string>>) {
  const bool = (key: ProductImportField) => {
    const raw = values[key];
    if (!raw) return undefined;
    const parsed = parseBoolean(raw);
    return parsed.ok ? parsed.value : undefined;
  };
  const num = (key: ProductImportField) => {
    const raw = values[key];
    if (!raw) return undefined;
    return parseImportNumber(raw) ?? undefined;
  };
  let status = values.status ? parseStatus(values.status) : undefined;
  const active = bool("active");
  if (!status && active !== undefined) status = active ? "ACTIVE" : "INACTIVE";
  return {
    sku: values.sku?.trim().toUpperCase() ?? "",
    name: values.name?.trim(),
    brand: values.brand?.trim(),
    category: values.category?.trim(),
    subcategory: values.subcategory?.trim(),
    externalRef: values.externalRef?.trim(),
    ean: values.ean?.trim(),
    mpn: values.mpn?.trim(),
    shortDescription: values.shortDescription,
    description: values.description,
    trade: num("trade"),
    rrp: num("rrp"),
    vat: values.vat ? normalizeVatCode(values.vat) : undefined,
    packQty: num("packQty") != null ? Math.round(num("packQty")!) : undefined,
    caseQty: num("caseQty") != null ? Math.round(num("caseQty")!) : undefined,
    minimumOrderQty: num("minimumOrderQty") != null ? Math.round(num("minimumOrderQty")!) : undefined,
    orderIncrement: num("orderIncrement") != null ? Math.round(num("orderIncrement")!) : undefined,
    unit: values.unit?.trim(),
    weightKg: num("weight"),
    lengthMm: num("length"),
    widthMm: num("width"),
    heightMm: num("height"),
    status,
    isTradeVisible: bool("tradeVisible"),
    isFeatured: bool("featured"),
    isNew: bool("newProduct"),
    slug: values.slug ? slugifyCatalogue(values.slug) : undefined,
    metaTitle: values.metaTitle,
    metaDescription: values.metaDescription,
    primaryImage: values.primaryImage?.trim(),
  };
}

export function serializeImportCsv(
  products: Array<Record<string, string | number | boolean | null | undefined>>,
): string {
  const header = PRODUCT_IMPORT_FIELDS.join(",");
  const lines = products.map((p) =>
    PRODUCT_IMPORT_FIELDS.map((field) => csvEscape(p[field] == null ? "" : String(p[field]))).join(","),
  );
  return [header, ...lines].join("\n") + "\n";
}

export const PRODUCT_CSV_IMPORT_TEMPLATE = serializeImportCsv([
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
    active: true,
    status: "ACTIVE",
    tradeVisible: true,
    featured: false,
    newProduct: false,
  },
]);
