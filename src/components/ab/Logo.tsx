import { Link } from "@tanstack/react-router";
import { mediaContainClass } from "@/lib/media-presentation";
import { cn } from "@/lib/utils";

/** First-party brand mark — served from /public/brand (no Lovable CDN). */
const LOGO_SRC = "/brand/ab-logo.jpg";

export function Logo({
  to = "/",
  subtitle = "Trade Supply",
  className,
  markOnly = false,
}: {
  to?: string;
  subtitle?: string | null;
  className?: string;
  markOnly?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn("flex min-w-0 items-center gap-2.5", className)}
      aria-label="Automotive Brands area home"
    >
      <img
        src={LOGO_SRC}
        alt=""
        width={36}
        height={36}
        className={cn("size-9 shrink-0 rounded-sm bg-white", mediaContainClass)}
      />
      {markOnly ? null : (
        <span className="min-w-0 leading-none">
          <span className="block font-display text-[15px] font-semibold tracking-[0.06em]">
            AUTOMOTIVE BRANDS
          </span>
          {subtitle ? (
            <span className="mt-1 block text-[9px] uppercase tracking-[0.32em] text-steel">
              {subtitle}
            </span>
          ) : null}
        </span>
      )}
    </Link>
  );
}
