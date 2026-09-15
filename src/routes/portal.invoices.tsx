import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { PanelHeader, Metric } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { gbp, gbp0 } from "@/lib/data";
import { invoices } from "@/lib/crm-data";

export const Route = createFileRoute("/portal/invoices")({
  head: () => ({
    meta: [
      { title: "Invoices & Statements — Automotive Brands Trade Portal" },
      {
        name: "description",
        content: "Outstanding balance, invoice history and statements for your trade account.",
      },
      { property: "og:title", content: "Invoices & Statements — Automotive Brands" },
      { property: "og:description", content: "Invoice history and account statements." },
    ],
  }),
  component: PortalInvoices,
});

function PortalInvoices() {
  const outstanding = invoices.filter((i) => i.status !== "Paid").reduce((s, i) => s + i.value, 0);
  const overdue = invoices.filter((i) => i.status === "Overdue").reduce((s, i) => s + i.value, 0);

  return (
    <div>
      <PanelHeader
        title="Invoices & statements"
        sub="Account ABC001 · 30 Days Net"
        actions={
          <button
            type="button"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-[13px] font-semibold transition-colors hover:border-steel"
          >
            <Download className="size-4" aria-hidden /> Download statement
          </button>
        }
      />
      <div className="grid gap-px bg-border sm:grid-cols-3">
        <Metric label="Outstanding balance" value={gbp0(outstanding)} tone="warn" hint="Across 3 invoices" />
        <Metric label="Overdue" value={gbp0(overdue)} tone="bad" hint="1 invoice past due date" />
        <Metric label="Paid last 90 days" value={gbp0(2210)} tone="good" hint="1 invoice settled" />
      </div>
      <div className="p-4 sm:p-6">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">Invoice</th>
                <th className="px-3 py-2 font-semibold">Order</th>
                <th className="px-3 py-2 font-semibold">Invoice date</th>
                <th className="px-3 py-2 font-semibold">Due date</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Value</th>
                <th className="px-3 py-2 text-right font-semibold">PDF</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr
                  key={inv.id}
                  className={`border-b border-border/60 hover:bg-secondary/60 ${i % 2 ? "bg-surface/30" : ""}`}
                >
                  <td className="num px-3 py-2 font-medium text-primary">{inv.id}</td>
                  <td className="num px-3 py-2 text-steel">{inv.order}</td>
                  <td className="px-3 py-2 text-steel">{inv.date}</td>
                  <td className="px-3 py-2 text-steel">{inv.due}</td>
                  <td className="px-3 py-2">
                    <StatusBadge
                      tone={inv.status === "Overdue" ? "bad" : inv.status === "Paid" ? "good" : "warn"}
                    >
                      {inv.status}
                    </StatusBadge>
                  </td>
                  <td className="num px-3 py-2 text-right font-semibold">{gbp(inv.value)}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" aria-label={`Download ${inv.id}`} className="text-steel hover:text-primary">
                      <Download className="size-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
