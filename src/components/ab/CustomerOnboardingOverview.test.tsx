/** @vitest-environment happy-dom */
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import {
  deriveCustomerOnboarding,
  type CustomerOnboardingInput,
} from "@/domain/customer-onboarding";
import {
  CustomerOnboardingOverview,
  type CustomerOnboardingOverviewData,
} from "@/components/ab/CustomerOnboardingOverview";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    search?: unknown;
    className?: string;
  }) => createElement("a", { href: typeof to === "string" ? to : "#", ...rest }, children),
}));

const staff: Pick<
  CustomerOnboardingInput,
  "canEditCompany" | "canEditContacts" | "canManageUsers" | "canImportHistory"
> = {
  canEditCompany: true,
  canEditContacts: true,
  canManageUsers: true,
  canImportHistory: true,
};

function input(overrides: Partial<CustomerOnboardingInput> = {}): CustomerOnboardingInput {
  return {
    status: "PROSPECT",
    contactCount: 0,
    addressCount: 0,
    salesCode: null,
    salesCodeVerified: false,
    ownershipAmbiguous: false,
    ownershipNote: null,
    masterLinked: false,
    masterCodes: [],
    masterRestricted: false,
    priceListName: null,
    paymentTerms: null,
    customerGroupName: null,
    taxStatus: "STANDARD",
    historyStatus: "NOT_STARTED",
    historyKind: null,
    portalActiveUsers: 0,
    portalPending: 0,
    ...staff,
    ...overrides,
  };
}

function overview(
  overrides: Partial<CustomerOnboardingInput> = {},
): CustomerOnboardingOverviewData {
  return {
    ...deriveCustomerOnboarding(input(overrides)),
    orders: { count: 0, recent: [] },
    quotes: { count: 0 },
    masterLinked: Boolean(overrides.masterLinked),
  };
}

const TABS = [
  "Overview",
  "Contacts",
  "Addresses",
  "Commercial",
  "Autopart",
  "Users",
  "Orders",
  "Quotes",
] as const;

