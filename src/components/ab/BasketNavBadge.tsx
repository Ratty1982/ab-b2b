import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ShoppingCart } from "lucide-react";
import { getBasketSummaryFn } from "@/server/phase2/fns";
import { ROUTES } from "@/lib/app-nav";
import { useSession, canViewBasketSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/** Compact basket link with line count for the portal chrome. */
export function BasketNavBadge({ className }: { className?: string }) {
  const session = useSession();
  const [lineCount, setLineCount] = useState(0);
  const show = canViewBasketSession(session);

  useEffect(() => {
    if (!show) {
      setLineCount(0);
      return;
    }
    let cancelled = false;
    void getBasketSummaryFn().then((result) => {
      if (cancelled || !result.ok) return;
      setLineCount(result.data.lineCount);
    });
    const onFocus = () => {
      void getBasketSummaryFn().then((result) => {
        if (!result.ok) return;
        setLineCount(result.data.lineCount);
      });
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [show, session.signedIn ? session.user.id : null]);

  if (!show) return null;

  return (
    <Link
      to={ROUTES.portalBasket}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[12px] font-semibold hover:border-steel",
        className,
      )}
      aria-label={lineCount ? `Basket, ${lineCount} lines` : "Basket, empty"}
    >
      <ShoppingCart className="size-4" aria-hidden />
      <span>Basket</span>
      <span className="num rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-bold text-primary">
        {lineCount}
      </span>
    </Link>
  );
}
