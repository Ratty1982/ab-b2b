import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardError } from "./DashboardError";
import { DashboardSkeleton } from "./DashboardSkeleton";
import { NeedsAttentionPanel } from "./NeedsAttentionPanel";
import { SystemHealthPanel } from "./SystemHealthPanel";
import { RecentActivityPanel } from "./RecentActivityPanel";
import { AdminDashboardHeader } from "./AdminDashboardHeader";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={typeof to === "string" ? to : "#"} {...rest}>
      {children}
    </a>
  ),
}));

describe("admin dashboard UI states", () => {
  it("renders skeleton without layout-breaking copy", () => {
    const html = renderToStaticMarkup(<DashboardSkeleton />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading operational overview");
  });

  it("renders compact error with retry", () => {
    const html = renderToStaticMarkup(<DashboardError onRetry={() => undefined} />);
    expect(html).toContain("Dashboard unavailable");
    expect(html).toContain("Could not load the operational overview.");
    expect(html).toContain("Retry");
    expect(html).not.toContain("ECONNREFUSED");
    expect(html).not.toContain("stack");
  });

  it("renders healthy needs-attention empty state", () => {
    const html = renderToStaticMarkup(<NeedsAttentionPanel items={[]} />);
    expect(html).toContain("You&#x27;re up to date");
    expect(html).toContain("No operational issues currently require attention.");
  });

  it("renders needs-attention rows with severity and action", () => {
    const html = renderToStaticMarkup(
      <NeedsAttentionPanel
        items={[
          {
            id: "export-blocked",
            label: "Orders blocked from Autopart export",
            count: 1,
            href: "/admin/orders?autopartExport=BLOCKED",
            severity: "critical",
            actionLabel: "FIX",
          },
          {
            id: "applications",
            label: "Trade applications awaiting review",
            count: 3,
            href: "/admin/applications",
            severity: "attention",
            actionLabel: "REVIEW",
          },
        ]}
      />,
    );
    expect(html).toContain("FIX");
    expect(html).toContain("REVIEW");
    expect(html).toContain("Orders blocked from Autopart export");
  });

  it("renders system health rows from authoritative labels only", () => {
    const html = renderToStaticMarkup(
      <SystemHealthPanel
        rows={[
          {
            id: "email",
            label: "Email",
            statusLabel: "Healthy",
            tone: "healthy",
            href: "/admin/settings?tab=email",
          },
          {
            id: "autopart-504c",
            label: "504C Order Status Feed",
            statusLabel: "Not configured",
            tone: "not_configured",
            href: "/admin/settings?tab=autopart",
          },
        ]}
      />,
    );
    expect(html).toContain("Healthy");
    expect(html).toContain("Not configured");
    expect(html).not.toContain("+12%");
  });

  it("renders activity timeline from backend rows", () => {
    const html = renderToStaticMarkup(
      <RecentActivityPanel
        rows={[
          {
            id: "1",
            when: "2026-10-01T12:04:00.000Z",
            whenLabel: "01/10/2026, 13:04 BST",
            whenTimeLabel: "13:04",
            who: "Wayne",
            what: "Order exported to Autopart",
          },
        ]}
      />,
    );
    expect(html).toContain("13:04");
    expect(html).toContain("Wayne");
    expect(html).toContain("order exported to autopart");
  });

  it("renders greeting and quick actions", () => {
    const html = renderToStaticMarkup(
      <AdminDashboardHeader
        greeting={{
          greeting: "Good afternoon",
          displayName: "Wayne",
          dateLabel: "Thursday, 1 October 2026",
        }}
        quickActions={[
          { id: "view-orders", label: "View Orders", href: "/admin/orders" },
          { id: "products", label: "Products", href: "/admin/products" },
        ]}
      />,
    );
    expect(html).toContain("Good afternoon, Wayne");
    expect(html).toContain("Thursday, 1 October 2026");
    expect(html).toContain("View Orders");
    expect(html).toContain('href="/admin/orders"');
  });
});
