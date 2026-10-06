import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import { EmailSettingsPanel } from "@/components/ab/EmailSettingsPanel";
import { TradeOrderingSettingsPanel } from "@/components/ab/TradeOrderingSettingsPanel";
import { Autopart504cFeedPanel } from "@/components/ab/Autopart504cFeedPanel";
import { AutopartOngoingSalesFeedPanel } from "@/components/ab/AutopartOngoingSalesFeedPanel";
import { SharePointSdsSettingsPanel } from "@/components/catalogue/SharePointSdsSettingsPanel";
import { getMyTradeTestLevelFn, getSharePointSdsSettingsFn, setMyTradeTestLevelFn } from "@/server/phase2/fns";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import {
  SETTINGS_TAB_META,
  parseSettingsSearch,
  resolveSettingsTab,
  type SettingsSearch,
  type SettingsTab,
} from "@/domain/admin-settings-tabs";

export {
  parseSettingsSearch,
  resolveSettingsTab,
  SETTINGS_TABS,
} from "@/domain/admin-settings-tabs";
export type { SettingsSearch, SettingsTab } from "@/domain/admin-settings-tabs";

export const Route = createFileRoute("/admin/settings")({
  validateSearch: (search: Record<string, unknown>): SettingsSearch =>
    parseSettingsSearch(search),
  head: () => ({
    meta: [
      { title: "Platform Settings — Automotive Brands Admin" },
      {
        name: "description",
        content:
          "Trading, ordering, delivery, email and notification settings for the Automotive Brands trade platform.",
      },
      { property: "og:title", content: "Platform Settings — Automotive Brands Admin" },
      { property: "og:description", content: "Trading, ordering, email and notification defaults." },
    ],
  }),
  component: AdminSettings,
});

type TradeTestState = {
  mode: "NONE" | "BASE_TRADE" | "PRICE_LIST";
  priceListId: string | null;
  priceListCode: string | null;
  priceListName: string | null;
  label: string | null;
  options: Array<{ id: string; code: string; name: string; isDefault: boolean }>;
};

function tradeTestSelectValue(state: TradeTestState | null): string {
  if (!state || state.mode === "NONE") return "none";
  if (state.mode === "BASE_TRADE") return "base_trade";
  return state.priceListId ?? "none";
}

