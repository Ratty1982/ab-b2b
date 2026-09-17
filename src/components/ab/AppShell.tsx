import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Activity,
  Award,
  BarChart3,
  Briefcase,
  Building2,
  ClipboardList,
  Download,
  FilePen,
  FileText,
  Files,
  Folders,
  Globe,
  Heart,
  Image as ImageIcon,
  Kanban,
  LayoutDashboard,
  LifeBuoy,
  ListTodo,
  Menu,
  Package,
  PanelLeft,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  ShoppingBag,
  Store,
  Tags,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { signOutCurrent } from "@/server/auth/session";
import { isItemActive, type NavIconName, type VisibleNavItem, type VisibleNavSection } from "@/lib/app-nav";

const ICONS: Record<NavIconName, typeof LayoutDashboard> = {
  "layout-dashboard": LayoutDashboard,
  "building-2": Building2,
  "clipboard-list": ClipboardList,
  "file-text": FileText,
  "shopping-bag": ShoppingBag,
  receipt: Receipt,
  package: Package,
  award: Award,
  folders: Folders,
  tags: Tags,
  kanban: Kanban,
  "user-plus": UserPlus,
  briefcase: Briefcase,
  activity: Activity,
  "list-todo": ListTodo,
  globe: Globe,
  "file-pen": FilePen,
  image: ImageIcon,
  users: Users,
  shield: Shield,
  files: Files,
  "bar-chart-3": BarChart3,
  "scroll-text": ScrollText,
  settings: Settings,
  store: Store,
  heart: Heart,
  "life-buoy": LifeBuoy,
  download: Download,
};

const COLLAPSE_KEY = "ab.sidebar.collapsed";

function NavLink({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: VisibleNavItem;
  pathname: string;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const Icon = ICONS[item.icon] ?? LayoutDashboard;
  const active = isItemActive(item, pathname);
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-steel transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
        collapsed && "justify-center px-0",
        active &&
          "bg-sidebar-accent text-sidebar-foreground border-l-2 border-primary rounded-l-none font-semibold",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function NavTree({
  sections,
  pathname,
  collapsed,
  onNavigate,
}: {
  sections: VisibleNavSection[];
  pathname: string;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  return (
    <nav className="flex flex-col gap-5" aria-label="Application">
      {sections.map((section) => (
        <div key={section.id}>
          {collapsed ? (
            <div className="mx-auto mb-1 h-px w-6 bg-sidebar-border" aria-hidden />
          ) : (
            <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-steel">
              {section.label}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <NavLink
                key={item.id}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({
  sections,
  homeTo,
  areaLabel,
  user,
  children,
}: {
  sections: VisibleNavSection[];
  homeTo: string;
  areaLabel: string;
  user: { name: string; role: string };
  children: React.ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function signOut() {
    await signOutCurrent();
    window.location.assign("/login");
  }

  const sidebarBody = (iconMode: boolean) => (
    <>
      <div className={cn("flex items-center gap-2 border-b border-sidebar-border px-3 py-3", iconMode && "justify-center px-2")}>
        <Logo
          to={homeTo}
          subtitle={iconMode ? null : areaLabel}
          markOnly={iconMode}
          className={iconMode ? "gap-0" : ""}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <NavTree
          sections={sections}
          pathname={pathname}
          collapsed={iconMode}
          onNavigate={() => setMobileOpen(false)}
        />
      </div>
      <div className="border-t border-sidebar-border p-3">
        <div className={cn("flex items-center gap-2", iconMode && "justify-center")}>
          <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-primary text-[12px] font-bold text-primary-foreground">
            {user.name.slice(0, 1)}
          </span>
          {iconMode ? (
            <span className="sr-only">
              {user.name}, {user.role}
            </span>
          ) : (
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[12px] font-semibold">{user.name}</span>
              <span className="block truncate text-[10px] text-steel">{user.role}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          className={cn(
            "mt-2 w-full rounded-md border border-sidebar-border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-steel hover:border-steel hover:text-foreground",
            iconMode && "px-0",
          )}
          onClick={() => void signOut()}
        >
          {iconMode ? "Out" : "Sign out"}
        </button>
        <button
          type="button"
          className="mt-2 hidden w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-steel hover:bg-sidebar-accent hover:text-foreground lg:flex"
          onClick={toggleCollapsed}
          aria-pressed={iconMode}
          aria-label={iconMode ? "Expand sidebar" : "Collapse sidebar"}
        >
          <PanelLeft className="size-3.5" aria-hidden />
          {iconMode ? null : "Collapse"}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-svh bg-ink text-foreground">
      <aside
        className={cn(
          "sticky top-0 hidden h-svh shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex",
          collapsed ? "w-[72px]" : "w-60",
        )}
      >
        {sidebarBody(collapsed)}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border/70 bg-ink/90 px-3 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            className="grid size-9 shrink-0 place-items-center rounded-md border border-border"
          >
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
          <Logo to={homeTo} subtitle={areaLabel} />
        </header>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-ink/70"
              onClick={() => setMobileOpen(false)}
            />
            <div className="relative flex h-full w-[min(100%,18rem)] flex-col bg-sidebar shadow-2xl">
              <div className="flex items-center justify-end border-b border-sidebar-border p-2">
                <button
                  type="button"
                  aria-label="Close navigation"
                  className="grid size-9 place-items-center rounded-md border border-sidebar-border"
                  onClick={() => setMobileOpen(false)}
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{sidebarBody(false)}</div>
            </div>
          </div>
        ) : null}

        <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

export function AppBreadcrumb({ crumbs }: { crumbs: Array<{ label: string; to?: string }> }) {
  if (!crumbs.length) return null;
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-steel">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${crumb.label}:${crumb.to ?? i}`} className="flex items-center gap-1">
            {i > 0 ? <span aria-hidden>›</span> : null}
            {crumb.to && !last ? (
              <Link to={crumb.to} className="hover:text-foreground">
                {crumb.label}
              </Link>
            ) : (
              <span className={last ? "text-foreground" : undefined}>{crumb.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function PanelHeader({
  title,
  sub,
  actions,
  crumbs,
}: {
  title: string;
  sub?: string;
  actions?: React.ReactNode;
  crumbs?: Array<{ label: string; to?: string }>;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/70 px-4 py-4 sm:px-6">
      <div className="min-w-0">
        {crumbs ? <div className="mb-1"><AppBreadcrumb crumbs={crumbs} /></div> : null}
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
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">{label}</div>
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
