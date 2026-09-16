import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { COMPANY_STATUS_LABEL } from "@/domain/company";
import { getCompanyWorkspaceFn, listCompanyActivityFn } from "@/server/phase2/fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sales/customers/$id")({
  head: () => ({
    meta: [{ title: "Customer — Automotive Brands Sales" }],
  }),
  component: SalesCustomer,
});

const tabs = ["Overview", "Contacts", "Addresses", "Commercial", "Activity"] as const;

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
      creditLimit: number | null;
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
    permissions: { canViewCredit: boolean };
  }>(null);
  const [activity, setActivity] = useState<
    Array<{ id: string; title: string; body: string | null; at: string; actor: string | null }>
  >([]);
  const [error, setError] = useState<string | null>(null);

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
    if (tab !== "Activity") return;
    void listCompanyActivityFn({ data: { companyId: id } }).then((r) => {
      if (r.ok) setActivity(r.data);
    });
  }, [tab, id]);

  if (error) return <div className="p-6 text-sm text-bad">{error}</div>;
  if (!data) return <div className="p-6 text-sm text-steel">Loading…</div>;

  const { company, contacts, addresses, permissions } = data;

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
      <div className="p-4 sm:p-6 text-[13px]">
        {tab === "Overview" ? (
          <dl className="grid max-w-xl gap-3">
            <div>
              <dt className="text-steel">Trading name</dt>
              <dd>{company.tradingName ?? "—"}</dd>
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
              <dd>{company.salesperson?.name ?? "—"}</dd>
            </div>
            <Link to="/sales/customers" className="text-primary hover:underline">
              ← Back to customers
            </Link>
          </dl>
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
            <div>
              <dt className="text-steel">Credit limit</dt>
              <dd>
                {permissions.canViewCredit && company.creditLimit != null
                  ? `£${company.creditLimit.toLocaleString()}`
                  : permissions.canViewCredit
                    ? "—"
                    : "Restricted"}
              </dd>
            </div>
          </dl>
        ) : null}
        {tab === "Activity" ? (
          <ul className="grid gap-2">
            {activity.map((a) => (
              <li key={a.id} className="border border-border px-3 py-2">
                <div className="text-[12px] text-steel">
                  {a.actor} · {new Date(a.at).toLocaleString()}
                </div>
                <div className="font-semibold">{a.title}</div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
