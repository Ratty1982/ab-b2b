import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { ROUTES } from "@/lib/app-nav";
import { addToBasketFn, listPortalPromotionsFn } from "@/server/phase2/fns";

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
  const [basketNote, setBasketNote] = useState<Record<string, string>>({});

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
          Prices shown are your account unit price ex VAT when this offer is the one the pricing
          engine applies. Basket and checkout calculate the order price. Only one promotion applies
          to a line.
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
            <div className="flex flex-wrap items-start gap-4">
              {promotion.imageUrl ? (
                <img
                  src={promotion.imageUrl}
                  alt=""
                  className="h-20 w-32 rounded-md border border-border object-cover"
                />
              ) : null}
              <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-semibold uppercase tracking-tight">
                    {promotion.name}
                  </h2>
                  <p className="mt-1 text-[12px] text-steel">Offer code {promotion.code}</p>
                  {promotion.description ? (
                    <p className="mt-2 max-w-2xl text-[13px] text-steel">{promotion.description}</p>
                  ) : null}
                </div>
                <p className="font-display text-xl font-semibold text-primary">{promotion.offerLabel}</p>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.16em] text-steel">Start and expiry</dt>
                <dd className="mt-1">{promotion.validityLabel}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.16em] text-steel">Applies to</dt>
                <dd className="mt-1">
                  {promotion.scope === "catalogue" ? "All trade products" : "Selected products"}
                </dd>
              </div>
            </dl>
            {promotion.products.length > 0 ? (
              <ul className="mt-4 divide-y divide-border border-t border-border">
                {promotion.products.map((product) => (
                  <li key={product.variantId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="font-semibold">{product.name}</div>
                      <div className="text-[12px] text-steel">{product.sku}</div>
                      {product.unitPriceLabel ? (
                        <div className="mt-1 text-[13px]">Your price {product.unitPriceLabel} ex VAT</div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        to="/products/$sku"
                        params={{ sku: product.slug }}
                        className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase hover:border-steel"
                      >
                        View product
                      </Link>
                      <button
                        type="button"
                        className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground"
                        onClick={() => {
                          void (async () => {
                            const result = await addToBasketFn({
                              data: { variantId: product.variantId, quantity: product.quantity },
                            });
                            setBasketNote((current) => ({
                              ...current,
                              [product.variantId]: result.ok
                                ? "Added to basket"
                                : result.error,
                            }));
                          })();
                        }}
                      >
                        Add {product.quantity} to basket
                      </button>
                    </div>
                    {basketNote[product.variantId] ? (
                      <p className="w-full text-[12px] text-steel">{basketNote[product.variantId]}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-[13px] text-steel">
                This offer does not currently reduce your unit price. Open a product to see your trade price.
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
