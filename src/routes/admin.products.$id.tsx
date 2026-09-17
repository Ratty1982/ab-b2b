import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
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

function ProductWorkspace() {
  const { id } = Route.useParams();
  const [tab, setTab] = useState<Tab>("Overview");
  const [product, setProduct] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; depth: number }>>([]);

  const load = useCallback(async () => {
    const [p, b, c] = await Promise.all([
      getCatalogueProductFn({ data: { id } }),
      listCatalogueBrandsFn(),
      listCatalogueCategoriesFn(),
    ]);
    if (!p.ok) {
      setError(p.error);
      setProduct(null);
      return;
    }
    setError(null);
    setProduct(p.data);
    if (b.ok) setBrands(b.data);
    if (c.ok) setCategories(c.data);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm">{error}</p>
        <Link to="/admin/products" className="mt-4 inline-block text-[13px] font-semibold text-primary">Back to catalogue</Link>
      </div>
    );
  }
  if (!product) return <p className="p-6 text-[13px] text-steel">Loading product…</p>;

  const tabs: Tab[] = ["Overview", "Content", "Images", "Commercial", "Inventory", "Variants", "SEO", "Activity"];

  return (
    <div>
      <PanelHeader
        title={product.name}
        sub={`${product.sku} · ${product.brandName}`}
        actions={<StatusBadge tone={product.status === "ACTIVE" ? "good" : "warn"}>{product.status}</StatusBadge>}
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
        {tab === "Overview" ? <OverviewForm product={product} brands={brands} categories={categories} onSaved={load} /> : null}
        {tab === "Content" ? <ContentForm product={product} onSaved={load} /> : null}
        {tab === "Images" ? <ImagesForm product={product} onSaved={load} /> : null}
        {tab === "Commercial" ? <CommercialForm product={product} onSaved={load} /> : null}
        {tab === "Inventory" ? <InventoryPanel product={product} /> : null}
        {tab === "Variants" ? <VariantsForm product={product} onSaved={load} /> : null}
        {tab === "SEO" ? <SeoForm product={product} onSaved={load} /> : null}
        {tab === "Activity" ? <ActivityPanel product={product} /> : null}
      </div>
    </div>
  );
}

async function patch(product: Workspace, data: Record<string, unknown>, onSaved: () => Promise<void>) {
  const r = await updateCatalogueProductFn({ data: { id: product.id, ...data } });
  if (!r.ok) {
    toast.error(r.error);
    return;
  }
  toast.success("Saved");
  await onSaved();
}

function OverviewForm({
  product,
  brands,
  categories,
  onSaved,
}: {
  product: Workspace;
  brands: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; depth: number }>;
  onSaved: () => Promise<void>;
}) {
  const [sku, setSku] = useState(product.sku);
  const [name, setName] = useState(product.name);
  const [brandId, setBrandId] = useState(product.brandId);
  const [categoryId, setCategoryId] = useState(product.categoryId ?? "");
  const [status, setStatus] = useState(product.status);
  const [ean, setEan] = useState(product.ean ?? "");
  const [mpn, setMpn] = useState(product.mpn ?? "");
  const [externalRef, setExternalRef] = useState(product.externalRef ?? "");
  useEffect(() => {
    setSku(product.sku);
    setName(product.name);
    setBrandId(product.brandId);
    setCategoryId(product.categoryId ?? "");
    setStatus(product.status);
    setEan(product.ean ?? "");
    setMpn(product.mpn ?? "");
    setExternalRef(product.externalRef ?? "");
  }, [product]);
  return (
    <form className="grid max-w-2xl gap-4" onSubmit={(e) => { e.preventDefault(); void patch(product, { sku, name, brandId, categoryId: categoryId || null, status, ean, mpn, externalRef }, onSaved); }}>
      <Field label="SKU" htmlFor="ws-sku"><input id="ws-sku" value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} /></Field>
      <Field label="Name" htmlFor="ws-name"><input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></Field>
      <Field label="Brand" htmlFor="ws-brand">
        <select id="ws-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)} className={inputClass}>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
      <Field label="Category" htmlFor="ws-cat">
        <select id="ws-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
          {categories.map((c) => <option key={c.id} value={c.id}>{"— ".repeat(c.depth)}{c.name}</option>)}
        </select>
      </Field>
      <Field label="Status" htmlFor="ws-status">
        <select id="ws-status" value={status} onChange={(e) => setStatus(e.target.value as Workspace["status"])} className={inputClass}>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="DISCONTINUED">Discontinued</option>
        </select>
      </Field>
      <Field label="EAN / barcode" htmlFor="ws-ean"><input id="ws-ean" value={ean} onChange={(e) => setEan(e.target.value)} className={inputClass} /></Field>
      <Field label="MPN" htmlFor="ws-mpn"><input id="ws-mpn" value={mpn} onChange={(e) => setMpn(e.target.value)} className={inputClass} /></Field>
      <Field label="Autopart / external ref" htmlFor="ws-ext"><input id="ws-ext" value={externalRef} onChange={(e) => setExternalRef(e.target.value)} className={inputClass} /></Field>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={product.isTradeVisible} onChange={(e) => void patch(product, { isTradeVisible: e.target.checked }, onSaved)} />
        Visible to trade customers
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={product.isFeatured} onChange={(e) => void patch(product, { isFeatured: e.target.checked }, onSaved)} />
        Featured
      </label>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={product.isNew} onChange={(e) => void patch(product, { isNew: e.target.checked }, onSaved)} />
        New product
      </label>
      <button type="submit" className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">Save overview</button>
    </form>
  );
}