function mount(node: ReactElement, container = document.createElement("div")) {
  if (!container.isConnected) document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return {
    container,
    rerender(next: ReactElement) {
      act(() => {
        root.render(next);
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function click(element: Element | null) {
  expect(element).toBeTruthy();
  act(() => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function keyOn(element: Element | null, name: string) {
  expect(element).toBeTruthy();
  act(() => {
    (element as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}

const mounted: Array<{ unmount: () => void }> = [];

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
});

describe("CustomerOnboardingOverview collapse UX", () => {
  it("collapses the panel by default when every required step is complete", () => {
    const onOpenTab = vi.fn();
    mounted.push(
      mount(
        createElement(CustomerOnboardingOverview, {
          companyId: "co-complete",
          onboarding: overview({
            status: "ACTIVE",
            salesCode: "WORSBRO",
            salesCodeVerified: true,
            historyStatus: "COMPLETE",
            historyKind: "NO_HISTORICAL_SALES",
            portalActiveUsers: 1,
            contactCount: 1,
            addressCount: 1,
            paymentTerms: "30 days",
          }),
          availableTabs: TABS,
          onOpenTab,
        }),
      ),
    );

    const root = document.querySelector("[data-onboarding-overview]");
    expect(root?.getAttribute("data-onboarding-panel")).toBe("complete");
    expect(root?.getAttribute("data-onboarding-panel-open")).toBe("false");
    expect(document.querySelector("[data-onboarding-complete-summary]")?.textContent).toContain(
      "Customer onboarding complete",
    );
    expect(document.querySelector("[data-onboarding-outstanding]")).toBeNull();
    expect(document.querySelector("[data-onboarding-details]")).toBeNull();

    click(document.querySelector("[data-onboarding-complete-summary]"));
    expect(root?.getAttribute("data-onboarding-panel-open")).toBe("true");
    expect(document.querySelector("[data-onboarding-details]")).toBeTruthy();
    expect(document.querySelector("[data-onboarding-next='none']")).toBeTruthy();
  });

  it("keeps outstanding required and awaiting-verification cards visible for a partial customer", () => {
    const onOpenTab = vi.fn();
    mounted.push(
      mount(
        createElement(CustomerOnboardingOverview, {
          companyId: "co-partial",
          onboarding: overview({
            status: "ACTIVE",
            salesCode: "WORSBRO",
            salesCodeVerified: true,
            historyStatus: "NOT_STARTED",
            contactCount: 1,
            addressCount: 1,
            paymentTerms: "30 days",
          }),
          availableTabs: TABS,
          onOpenTab,
        }),
      ),
    );

    const root = document.querySelector("[data-onboarding-overview]");
    expect(root?.getAttribute("data-onboarding-panel")).toBe("incomplete");
    expect(document.querySelector("[data-onboarding-next='history']")).toBeTruthy();
    expect(
      document
        .querySelector("[data-onboarding-outstanding] [data-onboarding-step='history']")
        ?.getAttribute("data-onboarding-state"),
    ).toBe("required");
    expect(
      document.querySelector("[data-onboarding-optional-section] [data-onboarding-step='portal']"),
    ).toBeTruthy();
    expect(document.querySelector("[data-onboarding-complete-summary]")).toBeNull();

    const completed = document.querySelector("[data-onboarding-completed]");
    expect(completed?.getAttribute("data-completed-setup-open")).toBe("false");
    expect(document.querySelector("[data-completed-setup-count]")?.textContent).toContain("(");
    expect(document.querySelector("[data-onboarding-completed] [data-onboarding-step]")).toBeNull();

    click(document.querySelector("[data-completed-setup-trigger]"));
    expect(completed?.getAttribute("data-completed-setup-open")).toBe("true");
    expect(
      document.querySelector("[data-onboarding-completed] [data-onboarding-step='details']"),
    ).toBeTruthy();
    expect(
      document.querySelector("[data-onboarding-completed] [data-onboarding-step='trading']"),
    ).toBeTruthy();
    expect(
      document.querySelector("[data-onboarding-completed] [data-onboarding-step='autopart']"),
    ).toBeTruthy();
    expect(
      document.querySelector("[data-onboarding-completed] [data-onboarding-step='activation']"),
    ).toBeTruthy();

    const openHistory = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Open sales history"),
    );
    click(openHistory ?? null);
    expect(onOpenTab).toHaveBeenCalledWith("Autopart");
  });

  it("keeps awaiting verification prominent when a saved sales code is not verified", () => {
    mounted.push(
      mount(
        createElement(CustomerOnboardingOverview, {
          companyId: "co-await",
          onboarding: overview({
            status: "ACTIVE",
            salesCode: "WORSBRO",
            salesCodeVerified: false,
            contactCount: 1,
            addressCount: 1,
            paymentTerms: "30 days",
          }),
          availableTabs: TABS,
          onOpenTab: vi.fn(),
        }),
      ),
    );

    expect(document.querySelector("[data-onboarding-next='autopart']")).toBeTruthy();
    expect(
      document
        .querySelector("[data-onboarding-outstanding] [data-onboarding-step='autopart']")
        ?.getAttribute("data-onboarding-state"),
    ).toBe("awaiting_verification");
    expect(document.querySelector("[data-onboarding-complete-summary]")).toBeNull();
  });

  it("keeps a pending portal invitation outstanding even when the account is active", () => {
    mounted.push(
      mount(
        createElement(CustomerOnboardingOverview, {
          companyId: "co-portal",
          onboarding: overview({
            status: "ACTIVE",
            salesCode: "PORTAL",
            salesCodeVerified: true,
            historyStatus: "COMPLETE",
            historyKind: "NO_HISTORICAL_SALES",
            portalPending: 1,
            contactCount: 1,
            addressCount: 1,
            paymentTerms: "30 days",
          }),
          availableTabs: TABS,
          onOpenTab: vi.fn(),
        }),
      ),
    );

    expect(
      document.querySelector("[data-onboarding-panel]")?.getAttribute("data-onboarding-panel"),
    ).toBe("incomplete");
    expect(document.querySelector("[data-onboarding-next='portal']")).toBeTruthy();
    expect(
      document
        .querySelector("[data-onboarding-outstanding] [data-onboarding-step='portal']")
        ?.getAttribute("data-onboarding-state"),
    ).toBe("awaiting_verification");
    expect(document.querySelector("[data-onboarding-complete-summary]")).toBeNull();
  });

  it("shows optional actions without blocking the complete summary when required steps are done", () => {
    mounted.push(
      mount(
        createElement(CustomerOnboardingOverview, {
          companyId: "co-optional",
          onboarding: overview({
            status: "ACTIVE",
            salesCode: "OPT",
            salesCodeVerified: true,
            historyStatus: "COMPLETE",
            historyKind: "NO_HISTORICAL_SALES",
            portalActiveUsers: 1,
            contactCount: 0,
            addressCount: 0,
            paymentTerms: null,
            masterLinked: false,
          }),
          availableTabs: TABS,
          onOpenTab: vi.fn(),
        }),
      ),
    );

    expect(document.querySelector("[data-onboarding-complete-summary]")).toBeTruthy();
    expect(
      document
        .querySelector("[data-onboarding-panel-open]")
        ?.getAttribute("data-onboarding-panel-open"),
    ).toBe("false");

    click(document.querySelector("[data-onboarding-complete-summary]"));
    expect(document.querySelector("[data-onboarding-optional-section]")).toBeTruthy();
    expect(document.querySelector("[data-onboarding-optional='details']")?.textContent).toContain(
      "No contact is recorded",
    );
    expect(
      Array.from(document.querySelectorAll("[data-onboarding-optional]")).some((node) =>
        node.textContent?.includes("Payment terms are not set"),
      ),
    ).toBe(true);
  });

  it("supports keyboard expand and collapse of the completed setup accordion", () => {
    mounted.push(
      mount(
        createElement(CustomerOnboardingOverview, {
          companyId: "co-keys",
          onboarding: overview({
            status: "PROSPECT",
            contactCount: 1,
            addressCount: 1,
            paymentTerms: "Net 30",
          }),
          availableTabs: TABS,
          onOpenTab: vi.fn(),
        }),
      ),
    );

    const trigger = document.querySelector<HTMLButtonElement>("[data-completed-setup-trigger]");
    expect(trigger?.tagName).toBe("BUTTON");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.getAttribute("aria-controls")).toBeTruthy();
    expect(
      document
        .querySelector("[data-completed-setup-open]")
        ?.getAttribute("data-completed-setup-open"),
    ).toBe("false");

    act(() => {
      trigger!.focus();
    });
    expect(document.activeElement).toBe(trigger);
    // happy-dom does not synthesise the click a real browser fires for Enter on a button.
    keyOn(trigger, "Enter");
    click(trigger);
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(
      document
        .querySelector("[data-completed-setup-open]")
        ?.getAttribute("data-completed-setup-open"),
    ).toBe("true");

    keyOn(trigger, " ");
    click(trigger);
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(
      document
        .querySelector("[data-completed-setup-open]")
        ?.getAttribute("data-completed-setup-open"),
    ).toBe("false");
  });

  it("resets collapse defaults when the customer record changes while the page is open", () => {
    const onOpenTab = vi.fn();
    const view = mount(
      createElement(CustomerOnboardingOverview, {
        companyId: "co-live",
        onboarding: overview({
          status: "ACTIVE",
          salesCode: "LIVE",
          salesCodeVerified: false,
          contactCount: 1,
          addressCount: 1,
          paymentTerms: "30 days",
        }),
        availableTabs: TABS,
        onOpenTab,
      }),
    );
    mounted.push(view);

    expect(
      document.querySelector("[data-onboarding-panel]")?.getAttribute("data-onboarding-panel"),
    ).toBe("incomplete");
    click(document.querySelector("[data-completed-setup-trigger]"));
    expect(
      document
        .querySelector("[data-completed-setup-open]")
        ?.getAttribute("data-completed-setup-open"),
    ).toBe("true");

    view.rerender(
      createElement(CustomerOnboardingOverview, {
        companyId: "co-live",
        onboarding: overview({
          status: "ACTIVE",
          salesCode: "LIVE",
          salesCodeVerified: true,
          historyStatus: "COMPLETE",
          historyKind: "NO_HISTORICAL_SALES",
          portalActiveUsers: 1,
          contactCount: 1,
          addressCount: 1,
          paymentTerms: "30 days",
        }),
        availableTabs: TABS,
        onOpenTab,
      }),
    );

    expect(document.querySelector("[data-onboarding-complete-summary]")).toBeTruthy();
    expect(
      document
        .querySelector("[data-onboarding-panel-open]")
        ?.getAttribute("data-onboarding-panel-open"),
    ).toBe("false");
    expect(document.querySelector("[data-onboarding-outstanding]")).toBeNull();

    click(document.querySelector("[data-onboarding-complete-summary]"));
    expect(
      document
        .querySelector("[data-completed-setup-open]")
        ?.getAttribute("data-completed-setup-open"),
    ).toBe("false");

    view.rerender(
      createElement(CustomerOnboardingOverview, {
        companyId: "co-other",
        onboarding: overview({
          status: "PROSPECT",
          salesCode: "OTHER",
          salesCodeVerified: false,
        }),
        availableTabs: TABS,
        onOpenTab,
      }),
    );

    expect(
      document.querySelector("[data-onboarding-panel]")?.getAttribute("data-onboarding-panel"),
    ).toBe("incomplete");
    expect(document.querySelector("[data-onboarding-next='autopart']")).toBeTruthy();
    expect(document.querySelector("[data-onboarding-complete-summary]")).toBeNull();
  });
});
