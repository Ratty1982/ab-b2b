import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { LogActivityDrawer } from "@/components/crm/LogActivityDrawer";
import { COMPANY_STATUS_LABEL } from "@/domain/company";
import { activityTypeLabel, formatGbpExact, formatOpportunityValue } from "@/domain/crm";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { InstantText } from "@/components/ab/InstantText";
import {
  createCrmOpportunityFn,
  createCrmTaskFn,
  getCompanyCrmWorkspaceFn,
  getCompanyWorkspaceFn,
  listCompanyActivityFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/sales/customers/$id")({
  head: () => ({
    meta: [{ title: "Customer — Automotive Brands Sales" }],
  }),
  component: SalesCustomer,
});

const tabs = ["Overview", "CRM", "Contacts", "Addresses", "Commercial", "Activity"] as const;

function SalesCustomer() {
  const { id } = Route.useParams();
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const [data, setData] = useState<null | {
    company: {
      id: string;
      name: string;
      tradingName: string | null;
      accountNumber: string | null;
      status: keyof typeof COMPANY_STATUS_LABEL;
      primaryEmail: string | null;
      phone: string | null;
      paymentTerms: string | null;
      priceList: { name: string } | null;
      salesperson: { name: string } | null;
      taxStatus: string;
      autopartAccount?: { code: string | null };
    };
    contacts: Array<{
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      isPrimary: boolean;
    }>;
    addresses: Array<{
      id: string;
      label: string | null;
      line1: string;
      town: string;
      postcode: string;
      isDefaultBilling: boolean;
      isDefaultDelivery: boolean;
    }>;
  }>(null);
  const [crm, setCrm] = useState<Extract<
    Awaited<ReturnType<typeof getCompanyCrmWorkspaceFn>>,
    { ok: true }
  >["data"] | null>(null);
  const [activity, setActivity] = useState<
    Array<{ id: string; title: string; body: string | null; at: string; actor: string | null }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [logType, setLogType] = useState<"CALL" | "EMAIL" | "MEETING" | "NOTE" | null>(null);

  useEffect(() => {
    void getCompanyWorkspaceFn({ data: { id } }).then((r) => {
      if (!r.ok) {
        setError(r.error);
        if (r.code === "NOT_FOUND") throw notFound();
        return;
      }
      setData(r.data as typeof data);
    });
  }, [id]);

  useEffect(() => {
    if (tab !== "CRM" && tab !== "Overview") return;
    void getCompanyCrmWorkspaceFn({ data: { companyId: id } }).then((r) => {
      if (r.ok) setCrm(r.data);
    });
  }, [tab, id]);

  useEffect(() => {
    if (tab !== "Activity") return;
    void listCompanyActivityFn({ data: { companyId: id } }).then((r) => {
      if (r.ok) setActivity(r.data);
    });
  }, [tab, id]);

  if (error) return <div className="p-6 text-sm text-bad">{error}</div>;
  if (!data) return <div className="p-6 text-sm text-steel">Loading…</div>;

  const { company, contacts, addresses } = data;

  return (
    <div>
      <PanelHeader
        title={company.name}
        {...(company.accountNumber ? { sub: company.accountNumber } : {})}
        actions={
          <StatusBadge>{COMPANY_STATUS_LABEL[company.status]}</StatusBadge>
        }
      />
      <div className="flex gap-1 overflow-x-auto border-b border-border/70 px-4 sm:px-6">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "shrink-0 border-b-2 px-3 py-3 text-[13px] font-semibold",
              tab === t ? "border-primary text-foreground" : "border-transparent text-steel",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="p-4 text-[13px] sm:p-6">
        {tab === "Overview" ? (
          <div className="space-y-6">
            <dl className="grid max-w-xl gap-3">
              <div>
                <dt className="text-steel">Trading name</dt>
                <dd>{company.tradingName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-steel">Autopart account</dt>
                <dd className="font-mono">
                  {crm?.company.autopartCustomerCode ??
                    company.autopartAccount?.code ??
                    "—"}
                </dd>
              </div>
              <div>
                <dt className="text-steel">Email</dt>
                <dd>{company.primaryEmail ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-steel">Phone</dt>
                <dd>{company.phone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-steel">Salesperson</dt>
                <dd>{crm?.salesRep?.name ?? company.salesperson?.name ?? "—"}</dd>
              </div>
            </dl>
            {crm ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Snap label="Historic net sales" value={formatGbpExact(crm.snapshot.historicNetSales)} />
                <Snap label="Last purchased" value={crm.snapshot.lastPurchased ?? "—"} />
                <Snap label="Open opportunities" value={String(crm.snapshot.openOpportunities)} />
                <Snap label="Open tasks" value={String(crm.snapshot.openTasks)} />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <QuickBtn label="Log call" onClick={() => setLogType("CALL")} />
              <QuickBtn label="Log email" onClick={() => setLogType("EMAIL")} />
              <QuickBtn label="Create opportunity" onClick={() => {
                void createCrmOpportunityFn({
                  data: { companyId: id, title: `Opportunity — ${company.name}` },
                }).then(() => setTab("CRM"));
              }} />
              <Link
                to={ROUTES.salesIntelligence}
                search={{ mode: "customers", companyId: id }}
                className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-bold uppercase"
              >
                Sales Enquiry
              </Link>
            </div>
            <Link to="/sales/customers" className="text-primary hover:underline">
              ← Back to customers
            </Link>
          </div>
        ) : null}

        {tab === "CRM" ? (
          crm ? (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-2">
                <QuickBtn label="Log call" onClick={() => setLogType("CALL")} />
                <QuickBtn label="Log email" onClick={() => setLogType("EMAIL")} />
                <QuickBtn label="Log meeting" onClick={() => setLogType("MEETING")} />
                <QuickBtn label="Add note" onClick={() => setLogType("NOTE")} />
                <QuickBtn
                  label="Create task"
                  onClick={() => {
                    const due = new Date().toISOString().slice(0, 10);
                    void createCrmTaskFn({
                      data: {
                        companyId: id,
                        title: `Follow up — ${company.name}`,
                        dueDate: due,
                        taskType: "FOLLOW_UP",
                      },
                    });
                  }}
                />
                <Link
                  to={ROUTES.salesQuotesNew}
                  search={{ companyId: id }}
                  className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-bold uppercase"
                >
                  Create quote
                </Link>
                <Link
                  to={ROUTES.salesIntelligence}
                  search={{ mode: "customers", companyId: id }}
                  className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground"
                >
                  View Sales Intelligence
                </Link>
                <Link
                  to={ROUTES.salesIntelligenceGaps}
                  search={{ mode: "customers", companyId: id }}
                  className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-bold uppercase"
                >
                  Gap Analysis
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Snap label="Historic net sales" value={formatGbpExact(crm.snapshot.historicNetSales)} />
                <Snap label="Last purchased" value={crm.snapshot.lastPurchased ?? "—"} />
                <Snap label="Open quotes" value={String(crm.snapshot.openQuotes)} />
                <Snap label="Open opportunities" value={String(crm.snapshot.openOpportunities)} />
                <Snap label="Open tasks" value={String(crm.snapshot.openTasks)} />
                <Snap
                  label="Assigned sales rep"
                  value={crm.salesRep?.name ?? "Unassigned"}
                />
              </div>

              <div>
                <h2 className="mb-2 font-display text-base font-semibold uppercase">Timeline</h2>
                {crm.timeline.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-4 py-8 text-steel">
                    No activity recorded. Calls, meetings, notes and follow-ups will appear here.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {crm.timeline.map((a) => (
                      <li key={a.id} className="rounded-md border border-border px-3 py-2">
                        <div className="flex justify-between text-[11px] text-steel">
                          <span>
                            {activityTypeLabel(a.type)} · {a.actor ?? "System"}
                          </span>
                          <InstantText value={a.at} variant="audit" />
                        </div>
                        <p className="font-semibold">{a.title}</p>
                        {a.body ? <p className="text-steel">{a.body}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {crm.snapshot.recentOrders.length ? (
                <div>
                  <h2 className="mb-2 font-display text-base font-semibold uppercase">
                    Recent orders
                  </h2>
                  <ul className="space-y-1">
                    {crm.snapshot.recentOrders.map((o) => (
                      <li key={o.id} className="flex justify-between border-b border-border/50 py-1">
                        <span className="font-mono">{o.orderNumber}</span>
                        <span className="tabular-nums text-steel">
                          {o.status} · {formatOpportunityValue(o.grandTotal)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-steel">Loading CRM workspace…</p>
          )
        ) : null}

        {tab === "Contacts" ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {contacts.map((c) => (
              <li key={c.id} className="border border-border p-3">
                {c.firstName} {c.lastName}
                <div className="text-steel">{c.email}</div>
              </li>
            ))}
          </ul>
        ) : null}
        {tab === "Addresses" ? (
          <ul className="grid gap-2">
            {addresses.map((a) => (
              <li key={a.id} className="border border-border p-3">
                <div className="font-semibold">{a.label ?? "Address"}</div>
                {a.line1}, {a.town} {a.postcode}
              </li>
            ))}
          </ul>
        ) : null}
        {tab === "Commercial" ? (
          <dl className="grid max-w-xl gap-3">
            <div>
              <dt className="text-steel">Price list</dt>
              <dd>{company.priceList?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-steel">Payment terms</dt>
              <dd>{company.paymentTerms ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-steel">Tax status</dt>
              <dd>{company.taxStatus}</dd>
            </div>
          </dl>
        ) : null}
        {tab === "Activity" ? (
          activity.length === 0 ? (
            <p className="text-steel">No activity yet</p>
          ) : (
            <ul className="grid gap-2">
              {activity.map((a) => (
                <li key={a.id} className="border border-border px-3 py-2">
                  <div className="text-[12px] text-steel">
                    {a.actor} · <InstantText value={a.at} variant="audit" />
                  </div>
                  <div className="font-semibold">{a.title}</div>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <LogActivityDrawer
        open={Boolean(logType)}
        onClose={() => setLogType(null)}
        companyId={id}
        defaultType={logType ?? "CALL"}
        onLogged={() => {
          void getCompanyCrmWorkspaceFn({ data: { companyId: id } }).then((r) => {
            if (r.ok) setCrm(r.data);
          });
        }}
      />
    </div>
  );
}

function Snap({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-steel">{label}</p>
      <p className="mt-1 font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function QuickBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-9 rounded-md border border-border px-3 text-[12px] font-bold uppercase"
    >
      {label}
    </button>
  );
}
