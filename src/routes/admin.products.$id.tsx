import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { CatalogueMedia } from "@/components/catalogue/CatalogueMedia";
import { MediaPicker } from "@/components/cms/MediaPicker";
import {
  attachCatalogueProductMediaFn,
  detachCatalogueProductMediaFn,
  getCatalogueProductFn,
  listCatalogueBrandsFn,
  listCatalogueCategoriesFn,
  listCompaniesFn,
  listQuantityBreaksFn,
  previewTradePriceAsCustomerFn,
  reorderCatalogueProductMediaFn,
  saveCatalogueProductVariantFn,
  updateCatalogueProductFn,
  upsertQuantityBreakFn,
  deleteQuantityBreakFn,
} from "@/server/phase2/fns";
import { ImportProductJsonButton } from "@/components/catalogue/ImportProductJsonDrawer";
import { EditableStringList } from "@/components/catalogue/EditableStringList";
import { catalogueActivityLabel } from "@/domain/product-content-json";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import { CommercialAuditList } from "@/components/pricing/CommercialAuditList";
import { InternalStockDisplay } from "@/components/ab/InternalStockDisplay";
import { PUBLIC_AVAILABILITY_LABEL } from "@/domain/availability";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Tab = "Overview" | "Content" | "Images" | "Commercial" | "Inventory" | "Variants" | "SEO" | "Activity";

