import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import { formatGbp } from "@/domain/sales-intelligence";
import {
  addCompanyToCustomerGroupFn,
  exportCustomerGroupSalesCsvFn,
  getCustomerGroupFn,
  getCustomerGroupSalesSummaryFn,
  listCustomerGroupDocumentsFn,
  listCustomerGroupProductLinesFn,
  listCompaniesFn,
  removeCompanyFromCustomerGroupFn,
  updateCustomerGroupFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/customers/groups/$groupId")({
  head: () => ({
    meta: [{ title: "Customer Group — Automotive Brands Admin" }],
  }),
  component: CustomerGroupWorkspace,
});

type GroupDetail = Extract<Awaited<ReturnType<typeof getCustomerGroupFn>>, { ok: true }>["data"];
type SalesSummary = Extract<
  Awaited<ReturnType<typeof getCustomerGroupSalesSummaryFn>>,
  { ok: true }
>["data"];

function CustomerGroupWorkspace() {
  const { groupId } = Route.useParams();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [sales, setSales] = useState<SalesSummary | null>(null);
  const [period, setPeriod] = useState("LAST_30");
  const [error, setError] = useState<string | null>(null);
  const [drillCompanyId, setDrillCompanyId] = useState<string | null>(null);
  const [drillMam, setDrillMam] = useState<string | null>(null);
  const [docs, setDocs] = useState<
    Extract<Awaited<ReturnType<typeof listCustomerGroupDocumentsFn>>, { ok: true }>["data"] | null
  >(null);
  const [lines, setLines] = useState<
    Extract<Awaited<ReturnType<typeof listCustomerGroupProductLinesFn>>, { ok: true }>["data"] | null
  >(null);
  const [docsPage, setDocsPage] = useState(1);
  const [linesPage, setLinesPage] = useState(1);
  const [addQ, setAddQ] = useState("");
  const [addHits, setAddHits] = useState<Array<{ id: string; name: string }>>([]);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const load = useCallback(async () => {
    const [g, s] = await Promise.all([
      getCustomerGroupFn({ data: { groupId } }),
      getCustomerGroupSalesSummaryFn({
        data: {
          groupId,
          period,
          companyId: drillCompanyId,
          mamAccount: drillMam,
        },
      }),
    ]);
    if (!g.ok) {
      setError(g.error);
      setGroup(null);
      return;
    }
    setGroup(g.data);
    setEditName(g.data.name);
    setEditDesc(g.data.description ?? "");
    if (s.ok) setSales(s.data);
    else setError(s.error);

    const d = await listCustomerGroupDocumentsFn({
      data: {
        groupId,
        period,
        companyId: drillCompanyId,
        mamAccount: drillMam,
        page: docsPage,
        pageSize: 25,
      },
    });
    if (d.ok) setDocs(d.data);
    const l = await listCustomerGroupProductLinesFn({
      data: {
        groupId,
        period,
        companyId: drillCompanyId,
        mamAccount: drillMam,
        page: linesPage,
        pageSize: 40,
      },
    });
    if (l.ok) setLines(l.data);
  }, [groupId, period, drillCompanyId, drillMam, docsPage, linesPage]);

  useEffect(() => {
    setDocsPage(1);
    setLinesPage(1);
  }, [period, drillCompanyId, drillMam]);

  useEffect(() => {
    void load();
  }, [load]);

  async function searchAdd(q: string) {
    setAddQ(q);
    if (q.trim().length < 2) {
      setAddHits([]);
      return;
    }
    const res = await listCompaniesFn({ data: { q, page: 1, pageSize: 10 } });
    if (res.ok) setAddHits(res.data.items.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
  }

  if (!group && error) {
    return <p className="p-6 text-bad">{error}</p>;
  }
  if (!group) return <p className="p-6 text-steel">Loading…</p>;

  return (
    <div>
      <PanelHeader
        title={group.name}
        sub={group.description ?? "Customer Group workspace"}
        crumbs={[
          { label: "Sales" },
          { label: "Customers", to: ROUTES.adminCustomers },
          { label: "Customer Groups", to: ROUTES.adminCustomerGroups },
          { label: group.name },
        ]}
        actions={
          <button
            type="button"
            className="h-10 rounded-md border border-border px-3 text-[11px] font-semibold uppercase"
            onClick={() => {
              void exportCustomerGroupSalesCsvFn({
                data: { groupId, period, companyId: drillCompanyId, mamAccount: drillMam },
              }).then((r) => {
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                const blob = new Blob([r.data.csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = r.data.filename;
                a.click();
                URL.revokeObjectURL(url);
              });
            }}
          >
            Export CSV
          </button>
        }
      />

      <div className="space-y-6 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Period">
            <select className={inputClass} value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="LAST_7">7D</option>
              <option value="LAST_30">30D</option>
              <option value="LAST_90">90D</option>
              <option value="LAST_365">12M</option>
              <option value="ALL">ALL</option>
            </select>
          </Field>
          {drillCompanyId || drillMam ? (
            <button
              type="button"
              className="h-10 rounded-md border border-border px-3 text-[11px] font-semibold uppercase"
              onClick={() => {
                setDrillCompanyId(null);
                setDrillMam(null);
              }}
            >
              Clear drill-down
            </button>
          ) : null}
          <StatusBadge tone={group.active ? "good" : "neutral"}>
            {group.active ? "Active" : "Inactive"}
          </StatusBadge>
        </div>

        {sales ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Net Sales", formatGbp(sales.summary.netSales)],
              ["Invoice Sales", formatGbp(sales.summary.invoiceSales)],
              ["Credits", formatGbp(sales.summary.credits)],
              ["Units", String(sales.summary.units)],
              ["Documents", String(sales.summary.documents)],
              ["Products", String(sales.summary.productsPurchased)],
              ["Companies", String(sales.group.companyCount)],
              ["MAM accounts", String(sales.group.mamAccountCount)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-border px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-steel">
                  {label}
                </div>
                <div className="mt-1 font-display text-xl font-semibold">{value}</div>
              </div>
            ))}
          </div>
        ) : null}

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold uppercase">By Company</h2>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full text-left text-[12px]">
              <thead className="border-b border-border bg-surface/60 text-[10px] uppercase text-steel">
                <tr>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Salesperson</th>
                  <th className="px-3 py-2">Net Sales</th>
                  <th className="px-3 py-2">Docs</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sales?.byCompany.map((c) => (
                  <tr key={c.companyId} className="border-b border-border/60">
                    <td className="px-3 py-2">
                      <Link
                        to="/admin/customers/$id"
                        params={{ id: c.companyId }}
                        className="font-semibold text-cyan underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-steel">{c.salesperson ?? "—"}</td>
                    <td className="num px-3 py-2">{formatGbp(c.netSales)}</td>
                    <td className="num px-3 py-2">{c.documents}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-[10px] font-semibold uppercase text-cyan underline"
                        onClick={() => {
                          setDrillCompanyId(c.companyId);
                          setDrillMam(null);
                        }}
                      >
                        Drill
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold uppercase">By MAM Account</h2>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full text-left text-[12px]">
              <thead className="border-b border-border bg-surface/60 text-[10px] uppercase text-steel">
                <tr>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Net Sales</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sales?.byMamAccount.map((a) => (
                  <tr key={a.accountCode} className="border-b border-border/60">
                    <td className="px-3 py-2 font-semibold">
                      {a.accountCode}
                      {a.label ? <span className="ml-2 text-steel">({a.label})</span> : null}
                    </td>
                    <td className="px-3 py-2 text-steel">{a.companyName ?? "—"}</td>
                    <td className="num px-3 py-2">{formatGbp(a.netSales)}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-[10px] font-semibold uppercase text-cyan underline"
                        onClick={() => {
                          setDrillCompanyId(a.companyId);
                          setDrillMam(a.accountCode);
                        }}
                      >
                        Drill
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold uppercase">Documents</h2>
          <p className="text-[11px] text-steel">
            Page {docs?.page ?? 1} · {docs?.total?.toLocaleString() ?? 0} documents (paginated)
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full text-left text-[12px]">
              <thead className="border-b border-border bg-surface/60 text-[10px] uppercase text-steel">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Document</th>
                  <th className="px-3 py-2">MAM</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {docs?.items.map((d) => (
                  <tr
                    key={`${d.companyId}-${d.documentReference}-${d.documentType}`}
                    className="border-b border-border/60"
                  >
                    <td className="px-3 py-2 text-steel">{d.documentDate ?? "—"}</td>
                    <td className="px-3 py-2">
                      {d.documentType} {d.documentReference}
                    </td>
                    <td className="px-3 py-2">{d.mamAccount}</td>
                    <td className="px-3 py-2 text-steel">{d.companyName}</td>
                    <td className="num px-3 py-2">{formatGbp(d.netSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {docs && docs.total > docs.pageSize ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={docsPage <= 1}
                className="h-8 rounded-md border border-border px-3 text-[10px] font-semibold uppercase disabled:opacity-40"
                onClick={() => setDocsPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={docsPage * docs.pageSize >= docs.total}
                className="h-8 rounded-md border border-border px-3 text-[10px] font-semibold uppercase disabled:opacity-40"
                onClick={() => setDocsPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold uppercase">Product lines</h2>
          <p className="text-[11px] text-steel">
            Includes NOT_IN_AB_CATALOGUE / retail-only SKUs using source SKU and description.
            Page {lines?.page ?? 1} · {lines?.total?.toLocaleString() ?? 0} lines (paginated)
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full text-left text-[12px]">
              <thead className="border-b border-border bg-surface/60 text-[10px] uppercase text-steel">
                <tr>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">MAM</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {lines?.items.map((l, i) => (
                  <tr key={`${l.sku}-${l.documentReference}-${i}`} className="border-b border-border/60">
                    <td className="px-3 py-2 font-semibold">{l.sku}</td>
                    <td className="px-3 py-2 text-steel">{l.description ?? "—"}</td>
                    <td className="px-3 py-2">{l.mamAccount}</td>
                    <td className="num px-3 py-2">{l.units}</td>
                    <td className="num px-3 py-2">{formatGbp(l.netSales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {lines && lines.total > lines.pageSize ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={linesPage <= 1}
                className="h-8 rounded-md border border-border px-3 text-[10px] font-semibold uppercase disabled:opacity-40"
                onClick={() => setLinesPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                disabled={linesPage * lines.pageSize >= lines.total}
                className="h-8 rounded-md border border-border px-3 text-[10px] font-semibold uppercase disabled:opacity-40"
                onClick={() => setLinesPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </section>

        <section className="space-y-3 rounded-md border border-border p-4">
          <h2 className="font-display text-base font-semibold uppercase">Manage membership</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rename group">
              <input className={inputClass} value={editName} onChange={(e) => setEditName(e.target.value)} />
            </Field>
            <Field label="Description">
              <input className={inputClass} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-9 rounded-md bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground"
              onClick={() => {
                void updateCustomerGroupFn({
                  data: {
                    id: groupId,
                    name: editName,
                    description: editDesc || null,
                  },
                }).then(async (r) => {
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success("Group updated");
                    await load();
                  }
                });
              }}
            >
              Save group
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase"
              onClick={() => {
                void updateCustomerGroupFn({
                  data: { id: groupId, active: !group.active },
                }).then(async (r) => {
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success(group.active ? "Group deactivated" : "Group activated");
                    await load();
                  }
                });
              }}
            >
              {group.active ? "Deactivate" : "Activate"}
            </button>
          </div>

          <Field label="Add company">
            <input
              className={cn(inputClass, "max-w-md")}
              value={addQ}
              placeholder="Search company…"
              onChange={(e) => void searchAdd(e.target.value)}
            />
          </Field>
          <ul className="space-y-1">
            {addHits.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span>{h.name}</span>
                <button
                  type="button"
                  className="text-[10px] font-semibold uppercase text-cyan underline"
                  onClick={() => {
                    void addCompanyToCustomerGroupFn({
                      data: { groupId, companyId: h.id },
                    }).then(async (r) => {
                      if (!r.ok) toast.error(r.error);
                      else {
                        toast.success("Company added");
                        setAddQ("");
                        setAddHits([]);
                        await load();
                      }
                    });
                  }}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>

          <ul className="mt-3 space-y-2">
            {group.companies.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-[12px]"
              >
                <div>
                  <Link
                    to="/admin/customers/$id"
                    params={{ id: c.id }}
                    className="font-semibold text-cyan underline"
                  >
                    {c.name}
                  </Link>
                  <div className="text-steel">
                    {c.autopartCustomerCode ?? "No primary MAM"}
                    {c.aliases.length
                      ? ` · +${c.aliases.length} alias${c.aliases.length === 1 ? "" : "es"}`
                      : ""}
                    {c.salesperson ? ` · ${c.salesperson.name}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-[10px] font-semibold uppercase text-bad"
                  onClick={() => {
                    void removeCompanyFromCustomerGroupFn({
                      data: { companyId: c.id, groupId },
                    }).then(async (r) => {
                      if (!r.ok) toast.error(r.error);
                      else {
                        toast.success("Removed from group");
                        await load();
                      }
                    });
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
