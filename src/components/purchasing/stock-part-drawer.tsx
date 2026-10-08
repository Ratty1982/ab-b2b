import { useEffect, useState } from "react";
import { Drawer } from "@/components/ab/Drawer";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { EmptyState, ErrorState, qty, ukDate } from "@/components/purchasing/workspace";
import { getStockPartDetailFn } from "@/server/phase2/fns";

type Detail = Extract<Awaited<ReturnType<typeof getStockPartDetailFn>>, { ok: true }>["data"];

function tone(status: NonNullable<Detail>["stockStatus"]): Tone {
  if (status === "OUT_OF_STOCK") return "bad";
  if (status === "LOW") return "warn";
  if (status === "UNKNOWN") return "neutral";
  return "good";
}

function HistoryChart({ points }: { points: { at: string; qty: number }[] }) {
  const width = 520;
  const height = 140;
  const pad = 18;
  const min = Math.min(...points.map((point) => point.qty));
  const max = Math.max(...points.map((point) => point.qty));
  const span = max - min || 1;
  const coords = points.map((point, index) => {
    const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
    const y = height - pad - ((point.qty - min) / span) * (height - pad * 2);
    return `${x},${y}`;
  });
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-3 h-36 w-full text-primary"
      role="img"
      aria-label="Stock history"
    >
      <polyline fill="none" stroke="currentColor" strokeWidth="2" points={coords.join(" ")} />
      {points.length === 1 ? (
        <circle
          cx={coords[0]?.split(",")[0]}
          cy={coords[0]?.split(",")[1]}
          r="3"
          fill="currentColor"
        />
      ) : null}
    </svg>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/80 bg-surface/40 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">
        {label}
      </div>
      <div className="mt-1 text-[13px]">{value}</div>
    </div>
  );
}

export function StockPartDrawer({ sku, onClose }: { sku: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setError(null);
    void getStockPartDetailFn({ data: { sku } }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setDetail(null);
        return;
      }
      setDetail(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [sku]);

  return (
    <Drawer open title={sku} sub="Stock detail" width="lg" onClose={onClose}>
      <div data-stock-drawer={sku}>
        {error ? <ErrorState message={error} /> : null}
        {detail === undefined && !error ? (
          <div className="grid gap-2" aria-hidden>
            <div className="h-16 animate-pulse bg-secondary/50" />
            <div className="h-28 animate-pulse bg-secondary/40" />
            <div className="h-28 animate-pulse bg-secondary/30" />
          </div>
        ) : null}
        {detail === null && !error ? (
          <EmptyState
            title="Part number not found"
            body="This part number is not in the imported stock records."
          />
        ) : null}
        {detail ? (
          <div className="grid gap-6">
            <section>
              <h3 className="font-display text-sm font-semibold uppercase tracking-tight">
                Product
              </h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Fact label="Part number" value={detail.sku} />
                <Fact label="Product name" value={detail.productName || "—"} />
                <Fact label="Brand" value={detail.brandName || "—"} />
                <Fact label="SKU" value={detail.catalogueSku || detail.sku} />
                <Fact label="EAN" value={detail.ean || "—"} />
                <Fact label="Catalogue" value={detail.catalogueLabel} />
              </div>
            </section>
            <section>
              <h3 className="font-display text-sm font-semibold uppercase tracking-tight">Stock</h3>
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge tone={tone(detail.stockStatus)}>{detail.statusLabel}</StatusBadge>
                <span className="text-[12px] text-steel">
                  Last seen {ukDate(detail.lastSeenAt)}
                </span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Fact
                  label="Physical"
                  value={detail.physicalQty == null ? "—" : qty(detail.physicalQty)}
                />
                <Fact
                  label="Unavailable"
                  value={detail.unavailableQty == null ? "—" : qty(detail.unavailableQty)}
                />
                <Fact
                  label="Sellable"
                  value={detail.sellableQty == null ? "—" : qty(detail.sellableQty)}
                />
                <Fact label="Warehouse Avail" value={qty(detail.availQty)} />
                <Fact
                  label="Last successful update"
                  value={
                    detail.lastSuccessfulUpdateAt
                      ? ukDate(detail.lastSuccessfulUpdateAt)
                      : "No quantity change is recorded"
                  }
                />
                <Fact label="Incoming" value={qty(detail.incomingQty)} />
                <Fact
                  label="Reorder threshold"
                  value={detail.reorderPoint == null ? "Not configured" : qty(detail.reorderPoint)}
                />
              </div>
            </section>
            <section>
              <h3 className="font-display text-sm font-semibold uppercase tracking-tight">
                Warehouse
              </h3>
              {detail.locations.length === 0 ? (
                <p className="mt-2 text-[13px] text-steel">
                  No warehouse breakdown is stored for this part number.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-border/70 border border-border/80">
                  {detail.locations.map((location) => (
                    <li
                      key={`${location.kind}-${location.code}`}
                      className="flex items-center justify-between px-3 py-2 text-[13px]"
                    >
                      <span>
                        {location.name}
                        <span className="ml-2 text-[11px] uppercase tracking-[0.12em] text-steel">
                          {location.kind}
                        </span>
                      </span>
                      <span className="tabular-nums">{qty(location.qty)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="font-display text-sm font-semibold uppercase tracking-tight">
                Purchasing
              </h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Fact
                  label="Preferred supplier"
                  value={detail.supplierName || "No preferred supplier is recorded"}
                />
                <Fact
                  label="Expected arrival"
                  value={
                    detail.expectedArrivalAt
                      ? ukDate(detail.expectedArrivalAt)
                      : "Arrival date is not available"
                  }
                />
              </div>
            </section>
            <section>
              <h3 className="font-display text-sm font-semibold uppercase tracking-tight">
                Stock history
              </h3>
              {detail.history.available ? (
                <>
                  <p className="mt-2 text-[12px] text-steel">
                    {detail.history.source}. Current warehouse Avail {qty(detail.currentQty)}.
                  </p>
                  <HistoryChart points={detail.history.points} />
                </>
              ) : (
                <p className="mt-2 text-[13px] text-steel">
                  Current warehouse Avail is {qty(detail.currentQty)}. Historical data is
                  unavailable.
                </p>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
