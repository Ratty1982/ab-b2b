import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StockBadge, StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { brands as mockBrands, gbp, products as mockProducts, type Product } from "@/lib/data";
import { productDraftSchema, slugifyCatalogue } from "@/domain/catalogue";
import {
  listCatalogueBrandsFn,
  listCatalogueCategoriesFn,
  saveCatalogueBrandFn,
  saveCatalogueCategoryFn,
} from "@/server/phase2/fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/products")({
  head: () => ({
    meta: [
      { title: "Catalogue Administration — Automotive Brands" },
      {
        name: "description",
        content:
          "Maintain the Automotive Brands catalogue: products, SKUs, brands, categories, pricing, stock, documents and marketing imagery.",
      },
      { property: "og:title", content: "Catalogue Administration — Automotive Brands" },
      { property: "og:description", content: "Products, brands, categories and catalogue documents." },
    ],
  }),
  component: AdminProducts,
});

type Tab = "Products" | "Brands" | "Categories";

type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  parentName: string | null;
  sortOrder: number;
  isActive: boolean;
  childCount: number;
  productCount: number;
  depth: number;
};

type BrandRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
};

type ProductDraft = Product & { subcategory?: string };

function emptyProduct(): ProductDraft {
  return {
    sku: "",
    name: "",
    brand: mockBrands[0]?.name ?? "Power Maxed",
    category: "Braking",
    subcategory: "",
    type: "",
    trade: 0,
    rrp: 0,
    stock: "in",
    stockQty: 0,
    packQty: 1,
    caseQty: 1,
    vat: "standard",
    image: mockProducts[0]?.image ?? "",
    breaks: [],
    description: "",
    features: [],
    specs: [],
    downloads: [],
  };
}

