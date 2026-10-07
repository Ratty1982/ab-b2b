import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import { InstantText } from "@/components/ab/InstantText";
import { getAutopartProductFn, linkAutopartProductToVariantFn } from "@/server/phase2/fns";
import { ProductPurchasingPanel } from "@/components/purchasing/product-panel";

export const Route = createFileRoute("/admin/products/stock/product/$sku")({
  head: ({ params }) => ({
    meta: [{ title: `${params.sku} — Autopart product — Automotive Brands` }],
  }),
  component: AutopartProductPage,
});

type Data = Extract<Awaited<ReturnType<typeof getAutopartProductFn>>, { ok: true }>["data"];

function AutopartProductPage() {
  const { sku } = Route.useParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [variantSku, setVariantSku] = useState("");
  const [linking, setLinking] = useState(false);

  function load() {
    void getAutopartProductFn({ data: { sku } }).then((result) => {
      if (!result.ok) {
        setError(result.error);
        setData(null);
        return;
      }
      setError(null);
      setData(result.data);
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku]);

  async function link() {
    if (!data?.canLink || !variantSku.trim()) return;
    setLinking(true);
    const result = await linkAutopartProductToVariantFn({
      data: { sku, variantSku: variantSku.trim() },
    });
    setLinking(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setData(result.data);
    setVariantSku("");
  }

  return (
    <>
      <PanelHeader
        title={data?.description || sku}
        sub={`${sku} · internal Autopart product intelligence`}
        crumbs={[
          { label: "Catalogue", to: ROUTES.adminProducts },
          { label: "Autopart Stock", to: ROUTES.adminStockSync },
          { label: sku },
        ]}
      />
      {error ? (
        <p className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      {!data && !error ? <p className="px-4 py-8 text-[13px] text-steel">Loading Autopart product…</p> : null}
      {data ? (
        <div className="grid gap-8 px-4 py-5 sm:px-6 lg:grid-cols-2">
          <section>
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Overview</h2>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
              <div>
                <dt className="text-[10px] uppercase text-steel">SKU</dt>
                <dd className="font-mono">{data.sku}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-steel">Product type</dt>
                <dd>
                  <StatusBadge tone={data.kind === "EXTERNAL" ? "info" : data.kind === "CATALOGUE" ? "good" : "neutral"}>
                    {data.kindLabel}
                  </StatusBadge>
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[10px] uppercase text-steel">Description</dt>
                <dd>{data.description || "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[10px] uppercase text-steel">Last stock sync</dt>
                <dd>
                  <InstantText value={data.sourceUpdatedAt ?? data.lastSeenAt} />
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Stock</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
              <div>
                <dt className="text-[10px] uppercase text-steel">Avail</dt>
                <dd className="tabular-nums">{data.stale ? "Stock data delayed" : data.availQty.toLocaleString("en-GB")}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-steel">Physical</dt>
                <dd className="tabular-nums">{data.physicalQty == null ? "—" : data.physicalQty.toLocaleString("en-GB")}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-steel">Incoming</dt>
                <dd className="tabular-nums">
                  {data.stale ? "Incoming delayed" : data.incomingQty == null ? "—" : data.incomingQty.toLocaleString("en-GB")}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[12px] text-steel">
              {data.availLine} · {data.incomingLine}
            </p>
          </section>

          <ProductPurchasingPanel sku={sku} />

          <section>
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Sales</h2>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
              <div>
                <dt className="text-[10px] uppercase text-steel">30 days</dt>
                <dd className="tabular-nums">{data.sales.last30.toLocaleString("en-GB")}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-steel">90 days</dt>
                <dd className="tabular-nums">{data.sales.last90.toLocaleString("en-GB")}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-steel">365 days</dt>
                <dd className="tabular-nums">{data.sales.last365.toLocaleString("en-GB")}</dd>
              </div>
              <div className="col-span-3">
                <dt className="text-[10px] uppercase text-steel">Weekly demand</dt>
                <dd>{data.sales.weeklyDemand == null ? "—" : data.sales.weeklyDemand.toFixed(1)}</dd>
              </div>
            </dl>
            <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-steel">Top customer accounts</h3>
            {data.sales.topCustomers.length === 0 ? (
              <p className="mt-2 text-[13px] text-steel">No Autopart sales history for this SKU in the last year.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-[13px]">
                {data.sales.topCustomers.map((c) => (
                  <li key={c.name} className="flex justify-between gap-3">
                    <span>{c.name}</span>
                    <span className="tabular-nums text-steel">{c.units.toLocaleString("en-GB")}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.canLink && data.kind !== "CATALOGUE" ? (
            <section className="lg:col-span-2">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Link existing catalogue SKU</h2>
              <p className="mt-1 text-[12px] text-steel">
                Super Admin / catalogue staff can attach this Autopart SKU to an existing ProductVariant. This
                does not create a public product and does not rewrite sales history.
              </p>
              <div className="mt-3 flex max-w-xl flex-wrap items-end gap-2">
                <Field label="Existing catalogue SKU" htmlFor="link-variant-sku">
                  <input
                    id="link-variant-sku"
                    className={inputClass}
                    value={variantSku}
                    onChange={(e) => setVariantSku(e.target.value)}
                    placeholder="Exact AB catalogue SKU"
                  />
                </Field>
                <button
                  type="button"
                  className="h-10 rounded-md bg-primary px-4 text-[11px] font-semibold uppercase text-primary-foreground disabled:opacity-50"
                  disabled={linking || !variantSku.trim()}
                  onClick={() => void link()}
                >
                  {linking ? "Linking…" : "Link"}
                </button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
