import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { CatalogueMedia } from "@/components/catalogue/CatalogueMedia";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { listBackInStockEventsFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/admin/products/stock/back-in-stock")({
  head: () => ({
    meta: [
      { title: "Back in Stock — Automotive Brands" },
      {
        name: "description",
        content: "History of products that returned from confirmed zero Autopart Avail.",
      },
    ],
  }),
  component: BackInStockHistoryPage,
});

type Listed = Extract<Awaited<ReturnType<typeof listBackInStockEventsFn>>, { ok: true }>["data"];

function BackInStockHistoryPage() {
  const [data, setData] = useState<Listed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    void listBackInStockEventsFn({ data: { page, pageSize: 24 } }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setData(null);
        return;
      }
      setError(null);
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [page]);

  const totalPages = data ? Math.max(1, Math.ceil(data.totalMatching / data.pageSize)) : 1;

  return (
    <>
      <PanelHeader
        title="Back in stock"
        sub="Confirmed Autopart Avail transitions from zero to available"
        crumbs={[
          { label: "Catalogue", to: ROUTES.adminProducts },
          { label: "Autopart Stock", to: ROUTES.adminStockSync },
          { label: "Back in stock" },
        ]}
      />

      <div className="px-4 pb-10 sm:px-6">
        {error ? (
          <p className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}

        {!data && !error ? (
          <p className="py-8 text-[13px] text-steel">Loading back-in-stock history…</p>
        ) : null}

        {data && data.items.length === 0 ? (
          <div className="rounded-xl bg-[#12151c] px-4 py-10 text-center ring-1 ring-inset ring-white/10">
            <p className="text-[14px] font-medium text-white/85">No back-in-stock events to show</p>
            <p className="mt-1 text-[12px] text-white/45">
              Events appear after a live stock sync moves confirmed zero Avail to a positive quantity.
            </p>
            <Link
              to={ROUTES.adminStockSync}
              className="mt-4 inline-block text-[12px] font-semibold uppercase tracking-[0.12em] text-primary hover:underline"
            >
              Open Autopart Stock
            </Link>
          </div>
        ) : null}

        {data && data.items.length > 0 ? (
          <>
            <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {data.items.map((item) => (
                <li key={item.id}>
                  <div
                    className={cn(
                      "flex gap-3 rounded-xl bg-[#12151c] p-3 ring-1 ring-inset ring-white/10",
                      "transition-colors hover:bg-[#171b24] hover:ring-emerald-400/25",
                    )}
                  >
                    <a href={item.href} className="size-16 shrink-0 overflow-hidden rounded-lg bg-white">
                      <CatalogueMedia src={item.imageSrc} alt={item.productName} className="size-full" />
                    </a>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <a href={item.href} className="block truncate text-[13px] font-semibold text-white hover:underline">
                            {item.productName}
                          </a>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-white/55">{item.sku}</p>
                        </div>
                        <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
                          Now in stock
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] text-white/65">
                        Was 0 → now {item.currentSellableQty}
                        {item.reservedQty > 0 ? ` · ${item.reservedQty} reserved` : ""}
                        <span className="text-white/40"> · {item.observedAtLabel}</span>
                      </p>
                      <p className="mt-1 text-[11px]">
                        <a href={item.href} className="text-primary/90 hover:underline">
                          Product
                        </a>
                        <span className="text-white/30"> · </span>
                        <a href={item.stockHref} className="text-white/70 hover:text-white hover:underline">
                          Stock detail
                        </a>
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {totalPages > 1 ? (
              <div className="mt-6 flex items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-md bg-surface px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wide ring-1 ring-inset ring-border/60 disabled:opacity-40"
                >
                  Previous
                </button>
                <p className="text-[12px] text-steel">
                  Page {page} of {totalPages}
                </p>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-md bg-surface px-3 py-1.5 text-[12px] font-semibold uppercase tracking-wide ring-1 ring-inset ring-border/60 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
