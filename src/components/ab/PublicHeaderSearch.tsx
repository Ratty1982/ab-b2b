import { Link } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const SEARCH_PLACEHOLDER = "Search products or SKU";

/**
 * Public header search affordance — routes to the existing catalogue search.
 * Full field on large desktops; icon → expandable field on intermediate widths;
 * icon-only on compact/mobile.
 */
export function PublicHeaderSearch() {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setExpanded(false);
    }
    function onPointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        const toggle = (event.target as HTMLElement | null)?.closest?.(
          '[data-public-header="search-toggle"]',
        );
        if (!toggle) setExpanded(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const link = panelRef.current?.querySelector("a");
    link?.focus();
  }, [expanded]);

  return (
    <div className="relative flex items-center" data-public-header="search" ref={panelRef}>
      {/* Large desktop: full search field */}
      <Link
        to="/products"
        data-public-header="search-full"
        className="hidden h-9 w-[240px] items-center gap-2 rounded-md border border-border bg-surface px-3 text-[13px] text-steel transition-colors hover:border-steel 2xl:flex"
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{SEARCH_PLACEHOLDER}</span>
      </Link>

      {/* Intermediate desktop (nav visible, limited width): compact toggle */}
      <button
        type="button"
        data-public-header="search-toggle"
        aria-label={expanded ? "Close search" : "Open search"}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          "hidden size-9 place-items-center rounded-md border border-border text-steel transition-colors hover:border-steel hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 xl:grid 2xl:hidden",
          expanded && "border-steel text-foreground",
        )}
      >
        {expanded ? <X className="size-4" aria-hidden /> : <Search className="size-4" aria-hidden />}
      </button>

      {/* Mobile / tablet: icon links to catalogue search */}
      <Link
        to="/products"
        data-public-header="search-mobile"
        aria-label={SEARCH_PLACEHOLDER}
        className="grid size-9 place-items-center rounded-md border border-border text-steel transition-colors hover:border-steel hover:text-foreground xl:hidden"
      >
        <Search className="size-4" aria-hidden />
      </Link>

      {expanded ? (
        <div
          id={panelId}
          data-public-header="search-expanded"
          className="absolute right-0 top-[calc(100%+6px)] z-50 hidden xl:block 2xl:hidden"
        >
          <Link
            to="/products"
            className="flex h-9 w-[240px] items-center gap-2 rounded-md border border-border bg-ink px-3 text-[13px] text-steel shadow-md transition-colors hover:border-steel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <Search className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{SEARCH_PLACEHOLDER}</span>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