export const Route = createFileRoute("/admin/products/$id")({
  head: () => ({ meta: [{ title: "Product workspace — Automotive Brands Admin" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => {
    const tab = search["tab"];
    if (
      tab === "Overview" ||
      tab === "Content" ||
      tab === "Images" ||
      tab === "Commercial" ||
      tab === "Inventory" ||
      tab === "Variants" ||
      tab === "SEO" ||
      tab === "Activity"
    ) {
      return { tab };
    }
    return {};
  },
  component: ProductWorkspace,
});

type Workspace = Awaited<
  Extract<Awaited<ReturnType<typeof getCatalogueProductFn>>, { ok: true }>["data"]
>;

type ProductDraft = {
  sku: string;
  name: string;
  brandId: string;
  categoryId: string;
  status: Workspace["status"];
  ean: string;
  mpn: string;
  externalRef: string;
  isTradeVisible: boolean;
  isFeatured: boolean;
  isNew: boolean;
  shortDescription: string;
  description: string;
  keyBenefits: string[];
  features: string[];
  applications: string[];
  directions: string;
  warnings: string;
  specifications: Array<{ name: string; value: string }>;
  tradePrice: string;
  rrp: string;
  vat: "standard" | "zero";
  packQty: string;
  caseQty: string;
  minimumOrderQty: string;
  orderIncrement: string;
  unit: string;
  weightKg: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
};

function draftFromProduct(product: Workspace): ProductDraft {
  return {
    sku: product.sku,
    name: product.name,
    brandId: product.brandId,
    categoryId: product.categoryId ?? "",
    status: product.status,
    ean: product.ean ?? "",
    mpn: product.mpn ?? "",
    externalRef: product.externalRef ?? "",
    isTradeVisible: product.isTradeVisible,
    isFeatured: product.isFeatured,
    isNew: product.isNew,
    shortDescription: product.shortDescription ?? "",
    description: product.description ?? "",
    keyBenefits: product.selling?.keyBenefits ?? [],
    features: product.selling?.features ?? [],
    applications: product.selling?.applications ?? [],
    directions: product.selling?.directions ?? "",
    warnings: product.selling?.warnings ?? "",
    specifications: product.specifications.length ? product.specifications : [{ name: "", value: "" }],
    tradePrice: String(product.tradePrice ?? ""),
    rrp: String(product.rrp ?? ""),
    vat: product.vat === "zero" ? "zero" : "standard",
    packQty: String(product.packQty),
    caseQty: String(product.caseQty ?? ""),
    minimumOrderQty: String(product.minimumOrderQty),
    orderIncrement: String(product.orderIncrement),
    unit: product.unit,
    weightKg: String(product.weightKg ?? ""),
    lengthMm: String(product.lengthMm ?? ""),
    widthMm: String(product.widthMm ?? ""),
    heightMm: String(product.heightMm ?? ""),
    slug: product.slug,
    metaTitle: product.metaTitle ?? "",
    metaDescription: product.metaDescription ?? "",
  };
}

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return Number(trimmed);
}

function ProductWorkspace() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const [tab, setTab] = useState<Tab>(search.tab ?? "Overview");
  const [product, setProduct] = useState<Workspace | null>(null);
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; depth: number }>>([]);

  const load = useCallback(async (opts?: { keepDraft?: boolean }) => {
    const [p, b, c] = await Promise.all([
      getCatalogueProductFn({ data: { id } }),
      listCatalogueBrandsFn(),
      listCatalogueCategoriesFn(),
    ]);
    if (!p.ok) {
      setError(p.error);
      setProduct(null);
      if (!opts?.keepDraft) setDraft(null);
      return;
    }
    setError(null);
    setProduct(p.data);
    if (!opts?.keepDraft) {
      setDraft(draftFromProduct(p.data));
      setDirty(false);
    }
    if (b.ok) setBrands(b.data);
    if (c.ok) setCategories(c.data);
  }, [id]);

  useEffect(() => {
    setTab("Overview");
    setDirty(false);
    setDraft(null);
    void load();
  }, [load]);

  function updateDraft<K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
  }

  async function saveAll() {
    if (!product || !draft) return;
    setSaving(true);
    const r = await updateCatalogueProductFn({
      data: {
        id: product.id,
        sku: draft.sku,
        name: draft.name,
        brandId: draft.brandId,
        categoryId: draft.categoryId || null,
        status: draft.status,
        ean: draft.ean,
        mpn: draft.mpn,
        externalRef: draft.externalRef,
        isTradeVisible: draft.isTradeVisible,
        isFeatured: draft.isFeatured,
        isNew: draft.isNew,
        shortDescription: draft.shortDescription,
        description: draft.description,
        selling: {
          keyBenefits: draft.keyBenefits,
          features: draft.features,
          applications: draft.applications,
          directions: draft.directions,
          warnings: draft.warnings,
        },
        specifications: draft.specifications.filter((row) => row.name && row.value),
        tradePrice: optionalNumber(draft.tradePrice),
        rrp: optionalNumber(draft.rrp),
        vat: draft.vat,
        packQty: Number(draft.packQty),
        caseQty: optionalNumber(draft.caseQty),
        minimumOrderQty: Number(draft.minimumOrderQty),
        orderIncrement: Number(draft.orderIncrement),
        unit: draft.unit,
        weightKg: optionalNumber(draft.weightKg),
        lengthMm: optionalNumber(draft.lengthMm),
        widthMm: optionalNumber(draft.widthMm),
        heightMm: optionalNumber(draft.heightMm),
        slug: draft.slug,
        metaTitle: draft.metaTitle,
        metaDescription: draft.metaDescription,
      },
    });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Product saved");
    await load();
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm">{error}</p>
        <Link to="/admin/products" className="mt-4 inline-block text-[13px] font-semibold text-primary">Back to catalogue</Link>
      </div>
    );
  }
  if (!product || !draft) return <p className="p-6 text-[13px] text-steel">Loading product…</p>;

  const tabs: Tab[] = ["Overview", "Content", "Images", "Commercial", "Inventory", "Variants", "SEO", "Activity"];
  const refreshMedia = () => load({ keepDraft: true });

  return (
    <div>
      <PanelHeader
        title={draft.name || product.name}
        sub={`${draft.sku || product.sku} · ${product.brandName}${dirty ? " · unsaved changes" : ""}`}
        crumbs={[
          { label: "Products", to: "/admin/products" },
          { label: draft.name || product.name },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={draft.status === "ACTIVE" ? "good" : "warn"}>{draft.status}</StatusBadge>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveAll()}
              className="h-10 rounded-md bg-primary px-5 text-[12px] font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <Link
              to="/admin/products"
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-semibold uppercase tracking-wide"
            >
              Back to products
            </Link>
          </div>
        }
      />
      <div className="flex gap-1 overflow-x-auto border-b border-border/70 px-4 sm:px-6">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "shrink-0 border-b-2 px-3 py-3 text-[13px] font-semibold",
              tab === t ? "border-primary text-foreground" : "border-transparent text-steel",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="p-4 sm:p-6">
        <div hidden={tab !== "Overview"}>
          <OverviewForm draft={draft} brands={brands} categories={categories} onChange={updateDraft} />
        </div>
        <div hidden={tab !== "Content"}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-steel">Paste researched Product Content JSON to preview a merge. Nothing is written until you apply.</p>
            <ImportProductJsonButton productId={product.id} sku={draft.sku || product.sku} onApplied={() => load()} />
          </div>
          <ContentForm draft={draft} onChange={updateDraft} />
        </div>
        <div hidden={tab !== "Images"}>
          <ImagesForm product={product} onSaved={refreshMedia} />
        </div>
        <div hidden={tab !== "Commercial"}>
          <CommercialForm draft={draft} onChange={updateDraft} />
          {product.defaultVariantId ? (
            <div className="mt-10 space-y-10 border-t border-border/70 pt-8">
              <QuantityBreaksPanel variantId={product.defaultVariantId} />
              <PriceAsCustomerPanel variantId={product.defaultVariantId} sku={product.sku} />
              <CommercialAuditList variantId={product.defaultVariantId} />
            </div>
          ) : null}
        </div>
        <div hidden={tab !== "Inventory"}>
          <InventoryPanel product={product} />
        </div>
        <div hidden={tab !== "Variants"}>
          <VariantsForm product={product} onSaved={refreshMedia} />
        </div>
        <div hidden={tab !== "SEO"}>
          <SeoForm draft={draft} onChange={updateDraft} />
        </div>
        <div hidden={tab !== "Activity"}>
          <ActivityPanel product={product} />
        </div>
        {tab !== "Images" && tab !== "Variants" && tab !== "Inventory" && tab !== "Activity" ? (
          <p className="mt-6 max-w-2xl text-[12px] text-steel">Switch tabs freely. Save in the header writes overview, content, commercial and SEO together.</p>
        ) : null}
      </div>
    </div>
  );
}

