import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Search } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import { COMPANY_STATUSES, COMPANY_STATUS_LABEL, type CompanyStatusKey } from "@/domain/company";
import { DEFAULT_TRADE_PRICE_HELP, DEFAULT_TRADE_PRICE_LABEL } from "@/domain/default-trade-price";
import {
  createCompanyFn,
  listCompaniesFn,
  listSalesRepsFn,
} from "@/server/phase2/fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/customers/")({
  head: () => ({
    meta: [
      { title: "Customers — Automotive Brands Admin" },
      { name: "description", content: "Trade customers and companies." },
    ],
  }),
  component: AdminCustomers,
});

type CompanyRow = {
  id: string;
  name: string;
  tradingName: string | null;
  accountNumber: string | null;
  status: CompanyStatusKey;
  primaryEmail: string | null;
  phone: string | null;
  salesperson: { name: string } | null;
  paymentTerms: string | null;
};

function AdminCustomers() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [salesRepId, setSalesRepId] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<CompanyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [reps, setReps] = useState<Array<{ id: string; label: string }>>([]);
  const [createOpen, setCreateOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    const result = await listCompaniesFn({
      data: {
        q: q || undefined,
        status: status || undefined,
        salesRepId: salesRepId || undefined,
        page,
        pageSize: 25,
      },
    });
    if (!result.ok) {
      setError(result.error);
      setItems([]);
    } else {
      setItems(result.data.items as CompanyRow[]);
      setTotal(result.data.total);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, salesRepId]);

  useEffect(() => {
    void listSalesRepsFn().then((r) => {
      if (r.ok) setReps(r.data);
    });
  }, []);

  return (
    <div>
      <PanelHeader
        title="Customers"
        sub={`${total} companies`}
        crumbs={[{ label: "Sales" }, { label: "Customers", to: ROUTES.adminCustomers }]}
        actions={
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-bold uppercase tracking-wide text-primary-foreground"
          >
            <Plus className="size-4" aria-hidden />
            Create customer
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3 sm:px-6">
        <div className="flex h-9 min-w-52 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3">
          <Search className="size-4 text-steel" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setPage(1);
                void load();
              }
            }}
            placeholder="Search name, account, email, VAT…"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-border bg-surface px-3 text-[13px]"
        >
          <option value="">All statuses</option>
          {COMPANY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {COMPANY_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          value={salesRepId}
          onChange={(e) => {
            setSalesRepId(e.target.value);
            setPage(1);
          }}
          className="h-9 rounded-md border border-border bg-surface px-3 text-[13px]"
        >
          <option value="">All salespeople</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            setPage(1);
            void load();
          }}
          className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
        >
          Search
        </button>
      </div>

      <div className="p-4 sm:p-6">
        {error ? (
          <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>
        ) : null}
        {loading ? (
          <div className="text-sm text-steel">Loading customers…</div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-6 py-16 text-center">
            <p className="font-display text-xl uppercase">No customers yet</p>
            <p className="mt-2 text-sm text-steel">Create a customer or approve a trade application.</p>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="mt-6 h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase text-primary-foreground"
            >
              Create customer
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="border-b border-border bg-surface/60 text-[11px] uppercase tracking-wider text-steel">
                <tr>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Salesperson</th>
                  <th className="px-4 py-3">Contact</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 hover:bg-surface/40">
                    <td className="px-4 py-3">
                      <Link
                        to="/admin/customers/$id"
                        params={{ id: c.id }}
                        className="font-semibold text-foreground hover:text-primary"
                      >
                        {c.name}
                      </Link>
                      {c.tradingName ? (
                        <div className="text-[12px] text-steel">t/a {c.tradingName}</div>
                      ) : null}
                    </td>
                    <td className="num px-4 py-3 text-steel">{c.accountNumber ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        tone={
                          c.status === "ACTIVE"
                            ? "good"
                            : c.status === "SUSPENDED" || c.status === "ON_HOLD"
                              ? "warn"
                              : c.status === "CLOSED"
                                ? "bad"
                                : "brand"
                        }
                      >
                        {COMPANY_STATUS_LABEL[c.status]}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-steel">{c.salesperson?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-steel">
                      <div>{c.primaryEmail ?? "—"}</div>
                      <div className="text-[12px]">{c.phone}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 25 ? (
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-9 rounded-md border border-border px-3 text-[12px] disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-[12px] text-steel">
              Page {page} of {Math.ceil(total / 25)}
            </span>
            <button
              type="button"
              disabled={page * 25 >= total}
              onClick={() => setPage((p) => p + 1)}
              className="h-9 rounded-md border border-border px-3 text-[12px] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        ) : null}
      </div>

      <CreateCustomerDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        reps={reps}
        onCreated={(id) => {
          setCreateOpen(false);
          void navigate({ to: "/admin/customers/$id", params: { id } });
        }}
      />
    </div>
  );
}

function CreateCustomerDrawer({
  open,
  onClose,
  reps,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  reps: Array<{ id: string; label: string }>;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [tradingName, setTradingName] = useState("");
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [salesRepId, setSalesRepId] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  return (
    <Drawer open title="Create customer" onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            setSaving(true);
            const result = await createCompanyFn({
              data: {
                name,
                tradingName: tradingName || null,
                primaryEmail: primaryEmail || null,
                phone: phone || null,
                salesRepId: salesRepId || null,
                status: "PROSPECT",
              },
            });
            setSaving(false);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Customer created");
            onCreated(result.data.id);
          })();
        }}
      >
        <Field label="Legal / company name">
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Trading name">
          <input value={tradingName} onChange={(e) => setTradingName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Primary email">
          <input
            type="email"
            value={primaryEmail}
            onChange={(e) => setPrimaryEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Assigned salesperson">
          <select
            value={salesRepId}
            onChange={(e) => setSalesRepId(e.target.value)}
            className={cn(inputClass)}
          >
            <option value="">Unassigned</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="rounded-md border border-border/80 px-3 py-2.5 text-[12px] text-steel">
          <span className="font-semibold text-foreground">{DEFAULT_TRADE_PRICE_LABEL}</span>
          {" — "}
          {DEFAULT_TRADE_PRICE_HELP}
        </div>
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create customer"}
        </button>
      </form>
    </Drawer>
  );
}
