import { useNavigate } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const SEARCH_PLACEHOLDER = "Search products or SKU";

/**
 * Public header search — submits to the catalogue with `?q=`.
 * Full field on large desktops; icon → expandable field below that.
 */
export function PublicHeaderSearch() {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const fullInputRef = useRef<HTMLInputElement>(null);
  const expandedInputRef = useRef<HTMLInputElement>(null);

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
    expandedInputRef.current?.focus();
  }, [expanded]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    setExpanded(false);
    void navigate({
      to: "/products",
      search: q ? { q } : {},
    });
  }

  const fieldClass =
    "h-9 w-full rounded-md border border-border bg-surface py-0 pl-9 pr-3 text-[13px] text-foreground placeholder:text-steel transition-colors hover:border-steel focus-visible:border-steel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

  return (
    <div className="relative flex items-center" data-public-header="search" ref={panelRef}>
      {/* Large desktop: full search field */}
      <form
        data-public-header="search-full"
        className="relative hidden w-[240px] 2xl:block"
        role="search"
        onSubmit={submitSearch}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-steel" aria-hidden />
        <input
          ref={fullInputRef}
          type="search"
          name="q"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={SEARCH_PLACEHOLDER}
          aria-label={SEARCH_PLACEHOLDER}
          className={fieldClass}
          autoComplete="off"
        />
      </form>

      {/* Compact / intermediate: icon toggles expandable field */}
      <button
        type="button"
        data-public-header="search-toggle"
        aria-label={expanded ? "Close search" : "Open search"}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          "grid size-9 place-items-center rounded-md border border-border text-steel transition-colors hover:border-steel hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 2xl:hidden",
          expanded && "border-steel text-foreground",
        )}
      >
        {expanded ? <X className="size-4" aria-hidden /> : <Search className="size-4" aria-hidden />}
      </button>

      {expanded ? (
        <div
          id={panelId}
          data-public-header="search-expanded"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[min(100vw-2rem,280px)] 2xl:hidden"
        >
          <form
            data-public-header="search-mobile"
            role="search"
            className="relative rounded-md border border-border bg-ink p-1 shadow-md"
            onSubmit={submitSearch}
          >
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-steel"
              aria-hidden
            />
            <input
              ref={expandedInputRef}
              type="search"
              name="q"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={SEARCH_PLACEHOLDER}
              aria-label={SEARCH_PLACEHOLDER}
              className={cn(fieldClass, "bg-ink")}
              autoComplete="off"
            />
          </form>
        </div>
      ) : null}
    </div>
  );
}
