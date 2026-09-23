import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import { getMyTradeTestLevelFn, setMyTradeTestLevelFn } from "@/server/phase2/fns";
import { ROUTES } from "@/lib/app-nav";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "Platform Settings — Automotive Brands Admin" },
      {
        name: "description",
        content:
          "Trading, ordering, delivery, credit and notification settings for the Automotive Brands trade platform.",
      },
      { property: "og:title", content: "Platform Settings — Automotive Brands Admin" },
      { property: "og:description", content: "Trading, ordering and notification defaults." },
    ],
  }),
  component: AdminSettings,
});

type TradeTestState = {
  priceListId: string | null;
  priceListCode: string | null;
  priceListName: string | null;
  options: Array<{ id: string; code: string; name: string; isDefault: boolean }>;
};

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

  async function onChange(priceListId: string | null) {
    setSaving(true);
    const result = await setMyTradeTestLevelFn({ data: { priceListId } });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setState(result.data);
    toast.success(
      result.data.priceListName
        ? `Trade test level set to ${result.data.priceListName}`
        : "Trade test level cleared",
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
          Select a PriceList to browse the public catalogue and exercise Phase 6A ordering as an
          admin. This is not customer impersonation — no real company or CustomerPrice is used.
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
            value={state?.priceListId ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              void onChange(value ? value : null);
            }}
          >
            <option value="">No test level</option>
            {(state?.options ?? []).map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.name}
                {opt.isDefault ? " (default)" : ""} · {opt.code}
              </option>
            ))}
          </select>
        </Field>
        <div className="text-[13px] text-steel">
          {state?.priceListName ? (
            <p data-trade-test-status="active">
              Status: Testing public catalogue using <strong>{state.priceListName}</strong>
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
      <PanelHeader title="Settings" sub="Trading defaults, ordering rules and notifications" />

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-2">
        <TradeTestingPanel />

        <section className="space-y-4">
          <h2 className="font-display text-lg font-semibold uppercase">Trading</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Default payment terms">
              <select className={inputClass} defaultValue="30 Days Net">
                {["Pro-forma", "30 Days Net", "45 Days Net", "60 Days Net"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Default price group for new accounts">
              <select className={inputClass} defaultValue="Trade C">
                {["Trade List", "Trade A", "Trade B", "Trade C", "Distributor", "Buying Group"].map(
                  (t) => (
                    <option key={t}>{t}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label="VAT rate">
              <input className={inputClass} defaultValue="20%" />
            </Field>
            <Field label="Minimum order value">
              <input className={inputClass} defaultValue="£25.00" />
            </Field>
            <Field label="Free delivery threshold">
              <input className={inputClass} defaultValue="£250.00" />
            </Field>
            <Field label="Standard carriage charge">
              <input className={inputClass} defaultValue="£8.95" />
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-lg font-semibold uppercase">Ordering &amp; credit</h2>
          <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
            {[
              ["Require purchase order number at checkout", true],
              ["Allow ordering above available credit", false],
              ["Hold orders that exceed credit limit for review", true],
              ["Allow card payment for pro-forma accounts", true],
              ["Show live stock quantities to trade customers", true],
              ["Allow back orders on out-of-stock lines", false],
            ].map(([label, on]) => (
              <li
                key={String(label)}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3"
              >
                <span className="min-w-0">{label as string}</span>
                <input
                  type="checkbox"
                  defaultChecked={on as boolean}
                  className="size-4 accent-primary"
                  aria-label={label as string}
                />
              </li>
            ))}
          </ul>

          <h2 className="pt-2 font-display text-lg font-semibold uppercase">Notifications</h2>
          <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
            {[
              ["Email account manager when a customer places an order", true],
              ["Email accounts team when an order exceeds credit", true],
              ["Email sales manager on new trade applications", true],
              ["Notify representative when a quote is viewed", true],
              ["Weekly at-risk customer digest", false],
            ].map(([label, on]) => (
              <li
                key={String(label)}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3"
              >
                <span className="min-w-0">{label as string}</span>
                <input
                  type="checkbox"
                  defaultChecked={on as boolean}
                  className="size-4 accent-primary"
                  aria-label={label as string}
                />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
