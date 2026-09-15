import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout, PageHeader, Breadcrumbs } from "@/components/ab/PublicLayout";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Automotive Brands — Trade Sales & Support" },
      {
        name: "description",
        content:
          "Contact the Automotive Brands trade sales, customer service and accounts teams, or ask your account manager to call you back.",
      },
      { property: "og:title", content: "Contact Automotive Brands" },
      { property: "og:description", content: "Trade sales, customer service and accounts contacts." },
    ],
  }),
  component: Contact,
});

const teams = [
  { name: "Trade sales", detail: "New accounts, pricing and brand enquiries", hours: "Mon–Fri 08:00–17:30" },
  { name: "Customer service", detail: "Orders, deliveries, returns and stock", hours: "Mon–Fri 08:00–17:30" },
  { name: "Accounts", detail: "Invoices, statements and credit terms", hours: "Mon–Fri 09:00–17:00" },
];

function Contact() {
  return (
    <PublicLayout>
      <PageHeader eyebrow="Contact" title="Talk to the trade team" sub="Placeholder contact details — send us the real numbers and addresses and we will swap them in." />
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-2">
        <div>
          <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Contact" }]} />
          <ul className="mt-8 divide-y divide-border rounded-lg border border-border">
            {teams.map((t) => (
              <li key={t.name} className="p-4">
                <div className="font-display text-base font-semibold uppercase">{t.name}</div>
                <div className="text-[13px] text-steel">{t.detail}</div>
                <div className="num mt-1 text-[13px]">0000 000 0000 · trade@automotivebrands.co.uk</div>
                <div className="text-[11px] text-steel">{t.hours}</div>
              </li>
            ))}
          </ul>
        </div>

        <form
          className="rounded-lg border border-border bg-surface/50 p-5"
          onSubmit={(e) => e.preventDefault()}
        >
          <h2 className="font-display text-lg font-semibold uppercase">Request a callback</h2>
          <div className="mt-4 grid gap-3">
            {[
              { id: "name", label: "Your name", type: "text" },
              { id: "company", label: "Company", type: "text" },
              { id: "email", label: "Email", type: "email" },
              { id: "phone", label: "Telephone", type: "tel" },
            ].map((f) => (
              <div key={f.id} className="grid gap-1.5">
                <label htmlFor={f.id} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                  {f.label}
                </label>
                <input
                  id={f.id}
                  type={f.type}
                  className="h-10 rounded-md border border-border bg-ink px-3 text-[14px] outline-none focus-visible:border-primary"
                />
              </div>
            ))}
            <div className="grid gap-1.5">
              <label htmlFor="msg" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                How can we help?
              </label>
              <textarea
                id="msg"
                rows={4}
                className="rounded-md border border-border bg-ink p-3 text-[14px] outline-none focus-visible:border-primary"
              />
            </div>
            <button
              type="submit"
              className="mt-2 h-11 rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
            >
              Send enquiry
            </button>
          </div>
        </form>
      </div>
    </PublicLayout>
  );
}
