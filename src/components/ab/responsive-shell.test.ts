import { createElement, type ReactElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { VisibleNavSection } from "@/lib/app-nav";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: ReactNode;
    to: string;
  } & Record<string, unknown>) => createElement("a", { href: to, ...rest }, children),
  useRouterState: (options?: { select?: (state: { location: { pathname: string } }) => unknown }) => {
    const state = { location: { pathname: "/sales/orders" } };
    return options?.select ? options.select(state) : state;
  },
}));

vi.mock("@/server/auth/session", () => ({
  signOutCurrent: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/components/system/WhatsNewHost", () => ({
  WhatsNewHost: () => null,
  WhatsNewTriggerButton: () => null,
}));

import { AppShell } from "@/components/ab/AppShell";

const sections: VisibleNavSection[] = [
  {
    id: "sales",
    label: "Sales",
    items: [
      {
        id: "orders",
        label: "Orders",
        icon: "shopping-bag",
        to: "/sales/orders",
        exact: false,
        matchPrefixes: ["/sales/orders"],
        excludePrefixes: [],
        children: [],
      },
    ],
  },
];

describe("responsive shells", () => {
  it("gives the staff menu a 44px control and keeps wide pages inside the main column", () => {
    const markup = renderToStaticMarkup(
      createElement(AppShell, {
        sections,
        homeTo: "/sales",
        areaLabel: "Sales",
        user: { name: "Alex", role: "Sales", actorType: "INTERNAL" },
        children: createElement("p", null, "Workspace"),
      }) as ReactElement,
    );
    expect(markup).toContain("Open navigation");
    expect(markup).toContain("size-11");
    expect(markup).toContain("overflow-x-clip");
    expect(markup).toContain("safe-area-inset-top");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("Orders");
  });

  it("keeps phone form controls at 16px and dialogs inside the viewport", () => {
    const css = readFileSync(path.join(process.cwd(), "src/styles.css"), "utf8");
    const dialog = readFileSync(path.join(process.cwd(), "src/components/ui/dialog.tsx"), "utf8");
    const alertDialog = readFileSync(path.join(process.cwd(), "src/components/ui/alert-dialog.tsx"), "utf8");
    const root = readFileSync(path.join(process.cwd(), "src/routes/__root.tsx"), "utf8");
    expect(css).toContain("@media (max-width: 1023px)");
    expect(css).toContain("font-size: 16px");
    expect(dialog).toContain("overflow-y-auto");
    expect(dialog).toContain("100vw-1.5rem");
    expect(dialog).toContain("85dvh");
    expect(alertDialog).toContain("min-h-11");
    expect(root).toContain("viewport-fit=cover");
  });
});