function OverviewForm({
  draft,
  brands,
  categories,
  onChange,
}: {
  draft: ProductDraft;
  brands: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; depth: number }>;
  onChange: <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => void;
}) {
  return (
    <div className="grid max-w-2xl gap-4">
      <Field label="SKU" htmlFor="ws-sku"><input id="ws-sku" value={draft.sku} onChange={(e) => onChange("sku", e.target.value)} className={inputClass} /></Field>
      <Field label="Name" htmlFor="ws-name"><input id="ws-name" value={draft.name} onChange={(e) => onChange("name", e.target.value)} className={inputClass} /></Field>
      <Field label="Brand" htmlFor="ws-brand">
        <select id="ws-brand" value={draft.brandId} onChange={(e) => onChange("brandId", e.target.value)} className={inputClass}>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
      <Field label="Category" htmlFor="ws-cat">
        <select id="ws-cat" value={draft.categoryId} onChange={(e) => onChange("categoryId", e.target.value)} className={inputClass}>
          {categories.map((c) => <option key={c.id} value={c.id}>{"— ".repeat(c.depth)}{c.name}</option>)}
        </select>
      </Field>
      <Field label="Status" htmlFor="ws-status">
        <select id="ws-status" value={draft.status} onChange={(e) => onChange("status", e.target.value as Workspace["status"])} className={inputClass}>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="DISCONTINUED">Discontinued</option>
        </select>
      </Field>
      <Field label="EAN / barcode" htmlFor="ws-ean"><input id="ws-ean" value={draft.ean} onChange={(e) => onChange("ean", e.target.value)} className={inputClass} /></Field>
      <Field label="MPN" htmlFor="ws-mpn"><input id="ws-mpn" value={draft.mpn} onChange={(e) => onChange("mpn", e.target.value)} className={inputClass} /></Field>
      <Field label="Autopart / external ref" htmlFor="ws-ext"><input id="ws-ext" value={draft.externalRef} onChange={(e) => onChange("externalRef", e.target.value)} className={inputClass} /></Field>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={draft.isTradeVisible} onChange={(e) => onChange("isTradeVisible", e.target.checked)} />
        Visible to trade customers
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={draft.isFeatured} onChange={(e) => onChange("isFeatured", e.target.checked)} />
        Featured
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={draft.isNew} onChange={(e) => onChange("isNew", e.target.checked)} />
        New product
      </label>
    </div>
  );
}

