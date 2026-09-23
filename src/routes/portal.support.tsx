import { createFileRoute } from "@tanstack/react-router";
import { Mail, Phone } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import {
  ACCOUNT_MANAGER_HOURS,
  ACCOUNT_MANAGER_HOURS_LINES,
} from "@/domain/account-manager-hours";

export const Route = createFileRoute("/portal/support")({
  head: () => ({
    meta: [
      { title: "Support — Automotive Brands Trade Portal" },
      {
        name: "description",
        content: "Contact your account manager, report an order issue or request a callback.",
      },
      { property: "og:title", content: "Support — Automotive Brands Trade Portal" },
      { property: "og:description", content: "Account manager contact and order support." },
    ],
  }),
  component: Support,
});

function Support() {
  return (
    <div>
      <PanelHeader title="Support" sub="Account ABC001 · ABC Motor Factors Ltd" />
      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-lg border border-border bg-surface/40 p-5">
          <h2 className="font-display text-lg font-semibold uppercase tracking-tight">
            Send a message to your account manager
          </h2>
          <form
            className="mt-4 grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <Field label="Subject">
              <select className={inputClass} defaultValue="Order query">
                {[
                  "Order query",
                  "Delivery issue",
                  "Pricing enquiry",
                  "Product or technical question",
                  "Returns or warranty",
                  "Account or credit",
                ].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </Field>
            <Field label="Related order or quote (optional)">
              <input className={inputClass} placeholder="AB-9821" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Message">
                <textarea
                  rows={6}
                  className={inputClass}
                  defaultValue=""
                  placeholder="Tell us what you need and we will respond the same working day."
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="h-11 rounded-md bg-primary px-6 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
              >
                Send message
              </button>
            </div>
          </form>
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-surface/50 p-4">
            <div className="text-[11px] uppercase tracking-[0.16em] text-steel">Account manager</div>
            <div className="mt-1 font-display text-lg font-semibold uppercase">James Whitfield</div>
            <ul className="num mt-3 space-y-1.5 text-[13px]">
              <li className="flex items-center gap-2">
                <Phone className="size-3.5 text-primary" aria-hidden />
                <a href="tel:01214960142" className="hover:underline">
                  0121 496 0142
                </a>
              </li>
              <li className="flex min-w-0 items-center gap-2">
                <Mail className="size-3.5 shrink-0 text-primary" aria-hidden />
                <a
                  href="mailto:james.whitfield@automotivebrands.co.uk"
                  className="truncate hover:underline"
                >
                  james.whitfield@automotivebrands.co.uk
                </a>
              </li>
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-surface/50 p-4 text-[13px]">
            <div className="text-[11px] uppercase tracking-[0.16em] text-steel">
              {ACCOUNT_MANAGER_HOURS.heading}
            </div>
            <ul className="mt-2 space-y-1 text-steel">
              {ACCOUNT_MANAGER_HOURS_LINES.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
