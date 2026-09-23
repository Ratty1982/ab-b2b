import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, Search, X } from "lucide-react";
import { Logo } from "./Logo";
import { BasketNavBadge } from "./BasketNavBadge";
import { cn } from "@/lib/utils";
import { canViewBasketSession, RequestSessionProvider, useSession } from "@/lib/session";
import { publicHeaderAccountLinks } from "@/lib/public-header-account";
import { signOutCurrent, type ClientSession } from "@/server/auth/session";

const nav = [
  { label: "Products", to: "/products" },
  { label: "Brands", to: "/brands" },
  { label: "Trade Solutions", to: "/trade-solutions" },
  { label: "Why Automotive Brands", to: "/why-automotive-brands" },
  { label: "Resources", to: "/resources" },
  { label: "About Us", to: "/about" },
  { label: "Contact", to: "/contact" },
] as const;

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const session = useSession();
  const router = useRouter();
  // Authentication and orderability are separate. Any signed-in user must not
  // see Trade Login — even if they cannot order yet.
  const signedIn = session.signedIn;
  const showBasket = canViewBasketSession(session);
  const accountLinks = publicHeaderAccountLinks(session);

  async function onSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setOpen(false);
    try {
      await signOutCurrent();
      await router.invalidate();
      window.location.assign("/");
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-ink/90 backdrop-blur" data-public-header="shell">
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <div className="grid h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <div className="flex min-w-0 items-center gap-8">
            <Logo />
            <nav className="hidden items-center gap-6 text-[13px] font-medium text-steel xl:flex">
              {nav.slice(0, 5).map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="transition-colors hover:text-foreground"
                  activeProps={{ className: "text-foreground" }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2.5" data-public-header="actions">
            <Link
              to="/products"
              className="hidden h-9 w-56 items-center gap-2 rounded-md border border-border bg-surface px-3 text-[13px] text-steel transition-colors hover:border-steel lg:flex"
            >
              <Search className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">Search product, SKU or brand…</span>
            </Link>
            {showBasket ? (
              <BasketNavBadge
                data-public-header="basket"
                className="inline-flex h-9"
              />
            ) : null}
            {signedIn ? (
              accountLinks.map((link) => (
                <Link
                  key={link.key}
                  to={link.to}
                  data-public-header={link.key}
                  className="hidden h-9 items-center rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel sm:inline-flex"
                >
                  {link.label}
                </Link>
              ))
            ) : (
              <Link
                to="/login"
                data-public-header="trade-login"
                className="hidden h-9 items-center rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel sm:inline-flex"
              >
                Trade Login
              </Link>
            )}
            {!signedIn ? (
              <Link
                to="/register"
                data-public-header="open-account"
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
              >
                Open a Trade Account
              </Link>
            ) : (
              <button
                type="button"
                data-public-header="logout"
                disabled={signingOut}
                onClick={() => void onSignOut()}
                className="hidden h-9 items-center rounded-md px-3 text-[13px] font-semibold text-steel transition-colors hover:text-foreground sm:inline-flex"
              >
                Log out
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              className="grid size-9 shrink-0 place-items-center rounded-md border border-border xl:hidden"
            >
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
      </div>
      {open ? (
        <div className="border-t border-border/70 bg-ink xl:hidden" data-public-header="mobile-menu">
          <nav className="mx-auto grid max-w-[1400px] gap-1 px-4 py-3 sm:px-6">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-steel transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "text-foreground bg-secondary" }}
              >
                {item.label}
              </Link>
            ))}
            {signedIn ? (
              <>
                {showBasket ? (
                  <div className="px-3 py-2" data-public-header="mobile-basket">
                    <BasketNavBadge className="w-full justify-center" />
                  </div>
                ) : null}
                {accountLinks.map((link) => (
                  <Link
                    key={`mobile-${link.key}`}
                    to={link.to}
                    onClick={() => setOpen(false)}
                    data-public-header={`mobile-${link.key}`}
                    className="rounded-md px-3 py-2 text-sm font-semibold"
                  >
                    {link.label}
                  </Link>
                ))}
                <button
                  type="button"
                  data-public-header="mobile-logout"
                  disabled={signingOut}
                  onClick={() => void onSignOut()}
                  className="rounded-md px-3 py-2 text-left text-sm font-semibold text-steel"
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/login"
                  onClick={() => setOpen(false)}
                  data-public-header="mobile-trade-login"
                  className="rounded-md px-3 py-2 text-sm font-semibold sm:hidden"
                >
                  Trade Login
                </Link>
                <Link
                  to="/register"
                  onClick={() => setOpen(false)}
                  data-public-header="mobile-open-account"
                  className="rounded-md px-3 py-2 text-sm font-semibold text-primary sm:hidden"
                >
                  Open a Trade Account
                </Link>
              </>
            )}
          </nav>
        </div>
      ) : null}
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-border/60 bg-ink">
      <div className="mx-auto flex max-w-[1400px] flex-col justify-between gap-6 px-4 py-12 sm:px-6 md:flex-row md:items-center lg:px-10">
        <Logo subtitle={null} />
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-steel">
          {nav.map((item) => (
            <Link key={item.to} to={item.to} className="transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </div>
        <div className="text-[12px] text-steel">© 2026 Automotive Brands · automotivebrands.co.uk</div>
      </div>
    </footer>
  );
}

export function PublicLayout({
  children,
  kinetic = false,
  requestSession,
}: {
  children: React.ReactNode;
  kinetic?: boolean;
  /** Loader-resolved session from the same request cookies as pricing. */
  requestSession?: ClientSession;
}) {
  const body = (
    <div className="flex min-h-screen flex-col bg-ink text-foreground">
      <PublicHeader />
      <main className={cn("flex-1", kinetic && "kinetic")}>{children}</main>
      <PublicFooter />
    </div>
  );
  if (!requestSession) return body;
  return <RequestSessionProvider session={requestSession}>{body}</RequestSessionProvider>;
}

export function PageHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="border-b border-border/60">
      <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6 lg:px-10">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
          {eyebrow}
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
          {title}
        </h1>
        {lead ? <p className="mt-3 max-w-2xl text-sm leading-relaxed text-steel">{lead}</p> : null}
      </div>
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; to?: string | undefined }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[12px] text-steel">
      {items.map((item, i) => (
        <span key={item.label} className="flex items-center gap-2">
          {i > 0 ? <span aria-hidden>/</span> : null}
          {item.to ? (
            <Link to={item.to} className="transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
