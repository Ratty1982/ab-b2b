import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { btnClass, controlClass, qty } from "@/components/purchasing/workspace";
import { salesTrendFilenameMonth, type SalesTrendRange } from "@/domain/sales-trend";
import { getBrandSalesTrendFn, getSkuSalesTrendFn, listSalesHistoryBrandsFn } from "@/server/phase2/fns";

type SkuTrend = Extract<Awaited<ReturnType<typeof getSkuSalesTrendFn>>, { ok: true }>["data"];
type BrandTrend = Extract<Awaited<ReturnType<typeof getBrandSalesTrendFn>>, { ok: true }>["data"];
type Brand = { slug: string; name: string };

const RANGES: Array<{ id: SalesTrendRange; label: string }> = [
  { id: "12", label: "12 months" },
  { id: "24", label: "24 months" },
  { id: "all", label: "All available" },
];

export function SkuSalesTrendSheet({
  sku,
  name,
  open,
  onOpenChange,
}: {
  sku: string | null;
  name?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [range, setRange] = useState<SalesTrendRange>("12");
  const [trend, setTrend] = useState<SkuTrend | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sku) return;
    let cancelled = false;
    setTrend(null);
    setError(null);
    void getSkuSalesTrendFn({ data: { sku, range } }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setTrend(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, sku, range]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-display uppercase tracking-wide">Sales trend</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid gap-3 text-[13px]">
          <div>
            <div className="font-medium">{name || sku}</div>
            <div className="font-mono text-[12px] text-steel">{sku}</div>
          </div>
          <RangePicker range={range} onChange={setRange} />
          {error ? <p className="text-destructive">{error}</p> : null}
          {trend ? <TrendBody trend={trend} mode="units" skuFacts={trend} /> : <p className="text-steel">Loading sales trend…</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function BrandSalesTrendDialog({
  open,
  onOpenChange,
  initialBrandSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialBrandSlug?: string | null;
}) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandSlug, setBrandSlug] = useState(initialBrandSlug ?? "");
  const [range, setRange] = useState<SalesTrendRange>("12");
  const [measure, setMeasure] = useState<"units" | "net">("units");
  const [trend, setTrend] = useState<BrandTrend | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBrandSlug(initialBrandSlug ?? "");
    setRange("12");
    setMeasure("units");
    void listSalesHistoryBrandsFn().then((result) => {
      if (!result.ok) return;
      setBrands(result.data);
      setBrandSlug((current) => current || result.data.find((brand) => brand.slug === initialBrandSlug)?.slug || "");
    });
  }, [open, initialBrandSlug]);

  useEffect(() => {
    if (!open || !brandSlug) {
      setTrend(null);
      return;
    }
    let cancelled = false;
    setError(null);
    void getBrandSalesTrendFn({ data: { brandSlug, range } }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setTrend(null);
        setError(result.error);
        return;
      }
      setTrend(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, brandSlug, range]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-wide">Brand trend</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 text-[13px]">
          <div className="flex flex-wrap gap-2">
            <select className={controlClass} value={brandSlug} onChange={(event) => setBrandSlug(event.target.value)}>
              <option value="">Select a brand</option>
              {brands.map((brand) => (
                <option key={brand.slug} value={brand.slug}>
                  {brand.name}
                </option>
              ))}
            </select>
            <RangePicker range={range} onChange={setRange} />
            <div className="flex gap-1">
              <button type="button" className={btnClass} onClick={() => setMeasure("units")}>
                Units
              </button>
              <button type="button" className={btnClass} onClick={() => setMeasure("net")}>
                Net sales
              </button>
            </div>
          </div>
          {error ? <p className="text-destructive">{error}</p> : null}
          {trend ? (
            <>
              <div className="text-steel">
                {trend.brandName} · {trend.skuCount.toLocaleString("en-GB")} products with sales
                {measure === "net" ? " · Net sales are ex VAT from imported invoices" : ""}
              </div>
              <TrendBody trend={trend} mode={measure} />
            </>
          ) : (
            <p className="text-steel">{brandSlug ? "Loading brand trend…" : "Choose a brand to see monthly sales."}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RangePicker({ range, onChange }: { range: SalesTrendRange; onChange: (range: SalesTrendRange) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {RANGES.map((item) => (
        <button key={item.id} type="button" className={btnClass} onClick={() => onChange(item.id)} aria-pressed={range === item.id}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function TrendBody({
  trend,
  mode,
  skuFacts,
}: {
  trend: Pick<
    BrandTrend,
    | "points"
    | "average3"
    | "average6"
    | "average12"
    | "last12Units"
    | "previous12Units"
    | "peakMonth"
    | "peakUnits"
    | "lowestCompleteMonth"
    | "lowestCompleteUnits"
    | "directionLabel"
    | "directionReason"
    | "yoy"
  >;
  mode: "units" | "net";
  skuFacts?: Pick<SkuTrend, "last30" | "last90" | "last365">;
}) {
  const chart = trend.points.map((point) => ({
    label: salesTrendFilenameMonth(point.month),
    value: mode === "net" ? point.netSales : point.units,
    complete: point.complete,
  }));
  return (
    <div className="grid gap-3">
      <div className="h-56 w-full">
        {chart.length === 0 ? (
          <p className="text-steel">No imported sales in this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} width={48} />
              <Tooltip />
              <Line type="monotone" dataKey="value" stroke="currentColor" dot={false} name={mode === "net" ? "Net sales" : "Units"} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <p className="text-[12px] text-steel">
        Months before the first imported sale are omitted. A later month with no sales is shown as 0. The current month
        is incomplete and is left out of averages, trend direction, and year-on-year.
      </p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {skuFacts ? (
          <>
            <Stat label="Last 30 days" value={qty(skuFacts.last30)} />
            <Stat label="Last 90 days" value={qty(skuFacts.last90)} />
            <Stat label="Last 12 months" value={qty(skuFacts.last365)} />
          </>
        ) : (
          <>
            <Stat label="12-month units" value={qty(trend.last12Units)} />
            <Stat label="Previous 12-month units" value={qty(trend.previous12Units)} />
          </>
        )}
        <Stat label="3-month average" value={perMonth(trend.average3)} />
        <Stat label="6-month average" value={perMonth(trend.average6)} />
        <Stat label="12-month average" value={perMonth(trend.average12)} />
        <Stat label="Peak month" value={trend.peakMonth ? `${salesTrendFilenameMonth(trend.peakMonth)} · ${qty(trend.peakUnits)}` : "—"} />
        <Stat
          label="Lowest complete month"
          value={
            trend.lowestCompleteMonth
              ? `${salesTrendFilenameMonth(trend.lowestCompleteMonth)} · ${qty(trend.lowestCompleteUnits)}`
              : "—"
          }
        />
        <Stat label="Trend direction" value={trend.directionLabel} />
      </dl>
      <p className="text-[12px] text-steel">{trend.directionReason}</p>
      <p className="text-[12px]">
        {trend.yoy
          ? `Year on year, ${trend.yoy.label}: ${qty(trend.yoy.recentUnits)} vs ${qty(trend.yoy.priorUnits)}${
              trend.yoy.pct == null ? " (no percentage — the earlier period is zero)" : ` (${trend.yoy.pct}%)`
            }.`
          : "Year on year is hidden until the same three complete months exist in the previous year."}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">{label}</div>
      <div>{value}</div>
    </div>
  );
}

function perMonth(value: number | null): string {
  if (value == null) return "—";
  return `${value.toLocaleString("en-GB")} / month`;
}
