import { Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "./Logo";
import { BasketNavBadge } from "./BasketNavBadge";
import { PublicAccountMenu } from "./PublicAccountMenu";
import { PublicHeaderSearch } from "./PublicHeaderSearch";
import { cn } from "@/lib/utils";
import { canViewBasketSession, RequestSessionProvider, useSession } from "@/lib/session";
import { publicHeaderAccountLinks } from "@/lib/public-header-account";
import { signOutCurrent, type ClientSession } from "@/server/auth/session";

/** Concise launch navigation — Resources stays routable but off the public chrome. */
const primaryNav = [
  { label: "Products", to: "/products" },
  { label: "Brands", to: "/brands" },
  { label: "Trade Solutions", to: "/trade-solutions" },
  { label: "Motorsport", to: "/motorsport" },
  { label: "Why Us", to: "/why-automotive-brands" },
] as const;

const footerShop = [
  { label: "Products", to: "/products" as const },
  { label: "Power Maxed", href: "/brands/power-maxed" },
  { label: "Steel Seal", href: "/brands/steel-seal" },
] as const;

const footerTrade = [
  { label: "Open a Trade Account", to: "/register" as const },
  { label: "Trade Login", to: "/login" as const },
  { label: "Trade Solutions", to: "/trade-solutions" as const },
] as const;

const footerSupport = [
  { label: "Contact / Support", to: "/contact" as const },
] as const;

const footerCompany = [
  { label: "Why Automotive Brands", to: "/why-automotive-brands" as const },
  { label: "Motorsport", to: "/motorsport" as const },
  { label: "About", to: "/about" as const },
] as const;

const navLinkClass =
  "relative whitespace-nowrap py-1 text-steel transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none";
const navActiveClass =
  "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary";

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
    <header
      className="sticky top-0 z-40 border-b border-border/70 bg-ink/95 backdrop-blur"
      data-public-header="shell"
    >
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10">
        <div className="flex h-[74px] items-center gap-4 xl:gap-6">
          <div className="flex min-w-0 flex-1 items-center gap-6 xl:gap-8">
            <Logo markOnly size="header" className="shrink-0" />
            <nav
              className="hidden items-center gap-5 text-[13px] font-medium xl:flex xl:gap-6"
              data-public-header="primary-nav"
              aria-label="Primary"
            >
              {primaryNav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={navLinkClass}
                  activeProps={{ className: cn(navLinkClass, navActiveClass) }}
                  activeOptions={{ exact: false }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-2.5" data-public-header="actions">
            <PublicHeaderSearch />
            {showBasket ? (
              <BasketNavBadge data-public-header="basket" className="inline-flex h-9" />
            ) : null}
            {signedIn ? (
              <PublicAccountMenu
                links={accountLinks}
                signingOut={signingOut}
                onSignOut={() => void onSignOut()}
                className="hidden xl:block"
              />
            ) : (
              <>
                <Link
                  to="/login"
                  data-public-header="trade-login"
                  className="hidden h-9 items-center rounded-md border border-border px-3 text-[13px] font-semibold whitespace-nowrap transition-colors hover:border-steel xl:inline-flex"
                >
                  Trade Login
                </Link>
                <Link
                  to="/register"
                  data-public-header="open-account"
                  className="hidden h-9 items-center rounded-md bg-primary px-4 text-[13px] font-bold whitespace-nowrap text-primary-foreground transition hover:brightness-110 xl:inline-flex"
                >
                  Open Trade Account
                </Link>
              </>
            )}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              data-public-header="mobile-menu-toggle"
              className="grid size-9 shrink-0 place-items-center rounded-md border border-border xl:hidden"
            >
              {open ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
      </div>
      {open ? (
        <div className="border-t border-border/70 bg-ink xl:hidden" data-public-header="mobile-menu">
          <nav className="mx-auto grid max-w-[1400px] gap-1 px-4 py-3 sm:px-6" aria-label="Mobile">
            {primaryNav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm whitespace-nowrap text-steel transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "text-foreground bg-secondary" }}
                activeOptions={{ exact: false }}
              >
                {item.label}
              </Link>
            ))}
            {signedIn ? (
              <>
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
                  className="rounded-md px-3 py-2 text-sm font-semibold"
                >
                  Trade Login
                </Link>
                <Link
                  to="/register"
                  onClick={() => setOpen(false)}
                  data-public-header="mobile-open-account"
                  className="rounded-md px-3 py-2 text-sm font-semibold text-primary"
                >
                  Open Trade Account
                </Link>
              </>
            )}
          </nav>
        </div>
      ) : null}
    </header>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ label: string; to?: string; href?: string }>;
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-steel">{title}</div>
      <ul className="mt-3 space-y-2">
        {links.map((item) => (
          <li key={item.label}>
            {item.to ? (
              <Link to={item.to} className="text-[13px] text-foreground/90 transition-colors hover:text-primary">
                {item.label}
              </Link>
            ) : (
              <a href={item.href} className="text-[13px] text-foreground/90 transition-colors hover:text-primary">
                {item.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-border/60 bg-ink">
      <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6 lg:px-10">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))]">
          <div>
            <Logo subtitle={null} />
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-steel">
              Power Maxed and Steel Seal — professional automotive products for UK trade customers.
            </p>
          </div>
          <FooterColumn title="Shop" links={footerShop} />
          <FooterColumn title="Trade" links={footerTrade} />
          <FooterColumn title="Support" links={footerSupport} />
          <FooterColumn title="Company" links={footerCompany} />
        </div>
        <div className="mt-10 border-t border-border/50 pt-6 text-[12px] text-steel">
          © 2026 Automotive Brands · automotivebrands.co.uk
        </div>
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

/** In-content breadcrumb band — page context, not a second navigation strip. */
export function PublicPageBreadcrumbs({
  items,
}: {
  items: { label: string; to?: string | undefined }[];
}) {
  return (
    <div
      className="mx-auto max-w-[1400px] px-4 pt-5 pb-3 sm:px-6 lg:px-10"
      data-public-breadcrumbs="page"
    >
      <Breadcrumbs items={items} />
    </div>
  );
}
