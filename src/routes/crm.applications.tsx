import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { FileText } from "lucide-react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { applications, priceGroups, paymentTermsOptions, salesTeam } from "@/lib/crm-data";
import { brands } from "@/lib/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/crm/applications")({
  head: () => ({
    meta: [
      { title: "Trade Applications — Automotive Brands" },
      {
        name: "description",
        content:
          "Internal queue for new trade account applications: review submitted company and trading information, request more information, approve or reject.",
      },
      { property: "og:title", content: "Trade Applications — Automotive Brands" },
      {
        property: "og:description",
        content: "Review, approve and activate new trade accounts.",
      },
    ],
  }),
  component: ApplicationQueue,
});

const statuses = [
  "All",
  "New",
  "Under Review",
  "More Information Required",
  "Approved",
  "Rejected",
] as const;

function tone(status: string) {
  if (status === "Approved") return "good" as const;
  if (status === "Rejected") return "bad" as const;
  if (status === "More Information Required") return "warn" as const;
  if (status === "New") return "brand" as const;
  return "neutral" as const;
}

function ApplicationQueue() {
  const [filter, setFilter] = useState<(typeof statuses)[number]>("All");
  const [open, setOpen] = useState<(typeof applications)[number] | null>(null);
  const [approved, setApproved] = useState<string[]>([]);

  const rows = applications.filter((a) => filter === "All" || a.status === filter);

  return (
    <div>
      <PanelHeader
        title="Trade Applications"
        sub="New trade account requests awaiting review, approval and activation"
      />

      <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="New"
          value={String(applications.filter((a) => a.status === "New").length)}
          tone="brand"
          hint="Not yet opened"
        />
        <Metric
          label="Under review"
          value={String(applications.filter((a) => a.status === "Under Review").length)}
          hint="Credit checks in progress"
        />
        <Metric
          label="Awaiting customer"
          value={String(applications.filter((a) => a.status === "More Information Required").length)}
          tone="warn"
          hint="More information requested"
        />
        <Metric
          label="Approved this month"
          value={String(applications.filter((a) => a.status === "Approved").length + approved.length)}
          tone="good"
          hint="Accounts activated"
        />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        {statuses.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            aria-pressed={filter === s}
            className={cn(
              "h-8 rounded-md border px-3 text-[12px] font-semibold transition-colors",
              filter === s
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-steel hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[980px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">Reference</th>
                <th className="px-3 py-2 font-semibold">Company</th>
                <th className="px-3 py-2 font-semibold">Business type</th>
                <th className="px-3 py-2 font-semibold">Location</th>
                <th className="px-3 py-2 font-semibold">Submitted</th>
                <th className="px-3 py-2 font-semibold">Est. monthly spend</th>
                <th className="px-3 py-2 font-semibold">Documents</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a, i) => (
                <tr key={a.id} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                  <td className="num px-3 py-2.5 text-primary">{a.id}</td>
                  <td className="px-3 py-2.5 font-medium">{a.company}</td>
                  <td className="px-3 py-2.5 text-steel">{a.type}</td>
                  <td className="px-3 py-2.5 text-steel">{a.town}</td>
                  <td className="px-3 py-2.5 text-steel">{a.submitted}</td>
                  <td className="num px-3 py-2.5">{a.volume}</td>
                  <td className="num px-3 py-2.5 text-steel">{a.documents.length}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge tone={approved.includes(a.id) ? "good" : tone(a.status)}>
                      {approved.includes(a.id) ? "Approved" : a.status}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => setOpen(a)}
                      className="text-[12px] font-semibold text-primary hover:underline"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={open !== null}
        onClose={() => setOpen(null)}
        width="xl"
        title={open ? `${open.id} — ${open.company}` : ""}
        sub="Review submitted information, then approve and activate the trade account"
        footer={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (open) setApproved((a) => [...a, open.id]);
                setOpen(null);
              }}
              className="h-11 flex-1 rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground"
            >
              Approve &amp; activate account
            </button>
            <button type="button" className="h-11 rounded-md border border-border px-4 text-[13px] font-semibold">
              Request more information
            </button>
            <button
              type="button"
              className="h-11 rounded-md border border-destructive/50 px-4 text-[13px] font-semibold text-destructive"
            >
              Reject
            </button>
          </div>
        }
      >
        {open ? (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 font-display text-base font-semibold uppercase">Submitted details</h3>
              <dl className="divide-y divide-border rounded-lg border border-border text-[13px]">
                {[
                  ["Trading name", open.company],
                  ["Business type", open.type],
                  ["Company registration", open.companyNumber],
                  ["VAT number", open.vat],
                  ["Trading address", open.tradingAddress],
                  ["Delivery address", open.deliveryAddress],
                  ["Primary contact", `${open.contact} — ${open.contactRole}`],
                  ["Accounts contact", open.accountsContact],
                  ["Telephone", open.telephone],
                  ["Email", open.email],
                  ["Website", open.website],
                  ["Estimated monthly spend", open.volume],
                  ["Brands of interest", open.interest.join(", ")],
                  ["Submitted", open.submitted],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[180px_minmax(0,1fr)] gap-3 px-3 py-2.5">
                    <dt className="text-steel">{k}</dt>
                    <dd className="font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section>
              <h3 className="mb-2 font-display text-base font-semibold uppercase">Uploaded documents</h3>
              <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
                {open.documents.length === 0 ? (
                  <li className="px-3 py-6 text-center text-steel">No documents uploaded</li>
                ) : null}
                {open.documents.map((d) => (
                  <li key={d.name} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
                    <FileText className="size-4 text-steel" aria-hidden />
                    <span className="min-w-0 truncate">
                      {d.name} <span className="num text-steel">· {d.type} · {d.size}</span>
                    </span>
                    <button type="button" className="text-[12px] font-semibold text-primary hover:underline">
                      View
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="mb-2 font-display text-base font-semibold uppercase">Account set-up on approval</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Account number">
                  <input className={inputClass} defaultValue="FAI031" />
                </Field>
                <Field label="Account manager">
                  <select className={inputClass}>
                    {salesTeam.map((s) => (
                      <option key={s.name}>{s.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Price group">
                  <select className={inputClass} defaultValue="Trade B">
                    {priceGroups.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Payment terms">
                  <select className={inputClass} defaultValue="30 Days Net">
                    {paymentTermsOptions.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Credit limit">
                  <input className={inputClass} defaultValue="£5,000" />
                </Field>
                <Field label="Permitted catalogues">
                  <select className={inputClass} multiple size={5}>
                    {brands.map((b) => (
                      <option key={b.name}>{b.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="mt-3 text-[12px] text-steel">
                Approving creates the account, sets pricing and emails the primary contact an
                invitation to set their password and sign in to the trade portal.
              </p>
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
