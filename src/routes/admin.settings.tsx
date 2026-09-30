import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import { EmailSettingsPanel } from "@/components/ab/EmailSettingsPanel";
import { TradeOrderingSettingsPanel } from "@/components/ab/TradeOrderingSettingsPanel";
import { Autopart504cFeedPanel } from "@/components/ab/Autopart504cFeedPanel";
import { AutopartOngoingSalesFeedPanel } from "@/components/ab/AutopartOngoingSalesFeedPanel";
import { getMyTradeTestLevelFn, setMyTradeTestLevelFn } from "@/server/phase2/fns";
import { ROUTES } from "@/lib/app-nav";

export const Route = createFileRoute("/admin/settings")({
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
      className="space-y-4 rounded-lg border border-border bg-surface/30 p-4 sm:p-5 lg:col-span-2"
    >
      <div>
        <h2 className="font-display text-lg font-semibold uppercase">Trade testing</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-steel">
          Choose Default Trade Price (catalogue import / ProductVariant.tradePrice) or a named
          PriceList to browse the public catalogue and exercise Phase 6A ordering. This is not
          customer impersonation — no real company or CustomerPrice is used. Separate from
          &quot;Default price group for new accounts&quot; below.
        </p>
      </div>

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

function AdminSettings() {
  return (
    <div>
      <PanelHeader title="Settings" sub="Trading defaults, ordering rules, email and notifications" />

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-2">
        <TradeTestingPanel />

        <TradeOrderingSettingsPanel />

        <EmailSettingsPanel />

        <Autopart504cFeedPanel />

        <AutopartOngoingSalesFeedPanel />

        <section className="space-y-4" aria-labelledby="trading-read-only-heading">
          <h2 id="trading-read-only-heading" className="font-display text-lg font-semibold uppercase">
            Trading
          </h2>
          <p className="text-[12px] text-steel">
            Read-only platform rules. These values are defined in application code and cannot be
            changed from this screen.
          </p>
          <dl className="grid gap-3 sm:grid-cols-2 text-[13px]">
            <div className="rounded-md border border-border bg-ink/30 px-3 py-2.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-steel">
                Default payment terms
              </dt>
              <dd className="mt-1 font-semibold">30 Days Net</dd>
              <dd className="mt-1 text-[12px] text-steel">
                Company payment terms are set per customer. This is the usual default for new
                accounts.
              </dd>
            </div>
            <div className="rounded-md border border-border bg-ink/30 px-3 py-2.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-steel">
                Default price for new accounts
              </dt>
              <dd className="mt-1 font-semibold">Default Trade Price</dd>
              <dd className="mt-1 text-[12px] text-steel">
                Every new trade account starts on catalogue Default Trade Price
                (ProductVariant.tradePrice). A salesperson can later assign a named price list or
                set special prices on the customer Commercial tab.
              </dd>
            </div>
            <div className="rounded-md border border-border bg-ink/30 px-3 py-2.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-steel">
                Free delivery threshold
              </dt>
              <dd className="mt-1 font-semibold">£100.00 ex VAT goods</dd>
              <dd className="mt-1 text-[12px] text-steel">
                Authoritative domain rule (TRADE_FREE_DELIVERY_THRESHOLD_EX_VAT).
              </dd>
            </div>
            <div className="rounded-md border border-border bg-ink/30 px-3 py-2.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-steel">
                Standard carriage charge
              </dt>
              <dd className="mt-1 font-semibold">£5.95 ex VAT</dd>
              <dd className="mt-1 text-[12px] text-steel">
                Applied when goods subtotal is below the free-delivery threshold
                (TRADE_DELIVERY_CHARGE_EX_VAT).
              </dd>
            </div>
          </dl>
        </section>

        <section className="space-y-4" aria-labelledby="ordering-read-only-heading">
          <h2 id="ordering-read-only-heading" className="font-display text-lg font-semibold uppercase">
            Ordering &amp; notifications
          </h2>
          <p className="text-[12px] text-steel">
            Automotive Brands does not manage customer credit control. Credit limits and available
            credit remain authoritative in Autopart/MAM and are managed by Accounts.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
            {[
              "Purchase order handling is enforced in checkout where required by the order flow.",
              "Live stock availability bands are shown to authenticated trade customers according to stock policy.",
              "Order and quote email alerts are configured in the Email section above.",
            ].map((line) => (
              <li key={line} className="px-3 py-3 text-steel">
                {line}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-steel">
            There are no editable ordering/notification toggles on this page. Trade application and
            new B2B order alert recipients are configured in the Email section.
          </p>
        </section>
      </div>
    </div>
  );
}
