import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { gbp } from "@/lib/data";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/** RRP is public catalogue information. Never used to infer trade. */
export function CatalogueRrp({
  rrp,
  className,
}: {
  rrp: number | null;
  className?: string;
}) {
  if (rrp == null) {
    return <span className={cn("text-[12px] text-steel", className)}>—</span>;
  }
  return <span className={cn("num text-sm font-semibold text-steel", className)}>{gbp(rrp)}</span>;
}

/**
 * Account price column. Trade is only shown when the payload already includes it
 * (anonymous viewers receive trade: null from the server).
 */
export function CatalogueYourPrice({
  trade,
  ctaMode = "text",
  className,
}: {
  trade: number | null;
  ctaMode?: "link" | "text";
  className?: string;
}) {
  const { signedIn } = useSession();
  const ctaClass = "inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary";

  if (!signedIn) {
    return (
      <div className={cn("min-w-0", className)}>
        {ctaMode === "link" ? (
          <Link to="/login" className={cn(ctaClass, "hover:underline")}>
            <Lock className="size-3" aria-hidden />
            Sign in to view your price
          </Link>
        ) : (
          <span className={ctaClass}>
            <Lock className="size-3" aria-hidden />
            Sign in to view your price
          </span>
        )}
      </div>
    );
  }

  if (trade == null) {
    return <div className={cn("text-[11px] text-steel", className)}>Account pricing is not available on this login</div>;
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-steel">Your price</div>
      <div className="num font-display text-lg font-semibold leading-none">{gbp(trade)}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-steel">ex VAT</div>
    </div>
  );
}

/**
 * Trade pricing is account-specific, so it is never rendered to a visitor
 * who is not signed in. Public visitors see RRP plus a route into the
 * account. Signed-in customers simply see "your price" — never the internal
 * price group name.
 */
export function TradePrice({
  trade,
  rrp,
  size = "md",
  className,
  /** Use plain text when rendered inside another link (avoids nested <a> hydration failures). */
  ctaMode = "link",
}: {
  trade: number | null;
  rrp: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  ctaMode?: "link" | "text";
}) {
  const { signedIn } = useSession();

  if (!signedIn || trade == null) {
    const ctaClass =
      "mt-1 inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary";
    return (
      <div className={cn("min-w-0", className)}>
        <div
          className={cn(
            "num font-display font-semibold text-steel",
            size === "sm" && "text-base",
            size === "md" && "text-lg",
            size === "lg" && "text-2xl",
          )}
        >
          {rrp != null ? <>RRP {gbp(rrp)}</> : "Price on request"}
        </div>
        {!signedIn ? (
          ctaMode === "link" ? (
            <Link to="/login" className={cn(ctaClass, "hover:underline")}>
              <Lock className="size-3" aria-hidden />
              Sign in to view your price
            </Link>
          ) : (
            <span className={ctaClass}>
              <Lock className="size-3" aria-hidden />
              Sign in to view your price
            </span>
          )
        ) : (
          <div className="text-[11px] text-steel">Account pricing is not available on this login</div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("min-w-0", className)}>
      <div
        className={cn(
          "num font-display font-semibold leading-none",
          size === "sm" && "text-xl",
          size === "md" && "text-2xl",
          size === "lg" && "text-4xl",
        )}
      >
        {gbp(trade)}
      </div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-steel">Your price · ex VAT</div>
      {rrp != null ? <div className="num mt-1 text-[11px] text-steel">RRP {gbp(rrp)}</div> : null}
    </div>
  );
}

/** Inline, table-friendly variant. */
export function TradePriceCell({ trade, rrp }: { trade: number; rrp: number }) {
  const { signedIn } = useSession();
  if (!signedIn) {
    return (
      <Link to="/login" className="num text-[12px] font-semibold text-primary hover:underline">
        Sign in for price
      </Link>
    );
  }
  return (
    <span className="num font-semibold" title={`RRP ${gbp(rrp)}`}>
      {gbp(trade)}
    </span>
  );
}

export function TradeOnly({ children, note }: { children: React.ReactNode; note: string }) {
  const { signedIn } = useSession();
  if (signedIn) return <>{children}</>;
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface/40 p-4">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <Lock className="size-4 text-primary" aria-hidden />
        {note}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to="/login"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[12px] font-bold text-primary-foreground transition hover:brightness-110"
        >
          Trade login
        </Link>
        <Link
          to="/register"
          className="inline-flex h-9 items-center rounded-md border border-border px-4 text-[12px] font-bold transition-colors hover:border-steel"
        >
          Open a trade account
        </Link>
      </div>
    </div>
  );
}
