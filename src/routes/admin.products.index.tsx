import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { gbp } from "@/lib/data";
import { ROUTES } from "@/lib/app-nav";
import {
  createCatalogueProductFn,
  exportCatalogueProductsFn,
  listCatalogueBrandsFn,
  listCatalogueCategoriesFn,
  listCatalogueWorkspaceFn,
} from "@/server/phase2/fns";
import { CatalogueMedia } from "@/components/catalogue/CatalogueMedia";
import { InternalStockDisplay } from "@/components/ab/InternalStockDisplay";
import { cn } from "@/lib/utils";
import { InstantText } from "@/components/ab/InstantText";
import { toast } from "sonner";
import { useSession } from "@/lib/session";

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export const Route = createFileRoute("/admin/products/")({
  head: () => ({
    meta: [
      { title: "Product catalogue — Automotive Brands Admin" },
      {
        name: "description",
        content: "Search, filter and maintain the Automotive Brands product master.",
      },
    ],
  }),
  component: AdminProducts,
});

type CategoryRow = { id: string; name: string; parentId: string | null; depth: number };
type BrandRow = { id: string; name: string };
type ProductRow = {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  status: string;
  trade: number | null;
  rrp: number | null;
  stockLabel: string;
  stockQty: number | null;
  availability: "in" | "low" | "out" | null;
  imageSrc: string | null;
  updatedAt: string;
};

function statusTone(status: string) {
  if (status === "ACTIVE") return "good" as const;
  if (status === "DRAFT") return "warn" as const;
  if (status === "DISCONTINUED") return "bad" as const;
  return "warn" as const;
}