function ContentForm({ product, onSaved }: { product: Workspace; onSaved: () => Promise<void> }) {
  const [shortDescription, setShort] = useState(product.shortDescription ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [specs, setSpecs] = useState(product.specifications);
  useEffect(() => {
    setShort(product.shortDescription ?? "");
    setDescription(product.description ?? "");
    setSpecs(product.specifications);
  }, [product]);
  return (
    <form className="grid max-w-3xl gap-4" onSubmit={(e) => { e.preventDefault(); void patch(product, { shortDescription, description, specifications: specs.filter((s) => s.name && s.value) }, onSaved); }}>
      <Field label="Short description" htmlFor="ws-short">
        <textarea id="ws-short" value={shortDescription} onChange={(e) => setShort(e.target.value)} className={`${inputClass} min-h-20`} />
      </Field>
      <Field label="Description" htmlFor="ws-desc">
        <textarea id="ws-desc" value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputClass} min-h-40`} />
      </Field>
      <div>
        <p className="mb-2 text-[12px] font-semibold uppercase text-steel">Specifications</p>
        {specs.map((row, i) => (
          <div key={i} className="mb-2 grid grid-cols-2 gap-2">
            <input value={row.name} placeholder="Name" className={inputClass} onChange={(e) => setSpecs(specs.map((s, idx) => idx === i ? { ...s, name: e.target.value } : s))} />
            <input value={row.value} placeholder="Value" className={inputClass} onChange={(e) => setSpecs(specs.map((s, idx) => idx === i ? { ...s, value: e.target.value } : s))} />
          </div>
        ))}
        <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setSpecs([...specs, { name: "", value: "" }])}>Add specification</button>
      </div>
      <button type="submit" className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">Save content</button>
    </form>
  );
}

function ImagesForm({ product, onSaved }: { product: Workspace; onSaved: () => Promise<void> }) {
  const [picker, setPicker] = useState(false);
  return (
    <div className="max-w-3xl">
      <p className="mb-4 text-[13px] text-steel">Uses the Website media library. Removing an image here does not delete the file.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {product.media.map((m, index) => (
          <div key={m.id} className="rounded-lg border border-border p-2">
            <img src={m.src} alt={m.altText || ""} className="aspect-[4/3] w-full rounded object-cover" />
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

function CommercialForm({ product, onSaved }: { product: Workspace; onSaved: () => Promise<void> }) {
  const [tradePrice, setTrade] = useState(String(product.tradePrice ?? ""));
  const [rrp, setRrp] = useState(String(product.rrp ?? ""));
  const [vat, setVat] = useState(product.vat);
  const [packQty, setPack] = useState(String(product.packQty));
  const [caseQty, setCase] = useState(String(product.caseQty ?? ""));
  const [minimumOrderQty, setMoq] = useState(String(product.minimumOrderQty));
  const [orderIncrement, setInc] = useState(String(product.orderIncrement));
  const [unit, setUnit] = useState(product.unit);
  const [weightKg, setW] = useState(String(product.weightKg ?? ""));
  const [lengthMm, setL] = useState(String(product.lengthMm ?? ""));
  const [widthMm, setWd] = useState(String(product.widthMm ?? ""));
  const [heightMm, setH] = useState(String(product.heightMm ?? ""));
  useEffect(() => {
    setTrade(String(product.tradePrice ?? ""));
    setRrp(String(product.rrp ?? ""));
    setVat(product.vat);
    setPack(String(product.packQty));
    setCase(String(product.caseQty ?? ""));
    setMoq(String(product.minimumOrderQty));
    setInc(String(product.orderIncrement));
    setUnit(product.unit);
    setW(String(product.weightKg ?? ""));
    setL(String(product.lengthMm ?? ""));
    setWd(String(product.widthMm ?? ""));
    setH(String(product.heightMm ?? ""));
  }, [product]);
  return (
    <form className="grid max-w-2xl gap-4 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault();
      void patch(product, {
        tradePrice: tradePrice === "" ? null : Number(tradePrice),
        rrp: rrp === "" ? null : Number(rrp),
        vat,
        packQty: Number(packQty),
        caseQty: caseQty === "" ? null : Number(caseQty),
        minimumOrderQty: Number(minimumOrderQty),
        orderIncrement: Number(orderIncrement),
        unit,
        weightKg: weightKg === "" ? null : Number(weightKg),
        lengthMm: lengthMm === "" ? null : Number(lengthMm),
        widthMm: widthMm === "" ? null : Number(widthMm),
        heightMm: heightMm === "" ? null : Number(heightMm),
      }, onSaved);
    }}>
      <p className="sm:col-span-2 text-[13px] text-steel">Base catalogue commercial data only. Customer price lists and promotions are Phase 4.</p>
      <Field label="Base trade price" htmlFor="ws-trade"><input id="ws-trade" value={tradePrice} onChange={(e) => setTrade(e.target.value)} className={inputClass} /></Field>
      <Field label="RRP" htmlFor="ws-rrp"><input id="ws-rrp" value={rrp} onChange={(e) => setRrp(e.target.value)} className={inputClass} /></Field>
      <Field label="VAT" htmlFor="ws-vat">
        <select id="ws-vat" value={vat} onChange={(e) => setVat(e.target.value as "standard" | "zero")} className={inputClass}>
          <option value="standard">Standard</option>
          <option value="zero">Zero</option>
        </select>
      </Field>
      <Field label="Pack qty" htmlFor="ws-pack"><input id="ws-pack" value={packQty} onChange={(e) => setPack(e.target.value)} className={inputClass} /></Field>
      <Field label="Case qty" htmlFor="ws-case"><input id="ws-case" value={caseQty} onChange={(e) => setCase(e.target.value)} className={inputClass} /></Field>
      <Field label="Minimum order qty" htmlFor="ws-moq"><input id="ws-moq" value={minimumOrderQty} onChange={(e) => setMoq(e.target.value)} className={inputClass} /></Field>
      <Field label="Order increment" htmlFor="ws-inc"><input id="ws-inc" value={orderIncrement} onChange={(e) => setInc(e.target.value)} className={inputClass} /></Field>
      <Field label="Unit" htmlFor="ws-unit"><input id="ws-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass} /></Field>
      <Field label="Weight (kg)" htmlFor="ws-w"><input id="ws-w" value={weightKg} onChange={(e) => setW(e.target.value)} className={inputClass} /></Field>
      <Field label="Length (mm)" htmlFor="ws-l"><input id="ws-l" value={lengthMm} onChange={(e) => setL(e.target.value)} className={inputClass} /></Field>
      <Field label="Width (mm)" htmlFor="ws-wd"><input id="ws-wd" value={widthMm} onChange={(e) => setWd(e.target.value)} className={inputClass} /></Field>
      <Field label="Height (mm)" htmlFor="ws-h"><input id="ws-h" value={heightMm} onChange={(e) => setH(e.target.value)} className={inputClass} /></Field>
      <button type="submit" className="sm:col-span-2 h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">Save commercial</button>
    </form>
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
      <p className="text-[13px] text-steel">Simple products use one default SKU. Extra variants are for pack size, colour or fitment later — not a full configurator.</p>
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

function SeoForm({ product, onSaved }: { product: Workspace; onSaved: () => Promise<void> }) {
  const [slug, setSlug] = useState(product.slug);
  const [metaTitle, setTitle] = useState(product.metaTitle ?? "");
  const [metaDescription, setDesc] = useState(product.metaDescription ?? "");
  useEffect(() => {
    setSlug(product.slug);
    setTitle(product.metaTitle ?? "");
    setDesc(product.metaDescription ?? "");
  }, [product]);
  return (
    <form className="grid max-w-2xl gap-4" onSubmit={(e) => { e.preventDefault(); void patch(product, { slug, metaTitle, metaDescription }, onSaved); }}>
      <Field label="Slug" htmlFor="ws-slug"><input id="ws-slug" value={slug} onChange={(e) => setSlug(e.target.value)} className={inputClass} /></Field>
      <p className="text-[12px] text-steel">Public URL: /products/{slug}</p>
      <Field label="Meta title" htmlFor="ws-mt"><input id="ws-mt" value={metaTitle} onChange={(e) => setTitle(e.target.value)} className={inputClass} /></Field>
      <Field label="Meta description" htmlFor="ws-md"><textarea id="ws-md" value={metaDescription} onChange={(e) => setDesc(e.target.value)} className={`${inputClass} min-h-24`} /></Field>
      <button type="submit" className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">Save SEO</button>
    </form>
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
          <div className="font-medium">{event.action}</div>
          <div className="num text-[12px] text-steel">{new Date(event.at).toLocaleString("en-GB")}</div>
        </li>
      ))}
    </ul>
  );
}
