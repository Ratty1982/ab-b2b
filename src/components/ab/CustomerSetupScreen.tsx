import { useEffect, useMemo, useRef, useState } from "react";
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
  requirementProgressLabel,
  requirementProgressTone,
  resolveCustomerSetupRefreshMode,
  shouldHydrateFormFields,
} from "@/domain/customer-setup-form";
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
    "inline-flex min-h-10 items-center justify-center rounded-md px-3 text-[12px] font-bold uppercase tracking-wide",
    primary
      ? "bg-primary text-primary-foreground disabled:opacity-50"
      : "border border-border disabled:opacity-50",
  );
}

function sectionClass() {
  return "rounded-lg border border-border p-3 sm:p-4";
}

function sectionTitle(text: string) {
  return <h2 className="font-display text-base uppercase tracking-wide">{text}</h2>;
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
  const dirtyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showCompletion, setShowCompletion] = useState(false);

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

  function markDirty() {
    dirtyRef.current = true;
    setDirty(true);
  }

  function clearDirty() {
    dirtyRef.current = false;
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

  async function refreshFromServer(
    id = companyId,
    options: { forceHydrate?: boolean; showLoading?: boolean } = {},
  ) {
    if (!id) {
      setData(null);
      setLoading(false);
      setShowCompletion(false);
      return;
    }
    if (options.showLoading !== false) setLoading(true);
    const result = await getCustomerSetupFn({ data: { companyId: id } });
    if (options.showLoading !== false) setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setData(null);
      return;
    }
    setError(null);
    setData(result.data);
    const mode = resolveCustomerSetupRefreshMode({
      dirty: dirtyRef.current,
      ...(options.forceHydrate ? { forceHydrate: true } : {}),
    });
    if (shouldHydrateFormFields(mode)) {
      hydrate(result.data);
      if (options.forceHydrate) clearDirty();
    }
  }

  useEffect(() => {
    clearDirty();
    setSaveError(null);
    setShowCompletion(false);
    void refreshFromServer(companyId, { forceHydrate: true });
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
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

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

  const assignedRepLabel =
    salesReps.find((rep) => rep.id === salesRepId)?.label ||
    data?.company.salesperson?.name ||
    "Unassigned";

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
    await refreshFromServer(companyId, { showLoading: false });
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
    await refreshFromServer(companyId, { showLoading: false });
  }

  async function saveSetup(enableOrdering: boolean) {
    if (!companyId || !data) return;
    if (enableOrdering && !creditReviewed) {
      toast.error("Confirm the credit limit review, including blank/unlimited if applicable.");
      return;
    }
    setBusy(true);
    setSaveError(null);
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
        creditLimitReviewed: creditReviewed,
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
        enableOrdering,
        expectedUpdatedAt: data.company.updatedAt,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setSaveError(result.error);
      toast.error(result.error);
      // Preserve unsaved input — do not reload/hydrate on failure.
      return;
    }
    clearDirty();
    setData(result.data.setup);
    hydrate(result.data.setup);
    toast.success(result.data.message);
    if (enableOrdering && result.data.salesReadiness.readyForSales) {
      setShowCompletion(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (enableOrdering && result.data.salesReadiness.incomplete.length > 0) {
      setSaveError(
        `Outstanding requirements: ${result.data.salesReadiness.incomplete
          .map((item) => item.label)
          .join(", ")}`,
      );
    }
  }

  function startAnotherCustomer() {
    clearDirty();
    setShowCompletion(false);
    setSaveError(null);
    setData(null);
    setName("");
    setTradingName("");
    setPhone("");
    setPrimaryEmail("");
    setCustomerType("");
    setNotes("");
    setPaymentTerms("");
    setCreditLimit("");
    setCreditReviewed(false);
    setPriceListId("");
    setSalesRepId("");
    setTaxStatus("STANDARD");
    setGroupId("");
    setAutopartCode("");
    setContacts([]);
    setAddresses([]);
    setDuplicates([]);
    setFindQuery("");
    onCompanyIdChange("");
  }

  if (showCompletion && data && companyId && readiness?.readyForSales) {
    return (
      <div data-customer-setup-screen="" data-setup-complete="">
        <PanelHeader
          title="Customer ready for sales"
          sub="Ordering is approved. Choose the next action."
          crumbs={[
            { label: "Sales" },
            { label: "Customers", to: ROUTES.adminCustomers },
            { label: "Setup" },
          ]}
        />
        <div className="mx-auto grid max-w-3xl gap-4 p-4 sm:p-6">
          <section className={cn(sectionClass(), "bg-surface/40")}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
              Customer ready for sales
            </p>
            <h2 className="mt-2 font-display text-2xl uppercase tracking-tight">
              {data.company.name}
            </h2>
            <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-steel">Autopart account</dt>
                <dd className="font-semibold">{data.company.autopartAccount.code ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-steel">Sales representative</dt>
                <dd className="font-semibold">{assignedRepLabel}</dd>
              </div>
              <div>
                <dt className="text-steel">Credit limit</dt>
                <dd className="font-semibold">
                  {data.company.creditLimit ? `£${data.company.creditLimit}` : "Blank / unlimited"}
                </dd>
              </div>
              <div>
                <dt className="text-steel">Payment terms</dt>
                <dd className="font-semibold">{data.company.paymentTerms ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-steel">Ordering</dt>
                <dd className="font-semibold text-good">Enabled — READY FOR SALES confirmed</dd>
              </div>
            </dl>
          </section>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/sales/orders/new"
              search={{ companyId }}
              className={buttonClass(true)}
              data-complete-create-order=""
            >
              Create sales order
            </Link>
            <Link
              to="/admin/customers/$id"
              params={{ id: companyId }}
              className={buttonClass()}
              data-complete-view-customer=""
            >
              View customer
            </Link>
            <button
              type="button"
              className={buttonClass()}
              onClick={startAnotherCustomer}
              data-complete-another=""
            >
              Set up another customer
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-customer-setup-screen="">
      <PanelHeader
        title={data?.company.name ?? "Customer setup"}
        sub={
          data
            ? `${statusLabel ?? data.company.status} · Setup`
            : "Find or create a customer, then complete setup."
        }
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
              View customer
            </Link>
          ) : null
        }
      />

      <div className="grid gap-3 p-3 sm:gap-4 sm:p-4 lg:p-5">
        {!companyId ? (
          <section className={sectionClass()} data-setup-find="">
            {sectionTitle("Find or create customer")}
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className={cn(inputClass, "min-w-[14rem] flex-1")}
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
              <ul className="mt-3 grid gap-1.5">
                {duplicates.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-[13px]"
                  >
                    <span>
                      {row.name} · {row.status}
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
            <div className="mt-3 grid gap-3 md:grid-cols-2">
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
              className={cn(buttonClass(true), "mt-3")}
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
              className={sectionClass()}
              data-setup-progress=""
              data-readiness={readiness?.label}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  {sectionTitle("Setup progress")}
                  {progress ? (
                    <p className="mt-1 text-[12px] font-semibold uppercase tracking-wide">
                      {progress.done}/{progress.total} complete · {progress.pct}%
                    </p>
                  ) : null}
                </div>
                <p className="rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold uppercase">
                  {readiness?.label.replaceAll("_", " ")}
                </p>
              </div>
              <ol className="mt-2 flex flex-wrap gap-1.5">
                {readiness?.requirements.map((item) => {
                  const tone = requirementProgressTone({
                    complete: item.complete,
                    orderingApproved: Boolean(readiness.orderingApproved),
                    requirementId: item.id,
                  });
                  return (
                    <li
                      key={item.id}
                      className={cn(
                        "rounded border px-2 py-1 text-[11px] font-semibold",
                        item.complete
                          ? "border-border text-steel"
                          : "border-amber-500/50 bg-amber-500/10",
                      )}
                      data-requirement={item.id}
                      data-complete={item.complete ? "true" : "false"}
                      data-tone={tone}
                      title={item.detail}
                    >
                      {requirementProgressLabel(tone)} · {item.label}
                    </li>
                  );
                })}
              </ol>
              {readiness && !readiness.canCreateStaffOrder && readiness.incomplete.length > 0 ? (
                <p className="mt-2 text-[12px] text-steel" data-ordering-blocked="">
                  Outstanding: {readiness.incomplete.map((item) => item.label).join(", ")}.
                </p>
              ) : null}
            </section>

            <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
              <section className={sectionClass()} data-setup-details="">
                {sectionTitle("1. Customer details")}
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
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
                  <Field label="Assigned sales representative" htmlFor="setup-rep">
                    <select
                      id="setup-rep"
                      className={inputClass}
                      value={salesRepId}
                      data-sales-rep-select=""
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

              <section className={sectionClass()} data-setup-autopart="">
                {sectionTitle("2. Autopart & history")}
                <p className="mt-1 text-[12px] text-steel">
                  Unique verification activates prospects. Suspended / on-hold / closed stay
                  blocked.
                </p>
                <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                  <Field label="Autopart sales code" htmlFor="setup-autopart">
                    <input
                      id="setup-autopart"
                      className={inputClass}
                      value={autopartCode}
                      onChange={(event) => setAutopartCode(event.target.value)}
                      disabled={!data.permissions.canVerifyAccount}
                    />
                  </Field>
                  <div className="rounded-md border border-border px-2.5 py-2 text-[12px]">
                    <p className="font-semibold">
                      {data.company.autopartAccount.verified ? "Verified" : "Not verified"}
                    </p>
                    <p className="mt-0.5 text-steel">
                      Master linked: {data.onboarding.masterLinked ? "yes" : "no"}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={buttonClass()}
                    disabled={busy || !data.permissions.canVerifyAccount}
                    onClick={() => void saveCodeOnly()}
                  >
                    Save code
                  </button>
                  <label className="inline-flex items-center gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={confirmVerify}
                      onChange={(event) => setConfirmVerify(event.target.checked)}
                    />
                    Confirm unique account
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
                <div className="mt-3 border-t border-border pt-3" data-setup-history="">
                  <AutopartHistoryImport
                    companyId={companyId}
                    companyName={data.company.name}
                    verifiedAccount={
                      data.company.autopartAccount.verified
                        ? data.company.autopartAccount.code
                        : null
                    }
                    canImport={data.permissions.canImportHistory}
                    blocked={
                      !data.company.autopartAccount.verified
                        ? "Verify Autopart before recording history."
                        : null
                    }
                    historyStatus={data.history.status}
                    historyKind={data.history.kind}
                    onChanged={async () => {
                      await refreshFromServer(companyId, { showLoading: false });
                    }}
                  />
                </div>
              </section>
            </div>

            <section className={sectionClass()} data-setup-contacts-addresses="">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {sectionTitle("3. Contacts & addresses")}
                <div className="flex flex-wrap gap-2">
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
              </div>

              <div className="mt-3 grid gap-3 lg:grid-cols-2" data-setup-contacts="">
                <div className="grid gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">
                    Contacts
                  </p>
                  {contacts.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-3 py-2 text-[12px] text-steel">
                      No contacts yet.
                    </p>
                  ) : null}
                  {contacts.map((contact, index) => (
                    <div
                      key={contact.key}
                      className="grid gap-2 rounded-md border border-border p-2.5 sm:grid-cols-2"
                    >
                      <input
                        className={inputClass}
                        placeholder="First name"
                        aria-label="First name"
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
                      <input
                        className={inputClass}
                        placeholder="Last name"
                        aria-label="Last name"
                        value={contact.lastName}
                        onChange={(event) => {
                          const value = event.target.value;
                          setContacts((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, lastName: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                      <input
                        className={inputClass}
                        placeholder="Email"
                        aria-label="Email"
                        value={contact.email}
                        onChange={(event) => {
                          const value = event.target.value;
                          setContacts((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, email: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                      <input
                        className={inputClass}
                        placeholder="Phone"
                        aria-label="Phone"
                        value={contact.phone}
                        onChange={(event) => {
                          const value = event.target.value;
                          setContacts((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, phone: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                      <div className="flex flex-wrap items-center gap-3 text-[12px] sm:col-span-2">
                        <label className="inline-flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={contact.isPrimary}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setContacts((rows) =>
                                rows.map((row, i) => ({
                                  ...row,
                                  isPrimary:
                                    i === index ? checked : checked ? false : row.isPrimary,
                                })),
                              );
                              markDirty();
                            }}
                          />
                          Primary
                        </label>
                        <label className="inline-flex items-center gap-1.5">
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
                          Orders
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

                <div className="grid gap-2" data-setup-addresses="">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">
                    Addresses
                  </p>
                  {addresses.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border px-3 py-2 text-[12px] text-steel">
                      No addresses yet.
                    </p>
                  ) : null}
                  {addresses.map((address, index) => (
                    <div
                      key={address.key}
                      className="grid gap-2 rounded-md border border-border p-2.5 sm:grid-cols-2"
                    >
                      <input
                        className={cn(inputClass, "sm:col-span-2")}
                        placeholder="Line 1"
                        aria-label="Address line 1"
                        value={address.line1}
                        onChange={(event) => {
                          const value = event.target.value;
                          setAddresses((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, line1: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                      <input
                        className={inputClass}
                        placeholder="Town"
                        aria-label="Town"
                        value={address.town}
                        onChange={(event) => {
                          const value = event.target.value;
                          setAddresses((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, town: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                      <input
                        className={inputClass}
                        placeholder="Postcode"
                        aria-label="Postcode"
                        value={address.postcode}
                        onChange={(event) => {
                          const value = event.target.value;
                          setAddresses((rows) =>
                            rows.map((row, i) => (i === index ? { ...row, postcode: value } : row)),
                          );
                          markDirty();
                        }}
                      />
                      <div className="flex flex-wrap items-center gap-3 text-[12px] sm:col-span-2">
                        <label className="inline-flex items-center gap-1.5">
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
                          Billing
                        </label>
                        <label className="inline-flex items-center gap-1.5">
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
                          Delivery
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
              </div>
            </section>

            <section className={sectionClass()} data-setup-terms="">
              {sectionTitle("4. Credit, terms & pricing")}
              <div className="mt-3 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
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
                    placeholder="Blank = unlimited"
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
                  <p className="mt-1 text-[11px] text-steel">{DEFAULT_TRADE_PRICE_HELP}</p>
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
              <label className="mt-3 inline-flex items-start gap-2 text-[12px]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={creditReviewed}
                  onChange={(event) => {
                    setCreditReviewed(event.target.checked);
                    markDirty();
                  }}
                />
                <span>Credit limit reviewed (blank/unlimited allowed). Informational only.</span>
              </label>
            </section>

            {saveError ? (
              <p className="text-[13px] text-destructive" data-save-error="" role="alert">
                {saveError}
              </p>
            ) : null}

            <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background/95 px-3 py-2.5 backdrop-blur">
              <p className="text-[12px] text-steel">
                {dirty ? "Unsaved changes." : "No unsaved changes."}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass()}
                  disabled={busy || !data.permissions.canEditCompany}
                  onClick={() => void saveSetup(false)}
                  data-save-draft=""
                >
                  {busy ? "Saving…" : "Save draft"}
                </button>
                <button
                  type="button"
                  className={buttonClass(true)}
                  disabled={busy || !data.permissions.canEditCompany}
                  onClick={() => void saveSetup(true)}
                  data-save-enable-ordering=""
                >
                  {busy ? "Saving…" : "Save & enable ordering"}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