function AdminProducts() {
  const [tab, setTab] = useState<Tab>("Products");
  const [term, setTerm] = useState("");
  const [catalog, setCatalog] = useState<ProductDraft[]>(() =>
    mockProducts.map((p) => ({ ...p, subcategory: p.type })),
  );
  const [productEdit, setProductEdit] = useState<ProductDraft | null>(null);
  const [productIsNew, setProductIsNew] = useState(false);
  const [productError, setProductError] = useState<string | null>(null);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categoryEdit, setCategoryEdit] = useState<Partial<CategoryRow> | null>(null);
  const [brandEdit, setBrandEdit] = useState<Partial<BrandRow> | null>(null);
  const [saving, setSaving] = useState(false);

  const loadTaxonomy = useCallback(async () => {
    setLoadError(null);
    const [cats, br] = await Promise.all([listCatalogueCategoriesFn(), listCatalogueBrandsFn()]);
    if (!cats.ok) {
      setLoadError(cats.error);
      return;
    }
    if (!br.ok) {
      setLoadError(br.error);
      return;
    }
    setCategories(cats.data);
    setBrands(br.data);
  }, []);

  useEffect(() => {
    void loadTaxonomy();
  }, [loadTaxonomy]);

  const topLevelCategories = useMemo(
    () => categories.filter((c) => !c.parentId),
    [categories],
  );

  const rows = catalog.filter(
    (p) =>
      !term ||
      p.sku.toLowerCase().includes(term.toLowerCase()) ||
      p.name.toLowerCase().includes(term.toLowerCase()) ||
      p.brand.toLowerCase().includes(term.toLowerCase()) ||
      p.category.toLowerCase().includes(term.toLowerCase()),
  );

  const productCategoryOptions = categories.length
    ? topLevelCategories.map((c) => c.name)
    : Array.from(new Set(catalog.map((p) => p.category)));

  const productSubcategoryOptions = (parentName: string) => {
    const parent = categories.find((c) => c.name === parentName && !c.parentId);
    if (!parent) return [];
    return categories.filter((c) => c.parentId === parent.id).map((c) => c.name);
  };

  async function saveProduct() {
    if (!productEdit) return;
    setProductError(null);
    const parsed = productDraftSchema.safeParse({
      sku: productEdit.sku,
      name: productEdit.name,
      brand: productEdit.brand,
      category: productEdit.category,
      subcategory: productEdit.subcategory || null,
      trade: productEdit.trade,
      rrp: productEdit.rrp,
      packQty: productEdit.packQty,
      caseQty: productEdit.caseQty,
      description: productEdit.description,
    });
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join("; ");
      setProductError(msg);
      toast.error(msg);
      return;
    }
    const next: ProductDraft = {
      ...productEdit,
      sku: parsed.data.sku,
      name: parsed.data.name,
      brand: parsed.data.brand,
      category: parsed.data.category,
      subcategory: parsed.data.subcategory ?? "",
      type: parsed.data.subcategory || productEdit.type,
      trade: parsed.data.trade,
      rrp: parsed.data.rrp,
      packQty: parsed.data.packQty,
      caseQty: parsed.data.caseQty,
      description: parsed.data.description,
    };
    setCatalog((prev) => {
      const idx = prev.findIndex((p) => p.sku === next.sku);
      if (productIsNew && idx >= 0) {
        setProductError("A product with this SKU already exists");
        toast.error("A product with this SKU already exists");
        return prev;
      }
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = next;
        return copy;
      }
      return [...prev, next];
    });
    toast.success(productIsNew ? "Product added to the catalogue draft" : "Product saved");
    setProductEdit(null);
    setProductIsNew(false);
  }

  async function saveCategory() {
    if (!categoryEdit?.name) {
      toast.error("Enter a category name");
      return;
    }
    setSaving(true);
    const r = await saveCatalogueCategoryFn({
      data: {
        id: categoryEdit.id,
        name: categoryEdit.name,
        slug: categoryEdit.slug || slugifyCatalogue(categoryEdit.name),
        description: categoryEdit.description ?? "",
        parentId: categoryEdit.parentId || null,
        isActive: categoryEdit.isActive ?? true,
        sortOrder: categoryEdit.sortOrder ?? 0,
      },
    });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(categoryEdit.id ? "Category saved" : "Category added");
    setCategoryEdit(null);
    await loadTaxonomy();
  }

  async function saveBrand() {
    if (!brandEdit?.name) {
      toast.error("Enter a brand name");
      return;
    }
    setSaving(true);
    const r = await saveCatalogueBrandFn({
      data: {
        id: brandEdit.id,
        name: brandEdit.name,
        slug: brandEdit.slug || slugifyCatalogue(brandEdit.name),
        tagline: brandEdit.tagline ?? "",
        description: brandEdit.description ?? "",
        isActive: brandEdit.isActive ?? true,
        sortOrder: brandEdit.sortOrder ?? 0,
      },
    });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success(brandEdit.id ? "Brand saved" : "Brand added");
    setBrandEdit(null);
    await loadTaxonomy();
  }

  const addLabel =
    tab === "Products" ? "Add product" : tab === "Brands" ? "Add brand" : "Add category";

  function onAdd() {
    if (tab === "Products") {
      setProductIsNew(true);
      setProductError(null);
      setProductEdit(emptyProduct());
      return;
    }
    if (tab === "Brands") {
      setBrandEdit({
        name: "",
        slug: "",
        tagline: "",
        description: "",
        isActive: true,
        sortOrder: brands.length + 1,
      });
      return;
    }
    setCategoryEdit({
      name: "",
      slug: "",
      description: "",
      parentId: null,
      isActive: true,
      sortOrder: topLevelCategories.length + 1,
    });
  }

  return (
    <div>
      <PanelHeader
        title="Catalogue"
        sub="Products, brands and nested categories across all Automotive Brands ranges"
        actions={
          <button
            type="button"
            onClick={onAdd}
            className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            {addLabel}
          </button>
        }
      />

      <div className="flex gap-1 border-b border-border/70 px-4 sm:px-6">
        {(["Products", "Brands", "Categories"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-3 text-[13px] font-semibold",
              tab === t ? "border-primary text-foreground" : "border-transparent text-steel hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {loadError ? (
        <div className="mx-4 mt-4 rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad sm:mx-6">
          {loadError}
        </div>
      ) : null}

      {tab === "Products" ? (
        <div className="p-4 sm:p-6">
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search SKU, product or brand"
            className={`${inputClass} mb-4 max-w-md`}
          />
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[1000px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">SKU</th>
                  <th className="px-3 py-2 font-semibold">Product</th>
                  <th className="px-3 py-2 font-semibold">Brand</th>
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 text-right font-semibold">Trade list</th>
                  <th className="px-3 py-2 text-right font-semibold">RRP</th>
                  <th className="px-3 py-2 text-right font-semibold">Pack</th>
                  <th className="px-3 py-2 text-right font-semibold">Case</th>
                  <th className="px-3 py-2 font-semibold">Stock</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => (
                  <tr key={p.sku} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                    <td className="num px-3 py-2 text-primary">{p.sku}</td>
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2 text-steel">{p.brand}</td>
                    <td className="px-3 py-2 text-steel">
                      {p.category}
                      {p.subcategory ? ` / ${p.subcategory}` : ""}
                    </td>
                    <td className="num px-3 py-2 text-right">{gbp(p.trade)}</td>
                    <td className="num px-3 py-2 text-right text-steel">{gbp(p.rrp)}</td>
                    <td className="num px-3 py-2 text-right">{p.packQty}</td>
                    <td className="num px-3 py-2 text-right">{p.caseQty}</td>
                    <td className="px-3 py-2">
                      <StockBadge stock={p.stock} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setProductIsNew(false);
                          setProductError(null);
                          setProductEdit({ ...p, subcategory: p.subcategory ?? p.type });
                        }}
                        className="text-[12px] font-semibold text-primary hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "Brands" ? (
        <div className="p-4 sm:p-6">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">Brand</th>
                  <th className="px-3 py-2 font-semibold">Positioning</th>
                  <th className="px-3 py-2 font-semibold">Brand page</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((b, i) => (
                  <tr key={b.id} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                    <td className="px-3 py-2 font-semibold">{b.name}</td>
                    <td className="px-3 py-2 text-steel">{b.tagline ?? "—"}</td>
                    <td className="num px-3 py-2 text-steel">/brands/{b.slug}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={b.isActive ? "good" : "warn"}>
                        {b.isActive ? "Published" : "Hidden"}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setBrandEdit(b)}
                        className="text-[12px] font-semibold text-primary hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "Categories" ? (
        <div className="p-4 sm:p-6">
          <p className="mb-4 max-w-2xl text-[13px] text-steel">
            Top-level categories can contain subcategories. Products pick a category and, optionally, a
            subcategory from this tree.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Parent</th>
                  <th className="px-3 py-2 font-semibold">Shown on site</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {categories.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-steel">
                      No categories yet. Add a category to start the tree.
                    </td>
                  </tr>
                ) : (
                  categories.map((c, i) => (
                    <tr key={c.id} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                      <td className="px-3 py-2 font-medium">
                        <span className={cn(c.depth > 0 && "pl-6 text-[13px]")}>
                          {c.depth > 0 ? "↳ " : ""}
                          {c.name}
                        </span>
                        {c.description ? (
                          <div className={cn("text-[12px] font-normal text-steel", c.depth > 0 && "pl-6")}>
                            {c.description}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-steel">{c.parentName ?? "—"}</td>
                      <td className="px-3 py-2">
                        <StatusBadge tone={c.isActive ? "good" : "warn"}>
                          {c.isActive ? "Visible" : "Hidden"}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-3">
                          {!c.parentId ? (
                            <button
                              type="button"
                              onClick={() =>
                                setCategoryEdit({
                                  name: "",
                                  slug: "",
                                  description: "",
                                  parentId: c.id,
                                  isActive: true,
                                  sortOrder: c.childCount + 1,
                                })
                              }
                              className="text-[12px] font-semibold text-primary hover:underline"
                            >
                              Add subcategory
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setCategoryEdit(c)}
                            className="text-[12px] font-semibold text-primary hover:underline"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <Drawer
        open={productEdit !== null}
        onClose={() => setProductEdit(null)}
        width="lg"
        title={
          productEdit
            ? productIsNew
              ? "Add product"
              : `${productEdit.sku} — ${productEdit.name}`
            : ""
        }
        sub="Catalogue record"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveProduct()}
              className="h-11 flex-1 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground"
            >
              Save changes
            </button>
            <button
              type="button"
              onClick={() => setProductEdit(null)}
              className="h-11 rounded-md border border-border px-5 text-[13px] font-semibold"
            >
              Cancel
            </button>
          </div>
        }
      >
        {productEdit ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {productError ? (
              <div className="sm:col-span-2 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[13px] text-bad">
                {productError}
              </div>
            ) : null}
            <Field label="SKU">
              <input
                className={inputClass}
                value={productEdit.sku}
                onChange={(e) => setProductEdit({ ...productEdit, sku: e.target.value })}
              />
            </Field>
            <Field label="Product name">
              <input
                className={inputClass}
                value={productEdit.name}
                onChange={(e) => setProductEdit({ ...productEdit, name: e.target.value })}
              />
            </Field>
            <Field label="Brand">
              <select
                className={inputClass}
                value={productEdit.brand}
                onChange={(e) => setProductEdit({ ...productEdit, brand: e.target.value })}
              >
                {(brands.length ? brands.map((b) => b.name) : mockBrands.map((b) => b.name)).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <select
                className={inputClass}
                value={productEdit.category}
                onChange={(e) =>
                  setProductEdit({ ...productEdit, category: e.target.value, subcategory: "" })
                }
              >
                {productCategoryOptions.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </Field>
            <Field label="Subcategory">
              <select
                className={inputClass}
                value={productEdit.subcategory ?? ""}
                onChange={(e) => setProductEdit({ ...productEdit, subcategory: e.target.value })}
              >
                <option value="">None</option>
                {productSubcategoryOptions(productEdit.category).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </Field>
            <Field label="Trade list price">
              <input
                className={inputClass}
                value={String(productEdit.trade)}
                onChange={(e) => setProductEdit({ ...productEdit, trade: Number(e.target.value) })}
              />
            </Field>
            <Field label="RRP">
              <input
                className={inputClass}
                value={String(productEdit.rrp)}
                onChange={(e) => setProductEdit({ ...productEdit, rrp: Number(e.target.value) })}
              />
            </Field>
            <Field label="Pack quantity">
              <input
                className={inputClass}
                value={String(productEdit.packQty)}
                onChange={(e) => setProductEdit({ ...productEdit, packQty: Number(e.target.value) })}
              />
            </Field>
            <Field label="Case quantity">
              <input
                className={inputClass}
                value={String(productEdit.caseQty)}
                onChange={(e) => setProductEdit({ ...productEdit, caseQty: Number(e.target.value) })}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <textarea
                  rows={4}
                  className={inputClass}
                  value={productEdit.description}
                  onChange={(e) => setProductEdit({ ...productEdit, description: e.target.value })}
                />
              </Field>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={categoryEdit !== null}
        onClose={() => setCategoryEdit(null)}
        width="md"
        title={
          categoryEdit?.id
            ? "Edit category"
            : categoryEdit?.parentId
              ? "Add subcategory"
              : "Add category"
        }
        sub="Taxonomy used across the catalogue"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveCategory()}
              className="h-11 flex-1 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setCategoryEdit(null)}
              className="h-11 rounded-md border border-border px-5 text-[13px] font-semibold"
            >
              Cancel
            </button>
          </div>
        }
      >
        {categoryEdit ? (
          <div className="grid gap-4">
            <Field label="Name">
              <input
                className={inputClass}
                value={categoryEdit.name ?? ""}
                onChange={(e) => {
                  const name = e.target.value;
                  const autoSlug = !categoryEdit.id;
                  setCategoryEdit({
                    ...categoryEdit,
                    name,
                    slug: autoSlug ? slugifyCatalogue(name) : (categoryEdit.slug ?? ""),
                  });
                }}
              />
            </Field>
            <Field label="Slug">
              <input
                className={inputClass}
                value={categoryEdit.slug ?? ""}
                onChange={(e) => setCategoryEdit({ ...categoryEdit, slug: e.target.value })}
              />
            </Field>
            <Field label="Parent category">
              <select
                className={inputClass}
                value={categoryEdit.parentId ?? ""}
                onChange={(e) =>
                  setCategoryEdit({ ...categoryEdit, parentId: e.target.value || null })
                }
              >
                <option value="">None — top level</option>
                {topLevelCategories
                  .filter((c) => c.id !== categoryEdit.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Description">
              <textarea
                rows={3}
                className={inputClass}
                value={categoryEdit.description ?? ""}
                onChange={(e) => setCategoryEdit({ ...categoryEdit, description: e.target.value })}
              />
            </Field>
            <Field label="Sort order">
              <input
                type="number"
                className={inputClass}
                value={String(categoryEdit.sortOrder ?? 0)}
                onChange={(e) =>
                  setCategoryEdit({ ...categoryEdit, sortOrder: Number(e.target.value) })
                }
              />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={categoryEdit.isActive ?? true}
                onChange={(e) => setCategoryEdit({ ...categoryEdit, isActive: e.target.checked })}
              />
              Shown on public site
            </label>
          </div>
        ) : null}
      </Drawer>

      <Drawer
        open={brandEdit !== null}
        onClose={() => setBrandEdit(null)}
        width="md"
        title={brandEdit?.id ? "Edit brand" : "Add brand"}
        sub="Brand record used on catalogue and brand pages"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveBrand()}
              className="h-11 flex-1 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setBrandEdit(null)}
              className="h-11 rounded-md border border-border px-5 text-[13px] font-semibold"
            >
              Cancel
            </button>
          </div>
        }
      >
        {brandEdit ? (
          <div className="grid gap-4">
            <Field label="Name">
              <input
                className={inputClass}
                value={brandEdit.name ?? ""}
                onChange={(e) => {
                  const name = e.target.value;
                  const autoSlug = !brandEdit.id;
                  setBrandEdit({
                    ...brandEdit,
                    name,
                    slug: autoSlug ? slugifyCatalogue(name) : (brandEdit.slug ?? ""),
                  });
                }}
              />
            </Field>
            <Field label="Slug">
              <input
                className={inputClass}
                value={brandEdit.slug ?? ""}
                onChange={(e) => setBrandEdit({ ...brandEdit, slug: e.target.value })}
              />
            </Field>
            <Field label="Positioning / tagline">
              <input
                className={inputClass}
                value={brandEdit.tagline ?? ""}
                onChange={(e) => setBrandEdit({ ...brandEdit, tagline: e.target.value })}
              />
            </Field>
            <Field label="Description">
              <textarea
                rows={4}
                className={inputClass}
                value={brandEdit.description ?? ""}
                onChange={(e) => setBrandEdit({ ...brandEdit, description: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={brandEdit.isActive ?? true}
                onChange={(e) => setBrandEdit({ ...brandEdit, isActive: e.target.checked })}
              />
              Published
            </label>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