function AdminProducts() {
  const session = useSession();
  const canCreate =
    session.signedIn && session.user.navPermissions.includes("products.create");
  const canExport =
    session.signedIn &&
    (session.user.navPermissions.includes("products.export") ||
      session.user.navPermissions.includes("products.edit"));
  const canImport = session.signedIn && session.user.navPermissions.includes("products.import");

  const [items, setItems] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [brandId, setBrandId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [tradeVisible, setTradeVisible] = useState("");
  const [featured, setFeatured] = useState("");
  const [stock, setStock] = useState("");
  const [sort, setSort] = useState<"name" | "sku" | "updated" | "brand">("updated");
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = {
    q: debouncedQ || undefined,
    brandId: brandId || undefined,
    categoryId: categoryId || undefined,
    status: status || undefined,
    tradeVisible: tradeVisible === "" ? undefined : tradeVisible === "true",
    featured: featured === "" ? undefined : featured === "true",
    stock: (stock || undefined) as "in" | "out" | "unknown" | undefined,
    sort,
    page,
    pageSize: 25,
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [list, brandRows, catRows] = await Promise.all([
      listCatalogueWorkspaceFn({ data: query }),
      listCatalogueBrandsFn(),
      listCatalogueCategoriesFn(),
    ]);
    if (!list.ok) {
      setError(list.error);
      setItems([]);
    } else {
      setItems(list.data.items);
      setTotal(list.data.total);
      setPageCount(list.data.pageCount);
    }
    if (brandRows.ok) setBrands(brandRows.data);
    if (catRows.ok) setCategories(catRows.data);
    setLoading(false);
  }, [debouncedQ, brandId, categoryId, status, tradeVisible, featured, stock, sort, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv(filtered: boolean) {
    const r = await exportCatalogueProductsFn({
      data: filtered ? query : { page: 1, pageSize: 5000 },
    });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    const blob = new Blob([Uint8Array.from(bytesFromBase64(r.data.base64)) as BlobPart], { type: r.data.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = r.data.filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(filtered ? "Filtered catalogue exported" : "Full catalogue exported");
  }

  const filterControls = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <select value={brandId} onChange={(e) => { setPage(1); setBrandId(e.target.value); }} className={inputClass}>
        <option value="">All brands</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </select>
      <select value={categoryId} onChange={(e) => { setPage(1); setCategoryId(e.target.value); }} className={inputClass}>
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{"— ".repeat(c.depth)}{c.name}</option>
        ))}
      </select>
      <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className={inputClass}>
        <option value="">All statuses</option>
        <option value="DRAFT">Draft</option>
        <option value="ACTIVE">Active</option>
        <option value="INACTIVE">Inactive</option>
        <option value="DISCONTINUED">Discontinued</option>
      </select>
      <select value={tradeVisible} onChange={(e) => { setPage(1); setTradeVisible(e.target.value); }} className={inputClass}>
        <option value="">Trade visibility</option>
        <option value="true">Visible to trade</option>
        <option value="false">Hidden from trade</option>
      </select>
      <select value={featured} onChange={(e) => { setPage(1); setFeatured(e.target.value); }} className={inputClass}>
        <option value="">Featured</option>
        <option value="true">Featured only</option>
        <option value="false">Not featured</option>
      </select>
      <select value={stock} onChange={(e) => { setPage(1); setStock(e.target.value); }} className={inputClass}>
        <option value="">Stock (local)</option>
        <option value="in">Has local qty</option>
        <option value="out">Local qty zero</option>
        <option value="unknown">No Autopart stock yet</option>
      </select>
      <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={inputClass}>
        <option value="updated">Recently updated</option>
        <option value="name">Name</option>
        <option value="sku">SKU</option>
        <option value="brand">Brand</option>
      </select>
    </div>
  );

  return (
    <div>
      <PanelHeader
        title="Products"
        sub={`${total.toLocaleString("en-GB")} catalogue lines · SKU is the import identity`}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            {canImport ? (
              <Link
                to={ROUTES.adminProductImports}
                className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-semibold uppercase tracking-wide"
              >
                Import
              </Link>
            ) : null}
            {canExport ? (
              <>
                <button type="button" onClick={() => void exportCsv(true)} className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase tracking-wide">
                  Export filtered
                </button>
                <button type="button" onClick={() => void exportCsv(false)} className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase tracking-wide">
                  Export all
                </button>
              </>
            ) : null}
            {canCreate ? (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground"
              >
                Add product
              </button>
            ) : null}
          </div>
        }
      />

      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={q}
            onChange={(e) => { setPage(1); setQ(e.target.value); }}
            placeholder="Search SKU, name, EAN or MPN"
            className={`${inputClass} max-w-lg`}
          />
          <button
            type="button"
            className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase lg:hidden"
            onClick={() => setFiltersOpen(true)}
          >
            Filters
          </button>
        </div>
        <div className="hidden lg:block">{filterControls}</div>

        {error ? (
          <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">{error}</div>
        ) : null}

        <div className="grid gap-3 md:hidden">
          {loading ? <p className="text-[13px] text-steel">Loading catalogue…</p> : null}
          {!loading && items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-steel">
              No products match. Add a product or import a CSV.
            </p>
          ) : null}
          {items.map((p) => (
            <Link
              key={p.id}
              to="/admin/products/$id"
              params={{ id: p.id }}
              className="flex gap-3 rounded-lg border border-border bg-surface/40 p-3"
            >
              <CatalogueMedia src={p.imageSrc} className="size-14 rounded border border-border" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.name}</div>
                <div className="num text-[12px] text-primary">{p.sku}</div>
                <div className="text-[12px] text-steel">{p.brand} · {p.category}</div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <StatusBadge tone={statusTone(p.status)}>{p.status}</StatusBadge>
                  <span className="text-[12px] font-semibold text-primary">Edit product</span>
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
          <table className="w-full min-w-[960px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">Image</th>
                <th className="px-3 py-2 font-semibold">SKU</th>
                <th className="px-3 py-2 font-semibold">Product</th>
                <th className="px-3 py-2 font-semibold">Brand</th>
                <th className="px-3 py-2 font-semibold">Category</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Trade</th>
                <th className="px-3 py-2 text-right font-semibold">RRP</th>
                <th className="px-3 py-2 text-right font-semibold">Stock</th>
                <th className="px-3 py-2 font-semibold">Updated</th>
                <th className="px-3 py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-3 py-10 text-center text-sm text-steel">Loading catalogue…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={11} className="px-3 py-10 text-center text-sm text-steel">No products match. Add a product or import a CSV.</td></tr>
              ) : (
                items.map((p, i) => (
                  <tr key={p.id} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                    <td className="px-3 py-2">
                      <CatalogueMedia src={p.imageSrc} className="size-10 rounded border border-border" />
                    </td>
                    <td className="num px-3 py-2 text-primary">
                      <Link to="/admin/products/$id" params={{ id: p.id }} className="hover:underline">{p.sku}</Link>
                    </td>
                    <td className="px-3 py-2">
                      <Link to="/admin/products/$id" params={{ id: p.id }} className="font-medium hover:underline">{p.name}</Link>
                    </td>
                    <td className="px-3 py-2 text-steel">{p.brand}</td>
                    <td className="px-3 py-2 text-steel">{p.category}</td>
                    <td className="px-3 py-2"><StatusBadge tone={statusTone(p.status)}>{p.status}</StatusBadge></td>
                    <td className="num px-3 py-2 text-right">{p.trade != null ? gbp(p.trade) : "—"}</td>
                    <td className="num px-3 py-2 text-right text-steel">{p.rrp != null ? gbp(p.rrp) : "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <InternalStockDisplay qty={p.stockQty} availability={p.availability} />
                    </td>
                    <td className="num px-3 py-2 text-steel"><InstantText value={p.updatedAt} variant="date" /></td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        to="/admin/products/$id"
                        params={{ id: p.id }}
                        className="text-[12px] font-semibold text-primary hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {pageCount > 1 ? (
          <div className="flex items-center justify-between text-[13px]">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="h-9 rounded-md border border-border px-3 disabled:opacity-40">Previous</button>
            <span className="text-steel">Page {page} of {pageCount}</span>
            <button type="button" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} className="h-9 rounded-md border border-border px-3 disabled:opacity-40">Next</button>
          </div>
        ) : null}
      </div>

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters">
        {filterControls}
      </Drawer>

      <AddProductDrawer
        open={addOpen}
        brands={brands}
        categories={categories}
        onClose={() => setAddOpen(false)}
      />
    </div>
  );
}

