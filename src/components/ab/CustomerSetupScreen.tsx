import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import { AutopartHistoryImport } from "@/components/ab/autopart/AutopartHistoryImport";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { COMPANY_STATUS_LABEL, TAX_STATUSES, type CompanyStatusKey } from "@/domain/company";
import { BUSINESS_TYPES } from "@/domain/trade-application";
import { DEFAULT_TRADE_PRICE_HELP, DEFAULT_TRADE_PRICE_LABEL } from "@/domain/default-trade-price";
import {
  getCustomerSetupFn,
  saveCustomerCreationDetailsFn,
  saveCustomerSetupAndEnableOrderingFn,
  searchCustomerCreationDuplicatesFn,
} from "@/server/companies/customer-creation-fns";
import {
  linkAndVerifyCompanyAutopartCustomerCodeFn,
  listCustomerGroupsFn,
  listPriceListsFn,
  listSalesRepsFn,
  setCompanyAutopartCustomerCodeFn,
  setCompanyCustomerGroupFn,
} from "@/server/phase2/fns";

type SetupData = Extract<Awaited<ReturnType<typeof getCustomerSetupFn>>, { ok: true }>["data"];

type ContactDraft = {
  key: string;
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  isPrimary: boolean;
  isPurchasing: boolean;
  isAccounts: boolean;
  persisted: boolean;
};

type AddressDraft = {
  key: string;
  id?: string;
  type: "TRADING" | "DELIVERY" | "BILLING" | "REGISTERED";
  label: string;
  line1: string;
  line2: string;
  town: string;
  county: string;
  postcode: string;
  country: string;
  isDefaultBilling: boolean;
  isDefaultDelivery: boolean;
  contactName: string;
  contactPhone: string;
  persisted: boolean;
};

function buttonClass(primary = false) {
  return cn(
    "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-[13px] font-bold uppercase tracking-wide",
    primary
      ? "bg-primary text-primary-foreground disabled:opacity-50"
      : "border border-border disabled:opacity-50",
  );
}

function newKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function CustomerSetupScreen({
  companyId,
  onCompanyIdChange,
}: {
  companyId?: string | undefined;
  onCompanyIdChange: (companyId: string) => void;
}) {
  const [data, setData] = useState<SetupData | null>(null);
  const [loading, setLoading] = useState(Boolean(companyId));
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [tradingName, setTradingName] = useState("");
  const [phone, setPhone] = useState("");
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [creditReviewed, setCreditReviewed] = useState(false);
  const [priceListId, setPriceListId] = useState<string>("");
  const [salesRepId, setSalesRepId] = useState<string>("");
  const [taxStatus, setTaxStatus] = useState<(typeof TAX_STATUSES)[number]>("STANDARD");
  const [groupId, setGroupId] = useState<string>("");
  const [autopartCode, setAutopartCode] = useState("");
  const [confirmVerify, setConfirmVerify] = useState(false);
  const [contacts, setContacts] = useState<ContactDraft[]>([]);
  const [addresses, setAddresses] = useState<AddressDraft[]>([]);
  const [priceLists, setPriceLists] = useState<Array<{ id: string; name: string; code: string }>>(
    [],
  );
  const [salesReps, setSalesReps] = useState<Array<{ id: string; label: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [findQuery, setFindQuery] = useState("");
  const [duplicates, setDuplicates] = useState<
    Array<{ id: string; name: string; status: string; strength: string; reason: string }>
  >([]);

  async function reload(id = companyId) {
    if (!id) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await getCustomerSetupFn({ data: { companyId: id } });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setData(null);
      return;
    }
    setError(null);
    setData(result.data);
    hydrate(result.data);
    setDirty(false);
  }

  function hydrate(setup: SetupData) {
    setName(setup.company.name);
    setTradingName(setup.company.tradingName ?? "");
    setPhone(setup.company.phone ?? "");
    setPrimaryEmail(setup.company.primaryEmail ?? "");
    setCustomerType(setup.company.customerType ?? "");
    setNotes(setup.company.staffNotes ?? "");
    setPaymentTerms(setup.company.paymentTerms ?? "");
    setCreditLimit(setup.company.creditLimit ?? "");
    setCreditReviewed(Boolean(setup.company.creditLimitReviewedAt));
    setPriceListId(setup.company.priceList?.id ?? "");
    setSalesRepId(setup.company.salesperson?.salesRepId ?? "");
    setTaxStatus(
      (TAX_STATUSES as readonly string[]).includes(setup.company.taxStatus)
        ? (setup.company.taxStatus as (typeof TAX_STATUSES)[number])
        : "STANDARD",
    );
    setGroupId(setup.company.customerGroup?.id ?? "");
    setAutopartCode(setup.company.autopartAccount.code ?? "");
    setContacts(
      setup.contacts.map((contact) => ({
        key: contact.id,
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        jobTitle: contact.jobTitle ?? "",
        isPrimary: contact.isPrimary,
        isPurchasing: contact.isPurchasing,
        isAccounts: contact.isAccounts,
        persisted: true,
      })),
    );
    setAddresses(
      setup.addresses.map((address) => ({
        key: address.id,
        id: address.id,
        type: address.type,
        label: address.label ?? "",
        line1: address.line1,
        line2: address.line2 ?? "",
        town: address.town,
        county: address.county ?? "",
        postcode: address.postcode,
        country: address.country || "GB",
        isDefaultBilling: address.isDefaultBilling,
        isDefaultDelivery: address.isDefaultDelivery,
        contactName: address.contactName ?? "",
        contactPhone: address.contactPhone ?? "",
        persisted: true,
      })),
    );
  }

  useEffect(() => {
    void reload(companyId);
    // Intentionally reload only when the selected company changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    void (async () => {
      const [lists, reps, customerGroups] = await Promise.all([
        listPriceListsFn(),
        listSalesRepsFn(),
        listCustomerGroupsFn({ data: undefined }),
      ]);
      if (lists.ok) {
        setPriceLists(lists.data.map((row) => ({ id: row.id, name: row.name, code: row.code })));
      }
      if (reps.ok) {
        setSalesReps(
          reps.data.map((row) => ({
            id: row.id,
            label: row.label || row.code || row.id,
          })),
        );
      }
      if (customerGroups.ok) {
        setGroups(customerGroups.data.items.map((row) => ({ id: row.id, name: row.name })));
      }
    })();
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const readiness = data?.salesReadiness;
  const statusLabel = data
    ? (COMPANY_STATUS_LABEL[data.company.status as CompanyStatusKey] ?? data.company.status)
    : null;

  const progress = useMemo(() => {
    if (!readiness) return null;
    const total = readiness.requirements.length;
    const done = readiness.requirements.filter((item) => item.complete).length;
    return { total, done, pct: Math.round((done / total) * 100) };
  }, [readiness]);

  function markDirty() {
    setDirty(true);
  }

  async function searchCustomers() {
    const result = await searchCustomerCreationDuplicatesFn({
      data: { name: findQuery, email: findQuery.includes("@") ? findQuery : undefined },
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDuplicates(
      result.data.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        strength: row.strength,
        reason: row.reason,
      })),
    );
  }

  async function createProspect() {
    if (!name.trim()) {
      toast.error("Enter the customer name.");
      return;
    }
    setBusy(true);
    const result = await saveCustomerCreationDetailsFn({
      data: {
        name: name.trim(),
        tradingName: tradingName.trim() || null,
        phone: phone.trim() || null,
        primaryEmail: primaryEmail.trim() || null,
        customerType: customerType || null,
        notes: notes || null,
        status: "PROSPECT",
        taxStatus,
      },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Customer created. Continue setup on this page.");
    onCompanyIdChange(result.data.companyId);
  }

  async function saveCodeOnly() {
    if (!companyId) return;
    setBusy(true);
    const result = await setCompanyAutopartCustomerCodeFn({
      data: { companyId, code: autopartCode.trim() || null },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Sales code saved (not verified).");
    await reload(companyId);
  }

  async function verifyAutopart() {
    if (!companyId || !confirmVerify) return;
    setBusy(true);
    const result = await linkAndVerifyCompanyAutopartCustomerCodeFn({
      data: { companyId, code: autopartCode.trim() },
    });
    setBusy(false);
    setConfirmVerify(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Autopart verified. Prospect accounts activate automatically.");
    await reload(companyId);
  }

  async function saveAndEnable() {
    if (!companyId || !data) return;
    if (!creditReviewed) {
      toast.error("Confirm the credit limit review, including blank/unlimited if applicable.");
      return;
    }
    setBusy(true);
    if (groupId && data.permissions.canManageGroups) {
      await setCompanyCustomerGroupFn({ data: { companyId, customerGroupId: groupId || null } });
    }
    const result = await saveCustomerSetupAndEnableOrderingFn({
      data: {
        companyId,
        name: name.trim(),
        tradingName: tradingName.trim() || null,
        phone: phone.trim() || null,
        primaryEmail: primaryEmail.trim() || null,
        customerType: customerType || null,
        notes: notes || null,
        paymentTerms: paymentTerms.trim() || null,
        creditLimit: creditLimit.trim() === "" ? null : creditLimit.trim(),
        creditLimitReviewed: true,
        priceListId: priceListId || null,
        salesRepId: salesRepId || null,
        taxStatus,
        contacts: contacts.map((contact) => ({
          ...(contact.id ? { id: contact.id } : {}),
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email || null,
          phone: contact.phone || null,
          jobTitle: contact.jobTitle || null,
          isPrimary: contact.isPrimary,
          isPurchasing: contact.isPurchasing,
          isAccounts: contact.isAccounts,
        })),
        addresses: addresses.map((address) => ({
          ...(address.id ? { id: address.id } : {}),
          type: address.type,
          label: address.label || null,
          line1: address.line1,
          line2: address.line2 || null,
          town: address.town,
          county: address.county || null,
          postcode: address.postcode,
          country: address.country || "GB",
          isDefaultBilling: address.isDefaultBilling,
          isDefaultDelivery: address.isDefaultDelivery,
          contactName: address.contactName || null,
          contactPhone: address.contactPhone || null,
        })),
        enableOrdering: true,
        expectedUpdatedAt: data.company.updatedAt,
      },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      await reload(companyId);
      return;
    }
    setDirty(false);
    setData(result.data.setup);
    hydrate(result.data.setup);
    toast.success(
      result.data.salesReadiness.readyForSales ? "Saved. Customer is READY FOR SALES." : "Saved.",
    );
  }

  return (
    <div data-customer-setup-screen="">
      <PanelHeader
        title={data?.company.name ?? "Customer setup"}
        sub="One screen: verify Autopart, record sales history, contacts, addresses, and terms — then enable ordering."
        crumbs={[
          { label: "Sales" },
          { label: "Customers", to: ROUTES.adminCustomers },
          { label: "Setup" },
        ]}
        actions={
          companyId ? (
            <Link
              to="/admin/customers/$id"
              params={{ id: companyId }}
              className={buttonClass()}
              onClick={(event) => {
                if (dirty && !window.confirm("You have unsaved changes. Leave anyway?")) {
                  event.preventDefault();
                }
              }}
            >
              Open customer record
            </Link>
          ) : null
        }
      />

      <div className="grid gap-6 p-4 sm:p-6">
        {!companyId ? (
          <section className="grid gap-4 rounded-lg border border-border p-4" data-setup-find="">
            <h2 className="font-display text-lg uppercase">Find or create customer</h2>
            <div className="flex flex-wrap gap-2">
              <input
                className={cn(inputClass, "min-w-[16rem] flex-1")}
                value={findQuery}
                onChange={(event) => setFindQuery(event.target.value)}
                placeholder="Search by name or email"
              />
              <button
                type="button"
                className={buttonClass()}
                onClick={() => void searchCustomers()}
              >
                Search
              </button>
            </div>
            {duplicates.length > 0 ? (
              <ul className="grid gap-2">
                {duplicates.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-[13px]"
                  >
                    <span>
                      {row.name} · {row.status} · {row.strength}/{row.reason}
                    </span>
                    <button
                      type="button"
                      className={buttonClass(true)}
                      onClick={() => onCompanyIdChange(row.id)}
                    >
                      Open setup
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Customer name" htmlFor="setup-new-name">
                <input
                  id="setup-new-name"
                  className={inputClass}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field label="Trading name" htmlFor="setup-new-trading">
                <input
                  id="setup-new-trading"
                  className={inputClass}
                  value={tradingName}
                  onChange={(event) => setTradingName(event.target.value)}
                />
              </Field>
            </div>
            <button
              type="button"
              className={buttonClass(true)}
              disabled={busy}
              onClick={() => void createProspect()}
            >
              Create prospect and continue
            </button>
          </section>
        ) : null}

        {loading ? <p className="text-[13px] text-steel">Loading setup…</p> : null}
        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

        {data && companyId ? (
          <>
            <section
              className="rounded-lg border border-border p-4"
              data-setup-progress=""
              data-readiness={readiness?.label}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg uppercase">Setup progress</h2>
                  <p className="mt-1 text-[13px] text-steel">{readiness?.summary}</p>
                  {progress ? (
                    <p className="mt-2 text-[12px] font-semibold uppercase tracking-wide">
                      {progress.done}/{progress.total} requirements · {progress.pct}%
                    </p>
                  ) : null}
                </div>
                <p className="rounded-md border border-border px-3 py-2 text-[12px] font-semibold uppercase">
                  {readiness?.label.replaceAll("_", " ")}
                </p>
              </div>
              <ol className="mt-4 grid gap-2 md:grid-cols-2">
                {readiness?.requirements.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-md border border-border px-3 py-2 text-[13px]"
                    data-requirement={item.id}
                    data-complete={item.complete ? "true" : "false"}
                  >
                    <span className="font-semibold">
                      {item.complete ? "Done" : "Needed"} · {item.label}
                    </span>
                    <p className="mt-1 text-steel">{item.detail}</p>
                  </li>
                ))}
              </ol>
              {!readiness?.canCreateStaffOrder ? (
                <p className="mt-3 text-[13px] text-steel" data-ordering-blocked="">
                  Staff ordering is disabled until setup is complete.
                  {readiness?.blockReason ? ` ${readiness.blockReason}` : ""}
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-[13px]" data-ordering-ready="">
                    Staff can create sales orders for this customer.
                  </p>
                  <Link to="/sales/orders/new" search={{ companyId }} className={buttonClass(true)}>
                    Create sales order
                  </Link>
                </div>
              )}
            </section>

            <section
              className="grid gap-4 rounded-lg border border-border p-4"
              data-setup-details=""
            >
              <h2 className="font-display text-lg uppercase">Customer details</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Customer name" htmlFor="setup-name">
                  <input
                    id="setup-name"
                    className={inputClass}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>
                <Field label="Status" htmlFor="setup-status">
                  <input
                    id="setup-status"
                    className={inputClass}
                    value={statusLabel ?? ""}
                    readOnly
                  />
                </Field>
                <Field label="Account number" htmlFor="setup-account">
                  <input
                    id="setup-account"
                    className={inputClass}
                    value={data.company.accountNumber ?? "—"}
                    readOnly
                  />
                </Field>
                <Field label="Customer type" htmlFor="setup-type">
                  <select
                    id="setup-type"
                    className={inputClass}
                    value={customerType}
                    onChange={(event) => {
                      setCustomerType(event.target.value);
                      markDirty();
                    }}
                  >
                    <option value="">Select type</option>
                    {BUSINESS_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Email" htmlFor="setup-email">
                  <input
                    id="setup-email"
                    className={inputClass}
                    value={primaryEmail}
                    onChange={(event) => {
                      setPrimaryEmail(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>
                <Field label="Telephone" htmlFor="setup-phone">
                  <input
                    id="setup-phone"
                    className={inputClass}
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.target.value);
                      markDirty();
                    }}
                  />
                </Field>
                <Field label="Assigned sales representative" htmlFor="setup-rep">
                  <select
                    id="setup-rep"
                    className={inputClass}
                    value={salesRepId}
                    onChange={(event) => {
                      setSalesRepId(event.target.value);
                      markDirty();
                    }}
                  >
                    <option value="">Unassigned</option>
                    {salesReps.map((rep) => (
                      <option key={rep.id} value={rep.id}>
                        {rep.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </section>

            <section
              className="grid gap-4 rounded-lg border border-border p-4"
              data-setup-autopart=""
            >
              <h2 className="font-display text-lg uppercase">Autopart verification</h2>
              <p className="text-[13px] text-steel">
                Successful unique verification activates PROSPECT accounts automatically. Suspended,
                on-hold, and closed accounts are not overridden here.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Autopart sales code" htmlFor="setup-autopart">
                  <input
                    id="setup-autopart"
                    className={inputClass}
                    value={autopartCode}
                    onChange={(event) => setAutopartCode(event.target.value)}
                    disabled={!data.permissions.canVerifyAccount}
                  />
                </Field>
                <div className="rounded-md border border-border px-3 py-2 text-[13px]">
                  <p className="font-semibold">
                    {data.company.autopartAccount.verified ? "Verified" : "Not verified"}
                  </p>
                  <p className="mt-1 text-steel">
                    {data.company.autopartAccount.verifiedAt
                      ? `Verified ${new Date(data.company.autopartAccount.verifiedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} Europe/London`
                      : "No verification timestamp."}
                  </p>
                  <p className="mt-1 text-steel">
                    Master linked: {data.onboarding.masterLinked ? "yes" : "no"}
                    {data.masters.length
                      ? ` (${data.masters.map((row) => row.accountCode).join(", ")})`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass()}
                  disabled={busy || !data.permissions.canVerifyAccount}
                  onClick={() => void saveCodeOnly()}
                >
                  Save code without verifying
                </button>
                <label className="inline-flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={confirmVerify}
                    onChange={(event) => setConfirmVerify(event.target.checked)}
                  />
                  I confirm this is the unique Autopart sales account
                </label>
                <button
                  type="button"
                  className={buttonClass(true)}
                  disabled={
                    busy ||
                    !confirmVerify ||
                    !autopartCode.trim() ||
                    !data.permissions.canVerifyAccount
                  }
                  onClick={() => void verifyAutopart()}
                >
                  Verify
                </button>
              </div>
            </section>

            <section
              className="grid gap-4 rounded-lg border border-border p-4"
              data-setup-history=""
            >
              <h2 className="font-display text-lg uppercase">Historical sales</h2>
              <AutopartHistoryImport
                companyId={companyId}
                companyName={data.company.name}
                verifiedAccount={
                  data.company.autopartAccount.verified ? data.company.autopartAccount.code : null
                }
                canImport={data.permissions.canImportHistory}
                blocked={
                  !data.company.autopartAccount.verified
                    ? "Verify the Autopart sales account before recording history."
                    : null
                }
                historyStatus={data.history.status}
                historyKind={data.history.kind}
                onChanged={async () => {
                  await reload(companyId);
                }}
              />
            </section>

            <section
              className="grid gap-4 rounded-lg border border-border p-4"
              data-setup-contacts=""
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-lg uppercase">Contacts</h2>
                <button
                  type="button"
                  className={buttonClass()}
                  onClick={() => {
                    setContacts((rows) => [
                      ...rows,
                      {
                        key: newKey("contact"),
                        firstName: "",
                        lastName: "",
                        email: "",
                        phone: "",
                        jobTitle: "",
                        isPrimary: rows.every((row) => !row.isPrimary),
                        isPurchasing: false,
                        isAccounts: false,
                        persisted: false,
                      },
                    ]);
                    markDirty();
                  }}
                >
                  Add contact
                </button>
              </div>
              <div className="grid gap-3">
                {contacts.map((contact, index) => (
                  <div
                    key={contact.key}
                    className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2"
                  >
                    <Field label="First name" htmlFor={`c-fn-${contact.key}`}>
                      <input
                        id={`c-fn-${contact.key}`}
                        className={inputClass}
                        value={contact.firstName}
                        onChange={(event) => {
                          const value = event.target.value;
                          setContacts((rows) =>
                            rows.map((row, i) =>
                              i === index ? { ...row, firstName: value } : row,
                            ),
                          );
                          markDirty();
                        }}
                      />
                    </Field>
                    <Field label="Last name" htmlFor={`c-ln-${contact.key}`}>
                      <input
                        id={`c-ln-${contact.key}`}
                        className={inputClass}
                        value={contact.lastName}
                        onChange={(event) => {
                          const value = event.target.value;
                          setContacts((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, lastName: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                    </Field>
                    <Field label="Email" htmlFor={`c-em-${contact.key}`}>
                      <input
                        id={`c-em-${contact.key}`}
                        className={inputClass}
                        value={contact.email}
                        onChange={(event) => {
                          const value = event.target.value;
                          setContacts((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, email: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                    </Field>
                    <Field label="Phone" htmlFor={`c-ph-${contact.key}`}>
                      <input
                        id={`c-ph-${contact.key}`}
                        className={inputClass}
                        value={contact.phone}
                        onChange={(event) => {
                          const value = event.target.value;
                          setContacts((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, phone: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                    </Field>
                    <Field label="Job title" htmlFor={`c-jt-${contact.key}`}>
                      <input
                        id={`c-jt-${contact.key}`}
                        className={inputClass}
                        value={contact.jobTitle}
                        onChange={(event) => {
                          const value = event.target.value;
                          setContacts((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, jobTitle: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-3 text-[13px]">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={contact.isPrimary}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setContacts((rows) =>
                              rows.map((row, i) => ({
                                ...row,
                                isPrimary: i === index ? checked : checked ? false : row.isPrimary,
                              })),
                            );
                            markDirty();
                          }}
                        />
                        Primary
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={contact.isPurchasing}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setContacts((rows) =>
                              rows.map((row, i) =>
                                i === index ? { ...row, isPurchasing: checked } : row,
                              ),
                            );
                            markDirty();
                          }}
                        />
                        Order contact
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={contact.isAccounts}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setContacts((rows) =>
                              rows.map((row, i) =>
                                i === index ? { ...row, isAccounts: checked } : row,
                              ),
                            );
                            markDirty();
                          }}
                        />
                        Accounts
                      </label>
                      {!contact.persisted ? (
                        <button
                          type="button"
                          className="text-destructive underline"
                          onClick={() => {
                            setContacts((rows) => rows.filter((_, i) => i !== index));
                            markDirty();
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section
              className="grid gap-4 rounded-lg border border-border p-4"
              data-setup-addresses=""
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-lg uppercase">Addresses</h2>
                <button
                  type="button"
                  className={buttonClass()}
                  onClick={() => {
                    setAddresses((rows) => [
                      ...rows,
                      {
                        key: newKey("address"),
                        type: "DELIVERY",
                        label: "",
                        line1: "",
                        line2: "",
                        town: "",
                        county: "",
                        postcode: "",
                        country: "GB",
                        isDefaultBilling: rows.every((row) => !row.isDefaultBilling),
                        isDefaultDelivery: rows.every((row) => !row.isDefaultDelivery),
                        contactName: "",
                        contactPhone: "",
                        persisted: false,
                      },
                    ]);
                    markDirty();
                  }}
                >
                  Add address
                </button>
              </div>
              <div className="grid gap-3">
                {addresses.map((address, index) => (
                  <div
                    key={address.key}
                    className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2"
                  >
                    <Field label="Line 1" htmlFor={`a-l1-${address.key}`}>
                      <input
                        id={`a-l1-${address.key}`}
                        className={inputClass}
                        value={address.line1}
                        onChange={(event) => {
                          const value = event.target.value;
                          setAddresses((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, line1: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                    </Field>
                    <Field label="Town" htmlFor={`a-town-${address.key}`}>
                      <input
                        id={`a-town-${address.key}`}
                        className={inputClass}
                        value={address.town}
                        onChange={(event) => {
                          const value = event.target.value;
                          setAddresses((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, town: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                    </Field>
                    <Field label="Postcode" htmlFor={`a-pc-${address.key}`}>
                      <input
                        id={`a-pc-${address.key}`}
                        className={inputClass}
                        value={address.postcode}
                        onChange={(event) => {
                          const value = event.target.value;
                          setAddresses((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, postcode: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                    </Field>
                    <Field label="Country" htmlFor={`a-co-${address.key}`}>
                      <input
                        id={`a-co-${address.key}`}
                        className={inputClass}
                        value={address.country}
                        onChange={(event) => {
                          const value = event.target.value.toUpperCase();
                          setAddresses((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, country: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-3 text-[13px] md:col-span-2">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={address.isDefaultBilling}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setAddresses((rows) =>
                              rows.map((row, i) => ({
                                ...row,
                                isDefaultBilling:
                                  i === index ? checked : checked ? false : row.isDefaultBilling,
                              })),
                            );
                            markDirty();
                          }}
                        />
                        Default billing
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={address.isDefaultDelivery}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setAddresses((rows) =>
                              rows.map((row, i) => ({
                                ...row,
                                isDefaultDelivery:
                                  i === index ? checked : checked ? false : row.isDefaultDelivery,
                              })),
                            );
                            markDirty();
                          }}
                        />
                        Default delivery
                      </label>
                      {!address.persisted ? (
                        <button
                          type="button"
                          className="text-destructive underline"
                          onClick={() => {
                            setAddresses((rows) => rows.filter((_, i) => i !== index));
                            markDirty();
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-4 rounded-lg border border-border p-4" data-setup-terms="">
              <h2 className="font-display text-lg uppercase">Credit and terms</h2>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Credit limit (£)" htmlFor="setup-credit">
                  <input
                    id="setup-credit"
                    className={inputClass}
                    value={creditLimit}
                    onChange={(event) => {
                      setCreditLimit(event.target.value);
                      setCreditReviewed(false);
                      markDirty();
                    }}
                    placeholder="Blank = unlimited / not set"
                  />
                </Field>
                <Field label="Payment terms" htmlFor="setup-terms">
                  <input
                    id="setup-terms"
                    className={inputClass}
                    value={paymentTerms}
                    onChange={(event) => {
                      setPaymentTerms(event.target.value);
                      markDirty();
                    }}
                    placeholder="30 DAYS"
                  />
                </Field>
                <Field label={DEFAULT_TRADE_PRICE_LABEL} htmlFor="setup-price">
                  <select
                    id="setup-price"
                    className={inputClass}
                    value={priceListId}
                    onChange={(event) => {
                      setPriceListId(event.target.value);
                      markDirty();
                    }}
                    disabled={!data.permissions.canEditPricing}
                  >
                    <option value="">Default trade price</option>
                    {priceLists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name} ({list.code})
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[12px] text-steel">{DEFAULT_TRADE_PRICE_HELP}</p>
                </Field>
                <Field label="Customer group" htmlFor="setup-group">
                  <select
                    id="setup-group"
                    className={inputClass}
                    value={groupId}
                    onChange={(event) => {
                      setGroupId(event.target.value);
                      markDirty();
                    }}
                    disabled={!data.permissions.canManageGroups}
                  >
                    <option value="">Ungrouped</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Tax status" htmlFor="setup-tax">
                  <select
                    id="setup-tax"
                    className={inputClass}
                    value={taxStatus}
                    onChange={(event) => {
                      setTaxStatus(event.target.value as (typeof TAX_STATUSES)[number]);
                      markDirty();
                    }}
                  >
                    {TAX_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="inline-flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={creditReviewed}
                  onChange={(event) => {
                    setCreditReviewed(event.target.checked);
                    markDirty();
                  }}
                />
                <span>
                  I have reviewed the credit limit (including blank/unlimited). Credit limit is
                  informational and does not create automatic credit holds.
                </span>
              </label>
            </section>

            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-background/95 p-4 backdrop-blur">
              <p className="text-[13px] text-steel">
                {dirty ? "Unsaved changes on this page." : "All local edits saved or unchanged."}
              </p>
              <button
                type="button"
                className={buttonClass(true)}
                disabled={busy || !data.permissions.canEditCompany}
                onClick={() => void saveAndEnable()}
                data-save-enable-ordering=""
              >
                {busy ? "Saving…" : "Save & enable ordering"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
