import { Link } from "@tanstack/react-router";
import { mediaContainClass } from "@/lib/media-presentation";
import { useSiteHeaderLogoSrc } from "@/lib/site-branding";
import { cn } from "@/lib/utils";
import { DEFAULT_SITE_HEADER_LOGO_SRC } from "@/domain/site-branding";

export function Logo({
  to = "/",
  subtitle = "Trade Supply",
  className,
  markOnly = false,
  size = "default",
  /** Optional override — defaults to configured site branding / static fallback. */
  src,
}: {
  to?: string;
  subtitle?: string | null;
  className?: string;
  markOnly?: boolean;
  /** `header` ≈ 56px visual height for the public site chrome. */
  size?: "default" | "header";
  src?: string;
}) {
  const configuredSrc = useSiteHeaderLogoSrc();
  const logoSrc = src || configuredSrc || DEFAULT_SITE_HEADER_LOGO_SRC;
  const isHeader = size === "header";
  return (
    <Link
      to={to}
      className={cn("flex min-w-0 items-center gap-2.5", className)}
      aria-label="Automotive Brands area home"
      data-logo-size={size}
    >
      <img
        src={logoSrc}
        alt=""
        width={isHeader ? 58 : 36}
        height={isHeader ? 56 : 36}
        className={cn(
          "shrink-0 rounded-sm",
          mediaContainClass,
          isHeader ? "h-14 w-auto max-w-[11rem]" : "size-9",
        )}
      />
      {markOnly ? null : (
        <span className="min-w-0 leading-none">
          <span className="block truncate font-display text-[15px] font-semibold tracking-[0.06em]">
            AUTOMOTIVE BRANDS
          </span>
          {subtitle ? (
            <span className="mt-1 block truncate text-[9px] uppercase tracking-[0.32em] text-steel">
              {subtitle}
            </span>
          ) : null}
        </span>
      )}
    </Link>
  );
}
