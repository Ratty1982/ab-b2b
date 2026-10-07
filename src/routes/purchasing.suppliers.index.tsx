import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import { StatusBadge } from "@/components/ab/Badges";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  btnClass,
  controlClass,
  gbp,
  primaryBtnClass,
  qty,
} from "@/components/purchasing/workspace";
import { ROUTES } from "@/lib/app-nav";
import { createPurchasingSupplierFn, listPurchasingSuppliersFn } from "@/server/phase2/fns";

type Search = { q?: string | undefined; status?: "active" | "inactive" | "all" | undefined };

export const Route = createFileRoute("/purchasing/suppliers/")({
  validateSearch: (raw: Record<string, unknown>): Search => {
    const out: Search = {};
    const q = raw["q"];
    const status = raw["status"];
    if (typeof q === "string" && q.trim()) out.q = q.trim();
    if (status === "inactive" || status === "all" || status === "active") out.status = status;
    return out;
  },
  head: () => ({
    meta: [{ title: "Suppliers — Purchasing — Automotive Brands" }],
  }),
  component: SuppliersPage,
});

type Data = Extract<Awaited<ReturnType<typeof listPurchasingSuppliersFn>>, { ok: true }>["data"];

function SuppliersPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [openForm, setOpenForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listPurchasingSuppliersFn({
      data: { q: search.q ?? null, status: search.status ?? "active" },
    }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setData(null);
        return;
      }
      setError(null);
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [search.q, search.status]);

  async function createSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setCreating(true);
    const result = await createPurchasingSupplierFn({
      data: {
        name: String(form.get("name") ?? ""),
        code: String(form.get("code") ?? ""),
        accountNumber: String(form.get("accountNumber") ?? ""),
        defaultLeadTimeDays: String(form.get("defaultLeadTimeDays") ?? ""),
        defaultMinimumOrderValue: String(form.get("defaultMinimumOrderValue") ?? ""),
        currency: String(form.get("currency") ?? "GBP"),
      },
    });
    setCreating(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpenForm(false);
    void navigate({ to: "/purchasing/suppliers/$id", params: { id: result.data.id } });
  }

  return (
    <>
      <PanelHeader
        title="Suppliers"
        sub="Supplier master for purchasing intelligence. Purchase orders are still created in Autopart."
        crumbs={[{ label: "Purchasing", to: ROUTES.purchasing }, { label: "Suppliers" }]}
        actions={
          data?.canManage ? (
            <button type="button" className={primaryBtnClass} onClick={() => setOpenForm((v) => !v)}>
              {openForm ? "Close" : "Create supplier"}
            </button>
          ) : null
        }
      />
      {error ? <ErrorState message={error} /> : null}
      <form
        className="flex flex-wrap gap-2 border-b border-border/70 px-4 py-3 sm:px-6"
        onSubmit={(event) => {
          event.preventDefault();
          const q = String(new FormData(event.currentTarget).get("q") ?? "").trim();
          void navigate({
            search: (prev) => {
              const next = { ...prev };
              if (q) next.q = q;
              else delete next.q;
              return next;
            },
          });
        }}
      >
        <input name="q" defaultValue={search.q ?? ""} placeholder="Search name, code or account" className={controlClass} />
        <select
          className={controlClass}
          value={search.status ?? "active"}
          onChange={(e) =>
            void navigate({
              search: (prev) => {
                const next = { ...prev };
                if (e.target.value === "active") delete next.status;
                else next.status = e.target.value as Search["status"];
                return next;
              },
            })
          }
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">Active and inactive</option>
        </select>
        <button type="submit" className={btnClass}>
          Search
        </button>
        <Link to={ROUTES.purchasingPlanner} search={{ supplierId: "unassigned" }} className={btnClass}>
          Unassigned products
        </Link>
      </form>
      {openForm && data?.canManage ? (
        <form onSubmit={(e) => void createSupplier(e)} className="grid gap-3 border-b border-border/70 px-4 py-4 sm:grid-cols-3 sm:px-6">
          <Field label="Name" htmlFor="supplier-name">
            <input id="supplier-name" name="name" required className={inputClass} />
          </Field>
          <Field label="Code" htmlFor="supplier-code">
            <input id="supplier-code" name="code" className={inputClass} />
          </Field>
          <Field label="Account number" htmlFor="supplier-account">
            <input id="supplier-account" name="accountNumber" className={inputClass} />
          </Field>
          <Field label="Default lead time (days)" htmlFor="supplier-lead">
            <input id="supplier-lead" name="defaultLeadTimeDays" inputMode="numeric" className={inputClass} />
          </Field>
          <Field label="Minimum order value" htmlFor="supplier-mov">
            <input id="supplier-mov" name="defaultMinimumOrderValue" inputMode="decimal" className={inputClass} />
          </Field>
          <Field label="Currency" htmlFor="supplier-currency">
            <input id="supplier-currency" name="currency" defaultValue="GBP" maxLength={3} className={inputClass} />
          </Field>
          <div className="sm:col-span-3">
            <button type="submit" className={primaryBtnClass} disabled={creating}>
              {creating ? "Saving…" : "Save supplier"}
            </button>
          </div>
        </form>
      ) : null}
      {!data && !error ? <LoadingState label="Loading suppliers…" /> : null}
      {data && data.suppliers.length === 0 ? (
        <div className="px-4 py-6 sm:px-6">
          <EmptyState
            title="No suppliers"
            body="Suppliers are not inferred from brand or SKU. Create one when you know who you buy from."
          />
        </div>
      ) : null}
      {data && data.unassigned.productsRequiringAction > 0 ? (
        <p className="px-4 py-3 text-[13px] text-steel sm:px-6">
          {qty(data.unassigned.productsRequiringAction)} products need purchasing attention and have no supplier.{" "}
          {data.unassigned.backordersAtRisk > 0
            ? `${qty(data.unassigned.backordersAtRisk)} of the unassigned catalogue have backorders at risk.`
            : null}
        </p>
      ) : null}
      {data && data.suppliers.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-[13px]">
            <thead className="border-b border-border text-[10px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-4 py-2">Supplier</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2 text-right">Products</th>
                <th className="px-3 py-2 text-right">Preferred</th>
                <th className="px-3 py-2 text-right">To consider</th>
                <th className="px-3 py-2 text-right">Backorders at risk</th>
                <th className="px-3 py-2 text-right">Suggested value</th>
                <th className="px-3 py-2 text-right">Minimum order</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.suppliers.map((supplier) => (
                <tr key={supplier.id} className="border-b border-border/60">
                  <td className="px-4 py-2">
                    <Link to="/purchasing/suppliers/$id" params={{ id: supplier.id }} className="font-medium hover:text-primary">
                      {supplier.name}
                    </Link>
                    <span className="mt-0.5 block text-[11px] text-steel">
                      Autopart Groups: {supplier.autopartGroups.length ? supplier.autopartGroups.join(", ") : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px]">{supplier.code ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(supplier.productCount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(supplier.preferredCount)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(supplier.planning.productsToConsider)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(supplier.planning.backordersAtRisk)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {gbp(supplier.planning.knownValue)}
                    {supplier.planning.missingCostLines > 0 ? (
                      <span className="mt-0.5 block text-[11px] text-steel">
                        {supplier.planning.missingCostLines} missing cost
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{gbp(supplier.planning.minimumOrderValue)}</td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={supplier.active ? "good" : "neutral"}>{supplier.active ? "Active" : "Inactive"}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
