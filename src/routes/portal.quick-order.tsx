import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { inputClass } from "@/components/ab/Drawer";
import { ProductResultList } from "@/components/public/ProductCard";
import { ROUTES } from "@/lib/app-nav";
import { listPublicCatalogueFn } from "@/server/phase2/fns";
import type { PublicProductCard } from "@/server/catalogue/products";

export const Route = createFileRoute("/portal/quick-order")({
  head: () => ({
    meta: [{ title: "Quick Order — Automotive Brands Trade Portal" }],
  }),
  component: QuickOrder,
});

function QuickOrder() {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PublicProductCard[]>([]);
  const [total, setTotal] = useState(0);
  const [searched, setSearched] = useState(false);

  async function search(next: string) {
    const q = next.trim();
    setQuery(q);
    setSearched(true);
    if (q.length < 2) {
      setItems([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const result = await listPublicCatalogueFn({ data: { q, page: 1 } });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setItems([]);
      setTotal(0);
      return;
    }
    setItems(result.data.items);
    setTotal(result.data.total);
  }

  return (
    <div>
      <PanelHeader
        title="Quick order"
        sub="Search by part number or name, then add to your basket."
        actions={
          <Link
            to={ROUTES.portalBasket}
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-bold uppercase hover:border-steel"
          >
            View basket
          </Link>
        }
      />
      <div className="grid gap-4 p-4 sm:p-6">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search(draft);
          }}
        >
          <label className="grid min-w-[16rem] flex-1 gap-1 text-[12px] font-semibold text-steel">
            Part number or product name
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className={inputClass}
              autoComplete="off"
            />
          </label>
          <button
            type="submit"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
          >
            Search
          </button>
        </form>
        {query.length > 0 && query.length < 2 ? (
          <p className="text-[13px] text-steel">Enter at least two characters.</p>
        ) : null}
        {loading ? <p className="text-[13px] text-steel">Searching…</p> : null}
        {error ? <p className="text-[13px] text-bad">{error}</p> : null}
        {!loading && searched && query.length >= 2 && items.length === 0 && !error ? (
          <p className="text-[13px] text-steel">No products match “{query}”.</p>
        ) : null}
        {items.length > 0 ? (
          <>
            <p className="text-[12px] text-steel">
              {total} product{total === 1 ? "" : "s"}
              {total > items.length ? `. Showing ${items.length}.` : "."}
            </p>
            <ProductResultList items={items} />
          </>
        ) : null}
        {!searched ? (
          <p className="text-[13px] text-steel">
            Prices and availability follow your trade account.{" "}
            <Link to={ROUTES.products} className="text-primary hover:underline">
              Open the shop
            </Link>{" "}
            to browse by brand.
          </p>
        ) : null}
      </div>
    </div>
  );
}
