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
  size = "default",
}: {
  to?: string;
  subtitle?: string | null;
  className?: string;
  markOnly?: boolean;
  /** `header` ≈ 56px visual height for the public site chrome. */
  size?: "default" | "header";
}) {
  const isHeader = size === "header";
  return (
    <Link
      to={to}
      className={cn("flex min-w-0 items-center gap-2.5", className)}
      aria-label="Automotive Brands area home"
      data-logo-size={size}
    >
      <img
        src={LOGO_SRC}
        alt=""
        width={isHeader ? 58 : 36}
        height={isHeader ? 56 : 36}
        className={cn(
          "shrink-0 rounded-sm bg-white",
          mediaContainClass,
          isHeader ? "h-14 w-auto max-w-[11rem]" : "size-9",
        )}
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
