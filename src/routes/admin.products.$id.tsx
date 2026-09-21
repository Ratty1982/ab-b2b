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
  reorderCatalogueProductMediaFn,
  saveCatalogueProductVariantFn,
  updateCatalogueProductFn,
} from "@/server/phase2/fns";
import { ImportProductJsonButton } from "@/components/catalogue/ImportProductJsonDrawer";
import { catalogueActivityLabel } from "@/domain/product-content-json";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/products/$id")({
  head: () => ({ meta: [{ title: "Product workspace — Automotive Brands Admin" }] }),
  component: ProductWorkspace,
});

type Tab = "Overview" | "Content" | "Images" | "Commercial" | "Inventory" | "Variants" | "SEO" | "Activity";

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
  const [tab, setTab] = useState<Tab>("Overview");
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
          <ContentForm
            draft={draft}
            selling={product.selling}
            onChange={updateDraft}
            onSpecsChange={(specifications) => updateDraft("specifications", specifications)}
          />
        </div>
        <div hidden={tab !== "Images"}>
          <ImagesForm product={product} onSaved={refreshMedia} />
        </div>
        <div hidden={tab !== "Commercial"}>
          <CommercialForm draft={draft} onChange={updateDraft} />
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
  selling,
  onChange,
  onSpecsChange,
}: {
  draft: ProductDraft;
  selling: Workspace["selling"];
  onChange: <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => void;
  onSpecsChange: (rows: Array<{ name: string; value: string }>) => void;
}) {
  return (
    <div className="grid max-w-3xl gap-4">
      <Field label="Short description" htmlFor="ws-short">
        <textarea id="ws-short" value={draft.shortDescription} onChange={(e) => onChange("shortDescription", e.target.value)} className={`${inputClass} min-h-20`} />
      </Field>
      <Field label="Description" htmlFor="ws-desc">
        <textarea id="ws-desc" value={draft.description} onChange={(e) => onChange("description", e.target.value)} className={`${inputClass} min-h-40`} />
      </Field>
      {selling?.keyBenefits.length ? (
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase text-steel">Key benefits</p>
          <ul className="list-disc pl-5 text-[13px]">{selling.keyBenefits.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}
      {selling?.features.length ? (
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase text-steel">Features</p>
          <ul className="list-disc pl-5 text-[13px]">{selling.features.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}
      {selling?.applications.length ? (
        <div>
          <p className="mb-2 text-[12px] font-semibold uppercase text-steel">Applications</p>
          <ul className="list-disc pl-5 text-[13px]">{selling.applications.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      ) : null}
      {selling?.directions ? <p className="text-[13px]"><span className="font-semibold">Directions. </span>{selling.directions}</p> : null}
      {selling?.warnings ? <p className="text-[13px]"><span className="font-semibold">Warnings. </span>{selling.warnings}</p> : null}
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase text-steel">Specifications</p>
        {draft.specifications.map((row, i) => (
          <div key={i} className="mb-2 grid grid-cols-2 gap-2">
            <input value={row.name} placeholder="Name" className={inputClass} onChange={(e) => onSpecsChange(draft.specifications.map((s, idx) => idx === i ? { ...s, name: e.target.value } : s))} />
            <input value={row.value} placeholder="Value" className={inputClass} onChange={(e) => onSpecsChange(draft.specifications.map((s, idx) => idx === i ? { ...s, value: e.target.value } : s))} />
          </div>
        ))}
        <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => onSpecsChange([...draft.specifications, { name: "", value: "" }])}>Add specification</button>
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
      <p className="sm:col-span-2 text-[13px] text-steel">Base catalogue commercial data only. Customer price lists and promotions are Phase 4.</p>
      <Field label="Base trade price" htmlFor="ws-trade"><input id="ws-trade" value={draft.tradePrice} onChange={(e) => onChange("tradePrice", e.target.value)} className={inputClass} /></Field>
      <Field label="RRP" htmlFor="ws-rrp"><input id="ws-rrp" value={draft.rrp} onChange={(e) => onChange("rrp", e.target.value)} className={inputClass} /></Field>
      <Field label="VAT" htmlFor="ws-vat">
        <select id="ws-vat" value={draft.vat} onChange={(e) => onChange("vat", e.target.value as "standard" | "zero")} className={inputClass}>
          <option value="standard">Standard</option>
          <option value="zero">Zero</option>
        </select>
      </Field>
      <div className="sm:col-span-2 mt-2 border-t border-border/70 pt-4">
        <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-steel">Ordering Information</h3>
        <p className="mt-1 text-[12px] text-steel">Pack and case sizes are sale units, not warehouse stock. Leave case quantity blank when unknown.</p>
      </div>
      <Field label="Pack Quantity" htmlFor="ws-pack">
        <input id="ws-pack" type="number" min={1} step={1} inputMode="numeric" value={draft.packQty} onChange={(e) => onChange("packQty", e.target.value)} className={inputClass} />
      </Field>
      <Field label="Case Quantity" htmlFor="ws-case">
        <input id="ws-case" type="number" min={1} step={1} inputMode="numeric" value={draft.caseQty} onChange={(e) => onChange("caseQty", e.target.value)} className={inputClass} />
      </Field>
      <Field label="Minimum Order Quantity" htmlFor="ws-moq">
        <input id="ws-moq" type="number" min={1} step={1} inputMode="numeric" value={draft.minimumOrderQty} onChange={(e) => onChange("minimumOrderQty", e.target.value)} className={inputClass} />
      </Field>
      <Field label="Order Increment" htmlFor="ws-inc">
        <input id="ws-inc" type="number" min={1} step={1} inputMode="numeric" value={draft.orderIncrement} onChange={(e) => onChange("orderIncrement", e.target.value)} className={inputClass} />
      </Field>
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
        <p className="font-semibold">No local stock recorded</p>
        <p className="mt-2 text-[13px] text-steel">Physical stock, allocations and sellable quantity will be supplied by Autopart. Automotive Brands does not invent warehouse figures here.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
            <th className="px-3 py-2">SKU</th>
            <th className="px-3 py-2">Warehouse</th>
            <th className="px-3 py-2 text-right">On hand</th>
            <th className="px-3 py-2 text-right">Reserved</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {product.inventory.map((row) => (
            <tr key={`${row.variantSku}-${row.warehouseCode}`} className="border-b border-border/60">
              <td className="num px-3 py-2">{row.variantSku}</td>
              <td className="px-3 py-2">{row.warehouse}</td>
              <td className="num px-3 py-2 text-right">{row.qtyOnHand}</td>
              <td className="num px-3 py-2 text-right">{row.qtyReserved}</td>
              <td className="px-3 py-2">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[12px] text-steel">Local snapshot only — Autopart remains the stock authority.</p>
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
