import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ShoppingCart } from "lucide-react";
import { getBasketSummaryFn } from "@/server/phase2/fns";
import { BASKET_UPDATED_EVENT } from "@/lib/basket-events";
import { ROUTES } from "@/lib/app-nav";
import { useSession, canViewBasketSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/** Compact basket link with line count for the portal chrome. */
export function BasketNavBadge({
  className,
  "data-public-header": dataPublicHeader,
}: {
  className?: string;
  "data-public-header"?: string;
}) {
  const session = useSession();
  const [lineCount, setLineCount] = useState(0);
  const show = canViewBasketSession(session);

  useEffect(() => {
    if (!show) {
      setLineCount(0);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void getBasketSummaryFn().then((result) => {
        if (cancelled || !result.ok) return;
        setLineCount(result.data.lineCount);
      });
    };
    refresh();
    const onFocus = () => refresh();
    const onBasketUpdated = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener(BASKET_UPDATED_EVENT, onBasketUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(BASKET_UPDATED_EVENT, onBasketUpdated);
    };
  }, [show, session.signedIn ? session.user.id : null]);

  if (!show) return null;

  return (
    <Link
      to={ROUTES.portalBasket}
      {...(dataPublicHeader != null ? { "data-public-header": dataPublicHeader } : {})}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-[12px] font-semibold hover:border-steel",
        className,
      )}
      aria-label={lineCount ? `Basket, ${lineCount} lines` : "Basket, empty"}
    >
      <ShoppingCart className="size-4" aria-hidden />
      <span>Basket</span>
      <span
        data-basket-badge-count={lineCount}
        className="num rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-bold text-primary"
      >
        {lineCount}
      </span>
    </Link>
  );
}
