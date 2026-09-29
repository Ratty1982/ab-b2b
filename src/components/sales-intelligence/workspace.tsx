/**
 * Shared Sales Intelligence presentation components (UX only).
 */
import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatGbp } from "@/domain/sales-intelligence";
import {
  formatPeriodRangeLong,
  gapStatusHint,
  gapStatusLabel,
  movementDirection,
  type MovementDirection,
} from "@/domain/sales-intelligence-ux";

export function SalesIntelligenceHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/70 px-4 py-3 sm:px-6">
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-steel">
          Sales Intelligence
        </p>
        <h1 className="truncate font-display text-xl font-semibold uppercase tracking-tight sm:text-2xl">
          {title}
        </h1>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function SiModeSwitch({
  mode,
  onChange,
}: {
  mode: "customers" | "products";
  onChange: (mode: "customers" | "products") => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5" role="tablist" aria-label="Enquiry mode">
      {(
        [
          ["customers", "Customers"],
          ["products", "Products"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          onClick={() => onChange(value)}
          className={cn(
            "h-8 rounded px-3.5 text-[11px] font-bold uppercase tracking-wide",
            mode === value
              ? "bg-primary text-primary-foreground"
              : "text-steel hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function SiEntityContext({
  eyebrow,
  title,
  meta,
  onChange,
  changeLabel = "Change",
}: {
  eyebrow?: string;
  title: string;
  meta: string[];
  onChange?: () => void;
  changeLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 pb-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-steel">{eyebrow}</p>
        ) : null}
        <h2 className="font-display text-xl font-semibold uppercase tracking-wide sm:text-2xl">
          {title}
        </h2>
        {meta.length > 0 ? (
          <p className="mt-1 text-[12px] text-steel">
            {meta.filter(Boolean).join("  ·  ")}
          </p>
        ) : null}
      </div>
      {onChange ? (
        <button
          type="button"
          onClick={onChange}
          className="h-8 rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide text-steel hover:text-foreground"
        >
          {changeLabel}
        </button>
      ) : null}
    </div>
  );
}

export function SiPeriodSummary({
  selectedFrom,
  selectedTo,
  comparisonFrom = null,
  comparisonTo = null,
}: {
  selectedFrom: string;
  selectedTo: string;
  comparisonFrom?: string | null | undefined;
  comparisonTo?: string | null | undefined;
}) {
  const hasComparison = Boolean(comparisonFrom && comparisonTo);
  return (
    <div
      className={cn(
        "grid gap-2 text-[13px]",
        hasComparison ? "sm:grid-cols-[1fr_auto_1fr] sm:items-center" : "",
      )}
    >
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-steel">
          Selected period
        </div>
        <div className="mt-0.5 font-medium tabular-nums">
          {formatPeriodRangeLong(selectedFrom, selectedTo)}
        </div>
      </div>
      {hasComparison ? (
        <>
          <div className="hidden text-[11px] font-bold uppercase tracking-wide text-steel sm:block">
            vs
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-steel">
              Comparison period
            </div>
            <div className="mt-0.5 font-medium tabular-nums">
              {formatPeriodRangeLong(comparisonFrom, comparisonTo)}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function SiProvenance({ text }: { text: string }) {
  return (
    <p className="text-[11px] text-steel/80" title={text}>
      Historic invoiced sales source: Autopart 561L + SLRB.
    </p>
  );
}

function MovementIcon({ direction }: { direction: MovementDirection }) {
  if (direction === "up") return <ArrowUp className="size-3.5 shrink-0" aria-hidden />;
  if (direction === "down") return <ArrowDown className="size-3.5 shrink-0" aria-hidden />;
  return <Minus className="size-3.5 shrink-0" aria-hidden />;
}

export function SiMovementValue({
  change,
  percentChange = null,
  money = false,
  hint = null,
  emphasize = false,
}: {
  change: string | number;
  percentChange?: number | null | undefined;
  money?: boolean | undefined;
  hint?: string | null | undefined;
  emphasize?: boolean | undefined;
}) {
  const dir = movementDirection(change);
  const display = money ? formatGbp(String(change)) : String(change);
  const pct =
    percentChange == null
      ? null
      : `${percentChange > 0 ? "+" : ""}${percentChange.toFixed(2)}%`;
  const label =
    hint ??
    (dir === "flat"
      ? `No change ${display}`
      : dir === "up"
        ? `Up ${display}${pct ? ` (${pct})` : ""}`
        : `Down ${display}${pct ? ` (${pct})` : ""}`);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        emphasize ? "font-semibold" : "font-medium",
        dir === "up" && "text-good",
        dir === "down" && "text-bad",
        dir === "flat" && "text-steel",
      )}
      aria-label={label}
    >
      <MovementIcon direction={dir} />
      <span>
        {display}
        {pct && !hint ? (
          <span className="ml-1 text-[12px] font-normal opacity-90">({pct})</span>
        ) : null}
      </span>
      {hint ? <span className="ml-1 text-[12px] font-normal text-steel">{hint}</span> : null}
    </span>
  );
}

export function SiMetricCard({
  label,
  value,
  movement,
  creditHint,
  primary = false,
}: {
  label: string;
  value: string;
  movement?: {
    change: string | number;
    percentChange?: number | null;
    money?: boolean;
  } | null;
  creditHint?: string | null;
  primary?: boolean;
}) {
  return (
    <div
      className={cn(
        "border-b border-border/70 pb-2",
        primary && "sm:col-span-1",
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-steel">{label}</div>
      <div
        className={cn(
          "mt-1 font-display font-semibold tabular-nums",
          primary ? "text-2xl sm:text-3xl" : "text-xl",
        )}
      >
        {value}
      </div>
      {creditHint ? (
        <p className="mt-1 text-[12px] text-steel">{creditHint}</p>
      ) : movement ? (
        <div className="mt-1 text-[13px]">
          <SiMovementValue
            change={movement.change}
            percentChange={movement.percentChange ?? null}
            money={movement.money ?? false}
          />
        </div>
      ) : null}
    </div>
  );
}

export function SiGapStatusCard({
  status,
  count,
  active,
  mode,
  onClick,
}: {
  status: "STOPPED" | "DECREASED" | "INCREASED" | "NEW";
  count: number;
  active: boolean;
  mode: "customers" | "products";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-3 py-3 text-left transition-colors",
        active
          ? "border-primary bg-primary/10"
          : "border-border/80 hover:border-border hover:bg-surface/40",
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-steel">
        {gapStatusLabel(status)}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{count}</div>
      <p className="mt-1 text-[11px] leading-snug text-steel">{gapStatusHint(status, mode)}</p>
    </button>
  );
}

export function SiComparisonSummary({
  rows,
}: {
  rows: Array<{
    label: string;
    selected: string;
    comparison: string;
    change: string | number;
    percentChange: number | null;
    money?: boolean;
  }>;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border/70">
      <div className="border-b border-border/70 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-steel">
        Overall movement
      </div>
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-steel">
            <th className="px-3 py-2 pr-3 font-semibold">Metric</th>
            <th className="px-3 py-2 pr-3 text-right font-semibold">Selected</th>
            <th className="px-3 py-2 pr-3 text-right font-semibold">Comparison</th>
            <th className="px-3 py-2 text-right font-semibold">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border/40 last:border-0">
              <td className="px-3 py-2.5 pr-3 font-medium">{r.label}</td>
              <td className="px-3 py-2.5 pr-3 text-right tabular-nums">
                {r.money ? formatGbp(String(r.selected)) : r.selected}
              </td>
              <td className="px-3 py-2.5 pr-3 text-right tabular-nums text-steel">
                {r.money ? formatGbp(String(r.comparison)) : r.comparison}
              </td>
              <td className="px-3 py-2.5 text-right">
                <SiMovementValue
                  change={r.change}
                  percentChange={r.percentChange}
                  money={r.money ?? false}
                  emphasize
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SiField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block text-[11px] font-medium text-steel", className)}>
      <span className="uppercase tracking-wide">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function siControlClassName(active = false) {
  return cn(
    "block h-9 w-full rounded-md border bg-background px-2.5 text-[13px] text-foreground",
    active ? "border-primary" : "border-border",
  );
}

export function SiClearFiltersButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide text-steel hover:text-foreground"
    >
      Clear filters
    </button>
  );
}

export function SiViewEnquiryLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-[10px] font-bold uppercase tracking-wide text-steel hover:border-primary hover:text-primary"
    >
      View enquiry
      <ArrowRight className="size-3" aria-hidden />
    </a>
  );
}

export function SiStickyTableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 border-b border-border bg-background">
      {children}
    </thead>
  );
}

export function SiPager({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-[12px] text-steel">
        Page {page} of {totalPages} · {total} rows
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
          className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function SiExportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-9 rounded-md border border-border px-3.5 text-[11px] font-bold uppercase tracking-wide"
    >
      Export CSV
    </button>
  );
}

export const SI_PERIOD_OPTIONS = [
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "LAST_30", label: "Last 30 days" },
  { value: "LAST_90", label: "Last 3 months" },
  { value: "LAST_180", label: "Last 6 months" },
  { value: "YTD", label: "Year to date" },
  { value: "LAST_YEAR", label: "Last year" },
  { value: "CUSTOM", label: "Custom" },
] as const;
