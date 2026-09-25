import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import { CommercialAuditList } from "@/components/pricing/CommercialAuditList";
import { ValidityBadge } from "@/components/pricing/ValidityBadge";
import { COMPANY_STATUSES, COMPANY_STATUS_LABEL, TAX_STATUSES } from "@/domain/company";
import {
  companyPriceListLabel,
  DEFAULT_TRADE_PRICE_HELP,
  DEFAULT_TRADE_PRICE_LABEL,
} from "@/domain/default-trade-price";
import { ROUTES } from "@/lib/app-nav";
import {
  createAddressFn,
  createContactFn,
  clearCompanyAutopartCustomerCodeFn,
  deleteCompanyFn,
  deleteCustomerPriceFn,
  getCompanyWorkspaceFn,
  inviteCompanyUserFn,
  listCompanyActivityFn,
  listCustomerPricesFn,
  listPriceListsFn,
  listSalesRepsFn,
  searchPricingVariantsFn,
  setCompanyAutopartCustomerCodeFn,
  updateCompanyFn,
  upsertCustomerPriceFn,
  verifyCompanyAutopartCustomerCodeFn,
} from "@/server/phase2/fns";
import { cn } from "@/lib/utils";
import { InstantText } from "@/components/ab/InstantText";
import { formatDate, formatOrDash } from "@/lib/datetime";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/customers/$id")({
  head: () => ({
    meta: [{ title: "Customer — Automotive Brands Admin" }],
  }),
  component: CustomerWorkspace,
});

const tabs = [
  "Overview",
  "Contacts",
  "Users",
  "Addresses",
  "Commercial",
  "Activity",
  "Documents",
  "Orders",
  "Quotes",
  "Invoices",
] as const;