function AddProductDrawer({
  open,
  brands,
  categories,
  onClose,
}: {
  open: boolean;
  brands: BrandRow[];
  categories: CategoryRow[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSku("");
      setName("");
      setBrandId(brands[0]?.id ?? "");
      setCategoryId(categories[0]?.id ?? "");
    }
  }, [open, brands, categories]);

  if (!open) return null;

  return (
    <Drawer open title="Add product" sub="SKU, name, brand and category. Enrich the rest in the workspace." onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            setSaving(true);
            const r = await createCatalogueProductFn({ data: { sku, name, brandId, categoryId } });
            setSaving(false);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            toast.success("Product created as a draft");
            onClose();
            await navigate({ to: "/admin/products/$id", params: { id: r.data.id } });
          })();
        }}
      >
        <Field label="SKU" htmlFor="new-sku">
          <input id="new-sku" required value={sku} onChange={(e) => setSku(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Product name" htmlFor="new-name">
          <input id="new-name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Brand" htmlFor="new-brand">
          <select id="new-brand" required value={brandId} onChange={(e) => setBrandId(e.target.value)} className={inputClass}>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="Category" htmlFor="new-cat">
          <select id="new-cat" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
            {categories.length === 0 ? <option value="">Add a category first</option> : null}
            {categories.map((c) => <option key={c.id} value={c.id}>{"— ".repeat(c.depth)}{c.name}</option>)}
          </select>
        </Field>
        <button type="submit" disabled={saving || !brandId || !categoryId} className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50">
          {saving ? "Creating…" : "Create and open"}
        </button>
      </form>
    </Drawer>
  );
}
