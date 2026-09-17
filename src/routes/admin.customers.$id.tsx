import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { COMPANY_STATUSES, COMPANY_STATUS_LABEL, TAX_STATUSES } from "@/domain/company";
import { ROUTES } from "@/lib/app-nav";
import {
  createAddressFn,
  createContactFn,
  getCompanyWorkspaceFn,
  inviteCompanyUserFn,
  listCompanyActivityFn,
  listPriceListsFn,
  listSalesRepsFn,
  updateCompanyFn,
} from "@/server/phase2/fns";
import { cn } from "@/lib/utils";
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
  const [inviteToken, setInviteToken] = useState<string | null>(null);

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
                <Row label="Price list" value={company.priceList?.name} />
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
              </dl>
              <p className="mt-4 text-[12px] text-steel">
                Created {new Date(company.createdAt).toLocaleString()} · Updated{" "}
                {new Date(company.updatedAt).toLocaleString()}
              </p>
            </section>
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
                user: { name: string | null; email: string; lastLoginAt: string | null };
              }) => (
                <li key={u.id} className="border border-border bg-surface/40 p-4">
                  <div className="font-semibold">{u.user.name ?? u.user.email}</div>
                  <div className="text-[12px] text-steel">{u.user.email}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
                    <StatusBadge>{u.role}</StatusBadge>
                    <StatusBadge tone={u.status === "ACTIVE" ? "good" : "warn"}>{u.status}</StatusBadge>
                    <span className="text-steel">
                      Last login {u.user.lastLoginAt ? new Date(u.user.lastLoginAt).toLocaleString() : "—"}
                    </span>
                  </div>
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
                  }) => (
                    <li key={inv.id} className="border border-border px-4 py-3 text-[13px]">
                      {inv.email} · {inv.role} · {inv.status}
                      {inv.emailDeferred ? (
                        <span className="ml-2 text-steel">(email deferred)</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {inviteToken ? (
                <p className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px]">
                  Invite token (copy now — not emailed): <code className="break-all">{inviteToken}</code>
                </p>
              ) : null}
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
                    <time>{new Date(a.at).toLocaleString()}</time>
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
          onSaved={async (token) => {
            setInviteOpen(false);
            setInviteToken(token);
            await reload();
          }}
        />
      ) : null}
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
          <option value="">None</option>
          {priceLists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
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
  onSaved: (token: string) => Promise<void>;
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
              toast.success("Invitation created (email deferred)");
              await onSaved(r.data.inviteToken);
            }
          })();
        }}
      >
        <p className="text-[12px] text-steel">
          Email delivery is not configured. An invite token will be shown for admin use.
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
          Create invitation
        </button>
      </form>
    </Drawer>
  );
}