function CustomerWorkspace() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Workspace payload from getCompanyWorkspaceFn
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);
  const [activity, setActivity] = useState<
    Array<{ id: string; title: string; body: string | null; at: string; actor: string | null }>
  >([]);
  const [reps, setReps] = useState<Array<{ id: string; label: string }>>([]);
  const [priceLists, setPriceLists] = useState<
    Array<{ id: string; code: string; name: string }>
  >([]);
  const [contactOpen, setContactOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function reload() {
    setLoading(true);
    const result = await getCompanyWorkspaceFn({ data: { id } });
    if (!result.ok) {
      setError(result.error);
      setData(null);
    } else {
      setData(result.data);
      setError(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void reload();
    void listSalesRepsFn().then((r) => r.ok && setReps(r.data));
    void listPriceListsFn().then((r) => r.ok && setPriceLists(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (tab !== "Activity") return;
    void listCompanyActivityFn({ data: { companyId: id } }).then((r) => {
      if (r.ok) setActivity(r.data);
    });
  }, [tab, id]);

  if (loading && !data) {
    return <div className="p-6 text-sm text-steel">Loading customer…</div>;
  }
  if (error && !data) {
    return <div className="p-6 text-sm text-bad">{error}</div>;
  }
  if (!data) return null;

  const { company, permissions, contacts, addresses, users, invitations } = data;

  return (
    <div>
      <PanelHeader
        title={company.name}
        sub={[company.accountNumber, company.tradingName ? `t/a ${company.tradingName}` : null]
          .filter(Boolean)
          .join(" · ")}
        crumbs={[
          { label: "Sales" },
          { label: "Customers", to: ROUTES.adminCustomers },
          { label: company.name },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {permissions.canDelete ? (
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteOpen(true)}
                className="h-9 border border-bad bg-transparent px-3 text-[12px] font-semibold text-bad hover:bg-bad/10 disabled:opacity-60"
                data-customer-action="delete"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            ) : null}
            <StatusBadge
              tone={
                company.status === "ACTIVE"
                  ? "good"
                  : company.status === "SUSPENDED" || company.status === "ON_HOLD"
                    ? "warn"
                    : "brand"
              }
            >
              {COMPANY_STATUS_LABEL[company.status as keyof typeof COMPANY_STATUS_LABEL]}
            </StatusBadge>
          </div>
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

      <div className="p-4 sm:p-6">
        {tab === "Overview" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="border border-border bg-surface/40 p-5">
              <h2 className="font-display text-lg uppercase">Company details</h2>
              <dl className="mt-4 grid gap-3 text-[13px]">
                <Row label="Legal name" value={company.name} />
                <Row label="Trading name" value={company.tradingName} />
                <Row label="Company no." value={company.companyNumber} />
                <Row label="VAT" value={company.vatNumber} />
                <Row label="Website" value={company.website} />
                <Row label="Phone" value={company.phone} />
                <Row label="Primary email" value={company.primaryEmail} />
                <Row label="External ref" value={company.externalRef} />
              </dl>
              {permissions.canEdit ? (
                <OverviewEditor
                  company={company}
                  onSave={async (patch) => {
                    const r = await updateCompanyFn({ data: { id: company.id, ...patch } });
                    if (!r.ok) toast.error(r.error);
                    else {
                      toast.success("Saved");
                      await reload();
                    }
                  }}
                />
              ) : null}
            </section>
            <section className="border border-border bg-surface/40 p-5">
              <h2 className="font-display text-lg uppercase">Commercial snapshot</h2>
              <dl className="mt-4 grid gap-3 text-[13px]">
                <Row label="Salesperson" value={company.salesperson?.name} />
                <Row
                  label="Price list"
                  value={companyPriceListLabel(company.priceList?.name)}
                />
                <Row label="Payment terms" value={company.paymentTerms} />
                <Row
                  label="Credit limit"
                  value={
                    permissions.canViewCredit && company.creditLimit != null
                      ? `£${company.creditLimit.toLocaleString()}`
                      : permissions.canViewCredit
                        ? "—"
                        : "Restricted"
                  }
                />
                <Row label="Tax status" value={company.taxStatus} />
                <Row
                  label="Autopart account"
                  value={
                    company.autopartAccount?.code
                      ? `${company.autopartAccount.code}${company.autopartAccount.verified ? " (verified)" : " (unverified)"}`
                      : null
                  }
                />
              </dl>
              <p className="mt-4 text-[12px] text-steel">
                Created <InstantText value={company.createdAt} variant="audit" /> · Updated{" "}
                <InstantText value={company.updatedAt} variant="audit" />
              </p>
            </section>
            {permissions.canDelete ? (
              <section className="border border-bad/40 bg-surface/40 p-5 lg:col-span-2">
                <h2 className="font-display text-lg uppercase text-bad">Delete customer</h2>
                <p className="mt-2 max-w-2xl text-[13px] text-steel">
                  Permanently removes this customer and related contacts, addresses, portal
                  memberships, invites, baskets, and negotiated prices. Customers with orders,
                  quotes, or invoices cannot be deleted — set status to Closed instead.
                </p>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteOpen(true)}
                  className="mt-4 border border-bad bg-transparent px-4 py-2 text-[13px] font-semibold text-bad hover:bg-bad/10 disabled:opacity-60"
                >
                  {deleting ? "Deleting…" : "Delete customer"}
                </button>
              </section>
            ) : null}
          </div>
        ) : null}

        {tab === "Contacts" ? (
          <WorkspaceList
            title="Contacts"
            empty="No contacts yet"
            actionLabel="Add contact"
            onAction={() => setContactOpen(true)}
          >
            {contacts.map((c: {
              id: string;
              firstName: string;
              lastName: string;
              jobTitle: string | null;
              email: string | null;
              isPrimary: boolean;
              isPurchasing: boolean;
              isAccounts: boolean;
            }) => (
              <li key={c.id} className="border border-border bg-surface/40 p-4">
                <div className="font-semibold">
                  {c.firstName} {c.lastName}
                </div>
                <div className="text-[12px] text-steel">{c.jobTitle}</div>
                <div className="mt-2 text-[13px]">{c.email}</div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {c.isPrimary ? <StatusBadge tone="brand">Primary</StatusBadge> : null}
                  {c.isPurchasing ? <StatusBadge>Purchasing</StatusBadge> : null}
                  {c.isAccounts ? <StatusBadge>Accounts</StatusBadge> : null}
                </div>
              </li>
            ))}
          </WorkspaceList>
        ) : null}

        {tab === "Users" ? (
          <div className="grid gap-6">
            <WorkspaceList
              title="Portal users"
              empty="No portal users"
              {...(permissions.canManageUsers
                ? { actionLabel: "Invite user", onAction: () => setInviteOpen(true) }
                : {})}
            >
              {users.map((u: {
                id: string;
                role: string;
                status: string;
                user: {
                  name: string | null;
                  email: string;
                  status?: string;
                  lastLoginAt: string | null;
                };
              }) => (
                <li key={u.id} className="border border-border bg-surface/40 p-4">
                  <div className="font-semibold">{u.user.name ?? u.user.email}</div>
                  <div className="text-[12px] text-steel">{u.user.email}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
                    <StatusBadge>{u.role}</StatusBadge>
                    <StatusBadge tone={u.status === "ACTIVE" ? "good" : "warn"}>{u.status}</StatusBadge>
                    <span className="text-steel">
                      Last login <InstantText value={u.user.lastLoginAt} variant="audit" />
                    </span>
                  </div>
                  {u.status === "INVITED" || u.user.status === "INVITED" ? (
                    <button
                      type="button"
                      className="mt-3 h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase hover:border-steel"
                      onClick={() => {
                        void (async () => {
                          const r = await inviteCompanyUserFn({
                            data: { companyId: id, email: u.user.email, role: u.role },
                          });
                          if (!r.ok) toast.error(r.error);
                          else {
                            toast.success(
                              r.data.emailSent
                                ? "Invitation resent"
                                : r.data.emailDeferred
                                  ? "Invitation deferred — enable email delivery to send"
                                  : "Invitation created but email failed",
                            );
                            await reload();
                          }
                        })();
                      }}
                    >
                      Resend invitation
                    </button>
                  ) : null}
                </li>
              ))}
            </WorkspaceList>
            <section>
              <h3 className="font-display text-base uppercase">Invitations</h3>
              {invitations.length === 0 ? (
                <p className="mt-2 text-sm text-steel">No pending invitations</p>
              ) : (
                <ul className="mt-3 grid gap-2">
                  {invitations.map((inv: {
                    id: string;
                    email: string;
                    role: string;
                    status: string;
                    emailDeferred: boolean;
                    createdAt?: string;
                  }) => (
                    <li key={inv.id} className="border border-border px-4 py-3 text-[13px]">
                      <div>
                        {inv.email} · {inv.role} · {inv.status}
                      </div>
                      <div className="mt-1 text-[12px] text-steel">
                        {inv.emailDeferred
                          ? "Email deferred (delivery disabled or not yet sent)"
                          : "Invitation sent"}
                        {inv.createdAt ? (
                          <>
                            {" · "}
                            <InstantText value={inv.createdAt} variant="audit" />
                          </>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        {tab === "Addresses" ? (
          <WorkspaceList
            title="Addresses"
            empty="No addresses"
            {...(permissions.canEdit
              ? { actionLabel: "Add address", onAction: () => setAddressOpen(true) }
              : {})}
          >
            {addresses.map((a: {
              id: string;
              label: string | null;
              type: string;
              line1: string;
              line2: string | null;
              town: string;
              county: string | null;
              postcode: string;
              isDefaultBilling: boolean;
              isDefaultDelivery: boolean;
            }) => (
              <li key={a.id} className="border border-border bg-surface/40 p-4 text-[13px]">
                <div className="font-semibold">{a.label ?? a.type}</div>
                <div className="mt-1 text-steel">
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ""}
                  <br />
                  {a.town}
                  {a.county ? `, ${a.county}` : ""} {a.postcode}
                </div>
                <div className="mt-2 flex gap-1.5">
                  {a.isDefaultBilling ? <StatusBadge tone="brand">Default billing</StatusBadge> : null}
                  {a.isDefaultDelivery ? <StatusBadge tone="good">Default delivery</StatusBadge> : null}
                </div>
              </li>
            ))}
          </WorkspaceList>
        ) : null}

        {tab === "Commercial" ? (
          <div className="grid gap-10">
          <CommercialEditor
            company={company}
            permissions={permissions}
            reps={reps}
            priceLists={priceLists}
            onSave={async (patch) => {
              const r = await updateCompanyFn({ data: { id: company.id, ...patch } });
              if (!r.ok) toast.error(r.error);
              else {
                toast.success("Commercial settings saved");
                await reload();
              }
            }}
          />
          <AutopartAccountEditor
            companyId={company.id}
            canEdit={permissions.canEdit}
            account={company.autopartAccount ?? { code: null, verified: false, verifiedAt: null, verifiedBy: null }}
            onChanged={reload}
          />
          <CustomerPricesEditor
            companyId={company.id}
            canEdit={permissions.canEditPricing}
            assignedPriceListName={company.priceList ? `${company.priceList.code} — ${company.priceList.name}` : null}
          />
          <CommercialAuditList companyId={company.id} />
          </div>
        ) : null}

        {tab === "Activity" ? (
          <ul className="grid gap-2">
            {activity.length === 0 ? (
              <li className="text-sm text-steel">No activity yet</li>
            ) : (
              activity.map((a) => (
                <li key={a.id} className="border border-border px-4 py-3">
                  <div className="flex justify-between gap-3 text-[12px] text-steel">
                    <span>{a.actor ?? "System"}</span>
                    <time dateTime={a.at}><InstantText value={a.at} variant="audit" /></time>
                  </div>
                  <div className="mt-1 font-semibold text-[13px]">{a.title}</div>
                  {a.body ? <p className="mt-1 text-[13px] text-steel">{a.body}</p> : null}
                </li>
              ))
            )}
          </ul>
        ) : null}

        {tab === "Documents" || tab === "Orders" || tab === "Quotes" || tab === "Invoices" ? (
          <div className="rounded-md border border-dashed border-border px-6 py-12 text-center text-sm text-steel">
            {tab} will be available in a later phase.
            {tab === "Documents" ? (
              <div className="mt-2">
                <Link to={ROUTES.adminApplications} className="text-primary hover:underline">
                  Related trade applications
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {contactOpen ? (
        <ContactDrawer
          companyId={company.id}
          onClose={() => setContactOpen(false)}
          onSaved={async () => {
            setContactOpen(false);
            await reload();
          }}
        />
      ) : null}
      {addressOpen ? (
        <AddressDrawer
          companyId={company.id}
          onClose={() => setAddressOpen(false)}
          onSaved={async () => {
            setAddressOpen(false);
            await reload();
          }}
        />
      ) : null}
      {inviteOpen ? (
        <InviteDrawer
          companyId={company.id}
          onClose={() => setInviteOpen(false)}
          onSaved={async () => {
            setInviteOpen(false);
            await reload();
          }}
        />
      ) : null}
      <ConfirmAction
        open={deleteOpen}
        title="Delete this customer?"
        description={`Permanently delete ${company.name}? Contacts, addresses, portal memberships, invites, baskets, and negotiated prices will be removed. This cannot be undone.`}
        confirmLabel="Delete customer"
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          void (async () => {
            setDeleting(true);
            const r = await deleteCompanyFn({ data: { id: company.id } });
            setDeleting(false);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            toast.success("Customer deleted");
            await navigate({ to: ROUTES.adminCustomers });
          })();
        }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-2">
      <dt className="text-steel">{label}</dt>
      <dd className="min-w-0 break-words">{value || "—"}</dd>
    </div>
  );
}

function WorkspaceList({
  title,
  empty,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  empty: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  const hasItems = items.filter(Boolean).length > 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg uppercase">{title}</h2>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="h-9 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
      {!hasItems ? (
        <p className="mt-6 text-sm text-steel">{empty}</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">{children}</ul>
      )}
    </div>
  );
}

function OverviewEditor({
  company,
  onSave,
}: {
  company: {
    name: string;
    tradingName: string | null;
    companyNumber: string | null;
    vatNumber: string | null;
    website: string | null;
    phone: string | null;
    primaryEmail: string | null;
    notes: string | null;
    status: string;
  };
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(company);
  if (!open) {
    return (
      <button
        type="button"
        className="mt-4 text-[12px] font-semibold text-primary"
        onClick={() => {
          setForm(company);
          setOpen(true);
        }}
      >
        Edit details
      </button>
    );
  }
  return (
    <form
      className="mt-4 grid gap-3 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(form).then(() => setOpen(false));
      }}
    >
      <Field label="Status">
        <select
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
          className={inputClass}
        >
          {COMPANY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {COMPANY_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </Field>
      {(
        [
          ["name", "Legal name"],
          ["tradingName", "Trading name"],
          ["companyNumber", "Company number"],
          ["vatNumber", "VAT number"],
          ["website", "Website"],
          ["phone", "Phone"],
          ["primaryEmail", "Primary email"],
        ] as const
      ).map(([key, label]) => (
        <Field key={key} label={label}>
          <input
            value={String((form as Record<string, unknown>)[key] ?? "")}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            className={inputClass}
          />
        </Field>
      ))}
      <Field label="Notes">
        <textarea
          value={form.notes ?? ""}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className={inputClass}
          rows={3}
        />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground">
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-md border border-border px-4 text-[12px]">
          Cancel
        </button>
      </div>
    </form>
  );
}

function CommercialEditor({
  company,
  permissions,
  reps,
  priceLists,
  onSave,
}: {
  company: {
    paymentTerms: string | null;
    creditLimit: number | null;
    taxStatus: string;
    priceListId: string | null;
    salesperson: { salesRepId: string } | null;
  };
  permissions: { canEdit: boolean; canEditCredit: boolean; canEditPricing: boolean };
  reps: Array<{ id: string; label: string }>;
  priceLists: Array<{ id: string; code: string; name: string }>;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [paymentTerms, setPaymentTerms] = useState(company.paymentTerms ?? "");
  const [creditLimit, setCreditLimit] = useState(
    company.creditLimit != null ? String(company.creditLimit) : "",
  );
  const [taxStatus, setTaxStatus] = useState(company.taxStatus);
  const [priceListId, setPriceListId] = useState(company.priceListId ?? "");
  const [salesRepId, setSalesRepId] = useState(company.salesperson?.salesRepId ?? "");

  return (
    <form
      className="max-w-xl grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!permissions.canEdit) return;
        void onSave({
          paymentTerms: paymentTerms || null,
          taxStatus,
          priceListId: permissions.canEditPricing ? priceListId || null : undefined,
          salesRepId: salesRepId || null,
          creditLimit:
            permissions.canEditCredit && creditLimit !== ""
              ? Number(creditLimit)
              : permissions.canEditCredit && creditLimit === ""
                ? null
                : undefined,
        });
      }}
    >
      <Field label="Assigned salesperson">
        <select value={salesRepId} onChange={(e) => setSalesRepId(e.target.value)} className={inputClass} disabled={!permissions.canEdit}>
          <option value="">Unassigned</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Price list">
        <select
          value={priceListId}
          onChange={(e) => setPriceListId(e.target.value)}
          className={inputClass}
          disabled={!permissions.canEditPricing}
        >
          <option value="">{DEFAULT_TRADE_PRICE_LABEL}</option>
          {priceLists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[12px] text-steel">{DEFAULT_TRADE_PRICE_HELP}</p>
      </Field>
      <Field label="Payment terms">
        <input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className={inputClass} disabled={!permissions.canEdit} />
      </Field>
      <Field label="Tax / VAT status">
        <select value={taxStatus} onChange={(e) => setTaxStatus(e.target.value)} className={inputClass} disabled={!permissions.canEdit}>
          {TAX_STATUSES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Credit limit">
        <input
          type="number"
          min={0}
          step="0.01"
          value={creditLimit}
          onChange={(e) => setCreditLimit(e.target.value)}
          className={inputClass}
          disabled={!permissions.canEditCredit}
          placeholder={permissions.canEditCredit ? "0.00" : "Restricted"}
        />
      </Field>
      {permissions.canEdit ? (
        <button type="submit" className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">
          Save commercial settings
        </button>
      ) : null}
    </form>
  );
}

function AutopartAccountEditor({
  companyId,
  canEdit,
  account,
  onChanged,
}: {
  companyId: string;
  canEdit: boolean;
  account: {
    code: string | null;
    verified: boolean;
    verifiedAt: string | null;
    verifiedBy: { id: string; name: string; email: string } | null;
  };
  onChanged: () => Promise<void>;
}) {
  const [code, setCode] = useState(account.code ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCode(account.code ?? "");
  }, [account.code]);

  return (
    <section className="max-w-xl space-y-4 rounded-lg border border-border bg-surface/30 p-4 sm:p-5">
      <div>
        <h3 className="font-display text-lg font-semibold uppercase">Autopart account</h3>
        <p className="mt-1 text-[13px] text-steel">
          Verified Autopart customer/account code for future order handoff. This is an ERP
          reference only — never a login or automatic account link from registration claims.
        </p>
      </div>
      <Field label="Account code">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className={inputClass}
          disabled={!canEdit || saving}
          placeholder="e.g. ABC001"
          autoComplete="off"
        />
      </Field>
      <dl className="grid gap-2 text-[13px]">
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
          <dt className="text-steel">Status</dt>
          <dd>{account.verified ? "Verified" : account.code ? "Unverified" : "Not linked"}</dd>
        </div>
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
          <dt className="text-steel">Verified</dt>
          <dd>
            {account.verifiedAt ? (
              <InstantText value={account.verifiedAt} variant="audit" />
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
          <dt className="text-steel">Verified by</dt>
          <dd>{account.verifiedBy?.name ?? "—"}</dd>
        </div>
      </dl>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
            onClick={() => {
              setSaving(true);
              void setCompanyAutopartCustomerCodeFn({
                data: { companyId, code: code.trim() ? code : null },
              }).then(async (r) => {
                setSaving(false);
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success(
                    r.data.code
                      ? "Autopart account code saved (unverified until you verify)"
                      : "Autopart account cleared",
                  );
                  await onChanged();
                }
              });
            }}
          >
            Save code
          </button>
          <button
            type="button"
            disabled={saving || !account.code}
            className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold disabled:opacity-50"
            onClick={() => {
              setSaving(true);
              void verifyCompanyAutopartCustomerCodeFn({ data: { companyId } }).then(async (r) => {
                setSaving(false);
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success("Autopart account verified");
                  await onChanged();
                }
              });
            }}
          >
            Verify
          </button>
          <button
            type="button"
            disabled={saving || !account.code}
            className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold text-bad disabled:opacity-50"
            onClick={() => {
              setSaving(true);
              void clearCompanyAutopartCustomerCodeFn({ data: { companyId } }).then(async (r) => {
                setSaving(false);
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success("Autopart account cleared");
                  setCode("");
                  await onChanged();
                }
              });
            }}
          >
            Clear
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ContactDrawer({
  companyId,
  onClose,
  onSaved,
}: {
  companyId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isAccounts, setIsAccounts] = useState(false);

  return (
    <Drawer open title="Add contact" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            const r = await createContactFn({
              data: {
                companyId,
                firstName,
                lastName,
                email: email || null,
                jobTitle: jobTitle || null,
                isPrimary,
                isPurchasing,
                isAccounts,
              },
            });
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Contact added");
              await onSaved();
            }
          })();
        }}
      >
        <Field label="First name">
          <input required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Last name">
          <input required value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Job title">
          <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} className={inputClass} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
          Primary contact
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={isPurchasing} onChange={(e) => setIsPurchasing(e.target.checked)} />
          Purchasing
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={isAccounts} onChange={(e) => setIsAccounts(e.target.checked)} />
          Accounts
        </label>
        <button type="submit" className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">
          Save contact
        </button>
      </form>
    </Drawer>
  );
}

function AddressDrawer({
  companyId,
  onClose,
  onSaved,
}: {
  companyId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [line1, setLine1] = useState("");
  const [town, setTown] = useState("");
  const [postcode, setPostcode] = useState("");
  const [type, setType] = useState("DELIVERY");
  const [isDefaultBilling, setIsDefaultBilling] = useState(false);
  const [isDefaultDelivery, setIsDefaultDelivery] = useState(false);

  return (
    <Drawer open title="Add address" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            const r = await createAddressFn({
              data: {
                companyId,
                type,
                label: label || null,
                line1,
                town,
                postcode,
                isDefaultBilling,
                isDefaultDelivery,
              },
            });
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Address added");
              await onSaved();
            }
          })();
        }}
      >
        <Field label="Label">
          <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} placeholder="Head Office" />
        </Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
            <option value="REGISTERED">Registered</option>
            <option value="BILLING">Billing</option>
            <option value="DELIVERY">Delivery</option>
            <option value="TRADING">Trading</option>
          </select>
        </Field>
        <Field label="Line 1">
          <input required value={line1} onChange={(e) => setLine1(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Town">
          <input required value={town} onChange={(e) => setTown(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Postcode">
          <input required value={postcode} onChange={(e) => setPostcode(e.target.value)} className={inputClass} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={isDefaultBilling} onChange={(e) => setIsDefaultBilling(e.target.checked)} />
          Default billing
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={isDefaultDelivery} onChange={(e) => setIsDefaultDelivery(e.target.checked)} />
          Default delivery
        </label>
        <button type="submit" className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">
          Save address
        </button>
      </form>
    </Drawer>
  );
}

function InviteDrawer({
  companyId,
  onClose,
  onSaved,
}: {
  companyId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("TRADE_BUYER");

  return (
    <Drawer open title="Invite portal user" onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            const r = await inviteCompanyUserFn({
              data: { companyId, email, role },
            });
            if (!r.ok) toast.error(r.error);
            else {
              toast.success(
                r.data.emailSent
                  ? "Invitation sent"
                  : r.data.emailDeferred
                    ? "Invitation created — email deferred (delivery disabled)"
                    : "Invitation created — email failed; use Resend invitation",
              );
              await onSaved();
            }
          })();
        }}
      >
        <p className="text-[12px] text-steel">
          Sends a branded activation email via Admin → Settings → Email. The activation link is
          never shown in this workspace.
        </p>
        <Field label="Email">
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Company role">
          <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
            <option value="TRADE_ADMIN">Trade admin</option>
            <option value="TRADE_BUYER">Buyer</option>
            <option value="TRADE_ACCOUNTS">Accounts</option>
            <option value="TRADE_READ_ONLY">Read only</option>
          </select>
        </Field>
        <button type="submit" className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">
          Send invitation
        </button>
      </form>
    </Drawer>
  );
}

function CustomerPricesEditor({
  companyId,
  canEdit,
  assignedPriceListName,
}: {
  companyId: string;
  canEdit: boolean;
  assignedPriceListName: string | null;
}) {
  const [rows, setRows] = useState<Array<{
    id: string;
    sku: string;
    productName: string;
    brand: string;
    variantId: string;
    baseTradePriceDisplay: string | null;
    priceListPriceDisplay: string | null;
    normalPriceDisplay: string | null;
    unitPrice: number | null;
    unitPriceDisplay: string | null;
    startsAt: string | null;
    endsAt: string | null;
    status: string;
  }>>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; sku: string; name: string; brand: string }>>([]);
  const [selected, setSelected] = useState<{ id: string; sku: string; name: string } | null>(null);
  const [price, setPrice] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);

  async function reload() {
    const result = await listCustomerPricesFn({ data: { companyId } });
    if (result.ok) setRows(result.data.items);
  }
  useEffect(() => {
    void reload();
  }, [companyId]);

  return (
    <section>
      <h3 className="font-display text-lg font-semibold uppercase">Customer-specific prices</h3>
      <p className="mt-1 max-w-2xl text-[13px] text-steel">
        Assigned price list: {assignedPriceListName ?? DEFAULT_TRADE_PRICE_LABEL}.{" "}
        {rows.length} negotiated product price{rows.length === 1 ? "" : "s"}.
        Sales can override individual lines below. Promotions are catalogue-scoped, not
        company-specific.
      </p>
      {canEdit ? (
        <form
          className="mt-4 grid max-w-3xl gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const variantId = selected?.id ?? hits[0]?.id;
            if (!variantId) return;
            void upsertCustomerPriceFn({
              data: {
                id: editingId ?? undefined,
                companyId,
                variantId,
                unitPrice: Number(price),
                startsAt: startsAt ? new Date(startsAt).toISOString() : null,
                endsAt: endsAt ? new Date(endsAt).toISOString() : null,
              },
            }).then((r) => {
              if (!r.ok) toast.error(r.error);
              else {
                toast.success("Customer price saved");
                setQ("");
                setHits([]);
                setSelected(null);
                setPrice("");
                setStartsAt("");
                setEndsAt("");
                setEditingId(null);
                void reload();
              }
            });
          }}
        >
          <Field label="SKU / product / brand">
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setSelected(null);
                void searchPricingVariantsFn({ data: { q: e.target.value } }).then((r) => r.ok && setHits(r.data));
              }}
              className={inputClass}
              placeholder="GC5000 or Power Maxed"
            />
          </Field>
          <Field label="Customer price ex VAT">
            <input value={price} onChange={(e) => setPrice(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Valid from (optional)">
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Valid until (optional)">
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inputClass} />
          </Field>
          {hits.length ? (
            <ul className="sm:col-span-2 max-h-32 overflow-auto rounded-md border border-border text-[13px]">
              {hits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    className={cn("w-full px-3 py-1.5 text-left", selected?.id === hit.id && "bg-surface")}
                    onClick={() => {
                      setSelected(hit);
                      setQ(`${hit.sku} — ${hit.name}`);
                    }}
                  >
                    {hit.sku} — {hit.name} ({hit.brand})
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="submit" className="sm:col-span-2 h-10 rounded-md border border-border text-[12px] font-semibold">
            {editingId ? "Update customer price" : "Add customer price"} {selected ? `(${selected.sku})` : ""}
          </button>
        </form>
      ) : null}
      {rows.length === 0 ? (
        <p className="mt-4 text-[13px] text-steel">No customer-specific prices.{canEdit ? " Add a negotiated product price above." : ""}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2 text-right">Normal price</th>
                <th className="px-3 py-2 text-right">Customer price</th>
                <th className="px-3 py-2">Valid from</th>
                <th className="px-3 py-2">Valid until</th>
                <th className="px-3 py-2">Status</th>
                {canEdit ? <th className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                  <td className="num px-3 py-2 text-primary">{row.sku}</td>
                  <td className="px-3 py-2">{row.productName}</td>
                  <td className="num px-3 py-2 text-right">{row.normalPriceDisplay ?? "—"}</td>
                  <td className="num px-3 py-2 text-right">{row.unitPriceDisplay ?? "—"}</td>
                  <td className="num px-3 py-2">{formatOrDash(formatDate(row.startsAt))}</td>
                  <td className="num px-3 py-2">{formatOrDash(formatDate(row.endsAt))}</td>
                  <td className="px-3 py-2"><ValidityBadge status={row.status} /></td>
                  {canEdit ? (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="mr-3 text-[12px] font-semibold text-primary"
                        onClick={() => {
                          setEditingId(row.id);
                          setSelected({ id: row.variantId, sku: row.sku, name: row.productName });
                          setQ(`${row.sku} — ${row.productName}`);
                          setPrice(row.unitPrice != null ? String(row.unitPrice) : "");
                          setStartsAt(row.startsAt ? row.startsAt.slice(0, 16) : "");
                          setEndsAt(row.endsAt ? row.endsAt.slice(0, 16) : "");
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setRemoveId(row.id)}>
                        Remove
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmAction
        open={Boolean(removeId)}
        title="Remove customer-specific price?"
        description="This company will fall back to its assigned price list or base trade price for that product."
        confirmLabel="Remove"
        onOpenChange={(open) => {
          if (!open) setRemoveId(null);
        }}
        onConfirm={() => {
          if (!removeId) return;
          void deleteCustomerPriceFn({ data: { id: removeId } }).then((r) => {
            if (!r.ok) toast.error(r.error);
            else void reload();
          });
        }}
      />
    </section>
  );
}
