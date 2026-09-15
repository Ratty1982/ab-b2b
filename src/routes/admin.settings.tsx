import { createFileRoute } from "@tanstack/react-router";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";

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

function AdminSettings() {
  return (
    <div>
      <PanelHeader title="Settings" sub="Trading defaults, ordering rules and notifications" />

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-2">
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
                {["Trade List", "Trade A", "Trade B", "Trade C", "Distributor", "Buying Group"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
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
              <li key={String(label)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3">
                <span className="min-w-0">{label as string}</span>
                <input type="checkbox" defaultChecked={on as boolean} className="size-4 accent-primary" aria-label={label as string} />
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
              <li key={String(label)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3">
                <span className="min-w-0">{label as string}</span>
                <input type="checkbox" defaultChecked={on as boolean} className="size-4 accent-primary" aria-label={label as string} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
