export type SpecRow = { name: string; value: string };

export type ProductSellingContent = {
  keyBenefits: string[];
  features: string[];
  applications: string[];
  directions: string | null;
  warnings: string | null;
};

export type ProductProvenance = {
  manufacturerUrl: string | null;
  supplierUrl: string | null;
  notes: string | null;
};

export type ProductSpecificationsDocument = {
  rows: SpecRow[];
  selling: ProductSellingContent;
  provenance: ProductProvenance;
  seoKeywords: string[];
};

const emptySelling = (): ProductSellingContent => ({
  keyBenefits: [],
  features: [],
  applications: [],
  directions: null,
  warnings: null,
});

const emptyProvenance = (): ProductProvenance => ({
  manufacturerUrl: null,
  supplierUrl: null,
  notes: null,
});

function asRows(value: unknown): SpecRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const name = "name" in row ? String(row.name).trim() : "";
      const val = "value" in row ? String(row.value).trim() : "";
      if (!name || !val) return null;
      return { name, value: val };
    })
    .filter((row): row is SpecRow => Boolean(row));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

/**
 * Specifications JSON is historically an array of { name, value }.
 * JSON import stores a document that keeps those rows plus selling copy and
 * private provenance — never shown on the public site automatically.
 */
export function parseSpecificationsDocument(value: unknown): ProductSpecificationsDocument {
  if (Array.isArray(value)) {
    return { rows: asRows(value), selling: emptySelling(), provenance: emptyProvenance(), seoKeywords: [] };
  }
  if (!value || typeof value !== "object") {
    return { rows: [], selling: emptySelling(), provenance: emptyProvenance(), seoKeywords: [] };
  }
  const rec = value as Record<string, unknown>;
  const sellingRaw = rec["selling"] && typeof rec["selling"] === "object" ? (rec["selling"] as Record<string, unknown>) : rec;
  const provenanceRaw =
    rec["provenance"] && typeof rec["provenance"] === "object" ? (rec["provenance"] as Record<string, unknown>) : {};
  return {
    rows: asRows(rec["rows"] ?? rec["specifications"]),
    selling: {
      keyBenefits: asStringArray(sellingRaw["keyBenefits"]),
      features: asStringArray(sellingRaw["features"]),
      applications: asStringArray(sellingRaw["applications"]),
      directions: typeof sellingRaw["directions"] === "string" ? sellingRaw["directions"] : null,
      warnings: typeof sellingRaw["warnings"] === "string" ? sellingRaw["warnings"] : null,
    },
    provenance: {
      manufacturerUrl: typeof provenanceRaw["manufacturerUrl"] === "string" ? provenanceRaw["manufacturerUrl"] : null,
      supplierUrl: typeof provenanceRaw["supplierUrl"] === "string" ? provenanceRaw["supplierUrl"] : null,
      notes: typeof provenanceRaw["notes"] === "string" ? provenanceRaw["notes"] : null,
    },
    seoKeywords: asStringArray(rec["seoKeywords"]),
  };
}

export function serializeSpecificationsDocument(doc: ProductSpecificationsDocument): {
  rows: SpecRow[];
  selling: ProductSellingContent;
  provenance: ProductProvenance;
  seoKeywords: string[];
} {
  return {
    rows: doc.rows,
    selling: doc.selling,
    provenance: doc.provenance,
    seoKeywords: doc.seoKeywords,
  };
}

export function upsertSpecRows(rows: SpecRow[], incoming: SpecRow[]): SpecRow[] {
  const next = [...rows];
  for (const row of incoming) {
    const idx = next.findIndex((existing) => existing.name.toLowerCase() === row.name.toLowerCase());
    if (idx >= 0) next[idx] = row;
    else next.push(row);
  }
  return next;
}

export const SPEC_LABELS: Record<string, string> = {
  size: "Size",
  productType: "Product type",
  form: "Form",
  containerType: "Container type",
};
