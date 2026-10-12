import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { ROUTES } from "@/lib/app-nav";
import { listPortalPromotionsFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/portal/promotions")({
  head: () => ({
    meta: [
      { title: "Promotions — Automotive Brands Trade Portal" },
      {
        name: "description",
        content: "Current Automotive Brands trade promotions for your account.",
      },
    ],
  }),
  component: PortalPromotionsPage,
});

type PromotionList = Extract<Awaited<ReturnType<typeof listPortalPromotionsFn>>, { ok: true }>["data"];

function PortalPromotionsPage() {
  const [data, setData] = useState<PromotionList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const result = await listPortalPromotionsFn();
      if (!result.ok) {
        setError(result.error);
        setData(null);
      } else {
        setData(result.data);
        setError(null);
      }
      setLoading(false);
    })();
  }, []);

  return (
    <div>
      <PanelHeader
        title="Promotions"
        sub="Current trade offers"
        actions={
          <Link
            to={ROUTES.products}
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
          >
            Shop products
          </Link>
        }
      />
      <div className="space-y-4 p-4 sm:p-6">
        <p className="max-w-3xl text-[13px] text-steel">
          These offers are applied automatically when they reduce your trade unit price. Only one
          promotion applies to a line. This page does not change prices.
        </p>
        {loading ? <p className="text-[13px] text-steel">Loading promotions…</p> : null}
        {error ? <p className="text-[13px] text-bad">{error}</p> : null}
        {!loading && data && data.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface/40 p-5">
            <h2 className="font-display text-lg font-semibold uppercase tracking-tight">
              No current trade promotions
            </h2>
            <p className="mt-2 text-[13px] text-steel">
              There are no active offers to show. Your account prices stay as agreed.
            </p>
          </div>
        ) : null}
        {data?.map((promotion) => (
          <article key={promotion.id} className="rounded-lg border border-border bg-surface/40 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold uppercase tracking-tight">
                  {promotion.name}
                </h2>
                <p className="mt-1 text-[12px] text-steel">Offer code {promotion.code}</p>
              </div>
              <p className="font-display text-xl font-semibold text-primary">{promotion.offerLabel}</p>
            </div>
            <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.16em] text-steel">Validity</dt>
                <dd className="mt-1">{promotion.validityLabel}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.16em] text-steel">Applies to</dt>
                <dd className="mt-1">
                  {promotion.scope === "catalogue" ? "All trade products" : "Selected products"}
                </dd>
              </div>
            </dl>
            {promotion.scope === "products" && promotion.products.length > 0 ? (
              <ul className="mt-4 divide-y divide-border border-t border-border">
                {promotion.products.map((product) => (
                  <li key={product.sku} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="font-semibold">{product.name}</div>
                      <div className="text-[12px] text-steel">{product.sku}</div>
                    </div>
                    <Link
                      to="/products/$sku"
                      params={{ sku: product.sku }}
                      className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase hover:border-steel"
                    >
                      View product
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {promotion.scope === "products" && promotion.products.length === 0 ? (
              <p className="mt-4 text-[13px] text-steel">
                This offer is limited to selected products. Open a product to see whether it applies
                to your trade price.
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
