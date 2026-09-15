import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { customers, gbp0 } from "@/lib/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sales/customers/")({
  head: () => ({
    meta: [
      { title: "My Customers — Automotive Brands Sales Portal" },
      {
        name: "description",
        content:
          "Search and filter your trade accounts by status, value, activity and risk — with last order, YTD sales and next activity on every row.",
      },
      { property: "og:title", content: "My Customers — Automotive Brands" },
      { property: "og:description", content: "Your trade account list with filters and next actions." },
    ],
  }),
  component: CustomerList,
});

const filters = [
  "My Accounts",
  "Active",
  "Prospects",
  "No Recent Order",
  "High Value",
  "At Risk",
  "New Customers",
] as const;

function CustomerList() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>("My Accounts");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (q && !`${c.company} ${c.number} ${c.location}`.toLowerCase().includes(q)) return false;
      switch (active) {
        case "Active":
          return c.status === "Active";
        case "Prospects":
          return c.status === "Prospect";
        case "No Recent Order":
          return c.risk === "No recent order";
        case "High Value":
          return c.risk === "High value";
        case "At Risk":
          return c.risk === "At risk" || c.risk === "Falling spend";
        case "New Customers":
          return c.risk === "New customer";
        default:
          return c.manager === "James Whitfield";
      }
    });
  }, [query, active]);

  return (
    <div>
      <PanelHeader title="My Customers" sub={`${rows.length} accounts`} />

      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        <div className="flex h-9 min-w-52 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3">
          <Search className="size-4 shrink-0 text-steel" aria-hidden />
          <label className="sr-only" htmlFor="cust-search">
            Search customers
          </label>
          <input
            id="cust-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search company, account number or town"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-steel"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setActive(f)}
              aria-pressed={active === f}
              className={cn(
                "h-9 rounded-md border px-3 text-[12px] font-semibold",
                active === f
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-steel hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {rows.length === 0 ? (
          <div className="grid place-items-center rounded-lg border border-dashed border-border p-16 text-center">
            <p className="font-display text-lg uppercase">No accounts match</p>
            <p className="mt-1 text-sm text-steel">Try a different filter or clear your search.</p>
          </div>
        ) : (
          <>
            {/* desktop table */}
            <div className="hidden overflow-x-auto rounded-lg border border-border lg:block">
              <table className="w-full min-w-[980px] text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                    <th className="px-3 py-2 font-semibold">Company</th>
                    <th className="px-3 py-2 font-semibold">Account</th>
                    <th className="px-3 py-2 font-semibold">Location</th>
                    <th className="px-3 py-2 font-semibold">Account Manager</th>
                    <th className="px-3 py-2 font-semibold">Last Order</th>
                    <th className="px-3 py-2 text-right font-semibold">YTD Sales</th>
                    <th className="px-3 py-2 text-right font-semibold">Open Opps</th>
                    <th className="px-3 py-2 font-semibold">Next Activity</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c, i) => (
                    <tr
                      key={c.id}
                      className={cn(
                        "border-b border-border/60 hover:bg-secondary/60",
                        i % 2 === 1 && "bg-surface/30",
                      )}
                    >
                      <td className="px-3 py-2.5 font-medium">
                        <Link
                          to="/sales/customers/$id"
                          params={{ id: c.id }}
                          className="hover:text-primary"
                        >
                          {c.company}
                        </Link>
                      </td>
                      <td className="num px-3 py-2.5 text-steel">{c.number}</td>
                      <td className="px-3 py-2.5 text-steel">{c.location}</td>
                      <td className="px-3 py-2.5 text-steel">{c.manager}</td>
                      <td className="px-3 py-2.5 text-steel">{c.lastOrder}</td>
                      <td className="num px-3 py-2.5 text-right font-semibold">{gbp0(c.ytd)}</td>
                      <td className="num px-3 py-2.5 text-right">{c.openOpps}</td>
                      <td className="px-3 py-2.5 text-steel">{c.nextActivity}</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge tone={c.status === "Active" ? "good" : "info"}>
                          {c.status}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* mobile cards — built for reps on the road */}
            <ul className="grid gap-3 lg:hidden">
              {rows.map((c) => (
                <li key={c.id} className="rounded-lg border border-border bg-surface/50 p-4">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <Link
                        to="/sales/customers/$id"
                        params={{ id: c.id }}
                        className="block truncate font-display text-base font-semibold uppercase"
                      >
                        {c.company}
                      </Link>
                      <div className="num text-[11px] text-steel">
                        {c.number} · {c.location}
                      </div>
                    </div>
                    <StatusBadge tone={c.status === "Active" ? "good" : "info"}>
                      {c.status}
                    </StatusBadge>
                  </div>
                  <dl className="num mt-3 grid grid-cols-2 gap-2 text-[12px]">
                    <div>
                      <dt className="text-steel">YTD sales</dt>
                      <dd className="font-semibold">{gbp0(c.ytd)}</dd>
                    </div>
                    <div>
                      <dt className="text-steel">Last order</dt>
                      <dd className="font-semibold">{c.lastOrder}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      to="/sales/customers/$id"
                      params={{ id: c.id }}
                      className="h-9 rounded-md bg-primary px-3 text-[12px] font-bold leading-9 text-primary-foreground"
                    >
                      Open
                    </Link>
                    <button type="button" className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold">
                      Log visit
                    </button>
                    <button type="button" className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold">
                      Add note
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
