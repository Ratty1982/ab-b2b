import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, Search, X } from "lucide-react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { signOutCurrent } from "@/server/auth/session";

export interface NavItem {
  label: string;
  to: string;
  exact?: boolean;
}

export function AppShell({
  nav,
  area,
  user,
  children,
}: {
  nav: NavItem[];
  area: string;
  user: { name: string; role: string };
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const navLinks = (
    <>
      {nav.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: item.exact ?? false }}
          onClick={() => setOpen(false)}
          className="rounded-md px-3 py-2 text-[13px] font-medium text-steel transition-colors hover:bg-secondary hover:text-foreground"
          activeProps={{
            className: "bg-secondary text-foreground border-l-2 border-primary rounded-l-none",
          }}
        >
          {item.label}
        </Link>
      ))}
    </>
  );

  return (
    <div className="flex min-h-screen flex-col bg-ink text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-ink/90 backdrop-blur">
        <div className="grid h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close navigation" : "Open navigation"}
              aria-expanded={open}
              className="grid size-9 shrink-0 place-items-center rounded-md border border-border lg:hidden"
            >
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
            <Logo subtitle={area} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="hidden h-9 w-64 items-center gap-2 rounded-md border border-border bg-surface px-3 text-left text-[13px] text-steel transition-colors hover:border-steel md:flex"
            >
              <Search className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">Search…</span>
              <kbd className="ml-auto rounded-sm border border-border px-1 text-[10px]">⌘K</kbd>
            </button>
            <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
              <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-primary text-[11px] font-bold text-primary-foreground">
                {user.name.slice(0, 1)}
              </span>
              <span className="hidden min-w-0 leading-tight sm:block">
                <span className="block truncate text-[12px] font-semibold">{user.name}</span>
                <span className="block truncate text-[10px] text-steel">{user.role}</span>
              </span>
              <button
                type="button"
                className="ml-1 text-[11px] font-semibold text-steel hover:text-foreground"
                onClick={() => {
                  void (async () => {
                    await signOutCurrent();
                    window.location.href = "/login";
                  })();
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-r border-border/70 bg-sidebar lg:block">
          <nav className="sticky top-14 flex flex-col gap-0.5 p-3">{navLinks}</nav>
        </aside>
        {open ? (
          <div className="fixed inset-0 top-14 z-30 bg-ink/95 lg:hidden">
            <nav className="flex flex-col gap-0.5 p-3">{navLinks}</nav>
          </div>
        ) : null}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

export function PanelHeader({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/70 px-4 py-4 sm:px-6">
      <div className="min-w-0">
        <h1 className="truncate font-display text-xl font-semibold uppercase tracking-tight sm:text-2xl">
          {title}
        </h1>
        {sub ? <p className="mt-0.5 truncate text-[12px] text-steel">{sub}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "brand" | "good" | "warn";
}) {
  return (
    <div className="border border-border bg-surface/60 p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">
        {label}
      </div>
      <div
        className={cn(
          "num mt-1.5 font-display text-2xl font-semibold",
          tone === "brand" && "text-primary",
          tone === "good" && "text-good",
          tone === "warn" && "text-warn",
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-[11px] text-steel">{hint}</div> : null}
    </div>
  );
}
