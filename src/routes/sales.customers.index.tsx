import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { COMPANY_STATUS_LABEL, type CompanyStatusKey } from "@/domain/company";
import { listCompaniesFn } from "@/server/phase2/fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sales/customers/")({
  head: () => ({
    meta: [
      { title: "My Customers — Automotive Brands Sales Portal" },
      {
        name: "description",
        content: "Trade accounts assigned to you — search, filter and open customer workspaces.",
      },
    ],
  }),
  component: CustomerList,
});

function CustomerList() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState<
    Array<{
      id: string;
      name: string;
      accountNumber: string | null;
      status: CompanyStatusKey;
      salesperson: { name: string } | null;
      primaryEmail: string | null;
    }>
  >([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const r = await listCompaniesFn({
      data: { q: query || undefined, status: status || undefined, page: 1, pageSize: 50 },
    });
    if (r.ok) {
      setItems(r.data.items as typeof items);
      setTotal(r.data.total);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <div>
      <PanelHeader title="My Customers" sub={`${total} accounts in your scope`} />
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        <div className="flex h-9 min-w-52 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3">
          <Search className="size-4 text-steel" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load()}
            placeholder="Search company or account"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-9 rounded-md border border-border bg-surface px-3 text-[13px]"
        >
          <option value="">All statuses</option>
          {Object.entries(COMPANY_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load()}
          className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
        >
          Search
        </button>
      </div>
      <div className="p-4 sm:p-6">
        {loading ? (
          <p className="text-sm text-steel">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-steel">No customers in your assignment scope.</p>
        ) : (
          <ul className="grid gap-2">
            {items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() =>
                    void navigate({ to: "/sales/customers/$id", params: { id: c.id } })
                  }
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border border-border bg-surface/40 px-4 py-3 text-left hover:border-primary/40",
                  )}
                >
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="num text-[12px] text-steel">{c.accountNumber ?? "—"}</div>
                  </div>
                  <StatusBadge>{COMPANY_STATUS_LABEL[c.status]}</StatusBadge>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-[12px] text-steel">
          Full customer workspace opens in Admin chrome.{" "}
          <Link to="/admin/customers" className="text-primary hover:underline">
            Open customers admin
          </Link>
        </p>
      </div>
    </div>
  );
}
