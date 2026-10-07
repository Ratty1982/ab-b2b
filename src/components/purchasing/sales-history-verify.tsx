import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { btnClass, controlClass, primaryBtnClass, ukDate } from "@/components/purchasing/workspace";
import { formatOperationalDateTime } from "@/lib/datetime";
import { listSalesHistoryBrandsFn, previewSalesHistoryCoverageFn, verifySalesHistoryCoverageFn } from "@/server/phase2/fns";

type Preview = Extract<Awaited<ReturnType<typeof previewSalesHistoryCoverageFn>>, { ok: true }>["data"];
type Brand = { slug: string; name: string };

export function SalesHistoryVerifyDialog({
  open,
  onOpenChange,
  initialBrandSlug,
  onVerified,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialBrandSlug?: string | null;
  onVerified: () => void;
}) {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [scope, setScope] = useState<"BRAND" | "ALL">("BRAND");
  const [brandSlug, setBrandSlug] = useState(initialBrandSlug ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const verifyLock = useRef(false);

  useEffect(() => {
    if (!open) return;
    setScope("BRAND");
    setBrandSlug(initialBrandSlug ?? "");
    setNotes("");
    setConfirmed(false);
    setError(null);
    setPreview(null);
    void listSalesHistoryBrandsFn().then((result) => {
      if (result.ok) setBrands(result.data);
    });
  }, [open, initialBrandSlug]);

  useEffect(() => {
    if (!open) return;
    if (scope === "BRAND" && !brandSlug) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    void previewSalesHistoryCoverageFn({
      data: { scope, brandSlug: scope === "BRAND" ? brandSlug : null },
    }).then((result) => {
      if (cancelled) return;
      setBusy(false);
      if (!result.ok) {
        setPreview(null);
        setError(result.error);
        return;
      }
      setPreview(result.data);
      setFrom(result.data.earliestSale ?? "");
      setTo(result.data.latestSale ?? "");
      setConfirmed(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, scope, brandSlug]);

  async function verify() {
    if (verifyLock.current) return;
    verifyLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await verifySalesHistoryCoverageFn({
        data: {
          scope,
          brandSlug: scope === "BRAND" ? brandSlug : null,
          coverageFrom: from,
          coverageTo: to,
          confirmed,
          notes: notes.trim() || null,
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.data);
      setConfirmed(false);
      setNotes("");
      onVerified();
    } finally {
      verifyLock.current = false;
      setBusy(false);
    }
  }

  const quiet = preview?.monthsWithNoRecordedSales ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-wide">Verify sales history</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 text-[13px]">
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">Scope</span>
            <select className={controlClass} value={scope} onChange={(event) => setScope(event.target.value as "BRAND" | "ALL")}>
              <option value="BRAND">Brand</option>
              <option value="ALL">All products</option>
            </select>
          </label>
          {scope === "BRAND" ? (
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">Brand</span>
              <select className={controlClass} value={brandSlug} onChange={(event) => setBrandSlug(event.target.value)}>
                <option value="">Select a brand</option>
                {brands.map((brand) => (
                  <option key={brand.slug} value={brand.slug}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {preview ? (
            <div className="border border-border/70 bg-surface/40 px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink">Imported history detected</div>
              <dl className="mt-2 grid grid-cols-2 gap-2">
                <Fact label="Earliest sale" value={ukDate(preview.earliestSale)} />
                <Fact label="Latest sale" value={ukDate(preview.latestSale)} />
                <Fact label="Sales records" value={preview.lineCount.toLocaleString("en-GB")} />
                <Fact label="Products with sales" value={preview.skuCount.toLocaleString("en-GB")} />
                <Fact label="Months represented" value={String(preview.monthsRepresented)} />
                <Fact
                  label="Months with no recorded sales"
                  value={quiet.length === 0 ? "None detected" : quiet.slice(0, 8).join(", ")}
                />
              </dl>
              <p className="mt-2 text-[12px] text-steel">{preview.quietMonthNote}</p>
              {preview.effectiveCoverage.length > 0 ? (
                <p className="mt-2 text-[12px]">
                  Confirmed so far:{" "}
                  {preview.effectiveCoverage.map((range) => `${ukDate(range.from)} → ${ukDate(range.to)}`).join("; ")}
                </p>
              ) : (
                <p className="mt-2 text-[12px]">No coverage has been confirmed for this scope.</p>
              )}
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">Verified coverage from</span>
              <input className={controlClass} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">To</span>
              <input className={controlClass} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
          </div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>I confirm the available sales history for this scope and period has been imported and reviewed for completeness.</span>
          </label>
          <label className="grid gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">Notes</span>
            <textarea
              className={`${controlClass} h-20 py-2`}
              value={notes}
              maxLength={2000}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
          {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
          {preview && !preview.canManage ? (
            <p className="text-[12px] text-steel">You can review coverage. Confirming it requires purchasing manage.</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" className={btnClass} onClick={() => onOpenChange(false)}>
              Close
            </button>
            <button
              type="button"
              className={primaryBtnClass}
              disabled={busy || !confirmed || !from || !to || !preview?.canManage}
              onClick={() => void verify()}
            >
              Verify history
            </button>
          </div>
          {preview && preview.history.length > 0 ? (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">Previous confirmations</div>
              <ul className="mt-2 grid gap-1 text-[12px]">
                {preview.history.map((row) => (
                  <li key={row.id}>
                    {ukDate(row.coverageFrom)} → {ukDate(row.coverageTo)} · {row.verifiedBy} ·{" "}
                    {formatOperationalDateTime(row.verifiedAt) ?? row.verifiedAt}
                    {row.notes ? ` · ${row.notes}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">{label}</div>
      <div>{value}</div>
    </div>
  );
}
