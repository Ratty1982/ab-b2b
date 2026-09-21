import { z } from "zod";
import { PRODUCT_STATUSES, slugifyCatalogue, type ProductStatus } from "@/domain/catalogue";
import { sanitizeProductDescriptionHtml } from "@/domain/product-content-html";
import {
  SPEC_LABELS,
  type ProductProvenance,
  type ProductSellingContent,
  type SpecRow,
  upsertSpecRows,
} from "@/domain/product-specifications";

export const PRODUCT_CONTENT_JSON_SCHEMA_VERSION = "1.0";

const skippableString = z.union([z.string(), z.null()]).optional();
const skippableStringList = z.union([z.array(z.string()), z.null()]).optional();
const skippableBool = z.union([z.boolean(), z.null()]).optional();

function moneyField() {
  return z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined || value === null || value === "") return;
      const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > 99_999_999) {
        ctx.addIssue({ code: "custom", message: "invalid price" });
      }
    });
}

function intField() {
  return z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .superRefine((value, ctx) => {
      if (value === undefined || value === null || value === "") return;
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 10_000) {
        ctx.addIssue({ code: "custom", message: "invalid pack quantity" });
      }
    });
}

export const productContentJsonV1Schema = z
  .object({
    schemaVersion: z.literal(PRODUCT_CONTENT_JSON_SCHEMA_VERSION),
    identity: z
      .object({
        sku: skippableString,
        name: skippableString,
        brand: skippableString,
        category: skippableString,
        subcategory: skippableString,
        status: z.union([z.enum(PRODUCT_STATUSES), z.null()]).optional(),
        tradeVisible: skippableBool,
      })
      .passthrough()
      .optional(),
    content: z
      .object({
        shortDescription: skippableString,
        description: skippableString,
        keyBenefits: skippableStringList,
        features: skippableStringList,
        applications: skippableStringList,
        directions: skippableString,
        warnings: skippableString,
      })
      .passthrough()
      .optional(),
    specifications: z
      .object({
        size: skippableString,
        productType: skippableString,
        form: skippableString,
        containerType: skippableString,
        ean: skippableString,
        mpn: skippableString,
        additional: z.union([z.record(z.string(), z.union([z.string(), z.number(), z.null()])), z.null()]).optional(),
      })
      .passthrough()
      .optional(),
    commercial: z
      .object({
        rrp: moneyField(),
        baseTradePrice: moneyField(),
        vatRate: z.union([z.number(), z.string(), z.null()]).optional(),
        packQty: intField(),
        caseQty: z.union([z.number(), z.string(), z.null()]).optional(),
        minimumOrderQty: intField(),
        orderIncrement: intField(),
      })
      .passthrough()
      .optional(),
    media: z
      .object({
        primaryImage: skippableString,
        gallery: skippableStringList,
        imageAlt: skippableString,
      })
      .passthrough()
      .optional(),
    seo: z
      .object({
        metaTitle: skippableString,
        metaDescription: skippableString,
        slug: skippableString,
        keywords: skippableStringList,
      })
      .passthrough()
      .optional(),
    merchandising: z
      .object({
        featured: skippableBool,
        newProduct: skippableBool,
        relatedSkus: skippableStringList,
        crossSellSkus: skippableStringList,
      })
      .passthrough()
      .optional(),
    source: z
      .object({
        manufacturerUrl: skippableString,
        supplierUrl: skippableString,
        notes: skippableString,
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ProductContentJsonV1 = z.infer<typeof productContentJsonV1Schema>;

export type JsonImportIssue = {
  level: "error" | "warning" | "info";
  code: string;
  message: string;
};

export type JsonImportSection = "identity" | "content" | "specifications" | "commercial" | "seo" | "merchandising" | "media" | "source";

export type JsonImportChange = {
  key: string;
  section: JsonImportSection;
  label: string;
  current: string;
  proposed: string;
};

export type ProductContentJsonPatch = {
  name?: string;
  brandId?: string;
  categoryId?: string | null;
  status?: ProductStatus;
  isTradeVisible?: boolean;
  shortDescription?: string;
  description?: string;
  ean?: string;
  mpn?: string;
  rrp?: number;
  tradePrice?: number;
  vatCode?: "STANDARD" | "ZERO_RATED";
  packQty?: number;
  caseQty?: number | null;
  minOrderQty?: number;
  orderIncrement?: number;
  metaTitle?: string;
  metaDescription?: string;
  slug?: string;
  isFeatured?: boolean;
  isNew?: boolean;
  specRowsUpsert?: SpecRow[];
  selling?: Partial<ProductSellingContent>;
  provenance?: Partial<ProductProvenance>;
  seoKeywords?: string[];
  mediaAlt?: string;
  attachMediaIds?: string[];
};

export type ProductContentJsonSnapshot = {
  id: string;
  sku: string;
  name: string;
  slug: string;
  brandId: string;
  brandName: string;
  categoryId: string | null;
  categoryName: string | null;
  parentCategoryName: string | null;
  status: ProductStatus;
  isTradeVisible: boolean;
  isFeatured: boolean;
  isNew: boolean;
  shortDescription: string | null;
  description: string | null;
  ean: string | null;
  mpn: string | null;
  rrp: number | null;
  tradePrice: number | null;
  vatCode: "STANDARD" | "ZERO_RATED";
  packQty: number;
  caseQty: number | null;
  minOrderQty: number;
  orderIncrement: number;
  metaTitle: string | null;
  metaDescription: string | null;
  specRows: SpecRow[];
  selling: ProductSellingContent;
  provenance: ProductProvenance;
  seoKeywords: string[];
  primaryMediaAlt: string | null;
  otherProductSlugs: string[];
};

export type CatalogueLookup = {
  brands: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; parentId: string | null; parentName: string | null }>;
  cmsMediaIds: string[];
  knownSkus: string[];
};

export type ProductContentJsonPreview = {
  schemaValid: boolean;
  skuMatched: boolean | null;
  brandMatched: boolean | null;
  categoryMatched: boolean | null;
  issues: JsonImportIssue[];
  changes: JsonImportChange[];
  skipped: string[];
  unsupported: string[];
  unresolved: string[];
  patch: ProductContentJsonPatch;
  schemaVersion: string;
};

/** Merge v1: omitted, null and empty arrays do not change stored values. */
export function isProvidedMergeValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0) return false;
  return true;
}

function extraKeys(record: Record<string, unknown> | undefined, allowed: string[], prefix: string): string[] {
  if (!record) return [];
  return Object.keys(record)
    .filter((key) => !allowed.includes(key))
    .map((key) => `${prefix}.${key}`);
}

function display(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function formatGbp(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asInt(value: unknown): number | null {
  const n = asNumber(value);
  if (n == null || !Number.isInteger(n)) return null;
  return n;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function looksLikeCuid(value: string): boolean {
  return /^c[a-z0-9]{20,}$/i.test(value.trim());
}

function matchName<T extends { name: string }>(rows: T[], name: string): T[] {
  const needle = name.trim().toLowerCase();
  return rows.filter((row) => row.name.trim().toLowerCase() === needle);
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const IDENTITY_KEYS = ["sku", "name", "brand", "category", "subcategory", "status", "tradeVisible"];
const CONTENT_KEYS = ["shortDescription", "description", "keyBenefits", "features", "applications", "directions", "warnings"];
const SPEC_KEYS = ["size", "productType", "form", "containerType", "ean", "mpn", "additional"];
const COMMERCIAL_KEYS = ["rrp", "baseTradePrice", "vatRate", "packQty", "caseQty", "minimumOrderQty", "orderIncrement"];
const MEDIA_KEYS = ["primaryImage", "gallery", "imageAlt"];
const SEO_KEYS = ["metaTitle", "metaDescription", "slug", "keywords"];
const MERCH_KEYS = ["featured", "newProduct", "relatedSkus", "crossSellSkus"];
const SOURCE_KEYS = ["manufacturerUrl", "supplierUrl", "notes"];
const ROOT_KEYS = ["schemaVersion", "identity", "content", "specifications", "commercial", "media", "seo", "merchandising", "source"];

export function parseProductContentJsonText(raw: string): { ok: true; data: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Paste a Product Content JSON object to validate." };
  try {
    return { ok: true, data: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, error: "The pasted text is not valid JSON." };
  }
}

export function parseProductContentJson(data: unknown):
  | { ok: true; value: ProductContentJsonV1; extraKeys: string[] }
  | { ok: false; error: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "JSON must be an object." };
  }
  const rec = data as Record<string, unknown>;
  const version = rec["schemaVersion"];
  if (version !== PRODUCT_CONTENT_JSON_SCHEMA_VERSION) {
    return {
      ok: false,
      error:
        version == null
          ? "schemaVersion is required and must be \"1.0\"."
          : `Unsupported schemaVersion "${String(version)}". This importer accepts "1.0" only.`,
    };
  }
  const parsed = productContentJsonV1Schema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.length ? first.path.join(".") : "JSON";
    return { ok: false, error: `${path}: ${first?.message ?? "invalid JSON"}` };
  }
  return {
    ok: true,
    value: parsed.data,
    extraKeys: extraKeys(rec, ROOT_KEYS, ""),
  };
}

export function previewProductContentJson(
  snapshot: ProductContentJsonSnapshot,
  lookup: CatalogueLookup,
  data: unknown,
): ProductContentJsonPreview {
  const parsed = parseProductContentJson(data);
  if (!parsed.ok) {
    return {
      schemaValid: false,
      skuMatched: null,
      brandMatched: null,
      categoryMatched: null,
      issues: [{ level: "error", code: "INVALID_JSON", message: parsed.error }],
      changes: [],
      skipped: [],
      unsupported: [],
      unresolved: [],
      patch: {},
      schemaVersion: PRODUCT_CONTENT_JSON_SCHEMA_VERSION,
    };
  }

  const json = parsed.value;
  const issues: JsonImportIssue[] = [];
  const changes: JsonImportChange[] = [];
  const skipped: string[] = [];
  const unsupported = [...parsed.extraKeys.filter(Boolean)];
  const unresolved: string[] = [];
  const patch: ProductContentJsonPatch = {};

  const identity = json.identity as Record<string, unknown> | undefined;
  const content = json.content as Record<string, unknown> | undefined;
  const specifications = json.specifications as Record<string, unknown> | undefined;
  const commercial = json.commercial as Record<string, unknown> | undefined;
  const media = json.media as Record<string, unknown> | undefined;
  const seo = json.seo as Record<string, unknown> | undefined;
  const merch = json.merchandising as Record<string, unknown> | undefined;
  const source = json.source as Record<string, unknown> | undefined;

  unsupported.push(
    ...extraKeys(identity, IDENTITY_KEYS, "identity"),
    ...extraKeys(content, CONTENT_KEYS, "content"),
    ...extraKeys(specifications, SPEC_KEYS, "specifications"),
    ...extraKeys(commercial, COMMERCIAL_KEYS, "commercial"),
    ...extraKeys(media, MEDIA_KEYS, "media"),
    ...extraKeys(seo, SEO_KEYS, "seo"),
    ...extraKeys(merch, MERCH_KEYS, "merchandising"),
    ...extraKeys(source, SOURCE_KEYS, "source"),
  );

  let skuMatched: boolean | null = null;
  if (isProvidedMergeValue(identity?.["sku"])) {
    const jsonSku = String(identity!["sku"]).trim().toUpperCase();
    skuMatched = jsonSku === snapshot.sku.trim().toUpperCase();
    if (!skuMatched) {
      issues.push({
        level: "error",
        code: "SKU_MISMATCH",
        message: `This JSON is for SKU ${jsonSku} but you are editing SKU ${snapshot.sku}.`,
      });
    }
  } else {
    skipped.push("identity.sku");
  }

  function addChange(
    section: JsonImportSection,
    key: string,
    label: string,
    current: string,
    proposed: string,
    apply: () => void,
  ) {
    if (current === proposed) {
      skipped.push(key);
      return;
    }
    changes.push({ key, section, label, current, proposed });
    apply();
  }

  if (isProvidedMergeValue(identity?.["name"])) {
    const name = String(identity!["name"]).trim();
    addChange("identity", "name", "Product name", display(snapshot.name), name, () => {
      patch.name = name;
    });
  } else skipped.push("identity.name");

  let brandMatched: boolean | null = null;
  if (isProvidedMergeValue(identity?.["brand"])) {
    const brandName = String(identity!["brand"]).trim();
    const hits = matchName(lookup.brands, brandName);
    if (hits.length === 1) {
      brandMatched = true;
      const brand = hits[0]!;
      addChange("identity", "brandId", "Brand", display(snapshot.brandName), brand.name, () => {
        patch.brandId = brand.id;
      });
    } else if (hits.length === 0) {
      brandMatched = false;
      issues.push({
        level: "error",
        code: "UNKNOWN_BRAND",
        message: `Unknown brand: "${brandName}". Match an existing Automotive Brands brand or cancel.`,
      });
    } else {
      brandMatched = false;
      issues.push({
        level: "error",
        code: "AMBIGUOUS_BRAND",
        message: `Brand "${brandName}" matches more than one catalogue brand.`,
      });
    }
  } else skipped.push("identity.brand");

  let categoryMatched: boolean | null = null;
  if (isProvidedMergeValue(identity?.["category"]) || isProvidedMergeValue(identity?.["subcategory"])) {
    const categoryName = isProvidedMergeValue(identity?.["category"]) ? String(identity!["category"]).trim() : "";
    const subName = isProvidedMergeValue(identity?.["subcategory"]) ? String(identity!["subcategory"]).trim() : "";
    let resolved: (typeof lookup.categories)[number] | null = null;
    if (categoryName && subName) {
      const parents = matchName(lookup.categories, categoryName).filter((c) => !c.parentId);
      const parent = parents[0] ?? matchName(lookup.categories, categoryName)[0];
      if (!parent) {
        categoryMatched = false;
        issues.push({
          level: "error",
          code: "UNKNOWN_CATEGORY",
          message: `Unknown category: "${categoryName}".`,
        });
      } else {
        const children = matchName(lookup.categories, subName).filter((c) => c.parentId === parent.id);
        if (!children[0]) {
          categoryMatched = false;
          issues.push({
            level: "error",
            code: "UNKNOWN_CATEGORY",
            message: `Unknown subcategory: "${subName}" under "${parent.name}".`,
          });
        } else {
          resolved = children[0]!;
        }
      }
    } else if (categoryName) {
      const hits = matchName(lookup.categories, categoryName);
      if (hits.length === 1) resolved = hits[0]!;
      else if (hits.length === 0) {
        categoryMatched = false;
        issues.push({ level: "error", code: "UNKNOWN_CATEGORY", message: `Unknown category: "${categoryName}".` });
      } else {
        const roots = hits.filter((c) => !c.parentId);
        resolved = roots[0] ?? null;
        if (!resolved) {
          categoryMatched = false;
          issues.push({
            level: "error",
            code: "AMBIGUOUS_CATEGORY",
            message: `Category "${categoryName}" matches more than one record.`,
          });
        }
      }
    } else if (subName) {
      const hits = matchName(lookup.categories, subName);
      if (hits.length === 1) resolved = hits[0]!;
      else {
        categoryMatched = false;
        issues.push({
          level: "error",
          code: "UNKNOWN_CATEGORY",
          message: `Unknown subcategory: "${subName}".`,
        });
      }
    }
    if (resolved) {
      categoryMatched = true;
      const label = resolved.parentName ? `${resolved.parentName} / ${resolved.name}` : resolved.name;
      const current = snapshot.parentCategoryName
        ? `${snapshot.parentCategoryName} / ${snapshot.categoryName}`
        : display(snapshot.categoryName);
      addChange("identity", "categoryId", "Category", current, label, () => {
        patch.categoryId = resolved!.id;
      });
    }
  } else {
    skipped.push("identity.category");
  }

  if (isProvidedMergeValue(identity?.["status"])) {
    const status = String(identity!["status"]) as ProductStatus;
    addChange("identity", "status", "Status", snapshot.status, status, () => {
      patch.status = status;
    });
  } else skipped.push("identity.status");

  if (typeof identity?.["tradeVisible"] === "boolean") {
    addChange(
      "identity",
      "isTradeVisible",
      "Trade visible",
      display(snapshot.isTradeVisible),
      display(identity["tradeVisible"]),
      () => {
        patch.isTradeVisible = identity["tradeVisible"] as boolean;
      },
    );
  } else skipped.push("identity.tradeVisible");

  if (isProvidedMergeValue(content?.["shortDescription"])) {
    const value = String(content!["shortDescription"]).trim();
    addChange("content", "shortDescription", "Short description", display(snapshot.shortDescription), value, () => {
      patch.shortDescription = value;
    });
  } else skipped.push("content.shortDescription");

  if (isProvidedMergeValue(content?.["description"])) {
    const sanitised = sanitizeProductDescriptionHtml(String(content!["description"]));
    addChange("content", "description", "Description", display(snapshot.description), sanitised, () => {
      patch.description = sanitised;
    });
    if (sanitised !== String(content!["description"]).trim()) {
      issues.push({
        level: "info",
        code: "HTML_SANITISED",
        message: "Description HTML was sanitised to the allowed product-description subset.",
      });
    }
  } else skipped.push("content.description");

  const sellingPatch: Partial<ProductSellingContent> = {};
  for (const key of ["keyBenefits", "features", "applications"] as const) {
    if (isProvidedMergeValue(content?.[key])) {
      const list = (content![key] as unknown[]).map((item) => String(item).trim()).filter(Boolean);
      addChange("content", key, key.replace(/[A-Z]/g, (c) => ` ${c}`).replace(/^./, (c) => c.toUpperCase()), display(snapshot.selling[key]), display(list), () => {
        sellingPatch[key] = list;
      });
    } else skipped.push(`content.${key}`);
  }
  for (const key of ["directions", "warnings"] as const) {
    if (isProvidedMergeValue(content?.[key])) {
      const value = String(content![key]).trim();
      addChange("content", key, key[0]!.toUpperCase() + key.slice(1), display(snapshot.selling[key]), value, () => {
        sellingPatch[key] = value;
      });
    } else skipped.push(`content.${key}`);
  }
  if (Object.keys(sellingPatch).length) patch.selling = sellingPatch;

  const specUpsert: SpecRow[] = [];
  for (const [jsonKey, label] of Object.entries(SPEC_LABELS)) {
    if (isProvidedMergeValue(specifications?.[jsonKey])) {
      const value = String(specifications![jsonKey]).trim();
      const current = snapshot.specRows.find((row) => row.name.toLowerCase() === label.toLowerCase())?.value ?? null;
      addChange("specifications", `spec.${label}`, label, display(current), value, () => {
        specUpsert.push({ name: label, value });
      });
    } else skipped.push(`specifications.${jsonKey}`);
  }
  if (isProvidedMergeValue(specifications?.["ean"])) {
    const ean = String(specifications!["ean"]).trim();
    addChange("specifications", "ean", "EAN", display(snapshot.ean), ean, () => {
      patch.ean = ean;
    });
  } else skipped.push("specifications.ean");
  if (isProvidedMergeValue(specifications?.["mpn"])) {
    const mpn = String(specifications!["mpn"]).trim();
    addChange("specifications", "mpn", "MPN", display(snapshot.mpn), mpn, () => {
      patch.mpn = mpn;
    });
  } else skipped.push("specifications.mpn");
  const additional = specifications?.["additional"];
  if (additional && typeof additional === "object" && !Array.isArray(additional)) {
    for (const [name, raw] of Object.entries(additional as Record<string, unknown>)) {
      if (!isProvidedMergeValue(raw)) continue;
      const value = String(raw).trim();
      const current = snapshot.specRows.find((row) => row.name.toLowerCase() === name.toLowerCase())?.value ?? null;
      addChange("specifications", `spec.${name}`, name, display(current), value, () => {
        specUpsert.push({ name, value });
      });
    }
  } else skipped.push("specifications.additional");
  if (specUpsert.length) patch.specRowsUpsert = specUpsert;

  if (isProvidedMergeValue(commercial?.["rrp"])) {
    const rrp = asNumber(commercial!["rrp"]);
    if (rrp == null) issues.push({ level: "error", code: "INVALID_PRICE", message: "commercial.rrp is not a valid price." });
    else {
      addChange("commercial", "rrp", "RRP", snapshot.rrp == null ? "—" : formatGbp(snapshot.rrp), formatGbp(rrp), () => {
        patch.rrp = rrp;
      });
    }
  } else skipped.push("commercial.rrp");

  if (isProvidedMergeValue(commercial?.["baseTradePrice"])) {
    const trade = asNumber(commercial!["baseTradePrice"]);
    if (trade == null) issues.push({ level: "error", code: "INVALID_PRICE", message: "commercial.baseTradePrice is not a valid price." });
    else {
      addChange(
        "commercial",
        "tradePrice",
        "Base trade price",
        snapshot.tradePrice == null ? "—" : formatGbp(snapshot.tradePrice),
        formatGbp(trade),
        () => {
          patch.tradePrice = trade;
        },
      );
    }
  } else skipped.push("commercial.baseTradePrice");

  if (isProvidedMergeValue(commercial?.["vatRate"])) {
    const rate = asNumber(commercial!["vatRate"]);
    if (rate !== 20 && rate !== 0) {
      issues.push({
        level: "error",
        code: "INVALID_VAT",
        message: "commercial.vatRate must be 20 (standard) or 0 (zero-rated).",
      });
    } else {
      const vatCode = rate === 0 ? "ZERO_RATED" : "STANDARD";
      addChange("commercial", "vatCode", "VAT", snapshot.vatCode === "ZERO_RATED" ? "0%" : "20%", rate === 0 ? "0%" : "20%", () => {
        patch.vatCode = vatCode;
      });
    }
  } else skipped.push("commercial.vatRate");

  if (isProvidedMergeValue(commercial?.["packQty"])) {
    const packQty = asInt(commercial!["packQty"]);
    if (packQty == null) issues.push({ level: "error", code: "INVALID_PACK_QTY", message: "commercial.packQty is not a valid pack quantity." });
    else addChange("commercial", "packQty", "Pack qty", display(snapshot.packQty), display(packQty), () => {
      patch.packQty = packQty;
    });
  } else skipped.push("commercial.packQty");

  if (isProvidedMergeValue(commercial?.["caseQty"])) {
    const caseQty = asInt(commercial!["caseQty"]);
    if (caseQty == null) issues.push({ level: "error", code: "INVALID_PACK_QTY", message: "commercial.caseQty is not a valid case quantity." });
    else addChange("commercial", "caseQty", "Case qty", display(snapshot.caseQty), display(caseQty), () => {
      patch.caseQty = caseQty;
    });
  } else skipped.push("commercial.caseQty");

  if (isProvidedMergeValue(commercial?.["minimumOrderQty"])) {
    const minOrderQty = asInt(commercial!["minimumOrderQty"]);
    if (minOrderQty == null) issues.push({ level: "error", code: "INVALID_PACK_QTY", message: "commercial.minimumOrderQty is invalid." });
    else addChange("commercial", "minOrderQty", "Minimum order qty", display(snapshot.minOrderQty), display(minOrderQty), () => {
      patch.minOrderQty = minOrderQty;
    });
  } else skipped.push("commercial.minimumOrderQty");

  if (isProvidedMergeValue(commercial?.["orderIncrement"])) {
    const orderIncrement = asInt(commercial!["orderIncrement"]);
    if (orderIncrement == null) issues.push({ level: "error", code: "INVALID_PACK_QTY", message: "commercial.orderIncrement is invalid." });
    else addChange("commercial", "orderIncrement", "Order increment", display(snapshot.orderIncrement), display(orderIncrement), () => {
      patch.orderIncrement = orderIncrement;
    });
  } else skipped.push("commercial.orderIncrement");

  if (isProvidedMergeValue(seo?.["metaTitle"])) {
    const metaTitle = String(seo!["metaTitle"]).trim().slice(0, 80);
    addChange("seo", "metaTitle", "Meta title", display(snapshot.metaTitle), metaTitle, () => {
      patch.metaTitle = metaTitle;
    });
  } else skipped.push("seo.metaTitle");

  if (isProvidedMergeValue(seo?.["metaDescription"])) {
    const metaDescription = String(seo!["metaDescription"]).trim().slice(0, 300);
    addChange("seo", "metaDescription", "Meta description", display(snapshot.metaDescription), metaDescription, () => {
      patch.metaDescription = metaDescription;
    });
  } else skipped.push("seo.metaDescription");

  if (isProvidedMergeValue(seo?.["slug"])) {
    const slug = slugifyCatalogue(String(seo!["slug"]));
    if (snapshot.otherProductSlugs.includes(slug)) {
      issues.push({
        level: "error",
        code: "SLUG_CONFLICT",
        message: `Slug "${slug}" is already used by another product.`,
      });
    } else {
      addChange("seo", "slug", "Slug", snapshot.slug, slug, () => {
        patch.slug = slug;
      });
    }
  } else skipped.push("seo.slug");

  if (isProvidedMergeValue(seo?.["keywords"])) {
    const keywords = (seo!["keywords"] as unknown[]).map((item) => String(item).trim()).filter(Boolean);
    addChange("seo", "seoKeywords", "SEO keywords (stored privately, not a meta keywords tag)", display(snapshot.seoKeywords), display(keywords), () => {
      patch.seoKeywords = keywords;
    });
  } else skipped.push("seo.keywords");

  if (typeof merch?.["featured"] === "boolean") {
    addChange("merchandising", "isFeatured", "Featured", display(snapshot.isFeatured), display(merch["featured"]), () => {
      patch.isFeatured = merch["featured"] as boolean;
    });
  } else skipped.push("merchandising.featured");

  if (typeof merch?.["newProduct"] === "boolean") {
    addChange("merchandising", "isNew", "New product", display(snapshot.isNew), display(merch["newProduct"]), () => {
      patch.isNew = merch["newProduct"] as boolean;
    });
  } else skipped.push("merchandising.newProduct");

  for (const field of ["relatedSkus", "crossSellSkus"] as const) {
    if (isProvidedMergeValue(merch?.[field])) {
      const skus = (merch![field] as unknown[]).map((item) => String(item).trim()).filter(Boolean);
      const known = new Set(lookup.knownSkus.map((sku) => sku.toUpperCase()));
      const missing = skus.filter((sku) => !known.has(sku.toUpperCase()));
      unsupported.push(`merchandising.${field}`);
      issues.push({
        level: "info",
        code: "RELATED_DEFERRED",
        message: `${field} is not stored in v1 — related/cross-sell relationships are not modelled yet.`,
      });
      for (const sku of missing) unresolved.push(`${field}:${sku}`);
    } else skipped.push(`merchandising.${field}`);
  }

  const attachMediaIds: string[] = [];
  const inspectMediaRef = (raw: string, field: string) => {
    const value = raw.trim();
    if (looksLikeUrl(value)) {
      unresolved.push(`${field}:${value}`);
      issues.push({
        level: "warning",
        code: "UNSUPPORTED_MEDIA",
        message: `${field} is an external URL and will not be downloaded. Use the Media Library.`,
      });
      return;
    }
    if (looksLikeCuid(value)) {
      if (lookup.cmsMediaIds.includes(value)) attachMediaIds.push(value);
      else {
        unresolved.push(`${field}:${value}`);
        issues.push({ level: "warning", code: "UNSUPPORTED_MEDIA", message: `${field} is not a known Media Library id.` });
      }
      return;
    }
    unresolved.push(`${field}:${value}`);
    issues.push({ level: "warning", code: "UNSUPPORTED_MEDIA", message: `${field} is not a Media Library id.` });
  };
  if (isProvidedMergeValue(media?.["primaryImage"])) inspectMediaRef(String(media!["primaryImage"]), "media.primaryImage");
  else skipped.push("media.primaryImage");
  if (isProvidedMergeValue(media?.["gallery"])) {
    for (const item of media!["gallery"] as unknown[]) inspectMediaRef(String(item), "media.gallery");
  } else skipped.push("media.gallery");
  if (attachMediaIds.length) {
    patch.attachMediaIds = [...new Set(attachMediaIds)];
    changes.push({
      key: "media.attach",
      section: "media",
      label: "Media library attachments",
      current: "Existing images kept",
      proposed: `${patch.attachMediaIds.length} Media Library asset(s) will be attached (nothing is removed).`,
    });
  }
  if (isProvidedMergeValue(media?.["imageAlt"])) {
    const imageAlt = String(media!["imageAlt"]).trim();
    addChange("media", "mediaAlt", "Primary image alt text", display(snapshot.primaryMediaAlt), imageAlt, () => {
      patch.mediaAlt = imageAlt;
    });
  } else skipped.push("media.imageAlt");

  const provenance: Partial<ProductProvenance> = {};
  for (const key of ["manufacturerUrl", "supplierUrl"] as const) {
    if (isProvidedMergeValue(source?.[key])) {
      const url = String(source![key]).trim();
      if (!validHttpUrl(url)) {
        issues.push({ level: "error", code: "INVALID_URL", message: `source.${key} is not a valid http(s) URL.` });
      } else {
        addChange("source", key, key === "manufacturerUrl" ? "Manufacturer URL" : "Supplier URL", display(snapshot.provenance[key]), url, () => {
          provenance[key] = url;
        });
      }
    } else skipped.push(`source.${key}`);
  }
  if (isProvidedMergeValue(source?.["notes"])) {
    const notes = String(source!["notes"]).trim();
    addChange("source", "notes", "Source notes (internal)", display(snapshot.provenance.notes), notes, () => {
      provenance.notes = notes;
    });
  } else skipped.push("source.notes");
  if (Object.keys(provenance).length) patch.provenance = provenance;

  const blocking = issues.some((issue) => issue.level === "error");
  return {
    schemaValid: !blocking,
    skuMatched,
    brandMatched,
    categoryMatched,
    issues,
    changes,
    skipped: [...new Set(skipped)],
    unsupported: [...new Set(unsupported)],
    unresolved: [...new Set(unresolved)],
    patch: blocking ? {} : patch,
    schemaVersion: PRODUCT_CONTENT_JSON_SCHEMA_VERSION,
  };
}

export function catalogueActivityLabel(action: string): string {
  if (action === "catalogue.product_json_import") return "Product content updated via JSON import";
  if (action === "catalogue.product_updated") return "Product updated";
  if (action === "catalogue.product_status_changed") return "Product status changed";
  if (action === "catalogue.product_created") return "Product created";
  return action.replace(/^catalogue\./, "").replace(/_/g, " ");
}

export { upsertSpecRows };