function TradeTestingPanel() {
  const [state, setState] = useState<TradeTestState | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getMyTradeTestLevelFn().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setState(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onChange(raw: string) {
    const payload =
      raw === "none"
        ? ({ mode: "NONE" } as const)
        : raw === "base_trade"
          ? ({ mode: "BASE_TRADE" } as const)
          : ({ mode: "PRICE_LIST", priceListId: raw } as const);

    setSaving(true);
    const result = await setMyTradeTestLevelFn({ data: payload });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setState(result.data);
    toast.success(
      result.data.mode === "NONE"
        ? "Trade test level cleared"
        : result.data.mode === "BASE_TRADE"
          ? "Trade test level set to Default Trade Price"
          : `Trade test level set to ${result.data.priceListName ?? "price list"}`,
    );
  }

  return (
    <section
      data-admin-section="trade-testing"
      className="space-y-4 rounded-lg border border-border bg-surface/30 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-display text-lg font-semibold uppercase">Trade testing</h2>
        <span className="text-[10px] font-bold uppercase tracking-wide text-warn">
          Internal tool
        </span>
      </div>
      <p className="max-w-2xl text-[13px] text-steel">
        Sets the price level used when staff browse the public catalogue for ordering tests. Not
        customer impersonation and not the default price group for new accounts.
      </p>

      {loadError ? (
        <p className="text-[13px] text-warn" role="status">
          {loadError}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] sm:items-end">
        <Field label="Trade price level">
          <select
            className={inputClass}
            disabled={!state || saving}
            value={tradeTestSelectValue(state)}
            onChange={(e) => {
              void onChange(e.target.value);
            }}
          >
            <option value="none">No test level</option>
            <option value="base_trade">Default Trade Price</option>
            {(state?.options ?? []).map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
                {opt.isDefault ? " (default list)" : ""} · {opt.code}
              </option>
            ))}
          </select>
        </Field>
        <div className="text-[13px] text-steel">
          {state?.mode === "BASE_TRADE" ? (
            <p data-trade-test-status="base-trade">
              Status: Testing public catalogue using <strong>Default Trade Price</strong>.
            </p>
          ) : state?.mode === "PRICE_LIST" && state.priceListName ? (
            <p data-trade-test-status="price-list">
              Status: Testing public catalogue using <strong>{state.priceListName}</strong>.
            </p>
          ) : (
            <p data-trade-test-status="inactive">
              Status: No test level selected — public ordering controls stay disabled.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          to="/products"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13px] font-bold uppercase tracking-wide text-primary-foreground"
        >
          View catalogue
        </Link>
        <Link
          to={ROUTES.adminPricing}
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[13px] font-semibold"
        >
          Manage price lists
        </Link>
      </div>
    </section>
  );
}

function PlatformDefaultsSection() {
  return (
    <section
      data-admin-section="platform-defaults"
      className="space-y-4"
      aria-labelledby="platform-defaults-heading"
    >
      <div>
        <h2
          id="platform-defaults-heading"
          className="font-display text-lg font-semibold uppercase"
        >
          Platform defaults
        </h2>
        <p className="mt-1 text-[12px] text-steel">
          Read-only platform rules. These values are defined in application code and cannot be
          changed from this screen.
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
        <div className="rounded-md border border-border bg-ink/30 px-3 py-2.5">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-steel">
            Default payment terms
          </dt>
          <dd className="mt-1 font-semibold">30 Days Net</dd>
          <dd className="mt-1 text-[12px] text-steel">Usual default for new trade accounts.</dd>
        </div>
        <div className="rounded-md border border-border bg-ink/30 px-3 py-2.5">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-steel">
            Default price for new accounts
          </dt>
          <dd className="mt-1 font-semibold">Default Trade Price</dd>
          <dd className="mt-1 text-[12px] text-steel">
            Catalogue ProductVariant.tradePrice until a list or special is assigned.
          </dd>
        </div>
        <div className="rounded-md border border-border bg-ink/30 px-3 py-2.5">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-steel">
            Free delivery threshold
          </dt>
          <dd className="mt-1 font-semibold">£100.00 ex VAT goods</dd>
          <dd className="mt-1 text-[12px] text-steel">TRADE_FREE_DELIVERY_THRESHOLD_EX_VAT</dd>
        </div>
        <div className="rounded-md border border-border bg-ink/30 px-3 py-2.5">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-steel">
            Standard carriage
          </dt>
          <dd className="mt-1 font-semibold">£5.95 ex VAT</dd>
          <dd className="mt-1 text-[12px] text-steel">
            TRADE_DELIVERY_CHARGE_EX_VAT when below free-delivery threshold.
          </dd>
        </div>
      </dl>
    </section>
  );
}

function OrderingNotesSection() {
  return (
    <section
      data-admin-section="ordering-notes"
      className="space-y-3"
      aria-labelledby="ordering-notes-heading"
    >
      <h2 id="ordering-notes-heading" className="font-display text-base font-semibold uppercase">
        Ordering notes
      </h2>
      <p className="text-[12px] text-steel">
        Automotive Brands does not manage customer credit control. Credit limits and available
        credit remain authoritative in Autopart/MAM and are managed by Accounts.
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
        {[
          "Purchase order handling is enforced in checkout where required by the order flow.",
          "Live stock availability bands are shown to authenticated trade customers according to stock policy.",
          "Order and quote email alerts are configured under the Email tab.",
        ].map((line) => (
          <li key={line} className="px-3 py-3 text-steel">
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SettingsTabNav({
  tab,
  onSelect,
}: {
  tab: SettingsTab;
  onSelect: (next: SettingsTab) => void;
}) {
  return (
    <div
      className="-mx-4 border-b border-border/70 px-4 sm:-mx-0 sm:px-6"
      data-settings-tabs="nav"
    >
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto"
      >
        {SETTINGS_TAB_META.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`settings-tab-${item.id}`}
              aria-selected={active}
              aria-controls={`settings-panel-${item.id}`}
              aria-current={active ? "page" : undefined}
              tabIndex={active ? 0 : -1}
              data-settings-tab={item.id}
              data-active={active ? "true" : "false"}
              onClick={() => onSelect(item.id)}
              className={cn(
                "shrink-0 border-b-2 px-3 py-3 text-[11px] font-bold uppercase tracking-wide transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-steel hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GeneralTab() {
  return (
    <div className="space-y-8" data-settings-panel="general">
      <PlatformDefaultsSection />
      <p className="max-w-2xl text-[13px] text-steel">
        Trade testing, email, Autopart feeds, and SharePoint SDS each have their own tab. Use those
        for editable configuration.
      </p>
    </div>
  );
}

function TradeTab() {
  return (
    <div className="space-y-8" data-settings-panel="trade">
      <TradeTestingPanel />
      <TradeOrderingSettingsPanel />
      <OrderingNotesSection />
    </div>
  );
}

function EmailTab() {
  return (
    <div className="space-y-6" data-settings-panel="email">
      <div>
        <h2 className="font-display text-lg font-semibold uppercase">Email</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-steel">
          Microsoft 365 / SMTP delivery and notification recipients for trade applications, orders,
          and quotes.
        </p>
      </div>
      <EmailSettingsPanel />
    </div>
  );
}

function AutopartTab() {
  return (
    <div className="space-y-8" data-settings-panel="autopart">
      <div>
        <h2 className="font-display text-lg font-semibold uppercase">Autopart integrations</h2>
        <p className="mt-1 max-w-3xl text-[13px] text-steel">
          Separate mailbox feeds for order status and ongoing sales. Settings and polling remain
          independent — do not merge these integrations.
        </p>
      </div>

      <section aria-labelledby="autopart-504c-heading" className="space-y-3">
        <div>
          <h3
            id="autopart-504c-heading"
            className="font-display text-base font-semibold uppercase"
          >
            504C — Order status
          </h3>
          <p className="mt-1 text-[12px] text-steel">
            Invoice / despatch feed (report 504C). Connection, schedule, and dry-run tools below.
          </p>
        </div>
        <Autopart504cFeedPanel />
      </section>

      <section aria-labelledby="autopart-ongoing-heading" className="space-y-3">
        <div>
          <h3
            id="autopart-ongoing-heading"
            className="font-display text-base font-semibold uppercase"
          >
            Ongoing sales &amp; credits
          </h3>
          <p className="mt-1 text-[12px] text-steel">504 + TRM21QC ongoing Autopart sales import.</p>
        </div>
        <AutopartOngoingSalesFeedPanel />
      </section>
    </div>
  );
}

function DocumentsTab() {
  const [sharePointEnabled, setSharePointEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getSharePointSdsSettingsFn();
      if (cancelled || !res.ok) return;
      setSharePointEnabled(Boolean(res.data.workflowEnabled));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6" data-settings-panel="documents">
      <section data-settings-section="sds-management">
        <h2 className="font-display text-lg font-semibold uppercase">SDS management</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-steel">
          Safety Data Sheets are managed manually. Use Bulk SDS Upload to add or replace documents
          across multiple products.
        </p>
        <p className="mt-2 max-w-2xl text-[13px] text-steel">
          PDF only, up to 20 MB each and 100 files per batch. New SDS becomes current; the previous
          current SDS is archived on replace. Individual product Documents tabs still handle single
          uploads and other document types.
        </p>
        <Link
          to={ROUTES.adminProductDocumentsImport}
          className="mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-semibold uppercase text-primary-foreground"
        >
          Bulk SDS Upload
        </Link>
      </section>
      {sharePointEnabled ? (
        <section data-settings-section="sharepoint-sds">
          <h3 className="font-display text-base font-semibold uppercase">SharePoint (environment enabled)</h3>
          <p className="mt-1 max-w-2xl text-[13px] text-steel">
            Microsoft Graph is switched on for this environment. Manual bulk upload remains the
            supported production workflow.
          </p>
          <div className="mt-4">
            <SharePointSdsSettingsPanel />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SystemTab() {
  return (
    <div className="space-y-4" data-settings-panel="system">
      <div>
        <h2 className="font-display text-lg font-semibold uppercase">System</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-steel">
          Reserved for genuine platform-level configuration. Version Updates and other SYSTEM
          tools keep their own navigation entries when available.
        </p>
      </div>
      <div
        className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13px] text-steel"
        data-settings-empty="system"
      >
        No editable system settings on this page yet.
      </div>
    </div>
  );
}

function AdminSettings() {
  const search = Route.useSearch();
  const tab = resolveSettingsTab(search);
  const navigate = Route.useNavigate();

  function selectTab(next: SettingsTab) {
    void navigate({
      search: (prev) => ({ ...prev, tab: next }),
      replace: false,
    });
  }

  return (
    <div data-page="admin-settings">
      <PanelHeader
        title="Settings"
        sub="Configure the Automotive Brands B2B platform"
      />

      <SettingsTabNav tab={tab} onSelect={selectTab} />

      <div
        className="p-4 sm:p-6"
        role="tabpanel"
        id={`settings-panel-${tab}`}
        aria-labelledby={`settings-tab-${tab}`}
        data-settings-active-tab={tab}
      >
        {tab === "general" ? <GeneralTab /> : null}
        {tab === "trade" ? <TradeTab /> : null}
        {tab === "email" ? <EmailTab /> : null}
        {tab === "autopart" ? <AutopartTab /> : null}
        {tab === "documents" ? <DocumentsTab /> : null}
        {tab === "system" ? <SystemTab /> : null}
      </div>
    </div>
  );
}
