import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { PublicHeaderAccountLink } from "@/lib/public-header-account";
import { cn } from "@/lib/utils";

/**
 * Authenticated public-header account control.
 * Navigation convenience only — server RBAC remains authoritative.
 */
export function PublicAccountMenu({
  links,
  signingOut,
  onSignOut,
  className,
}: {
  links: PublicHeaderAccountLink[];
  signingOut: boolean;
  onSignOut: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      data-public-header="account-menu"
    >
      <button
        type="button"
        data-public-header="my-account"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-semibold text-foreground transition-colors hover:border-steel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        My Account
        <ChevronDown
          className={cn("size-3.5 text-steel transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      <div
        id={menuId}
        role="menu"
        aria-label="My Account"
        hidden={!open}
        data-public-header="account-dropdown"
        className="absolute right-0 top-[calc(100%+6px)] z-50 min-w-[12rem] rounded-md border border-border bg-ink py-1 shadow-md"
      >
        {links.map((link) => (
          <Link
            key={link.key}
            to={link.to}
            role="menuitem"
            data-public-header={link.key}
            onClick={() => setOpen(false)}
            className="block whitespace-nowrap px-3 py-2 text-[13px] font-medium text-steel transition-colors hover:bg-secondary hover:text-foreground focus-visible:bg-secondary focus-visible:text-foreground focus-visible:outline-none"
          >
            {link.label}
          </Link>
        ))}
        {links.length > 0 ? <div className="my-1 border-t border-border/70" role="separator" /> : null}
        <button
          type="button"
          role="menuitem"
          data-public-header="logout"
          disabled={signingOut}
          onClick={() => {
            setOpen(false);
            onSignOut();
          }}
          className="block w-full whitespace-nowrap px-3 py-2 text-left text-[13px] font-medium text-steel transition-colors hover:bg-secondary hover:text-foreground focus-visible:bg-secondary focus-visible:text-foreground focus-visible:outline-none disabled:opacity-60"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
