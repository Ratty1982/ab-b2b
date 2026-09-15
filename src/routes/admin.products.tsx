import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StockBadge, StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { brands, gbp, products, type Product } from "@/lib/data";
import { categories } from "@/lib/crm-data";
import { cn } from "@/lib/utils";

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

function AdminProducts() {
  const [tab, setTab] = useState<"Products" | "Brands" | "Categories">("Products");
  const [term, setTerm] = useState("");
  const [edit, setEdit] = useState<Product | null>(null);

  const rows = products.filter(
    (p) =>
      !term ||
      p.sku.toLowerCase().includes(term.toLowerCase()) ||
      p.name.toLowerCase().includes(term.toLowerCase()) ||
      p.brand.toLowerCase().includes(term.toLowerCase()),
  );

  return (
    <div>
      <PanelHeader
        title="Catalogue"
        sub="Products, brands and categories across all five Automotive Brands ranges"
        actions={
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Add product
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
                    <td className="px-3 py-2 text-steel">{p.category}</td>
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
                        onClick={() => setEdit(p)}
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
      ) : tab === "Brands" ? (
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
                  <tr key={b.slug} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                    <td className="px-3 py-2 font-semibold">{b.name}</td>
                    <td className="px-3 py-2 text-steel">{b.category}</td>
                    <td className="num px-3 py-2 text-steel">/brands/{b.slug}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone="good">Published</StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="text-[12px] font-semibold text-primary hover:underline">
                        Edit page
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="p-4 sm:p-6">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">Category</th>
                  <th className="px-3 py-2 font-semibold">Shown on public site</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c, i) => (
                  <tr key={c.name} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone="good">Visible</StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="text-[12px] font-semibold text-primary hover:underline">
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Drawer
        open={edit !== null}
        onClose={() => setEdit(null)}
        width="lg"
        title={edit ? `${edit.sku} — ${edit.name}` : ""}
        sub="Catalogue record"
        footer={
          <div className="flex gap-2">
            <button type="button" className="h-11 flex-1 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">
              Save changes
            </button>
            <button type="button" onClick={() => setEdit(null)} className="h-11 rounded-md border border-border px-5 text-[13px] font-semibold">
              Cancel
            </button>
          </div>
        }
      >
        {edit ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="SKU">
              <input className={inputClass} defaultValue={edit.sku} />
            </Field>
            <Field label="Product name">
              <input className={inputClass} defaultValue={edit.name} />
            </Field>
            <Field label="Brand">
              <select className={inputClass} defaultValue={edit.brand}>
                {brands.map((b) => (
                  <option key={b.slug}>{b.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <input className={inputClass} defaultValue={edit.category} />
            </Field>
            <Field label="Trade list price">
              <input className={inputClass} defaultValue={edit.trade.toFixed(2)} />
            </Field>
            <Field label="RRP">
              <input className={inputClass} defaultValue={edit.rrp.toFixed(2)} />
            </Field>
            <Field label="Pack quantity">
              <input className={inputClass} defaultValue={String(edit.packQty)} />
            </Field>
            <Field label="Case quantity">
              <input className={inputClass} defaultValue={String(edit.caseQty)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <textarea rows={4} className={inputClass} defaultValue={edit.description} />
              </Field>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
