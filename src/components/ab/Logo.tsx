import { Link } from "@tanstack/react-router";
import logo from "@/assets/ab-logo.jpg.asset.json";
import { cn } from "@/lib/utils";

export function Logo({
  to = "/",
  subtitle = "Trade Supply",
  className,
}: {
  to?: string;
  subtitle?: string | null;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn("flex min-w-0 items-center gap-2.5", className)}
      aria-label="Automotive Brands home"
    >
      <img
        src={logo.url}
        alt=""
        width={36}
        height={36}
        className="size-9 shrink-0 rounded-sm object-cover"
      />
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
    </Link>
  );
}
