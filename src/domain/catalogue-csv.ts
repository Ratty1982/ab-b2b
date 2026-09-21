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

export function decodeCsvBytes(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) return "";
  const b0 = bytes[0]!;
  const b1 = bytes[1];
  const b2 = bytes[2];
  if (bytes.byteLength >= 3 && b0 === 0xef && b1 === 0xbb && b2 === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.byteLength >= 2 && b0 === 0xff && b1 === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.byteLength >= 2 && b0 === 0xfe && b1 === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  const sampleLen = Math.min(bytes.byteLength, 400);
  let zeros = 0;
  let oddZeros = 0;
  let evenZeros = 0;
  for (let i = 0; i < sampleLen; i += 1) {
    if (bytes[i] !== 0) continue;
    zeros += 1;
    if (i % 2 === 0) evenZeros += 1;
    else oddZeros += 1;
  }
  if (zeros >= sampleLen / 4) {
    if (oddZeros >= evenZeros) return new TextDecoder("utf-16le").decode(bytes);
    return new TextDecoder("utf-16be").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** Strip BOM/nulls so Excel Unicode CSVs can be stored in JSON/Postgres. */
export function ingestCsvText(input: string | Uint8Array): string {
  const raw = typeof input === "string" ? input : decodeCsvBytes(input);
  return raw.replace(/^\uFEFF/, "").replace(/\u0000/g, "");
}

function countUnquoted(src: string, delimiter: string): number {
  let n = 0;
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (ch === '"') {
      if (inQuotes && src[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) n += 1;
  }
  return n;
}

export function detectCsvDelimiter(text: string): "," | ";" | "\t" {
  const normalized = ingestCsvText(text);
  const lines = normalized.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return ",";
  const sepMatch = lines[0]!.match(/^sep\s*=\s*(.)/i);
  if (sepMatch) {
    const marker = sepMatch[1]!;
    if (marker === "," || marker === ";" || marker === "\t") return marker;
  }
  const start = sepMatch ? 1 : 0;
  const sample = lines.slice(start, start + 8).join("\n");
  const scores: Array<{ delimiter: "," | ";" | "\t"; count: number }> = [
    { delimiter: ",", count: countUnquoted(sample, ",") },
    { delimiter: ";", count: countUnquoted(sample, ";") },
    { delimiter: "\t", count: countUnquoted(sample, "\t") },
  ];
  scores.sort((a, b) => b.count - a.count);
  return scores[0]!.count > 0 ? scores[0]!.delimiter : ",";
}

export function parseCsvRecords(text: string, delimiter = detectCsvDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let src = ingestCsvText(text);
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  if (/^sep\s*=/i.test(firstLine.trim())) {
    const nl = src.indexOf("\n");
    src = nl === -1 ? "" : src.slice(nl + 1);
  }
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
    if (ch === delimiter) {
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