function ContentForm({
  draft,
  onChange,
}: {
  draft: ProductDraft;
  onChange: <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => void;
}) {
  const shortMax = 500;
  return (
    <div className="grid max-w-3xl gap-6">
      <Field label="Short description" htmlFor="ws-short">
        <textarea
          id="ws-short"
          value={draft.shortDescription}
          maxLength={shortMax}
          onChange={(e) => onChange("shortDescription", e.target.value)}
          className={`${inputClass} min-h-20`}
        />
        <p className="mt-1 text-[11px] text-steel">{draft.shortDescription.length} / {shortMax}</p>
      </Field>
      <Field label="Description" htmlFor="ws-desc">
        <textarea
          id="ws-desc"
          value={draft.description}
          onChange={(e) => onChange("description", e.target.value)}
          className={`${inputClass} min-h-40`}
        />
        <p className="mt-1 text-[11px] text-steel">Plain text or a small allowed HTML subset. Scripts and unsafe markup are stripped on save.</p>
      </Field>
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase text-steel">Key benefits</p>
        <EditableStringList
          value={draft.keyBenefits}
          onChange={(keyBenefits) => onChange("keyBenefits", keyBenefits)}
          addLabel="+ Add benefit"
          placeholder="Customer outcome"
          emptyLabel="No key benefits yet."
        />
      </div>
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase text-steel">Features</p>
        <EditableStringList
          value={draft.features}
          onChange={(features) => onChange("features", features)}
          addLabel="+ Add feature"
          placeholder="Product characteristic"
          emptyLabel="No features yet."
        />
      </div>
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase text-steel">Applications</p>
        <EditableStringList
          value={draft.applications}
          onChange={(applications) => onChange("applications", applications)}
          addLabel="+ Add application"
          placeholder="Suitable for…"
          compact
          emptyLabel="No applications yet."
        />
      </div>
      <Field label="Directions" htmlFor="ws-directions">
        <textarea
          id="ws-directions"
          value={draft.directions}
          onChange={(e) => onChange("directions", e.target.value)}
          className={`${inputClass} min-h-28`}
        />
      </Field>
      <Field label="Warnings / important information" htmlFor="ws-warnings">
        <textarea
          id="ws-warnings"
          value={draft.warnings}
          onChange={(e) => onChange("warnings", e.target.value)}
          className={`${inputClass} min-h-24`}
        />
        <p className="mt-1 text-[11px] text-steel">Leave blank to hide this section on the public product page.</p>
      </Field>
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase text-steel">Specifications</p>
        <div className="mb-2 hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2 text-[11px] font-semibold uppercase tracking-wide text-steel sm:grid">
          <span>Name</span>
          <span>Value</span>
          <span className="sr-only">Remove</span>
        </div>
        {draft.specifications.map((row, i) => (
          <div key={i} className="mb-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2rem] gap-2">
            <input
              value={row.name}
              placeholder="Name"
              aria-label={`Specification ${i + 1} name`}
              className={inputClass}
              onChange={(e) =>
                onChange(
                  "specifications",
                  draft.specifications.map((s, idx) => (idx === i ? { ...s, name: e.target.value } : s)),
                )
              }
            />
            <input
              value={row.value}
              placeholder="Value"
              aria-label={`Specification ${i + 1} value`}
              className={inputClass}
              onChange={(e) =>
                onChange(
                  "specifications",
                  draft.specifications.map((s, idx) => (idx === i ? { ...s, value: e.target.value } : s)),
                )
              }
            />
            <button
              type="button"
              className="grid size-9 place-items-center text-steel hover:text-bad"
              aria-label={`Remove specification ${i + 1}`}
              onClick={() => {
                const next = draft.specifications.filter((_, idx) => idx !== i);
                onChange("specifications", next.length ? next : [{ name: "", value: "" }]);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-[12px] font-semibold text-primary"
          onClick={() => onChange("specifications", [...draft.specifications, { name: "", value: "" }])}
        >
          + Add specification
        </button>
      </div>
    </div>
  );
}

function ImagesForm({ product, onSaved }: { product: Workspace; onSaved: () => Promise<void> }) {
  const [picker, setPicker] = useState(false);
  return (
    <div className="max-w-3xl">
      <p className="mb-4 text-[13px] text-steel">Uses the Website media library. Removing an image here does not delete the file. Image changes apply immediately and do not discard edits on other tabs.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {product.media.map((m, index) => (
          <div key={m.id} className="rounded-lg border border-border p-2">
            <CatalogueMedia src={m.src} alt={m.altText || ""} className="aspect-[4/3] w-full rounded" />
            <div className="mt-2 flex flex-wrap gap-2">
              {m.isPrimary ? <StatusBadge tone="good">Primary</StatusBadge> : (
                <button type="button" className="text-[11px] font-semibold" onClick={() => void reorderCatalogueProductMediaFn({ data: { productId: product.id, orderedIds: product.media.map((x) => x.id), primaryId: m.id } }).then(onSaved)}>Set primary</button>
              )}
              {index > 0 ? (
                <button type="button" className="text-[11px] font-semibold" onClick={() => {
                  const ids = product.media.map((x) => x.id);
                  [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
                  void reorderCatalogueProductMediaFn({ data: { productId: product.id, orderedIds: ids } }).then(onSaved);
                }}>Up</button>
              ) : null}
              <button type="button" className="text-[11px] font-semibold text-bad" onClick={() => void detachCatalogueProductMediaFn({ data: { id: m.id, productId: product.id } }).then(onSaved)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="mt-4 h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase" onClick={() => setPicker(true)}>Select or upload image</button>
      <MediaPicker
        open={picker}
        usage="PRODUCT_IMAGE"
        onClose={() => setPicker(false)}
        onSelect={(item) => {
          void attachCatalogueProductMediaFn({
            data: { productId: product.id, mediaId: item.id, altText: item.altText, isPrimary: product.media.length === 0 },
          }).then((r) => {
            if (!r.ok) toast.error(r.error);
            else void onSaved();
          });
        }}
      />
    </div>
  );
}

function CommercialForm({
  draft,
  onChange,
}: {
  draft: ProductDraft;
  onChange: <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => void;
}) {
  return (
    <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <p className="sm:col-span-2 text-[13px] text-steel">Base catalogue commercial data. Customer prices and price lists are resolved by the trade pricing engine; preview below does not change stored prices.</p>
      <Field label="Base trade price" htmlFor="ws-trade"><input id="ws-trade" value={draft.tradePrice} onChange={(e) => onChange("tradePrice", e.target.value)} className={inputClass} /></Field>
      <Field label="RRP" htmlFor="ws-rrp"><input id="ws-rrp" value={draft.rrp} onChange={(e) => onChange("rrp", e.target.value)} className={inputClass} /></Field>
      <Field label="VAT" htmlFor="ws-vat">
        <select id="ws-vat" value={draft.vat} onChange={(e) => onChange("vat", e.target.value as "standard" | "zero")} className={inputClass}>
          <option value="standard">Standard</option>
          <option value="zero">Zero</option>
        </select>
      </Field>
      <Field label="Pack qty" htmlFor="ws-pack"><input id="ws-pack" value={draft.packQty} onChange={(e) => onChange("packQty", e.target.value)} className={inputClass} /></Field>
      <Field label="Case qty" htmlFor="ws-case"><input id="ws-case" value={draft.caseQty} onChange={(e) => onChange("caseQty", e.target.value)} className={inputClass} /></Field>
      <Field label="Minimum order qty" htmlFor="ws-moq"><input id="ws-moq" value={draft.minimumOrderQty} onChange={(e) => onChange("minimumOrderQty", e.target.value)} className={inputClass} /></Field>
      <Field label="Order increment" htmlFor="ws-inc"><input id="ws-inc" value={draft.orderIncrement} onChange={(e) => onChange("orderIncrement", e.target.value)} className={inputClass} /></Field>
      <Field label="Unit" htmlFor="ws-unit"><input id="ws-unit" value={draft.unit} onChange={(e) => onChange("unit", e.target.value)} className={inputClass} /></Field>
      <Field label="Weight (kg)" htmlFor="ws-w"><input id="ws-w" value={draft.weightKg} onChange={(e) => onChange("weightKg", e.target.value)} className={inputClass} /></Field>
      <Field label="Length (mm)" htmlFor="ws-l"><input id="ws-l" value={draft.lengthMm} onChange={(e) => onChange("lengthMm", e.target.value)} className={inputClass} /></Field>
      <Field label="Width (mm)" htmlFor="ws-wd"><input id="ws-wd" value={draft.widthMm} onChange={(e) => onChange("widthMm", e.target.value)} className={inputClass} /></Field>
      <Field label="Height (mm)" htmlFor="ws-h"><input id="ws-h" value={draft.heightMm} onChange={(e) => onChange("heightMm", e.target.value)} className={inputClass} /></Field>
    </div>
  );
}

function InventoryPanel({ product }: { product: Workspace }) {
  if (!product.inventory.length) {
    return (
      <div className="max-w-xl rounded-lg border border-dashed border-border p-6">
        <p className="font-semibold">No Autopart stock recorded</p>
        <p className="mt-2 text-[13px] text-steel">
          Sellable quantity comes from Autopart 231PO3NEW Avail, matched on SKU. Nothing is invented here until a successful sync.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2 text-right">Available</th>
              <th className="px-3 py-2">Customer status</th>
              <th className="px-3 py-2">Last sync</th>
            </tr>
          </thead>
          <tbody>
            {product.inventory.map((row) => (
              <tr key={`${row.variantSku}-${row.warehouseCode}`} className="border-b border-border/60">
                <td className="num px-3 py-2">{row.variantSku}</td>
                <td className="px-3 py-2">
                  {row.source === "231PO3NEW" ? "Autopart 231PO3NEW" : row.warehouse}
                  {row.stale ? <span className="ml-2 text-[10px] font-semibold uppercase text-warn">Stale</span> : null}
                </td>
                <td className="num px-3 py-2 text-right">{row.sellableQty ?? row.qtyOnHand ?? "—"}</td>
                <td className="px-3 py-2">
                  <InternalStockDisplay qty={null} availability={row.customerAvailability} stale={row.stale} className="justify-start" />
                  {row.customerAvailability ? (
                    <span className="sr-only">{PUBLIC_AVAILABILITY_LABEL[row.customerAvailability]}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-steel">
                  {row.externalSyncedAt
                    ? new Date(row.externalSyncedAt).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-steel">
        Autopart stock is the exact Avail figure. Customers see only IN STOCK / LOW STOCK / OUT OF STOCK. Case quantity does not change this number.
      </p>
    </div>
  );
}

function VariantsForm({ product, onSaved }: { product: Workspace; onSaved: () => Promise<void> }) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-[13px] text-steel">Simple products use one default SKU. Extra variants are for pack size, colour or fitment later — not a full configurator. Adding a variant does not discard edits on other tabs.</p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {product.variants.map((v) => (
          <li key={v.id} className="flex items-center justify-between px-3 py-2 text-[13px]">
            <span className="num text-primary">{v.sku}</span>
            <span>{v.name || "Default"}</span>
            {v.isDefault ? <StatusBadge tone="good">Default</StatusBadge> : null}
          </li>
        ))}
      </ul>
      <form className="grid gap-3" onSubmit={(e) => {
        e.preventDefault();
        void saveCatalogueProductVariantFn({ data: { productId: product.id, sku, name } }).then((r) => {
          if (!r.ok) toast.error(r.error);
          else {
            setSku("");
            setName("");
            toast.success("Variant added");
            void onSaved();
          }
        });
      }}>
        <Field label="New variant SKU" htmlFor="v-sku"><input id="v-sku" required value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} /></Field>
        <Field label="Label (optional)" htmlFor="v-name"><input id="v-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></Field>
        <button type="submit" className="h-11 rounded-md border border-border text-[13px] font-bold uppercase">Add variant</button>
      </form>
    </div>
  );
}

function SeoForm({
  draft,
  onChange,
}: {
  draft: ProductDraft;
  onChange: <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => void;
}) {
  return (
    <div className="grid max-w-2xl gap-4">
      <Field label="Slug" htmlFor="ws-slug"><input id="ws-slug" value={draft.slug} onChange={(e) => onChange("slug", e.target.value)} className={inputClass} /></Field>
      <p className="text-[12px] text-steel">Public URL: /products/{draft.slug}</p>
      <Field label="Meta title" htmlFor="ws-mt"><input id="ws-mt" value={draft.metaTitle} onChange={(e) => onChange("metaTitle", e.target.value)} className={inputClass} /></Field>
      <Field label="Meta description" htmlFor="ws-md"><textarea id="ws-md" value={draft.metaDescription} onChange={(e) => onChange("metaDescription", e.target.value)} className={`${inputClass} min-h-24`} /></Field>
    </div>
  );
}

function ActivityPanel({ product }: { product: Workspace }) {
  if (!product.activity.length) {
    return <p className="text-[13px] text-steel">No catalogue audit events for this product yet.</p>;
  }
  return (
    <ul className="max-w-xl divide-y divide-border rounded-lg border border-border">
      {product.activity.map((event) => (
        <li key={event.id} className="px-3 py-2 text-[13px]">
          <div className="font-medium">{catalogueActivityLabel(event.action)}</div>
          <div className="num text-[12px] text-steel">
            {[event.actorName, new Date(event.at).toLocaleString("en-GB")].filter(Boolean).join(" · ")}
          </div>
        </li>
      ))}
    </ul>
  );
}

function QuantityBreaksPanel({ variantId }: { variantId: string }) {
  const [caseQty, setCaseQty] = useState<number | null>(null);
  const [rows, setRows] = useState<Array<{
    id: string;
    minQty: number;
    unitPrice: number | null;
    unitPriceDisplay: string | null;
    isBaseMirror: boolean;
    caseNote: string | null;
  }>>([]);
  const [minQty, setMinQty] = useState("12");
  const [unitPrice, setUnitPrice] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);

  async function reload() {
    const result = await listQuantityBreaksFn({ data: { variantId } });
    if (result.ok) {
      setRows(result.data.items);
      setCaseQty(result.data.caseQty);
    }
  }
  useEffect(() => {
    void reload();
  }, [variantId]);

  const volume = rows.filter((row) => !row.isBaseMirror);

  return (
    <section>
      <h3 className="font-display text-lg font-semibold uppercase">Quantity breaks</h3>
      <p className="mt-1 max-w-2xl text-[13px] text-steel">
        Fixed unit prices at a quantity threshold. The minQty=1 catalogue mirror is not a customer volume discount.
        Case quantity {caseQty ?? "not set"}. Phase 6 enforces full-case ordering; this editor does not change stored thresholds.
      </p>
      <form
        className="mt-4 grid max-w-xl gap-2 sm:grid-cols-[8rem_8rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          void upsertQuantityBreakFn({ data: { variantId, minQty: Number(minQty), unitPrice: Number(unitPrice) } }).then((r) => {
            if (!r.ok) toast.error(r.error);
            else {
              setUnitPrice("");
              void reload();
            }
          });
        }}
      >
        <Field label="Min qty"><input value={minQty} onChange={(e) => setMinQty(e.target.value)} className={inputClass} /></Field>
        <Field label="Unit price"><input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} className={inputClass} /></Field>
        <button type="submit" className="mt-6 h-10 rounded-md border border-border px-3 text-[12px] font-semibold">Add break</button>
      </form>
      {volume.length === 0 ? (
        <p className="mt-3 text-[13px] text-steel">No quantity breaks.</p>
      ) : (
        <ul className="mt-3 max-w-xl divide-y divide-border rounded-lg border border-border">
          {volume.map((row) => (
            <li key={row.id} className="px-3 py-2 text-[13px]">
              <div className="flex items-center justify-between">
                <span>{row.minQty}+ units · {row.unitPriceDisplay ?? "—"}</span>
                <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setRemoveId(row.id)}>
                  Remove
                </button>
              </div>
              {row.caseNote ? <p className="mt-1 text-[11px] text-steel">{row.caseNote}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <ConfirmAction
        open={Boolean(removeId)}
        title="Remove quantity break?"
        description="The stored threshold will be deleted. Case multiples are not rewritten."
        confirmLabel="Remove"
        onOpenChange={(open) => {
          if (!open) setRemoveId(null);
        }}
        onConfirm={() => {
          if (!removeId) return;
          void deleteQuantityBreakFn({ data: { id: removeId } }).then((r) => {
            if (!r.ok) toast.error(r.error);
            else void reload();
          });
        }}
      />
    </section>
  );
}

function PriceAsCustomerPanel({ variantId, sku }: { variantId: string; sku: string }) {
  const [q, setQ] = useState("");
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; accountNumber: string | null }>>([]);
  const [companyId, setCompanyId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [result, setResult] = useState<{
    winningRule: string;
    orderableNote: string | null;
    resolved: {
      unitPriceExVatDisplay: string;
      vatPercent: number;
      unitPriceIncVat: string;
      source: string;
      explanation: {
        baseTradePrice: string | null;
        priceListPrice: string | null;
        priceListName: string | null;
        customerOverride: string | null;
        quantityBreak: string | null;
        promotion: string | null;
        resolvedPrice: string | null;
      };
    };
  } | null>(null);

  function runPreview(nextQty = quantity) {
    if (!companyId) return;
    void previewTradePriceAsCustomerFn({
      data: { variantId, companyId, quantity: Number(nextQty) || 1 },
    }).then((r) => {
      if (!r.ok) toast.error(r.error);
      else setResult(r.data);
    });
  }

  return (
    <section>
      <h3 className="font-display text-lg font-semibold uppercase">Price as customer</h3>
      <p className="mt-1 max-w-2xl text-[13px] text-steel">
        Diagnostic only for {sku}. Prices come from the Phase 4A resolver. Quantity can be changed because volume breaks depend on it.
      </p>
      <div className="mt-4 grid max-w-xl gap-2">
        <Field label="Search customer">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              void listCompaniesFn({ data: { q: e.target.value, page: 1, pageSize: 8 } }).then((r) => {
                if (r.ok) setCompanies(r.data.items.map((c: { id: string; name: string; accountNumber: string | null }) => c));
              });
            }}
            className={inputClass}
            placeholder="Company name or account"
          />
        </Field>
        <Field label="Company">
          <select
            value={companyId}
            onChange={(e) => {
              setCompanyId(e.target.value);
              setResult(null);
            }}
            className={inputClass}
          >
            <option value="">Select</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.accountNumber ? `(${c.accountNumber})` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity">
          <input
            value={quantity}
            onChange={(e) => {
              setQuantity(e.target.value);
            }}
            className={inputClass}
          />
        </Field>
        <button
          type="button"
          className="h-10 rounded-md bg-primary text-[12px] font-bold uppercase text-primary-foreground"
          onClick={() => runPreview()}
        >
          Resolve
        </button>
      </div>
      {result ? (
        <div className="mt-4 max-w-xl">
          <p className="font-display text-2xl font-semibold">£{result.resolved.unitPriceExVatDisplay} ex VAT</p>
          <p className="text-[12px] text-steel">Winning rule: {result.winningRule}</p>
          {result.orderableNote ? <p className="mt-2 text-[12px] text-steel">{result.orderableNote}</p> : null}
          <dl className="mt-4 divide-y divide-border border-y border-border text-[13px]">
            <div className="flex justify-between py-2"><dt>Base Trade Price</dt><dd className="num">{result.resolved.explanation.baseTradePrice ?? "—"}</dd></div>
            <div className="flex justify-between py-2"><dt>Price List{result.resolved.explanation.priceListName ? ` (${result.resolved.explanation.priceListName})` : ""}</dt><dd className="num">{result.resolved.explanation.priceListPrice ?? "Not applicable"}</dd></div>
            <div className="flex justify-between py-2"><dt>Customer Override</dt><dd className="num">{result.resolved.explanation.customerOverride ?? "Not applicable"}</dd></div>
            <div className="flex justify-between py-2"><dt>Quantity Break</dt><dd className="num">{result.resolved.explanation.quantityBreak ?? "Not applicable"}</dd></div>
            <div className="flex justify-between py-2"><dt>Promotion</dt><dd>{result.resolved.explanation.promotion ?? "None"}</dd></div>
            <div className="flex justify-between py-2"><dt>VAT</dt><dd className="num">{result.resolved.vatPercent}%</dd></div>
            <div className="flex justify-between py-2 font-semibold"><dt>Final resolved price</dt><dd className="num">£{result.resolved.unitPriceExVatDisplay} ex VAT</dd></div>
          </dl>
        </div>
      ) : null}
    </section>
  );
}
