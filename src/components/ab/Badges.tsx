import { cn } from "@/lib/utils";
import { stockLabel, type Stock } from "@/lib/data";
import { customerOrderStatusLabel, customerOrderStatusTone } from "@/domain/order-status";

const tones = {
  good: "text-good border-good/30 bg-good/10",
  warn: "text-warn border-warn/30 bg-warn/10",
  bad: "text-destructive border-destructive/40 bg-destructive/10",
  info: "text-cyan border-cyan/30 bg-cyan/10",
  neutral: "text-steel border-border bg-secondary/60",
  brand: "text-primary border-primary/40 bg-primary/10",
} as const;

export type Tone = keyof typeof tones;

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const stockTone: Record<Stock, Tone> = {
  in: "good",
  low: "warn",
  backorder: "warn",
  out: "bad",
};

export function StockBadge({ stock, qty }: { stock: Stock; qty?: number | undefined }) {
  return (
    <StatusBadge tone={stockTone[stock]}>
      <span aria-hidden className="text-[8px]">
        ●
      </span>
      {stockLabel[stock]}
      {qty !== undefined && stock !== "backorder" && stock !== "out" ? (
        <span className="num font-normal opacity-70">{qty}</span>
      ) : null}
    </StatusBadge>
  );
}

const orderTone: Record<string, Tone> = {
  // Live OrderStatus enum
  DRAFT: "neutral",
  SUBMITTED: "info",
  CONFIRMED: "brand",
  PICKING: "warn",
  DISPATCHED: "info",
  DELIVERED: "good",
  CANCELLED: "bad",
  ON_HOLD: "warn",
  // Legacy prototype labels (keep harmless if any remain)
  Delivered: "good",
  Dispatched: "info",
  Picking: "warn",
  "Awaiting Stock": "bad",
  Active: "good",
  Prospect: "info",
  Draft: "neutral",
  Sent: "info",
  Viewed: "info",
  Accepted: "good",
  Rejected: "bad",
  Expired: "neutral",
};

export function OrderStatusBadge({ status }: { status: string }) {
  return (
    <StatusBadge tone={customerOrderStatusTone(status)}>
      {customerOrderStatusLabel(status)}
    </StatusBadge>
  );
}
