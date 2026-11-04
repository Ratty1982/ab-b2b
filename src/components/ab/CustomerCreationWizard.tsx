import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import { AutopartHistoryImport } from "@/components/ab/autopart/AutopartHistoryImport";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import {
  COMPANY_STATUSES,
  COMPANY_STATUS_LABEL,
  TAX_STATUSES,
  type CompanyStatusKey,
} from "@/domain/company";
import { DEFAULT_TRADE_PRICE_HELP, DEFAULT_TRADE_PRICE_LABEL } from "@/domain/default-trade-price";
import { BUSINESS_TYPES } from "@/domain/trade-application";
import {
  WIZARD_STEPS,
  customerTypeChoices,
  wizardFinishPlan,
  type WizardStepId,
} from "@/domain/customer-creation-wizard";
import {
  getCustomerCreationWizardFn,
  saveCustomerCreationDetailsFn,
  searchCustomerCreationDuplicatesFn,
} from "@/server/companies/customer-creation-fns";
import {
  createContactFn,
  inviteCompanyUserFn,
  linkAndVerifyCompanyAutopartCustomerCodeFn,
  listCustomerGroupsFn,
  listPriceListsFn,
  listSalesRepsFn,
  setCompanyAutopartCustomerCodeFn,
  setCompanyCustomerGroupFn,
  updateCompanyFn,
} from "@/server/phase2/fns";
import {
  linkAutopartMasterAccountFn,
  listAutopartMasterAccountsFn,
} from "@/server/companies/autopart-master-fns";

type WizardData = Extract<
  Awaited<ReturnType<typeof getCustomerCreationWizardFn>>,
  { ok: true }
>["data"];
type Duplicate = Extract<
  Awaited<ReturnType<typeof searchCustomerCreationDuplicatesFn>>,
  { ok: true }
>["data"][number];

const PORTAL_ROLES = ["TRADE_ADMIN", "TRADE_BUYER", "TRADE_ACCOUNTS", "TRADE_READ_ONLY"] as const;

const ROLE_LABEL: Record<(typeof PORTAL_ROLES)[number], string> = {
  TRADE_ADMIN: "Trade admin",
  TRADE_BUYER: "Buyer",
  TRADE_ACCOUNTS: "Accounts",
  TRADE_READ_ONLY: "Read only",
};

const TAX_LABEL: Record<(typeof TAX_STATUSES)[number], string> = {
  STANDARD: "Standard",
  ZERO_RATED: "Zero rated",
  EXEMPT: "Exempt",
  OUTSIDE_SCOPE: "Outside scope",
};

function buttonClass(primary = false) {
  return cn(
    "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-[13px] font-bold uppercase tracking-wide",
    primary
      ? "bg-primary text-primary-foreground disabled:opacity-50"
      : "border border-border disabled:opacity-50",
  );
}

export function CustomerCreationWizard({
  companyId,
  step,
  onNavigate,
}: {
  companyId?: string | undefined;
  step?: WizardStepId | undefined;
  onNavigate: (next: { companyId?: string | undefined; step?: WizardStepId | undefined }) => void;
}) {
  const navigate = useNavigate();
  const [data, setData] = useState<WizardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(companyId));
  const activeStep: WizardStepId = companyId ? (step ?? data?.suggestedStep ?? 1) : 1;

  async function reload(id = companyId) {
    if (!id) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await getCustomerCreationWizardFn({ data: { companyId: id } });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      setData(null);
      return;
    }
    setError(null);
    setData(result.data);
  }

  useEffect(() => {
    void reload(companyId);
  }, [companyId]);

  useEffect(() => {
    if (!companyId || !data || step) return;
    onNavigate({ companyId, step: data.suggestedStep });
  }, [companyId, data, step]);

  function go(next: WizardStepId, id = companyId) {
    if (!id) return;
    onNavigate({ companyId: id, step: next });
  }

  function leave() {
    if (!companyId) {
      toast.error("Save the customer details first. Nothing has been created yet.");
      return;
    }
    void navigate({ to: "/admin/customers/$id", params: { id: companyId } });
  }

  function finish() {
    if (!companyId) return;
    const plan = wizardFinishPlan(companyId);
    if (
      plan.mutations.length > 0 ||
      plan.activatesCustomer ||
      plan.verifiesSalesAccount ||
      plan.completesHistory ||
      plan.sendsInvitation ||
      plan.createsTransactions
    ) {
      toast.error("Finishing setup cannot change the customer.");
      return;
    }
    void navigate({ to: "/admin/customers/$id", params: { id: companyId } });
  }

  return (
    <div>
      <PanelHeader
        title={data?.company.name ?? "New customer"}
        sub="Guided setup. The customer is saved on the company record. You can leave and come back."
        crumbs={[
          { label: "Sales" },
          { label: "Customers", to: ROUTES.adminCustomers },
          { label: "Setup" },
        ]}
        actions={
          companyId ? (
            <button type="button" className={buttonClass()} onClick={leave}>
              Save and continue later
            </button>
          ) : null
        }
      />
      <div className="grid gap-6 p-4 sm:p-6">
        {data?.source ? (
          <div className="rounded-md border border-border bg-surface/40 px-4 py-3 text-[13px]">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">
              Setup source
            </div>
            <p className="mt-1 font-medium">{data.source.label}</p>
            {data.source.reference ? (
              <p className="mt-1 text-steel">Application {data.source.reference}</p>
            ) : null}
            {data.source.applicantClaimedAutopartCode ? (
              <p className="mt-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px]">
                Applicant claimed Autopart code{" "}
                <span className="font-semibold">{data.source.applicantClaimedAutopartCode}</span> —
                unverified. Confirm on the Autopart step before treating it as the sales account.
              </p>
            ) : null}
            {data.source.note ? <p className="mt-1 text-steel">{data.source.note}</p> : null}
          </div>
        ) : null}
        <nav aria-label="Customer setup steps">
          <ol className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {WIZARD_STEPS.map((item) => {
              const current = item.id === activeStep;
              const locked = item.id > 1 && !companyId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={locked}
                    aria-current={current ? "step" : undefined}
                    onClick={() => go(item.id)}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 rounded-md border px-3 text-left text-[13px]",
                      current ? "border-primary bg-surface" : "border-border",
                      locked && "opacity-50",
                    )}
                  >
                    <span className="font-bold">{item.id}</span>
                    <span>
                      {item.label}
                      {item.optional ? (
                        <span className="block text-[11px] text-steel">Optional</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {error ? (
          <p
            className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {loading && companyId && !data ? (
          <p className="text-sm text-steel">Loading customer…</p>
        ) : null}

        <section data-wizard-step={activeStep} className="grid gap-4">
          {activeStep === 1 ? (
            <DetailsStep
              companyId={companyId}
              data={data}
              onSaved={(id, later) => {
                if (later) {
                  void navigate({ to: "/admin/customers/$id", params: { id } });
                  return;
                }
                onNavigate({ companyId: id, step: 2 });
                void reload(id);
              }}
            />
          ) : null}
          {activeStep === 2 && data && companyId ? (
            <AutopartStep
              companyId={companyId}
              data={data}
              onChanged={() => reload(companyId)}
              onNext={() => go(3)}
            />
          ) : null}
          {activeStep === 3 && data && companyId ? (
            <TradingStep
              companyId={companyId}
              data={data}
              onChanged={() => reload(companyId)}
              onNext={() => go(4)}
              onDetails={() => go(1)}
            />
          ) : null}
          {activeStep === 4 && data && companyId ? (
            <HistoryStep
              companyId={companyId}
              data={data}
              onChanged={() => reload(companyId)}
              onNext={() => go(5)}
            />
          ) : null}
          {activeStep === 5 && data && companyId ? (
            <PortalStep
              companyId={companyId}
              data={data}
              onChanged={() => reload(companyId)}
              onNext={() => go(6)}
            />
          ) : null}
          {activeStep === 6 && data && companyId ? (
            <ReviewStep data={data} onFinish={finish} onEdit={go} />
          ) : null}
        </section>
      </div>
    </div>
  );
}

function DetailsStep({
  companyId,
  data,
  onSaved,
}: {
  companyId?: string | undefined;
  data: WizardData | null;
  onSaved: (companyId: string, later: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [tradingName, setTradingName] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [customerTypeOther, setCustomerTypeOther] = useState("");
  const [status, setStatus] = useState<CompanyStatusKey>("PROSPECT");
  const [taxStatus, setTaxStatus] = useState<(typeof TAX_STATUSES)[number]>("STANDARD");
  const [phone, setPhone] = useState("");
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [salesRepId, setSalesRepId] = useState("");
  const [reps, setReps] = useState<Array<{ id: string; label: string }>>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [town, setTown] = useState("");
  const [county, setCounty] = useState("");
  const [postcode, setPostcode] = useState("");
  const [confirmDespiteDuplicates, setConfirmDespiteDuplicates] = useState(false);
  const [confirmActivation, setConfirmActivation] = useState(false);
  const [matches, setMatches] = useState<Duplicate[]>([]);
  const [saving, setSaving] = useState(false);
  const [filledFor, setFilledFor] = useState<string | null>(null);

  useEffect(() => {
    void listSalesRepsFn().then((result) => {
      if (result.ok) setReps(result.data);
    });
  }, []);

  useEffect(() => {
    if (!data || filledFor === data.company.id) return;
    const storedType = data.company.customerType ?? "";
    const other = storedType.startsWith("Other — ") ? storedType.slice("Other — ".length) : "";
    const choice = other
      ? "Other"
      : customerTypeChoices().includes(storedType as (typeof BUSINESS_TYPES)[number])
        ? storedType
        : storedType
          ? "Other"
          : "";
    setName(data.company.name);
    setTradingName(data.company.tradingName ?? "");
    setCustomerType(choice);
    setCustomerTypeOther(
      other || (choice === "Other" && !storedType.startsWith("Other — ") ? storedType : ""),
    );
    setStatus(data.company.status);
    setTaxStatus(data.company.taxStatus as (typeof TAX_STATUSES)[number]);
    setPhone(data.company.phone ?? "");
    setPrimaryEmail(data.company.primaryEmail ?? "");
    setNotes(data.company.staffNotes);
    setSalesRepId(data.company.salesperson?.salesRepId ?? "");
    setConfirmActivation(data.company.status === "ACTIVE");
    setFilledFor(data.company.id);
  }, [data, filledFor]);

  async function lookForDuplicates() {
    const result = await searchCustomerCreationDuplicatesFn({
      data: { name, email: primaryEmail, phone, excludeCompanyId: companyId },
    });
    if (!result.ok) {
      toast.error(result.error);
      return [];
    }
    setMatches(result.data);
    return result.data;
  }

  async function save(later: boolean) {
    setSaving(true);
    const typeValue =
      customerType === "Other"
        ? customerTypeOther.trim()
          ? `Other — ${customerTypeOther.trim()}`
          : "Other"
        : customerType;
    const result = await saveCustomerCreationDetailsFn({
      data: {
        companyId: companyId ?? null,
        name,
        tradingName,
        customerType: typeValue,
        status,
        taxStatus,
        phone,
        primaryEmail,
        notes,
        salesRepId: salesRepId || null,
        confirmDespiteDuplicates,
        confirmActivation,
        contact:
          data && data.contacts.length > 0
            ? null
            : { firstName, lastName, email: contactEmail, phone: contactPhone, jobTitle },
        address:
          data && data.addresses.length > 0
            ? null
            : { line1, line2, town, county, postcode, country: "GB" },
      },
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      if (result.code === "DUPLICATE_CUSTOMER") await lookForDuplicates();
      return;
    }
    toast.success(result.data.created ? "Customer created" : "Customer details saved");
    onSaved(result.data.companyId, later);
  }

  const existingContact = data?.contacts[0];
  const existingAddress = data?.addresses[0];

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
    >
      <div>
        <h2 className="font-display text-lg uppercase">Customer details</h2>
        <p className="mt-1 text-[13px] text-steel">
          Search before creating a customer. Choosing an existing company continues their setup and
          does not create a duplicate.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name" htmlFor="wizard-name">
          <input
            id="wizard-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Trading name" htmlFor="wizard-trading">
          <input
            id="wizard-trading"
            value={tradingName}
            onChange={(event) => setTradingName(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Customer type" htmlFor="wizard-type">
          <select
            id="wizard-type"
            value={customerType}
            onChange={(event) => setCustomerType(event.target.value)}
            className={inputClass}
          >
            <option value="">Not recorded</option>
            {customerTypeChoices().map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </Field>
        {customerType === "Other" ? (
          <Field label="Customer type detail" htmlFor="wizard-type-other">
            <input
              id="wizard-type-other"
              value={customerTypeOther}
              onChange={(event) => setCustomerTypeOther(event.target.value)}
              className={inputClass}
            />
          </Field>
        ) : null}
        <Field label="Account status" htmlFor="wizard-status">
          <select
            id="wizard-status"
            value={status}
            onChange={(event) => {
              const next = event.target.value as CompanyStatusKey;
              setStatus(next);
              if (next !== "ACTIVE") setConfirmActivation(false);
            }}
            className={inputClass}
          >
            {COMPANY_STATUSES.map((item) => (
              <option key={item} value={item}>
                {COMPANY_STATUS_LABEL[item]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tax status" htmlFor="wizard-tax">
          <select
            id="wizard-tax"
            value={taxStatus}
            onChange={(event) => setTaxStatus(event.target.value as (typeof TAX_STATUSES)[number])}
            className={inputClass}
          >
            {TAX_STATUSES.map((item) => (
              <option key={item} value={item}>
                {TAX_LABEL[item]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Telephone" htmlFor="wizard-phone">
          <input
            id="wizard-phone"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Email" htmlFor="wizard-email">
          <input
            id="wizard-email"
            type="email"
            value={primaryEmail}
            onChange={(event) => setPrimaryEmail(event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Salesperson" htmlFor="wizard-rep">
          <select
            id="wizard-rep"
            value={salesRepId}
            onChange={(event) => setSalesRepId(event.target.value)}
            className={inputClass}
          >
            <option value="">Unassigned</option>
            {reps.map((rep) => (
              <option key={rep.id} value={rep.id}>
                {rep.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {status === "ACTIVE" ? (
        <label className="flex min-h-11 items-start gap-3 text-[13px]">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={confirmActivation}
            onChange={(event) => setConfirmActivation(event.target.checked)}
          />
          <span>
            Make this account active. Activation does not verify an Autopart code, complete sales
            history, or send an invitation.
          </span>
        </label>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass()} onClick={() => void lookForDuplicates()}>
          Check for existing customers
        </button>
      </div>
      {matches.length > 0 ? (
        <div className="rounded-md border border-border p-4" data-duplicate-results="">
          <h3 className="text-[14px] font-semibold">Possible existing customers</h3>
          <ul className="mt-3 grid gap-2">
            {matches.map((match) => (
              <li
                key={match.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <div>
                  <div className="font-semibold">{match.name}</div>
                  <div className="text-[12px] text-steel">
                    {COMPANY_STATUS_LABEL[match.status as CompanyStatusKey] ?? match.status} ·{" "}
                    {match.strength === "strong" ? "Exact match" : "Similar name"}
                    {match.primaryEmail ? ` · ${match.primaryEmail}` : ""}
                  </div>
                </div>
                <Link
                  to="/admin/customers/setup"
                  search={{ companyId: match.id }}
                  className={buttonClass(true)}
                >
                  Use this customer
                </Link>
              </li>
            ))}
          </ul>
          {!companyId ? (
            <label className="mt-3 flex min-h-11 items-start gap-3 text-[13px]">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={confirmDespiteDuplicates}
                onChange={(event) => setConfirmDespiteDuplicates(event.target.checked)}
              />
              <span>Create a separate customer anyway.</span>
            </label>
          ) : null}
        </div>
      ) : null}

      {existingContact ? (
        <div className="rounded-md border border-border bg-surface/30 p-4" data-existing-contact="">
          <p className="text-[13px] font-semibold">Existing primary contact</p>
          <p className="mt-1 text-[13px] text-steel">
            {existingContact.firstName} {existingContact.lastName}
            {existingContact.email ? ` · ${existingContact.email}` : ""}
            {existingContact.phone ? ` · ${existingContact.phone}` : ""}
          </p>
          <p className="mt-2 text-[12px] text-steel">
            This step does not edit the contact. Open the customer Contacts tab to change it.
          </p>
          {companyId ? (
            <Link
              to="/admin/customers/$id"
              params={{ id: companyId }}
              className="mt-3 inline-flex min-h-11 items-center text-[12px] font-bold uppercase"
            >
              Open customer to edit contact
            </Link>
          ) : null}
        </div>
      ) : (
        <fieldset className="grid gap-4 rounded-md border border-border p-4" data-new-contact="">
          <legend className="px-1 text-[13px] font-semibold">Add primary contact</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="wizard-first">
              <input
                id="wizard-first"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Last name" htmlFor="wizard-last">
              <input
                id="wizard-last"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Contact email" htmlFor="wizard-contact-email">
              <input
                id="wizard-contact-email"
                type="email"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Contact telephone" htmlFor="wizard-contact-phone">
              <input
                id="wizard-contact-phone"
                value={contactPhone}
                onChange={(event) => setContactPhone(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Job title" htmlFor="wizard-job">
              <input
                id="wizard-job"
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </fieldset>
      )}

      {existingAddress ? (
        <div className="rounded-md border border-border bg-surface/30 p-4" data-existing-address="">
          <p className="text-[13px] font-semibold">Existing address</p>
          <p className="mt-1 text-[13px] text-steel">
            {existingAddress.line1}, {existingAddress.town}, {existingAddress.postcode}
            {existingAddress.isDefaultDelivery ? " · default delivery" : ""}
          </p>
          <p className="mt-2 text-[12px] text-steel">
            This step does not edit the address. Open the customer Addresses tab to change it.
          </p>
          {companyId ? (
            <Link
              to="/admin/customers/$id"
              params={{ id: companyId }}
              className="mt-3 inline-flex min-h-11 items-center text-[12px] font-bold uppercase"
            >
              Open customer to edit address
            </Link>
          ) : null}
        </div>
      ) : (
        <fieldset className="grid gap-4 rounded-md border border-border p-4" data-new-address="">
          <legend className="px-1 text-[13px] font-semibold">Add address</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Address line 1" htmlFor="wizard-line1">
              <input
                id="wizard-line1"
                value={line1}
                onChange={(event) => setLine1(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Address line 2" htmlFor="wizard-line2">
              <input
                id="wizard-line2"
                value={line2}
                onChange={(event) => setLine2(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Town" htmlFor="wizard-town">
              <input
                id="wizard-town"
                value={town}
                onChange={(event) => setTown(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="County" htmlFor="wizard-county">
              <input
                id="wizard-county"
                value={county}
                onChange={(event) => setCounty(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Postcode" htmlFor="wizard-postcode">
              <input
                id="wizard-postcode"
                value={postcode}
                onChange={(event) => setPostcode(event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
        </fieldset>
      )}

      <Field label="Notes" htmlFor="wizard-notes">
        <textarea
          id="wizard-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          className={inputClass}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonClass(true)} disabled={saving || !name.trim()}>
          {saving ? "Saving…" : companyId ? "Save and continue" : "Create and continue"}
        </button>
        <button
          type="button"
          className={buttonClass()}
          disabled={saving || !name.trim()}
          onClick={() => void save(true)}
        >
          Save and continue later
        </button>
      </div>
    </form>
  );
}

function AutopartStep({
  companyId,
  data,
  onChanged,
  onNext,
}: {
  companyId: string;
  data: WizardData;
  onChanged: () => Promise<void>;
  onNext: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{
      id: string;
      accountCode: string;
      originalName: string;
      companyId: string | null;
      company: { name: string } | null;
    }>
  >([]);
  const [code, setCode] = useState(data.company.autopartAccount.code ?? "");
  const [confirmVerify, setConfirmVerify] = useState(false);
  const [busy, setBusy] = useState(false);
  const account = data.company.autopartAccount;

  async function search() {
    const result = await listAutopartMasterAccountsFn({ data: { q: query, link: "all", page: 1 } });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setResults(result.data.items);
  }

  async function link(accountId: string) {
    setBusy(true);
    const result = await linkAutopartMasterAccountFn({
      data: { accountId, companyId, setPrimary: false },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("407EXP master linked. The sales account was not verified.");
    await onChanged();
  }

  async function saveCode() {
    setBusy(true);
    const result = await setCompanyAutopartCustomerCodeFn({
      data: { companyId, code: code.trim() || null },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      result.data.verified
        ? "Verified sales account left unchanged"
        : "Sales account saved. It is not verified.",
    );
    await onChanged();
  }

  async function verify() {
    setBusy(true);
    const result = await linkAndVerifyCompanyAutopartCustomerCodeFn({
      data: { companyId, code: code.trim() },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Sales account verified");
    setConfirmVerify(false);
    await onChanged();
  }

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="font-display text-lg uppercase">Autopart account</h2>
        <p className="mt-1 text-[13px] text-steel">
          The 407EXP master account and the verified sales account are different. Entering or
          copying a code does not verify it.
        </p>
      </div>
      <div className="grid gap-3 rounded-md border border-border p-4 sm:grid-cols-2">
        <div>
          <h3 className="text-[13px] font-semibold">407EXP master</h3>
          <p className="mt-1 text-[13px] text-steel">
            {data.masterRestricted
              ? "Master account codes are hidden for this role."
              : data.masters.length
                ? data.masters
                    .map((master) => `${master.accountCode} · ${master.originalName}`)
                    .join(", ")
                : "No 407EXP master is linked."}
          </p>
        </div>
        <div>
          <h3 className="text-[13px] font-semibold">Sales account</h3>
          <p className="mt-1 text-[13px] text-steel">
            {account.code
              ? account.verified
                ? `Verified ${account.code}${account.verifiedBy ? ` by ${account.verifiedBy.name}` : ""}${account.verifiedAt ? ` at ${new Date(account.verifiedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })} London` : ""}.`
                : `${account.code} is saved and has not been verified.`
              : "No sales account is saved."}
          </p>
        </div>
      </div>

      {data.permissions.canViewMaster ? (
        <div className="grid gap-3">
          <Field label="Search 407EXP accounts" htmlFor="wizard-master-search">
            <input
              id="wizard-master-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={inputClass}
            />
          </Field>
          <button type="button" className={buttonClass()} onClick={() => void search()}>
            Search master accounts
          </button>
          {results.length > 0 ? (
            <ul className="grid gap-2">
              {results.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <div>
                    <div className="font-semibold">{row.accountCode}</div>
                    <div className="text-[12px] text-steel">
                      {row.originalName}
                      {row.company ? ` · linked to ${row.company.name}` : " · not linked"}
                    </div>
                  </div>
                  {row.companyId && row.companyId !== companyId ? (
                    <Link
                      to="/admin/customers/setup"
                      search={{ companyId: row.companyId, step: 2 }}
                      className={buttonClass()}
                    >
                      Open linked customer
                    </Link>
                  ) : data.permissions.canLinkMaster ? (
                    <button
                      type="button"
                      className={buttonClass()}
                      disabled={busy || row.companyId === companyId}
                      onClick={() => void link(row.id)}
                    >
                      {row.companyId === companyId ? "Linked" : "Link master"}
                    </button>
                  ) : (
                    <span className="text-[12px] text-steel">
                      Linking needs Autopart mapping permission.
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-[13px] text-steel">
          Searching 407EXP accounts needs permission to view Autopart customers.
        </p>
      )}

      <Field label="Autopart sales account code" htmlFor="wizard-sales-code">
        <input
          id="wizard-sales-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className={inputClass}
          disabled={!data.permissions.canVerifyAccount}
        />
      </Field>
      {data.permissions.canVerifyAccount ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass()}
            disabled={busy}
            onClick={() => void saveCode()}
          >
            Save code without verifying
          </button>
          <label className="flex min-h-11 items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              className="size-4"
              checked={confirmVerify}
              onChange={(event) => setConfirmVerify(event.target.checked)}
            />
            I have checked this sales account
          </label>
          <button
            type="button"
            className={buttonClass(true)}
            disabled={busy || !confirmVerify || !code.trim()}
            onClick={() => void verify()}
          >
            Verify sales account
          </button>
        </div>
      ) : (
        <p className="text-[13px] text-steel">
          Saving or verifying a sales account needs permission to edit customers.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass()} onClick={onNext}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

function TradingStep({
  companyId,
  data,
  onChanged,
  onNext,
  onDetails,
}: {
  companyId: string;
  data: WizardData;
  onChanged: () => Promise<void>;
  onNext: () => void;
  onDetails: () => void;
}) {
  const [paymentTerms, setPaymentTerms] = useState(data.company.paymentTerms ?? "");
  const [priceListId, setPriceListId] = useState(data.company.priceListId ?? "");
  const [taxStatus, setTaxStatus] = useState(data.company.taxStatus);
  const [groupId, setGroupId] = useState(data.company.customerGroup?.id ?? "");
  const [lists, setLists] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const delivery = data.addresses.find((address) => address.isDefaultDelivery) ?? data.addresses[0];

  useEffect(() => {
    if (data.permissions.canEditPricing || data.permissions.canEditCompany) {
      void listPriceListsFn().then((result) => {
        if (result.ok) setLists(result.data);
      });
    }
    if (data.permissions.canViewGroups) {
      void listCustomerGroupsFn({ data: {} }).then((result) => {
        if (result.ok) setGroups(result.data.items);
      });
    }
  }, [
    data.permissions.canEditCompany,
    data.permissions.canEditPricing,
    data.permissions.canViewGroups,
  ]);

  async function save() {
    setBusy(true);
    if (data.permissions.canEditCompany) {
      const result = await updateCompanyFn({
        data: {
          id: companyId,
          paymentTerms,
          taxStatus,
          ...(data.permissions.canEditPricing ? { priceListId: priceListId || null } : {}),
        },
      });
      if (!result.ok) {
        setBusy(false);
        toast.error(result.error);
        return;
      }
    }
    if (data.permissions.canManageGroups && groupId !== (data.company.customerGroup?.id ?? "")) {
      const result = await setCompanyCustomerGroupFn({
        data: { companyId, customerGroupId: groupId || null },
      });
      if (!result.ok) {
        setBusy(false);
        toast.error(result.error);
        return;
      }
    }
    setBusy(false);
    toast.success("Trading terms saved");
    await onChanged();
    onNext();
  }

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="font-display text-lg uppercase">Pricing and trading terms</h2>
        <p className="mt-1 text-[13px] text-steel">
          These are the existing commercial settings. An empty price list means{" "}
          {DEFAULT_TRADE_PRICE_LABEL}. Credit balance is not stored here.
        </p>
      </div>
      <Field label="Price list" htmlFor="wizard-price-list">
        <select
          id="wizard-price-list"
          value={priceListId}
          onChange={(event) => setPriceListId(event.target.value)}
          className={inputClass}
          disabled={!data.permissions.canEditPricing}
        >
          <option value="">{DEFAULT_TRADE_PRICE_LABEL}</option>
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.code} — {list.name}
            </option>
          ))}
        </select>
        <p className="text-[12px] text-steel">{DEFAULT_TRADE_PRICE_HELP}</p>
        {!data.permissions.canEditPricing ? (
          <p className="text-[12px] text-steel">
            Changing the price list needs the existing pricing permission. Current list:{" "}
            {data.company.priceList?.name ?? DEFAULT_TRADE_PRICE_LABEL}.
          </p>
        ) : null}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Payment terms" htmlFor="wizard-terms">
          <input
            id="wizard-terms"
            value={paymentTerms}
            onChange={(event) => setPaymentTerms(event.target.value)}
            className={inputClass}
            disabled={!data.permissions.canEditCompany}
          />
        </Field>
        <Field label="Tax status" htmlFor="wizard-trade-tax">
          <select
            id="wizard-trade-tax"
            value={taxStatus}
            onChange={(event) => setTaxStatus(event.target.value)}
            className={inputClass}
            disabled={!data.permissions.canEditCompany}
          >
            {TAX_STATUSES.map((item) => (
              <option key={item} value={item}>
                {TAX_LABEL[item]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Customer group" htmlFor="wizard-group">
          <select
            id="wizard-group"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            className={inputClass}
            disabled={!data.permissions.canManageGroups}
          >
            <option value="">No customer group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          {!data.permissions.canManageGroups ? (
            <p className="text-[12px] text-steel">
              Customer groups need the existing group permission. Current group:{" "}
              {data.company.customerGroup?.name ?? "not set"}.
            </p>
          ) : null}
        </Field>
      </div>
      <div className="rounded-md border border-border p-4 text-[13px]">
        <h3 className="font-semibold">Delivery preference</h3>
        <p className="mt-1 text-steel">
          {delivery
            ? `Default delivery address: ${delivery.line1}, ${delivery.town}, ${delivery.postcode}.`
            : "No delivery address is recorded."}{" "}
          Collection or delivery is chosen on each order. There is no separate customer collection
          flag.
        </p>
        {!delivery ? (
          <button type="button" className={`${buttonClass()} mt-3`} onClick={onDetails}>
            Add an address
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {data.permissions.canEditCompany || data.permissions.canManageGroups ? (
          <button
            type="button"
            className={buttonClass(true)}
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save and continue"}
          </button>
        ) : (
          <p className="text-[13px] text-steel">
            You can view these terms. Changing them needs commercial permission.
          </p>
        )}
        <button type="button" className={buttonClass()} onClick={onNext}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

function HistoryStep({
  companyId,
  data,
  onChanged,
  onNext,
}: {
  companyId: string;
  data: WizardData;
  onChanged: () => Promise<void>;
  onNext: () => void;
}) {
  const verified = data.company.autopartAccount.verified ? data.company.autopartAccount.code : null;
  const blocked = data.company.autopartAccount.attention
    ? data.company.autopartAccount.attention
    : !verified
      ? "Verify the sales account before recording history. A 407EXP master link is not a verified sales account."
      : data.company.status !== "ACTIVE"
        ? "Activate the customer before recording history. Leaving this wizard does not activate the customer or complete history."
        : null;
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="font-display text-lg uppercase">Sales history</h2>
        <p className="mt-1 text-[13px] text-steel">
          No historical purchases means the verified account has no historical purchases. Discarded
          pre-launch history means earlier imported history was deliberately discarded. They are not
          the same, and neither needs a blank spreadsheet or a dummy invoice.
        </p>
        <p className="mt-2 text-[13px] text-steel">
          Current position: {data.onboarding.steps.find((item) => item.id === "history")?.summary}
        </p>
      </div>
      <AutopartHistoryImport
        companyId={companyId}
        companyName={data.company.name}
        verifiedAccount={verified}
        canImport={data.permissions.canImportHistory}
        blocked={blocked}
        historyStatus={data.history.status}
        historyKind={data.history.kind}
        onChanged={onChanged}
      />
      {!data.permissions.canImportHistory ? (
        <p className="text-[13px] text-steel">
          Recording sales history needs the existing import permission.
        </p>
      ) : null}
      <button type="button" className={buttonClass()} onClick={onNext}>
        Continue
      </button>
    </div>
  );
}

function PortalStep({
  companyId,
  data,
  onChanged,
  onNext,
}: {
  companyId: string;
  data: WizardData;
  onChanged: () => Promise<void>;
  onNext: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [role, setRole] = useState<(typeof PORTAL_ROLES)[number]>("TRADE_BUYER");
  const [sendInvitation, setSendInvitation] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = data.company.status === "ACTIVE";

  async function addContact() {
    setBusy(true);
    const result = await createContactFn({
      data: {
        companyId,
        firstName,
        lastName,
        email,
        phone,
        isPrimary: data.contacts.length === 0,
        isPurchasing: true,
      },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Contact added. No invitation was sent.");
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    await onChanged();
  }

  async function invite() {
    setBusy(true);
    const result = await inviteCompanyUserFn({ data: { companyId, email: inviteEmail, role } });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      result.data.emailSent ? "Invitation sent" : "Invitation created. Email was not sent.",
    );
    setSendInvitation(false);
    setInviteEmail("");
    await onChanged();
  }

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="font-display text-lg uppercase">Portal access</h2>
        <p className="mt-1 text-[13px] text-steel">
          Adding a contact does not send an invitation. Internal staff email addresses cannot be
          registered as trade portal users.
        </p>
      </div>
      <ul className="grid gap-2">
        {data.contacts.map((contact) => (
          <li key={contact.id} className="rounded-md border border-border px-3 py-2 text-[13px]">
            {contact.firstName} {contact.lastName}
            {contact.email ? ` · ${contact.email}` : ""}
            {contact.isPrimary ? " · primary" : ""}
          </li>
        ))}
        {data.users.map((user) => (
          <li key={user.id} className="rounded-md border border-border px-3 py-2 text-[13px]">
            {user.email} · {ROLE_LABEL[user.role as keyof typeof ROLE_LABEL] ?? user.role} ·{" "}
            {user.status}
          </li>
        ))}
        {data.invitations.map((invitation) => (
          <li key={invitation.id} className="rounded-md border border-border px-3 py-2 text-[13px]">
            Invitation {invitation.email} ·{" "}
            {invitation.role
              ? (ROLE_LABEL[invitation.role as keyof typeof ROLE_LABEL] ?? invitation.role)
              : "Portal user"}{" "}
            · {invitation.status}
          </li>
        ))}
      </ul>
      {data.permissions.canCreateContacts ? (
        <fieldset className="grid gap-4 rounded-md border border-border p-4">
          <legend className="px-1 text-[13px] font-semibold">Add a contact</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="portal-first">
              <input
                id="portal-first"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Last name" htmlFor="portal-last">
              <input
                id="portal-last"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Email" htmlFor="portal-email">
              <input
                id="portal-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Telephone" htmlFor="portal-phone">
              <input
                id="portal-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <button
            type="button"
            className={buttonClass()}
            disabled={busy || !firstName.trim() || !lastName.trim()}
            onClick={() => void addContact()}
          >
            Add contact
          </button>
        </fieldset>
      ) : (
        <p className="text-[13px] text-steel">
          Adding contacts needs permission to create contacts.
        </p>
      )}
      {data.permissions.canManageUsers ? (
        <fieldset className="grid gap-4 rounded-md border border-border p-4" disabled={!active}>
          <legend className="px-1 text-[13px] font-semibold">Optional invitation</legend>
          {active ? null : (
            <p className="text-[13px] text-steel">
              Invitations are available after the account is active. Nothing is sent while the
              customer is a prospect.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Invitation email" htmlFor="portal-invite-email">
              <input
                id="portal-invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Portal permission" htmlFor="portal-role">
              <select
                id="portal-role"
                value={role}
                onChange={(event) => setRole(event.target.value as (typeof PORTAL_ROLES)[number])}
                className={inputClass}
              >
                {PORTAL_ROLES.map((item) => (
                  <option key={item} value={item}>
                    {ROLE_LABEL[item]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <label className="flex min-h-11 items-start gap-3 text-[13px]">
            <input
              type="checkbox"
              className="mt-1 size-4"
              checked={sendInvitation}
              onChange={(event) => setSendInvitation(event.target.checked)}
            />
            <span>
              Send the invitation email now. Leave this unticked and no invitation is created.
            </span>
          </label>
          <button
            type="button"
            className={buttonClass(true)}
            disabled={!active || busy || !sendInvitation || !inviteEmail.trim()}
            onClick={() => void invite()}
          >
            Send invitation
          </button>
        </fieldset>
      ) : (
        <p className="text-[13px] text-steel">
          Portal invitations need permission to manage customer users.
        </p>
      )}
      <button type="button" className={buttonClass()} onClick={onNext}>
        Continue to review
      </button>
    </div>
  );
}

function ReviewStep({
  data,
  onFinish,
  onEdit,
}: {
  data: WizardData;
  onFinish: () => void;
  onEdit: (step: WizardStepId) => void;
}) {
  const account = data.company.autopartAccount;
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="font-display text-lg uppercase">Review</h2>
        <p className="mt-1 text-[13px] text-steel">
          Finish opens the customer. It does not activate the account, verify a sales code, complete
          history, send invitations, or create sales.
        </p>
      </div>
      <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <dt className="text-[11px] font-bold uppercase text-steel">Customer</dt>
          <dd className="mt-1 font-semibold">{data.company.name}</dd>
          <dd>
            {COMPANY_STATUS_LABEL[data.company.status]}
            {data.company.customerType ? ` · ${data.company.customerType}` : ""}
          </dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-[11px] font-bold uppercase text-steel">Autopart</dt>
          <dd className="mt-1">
            {data.masters.length
              ? `407EXP ${data.masters.map((master) => master.accountCode).join(", ")}`
              : "407EXP master not linked"}
          </dd>
          <dd>
            {account.code
              ? account.verified
                ? `Verified sales account ${account.code}`
                : `Unverified sales account ${account.code}`
              : "No sales account saved"}
          </dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-[11px] font-bold uppercase text-steel">Trading</dt>
          <dd className="mt-1">{data.company.priceList?.name ?? DEFAULT_TRADE_PRICE_LABEL}</dd>
          <dd>
            Terms {data.company.paymentTerms || "not set"} · Group{" "}
            {data.company.customerGroup?.name ?? "not set"}
          </dd>
        </div>
        <div className="rounded-md border border-border p-3">
          <dt className="text-[11px] font-bold uppercase text-steel">Portal</dt>
          <dd className="mt-1">
            {data.contacts.length} contact{data.contacts.length === 1 ? "" : "s"} ·{" "}
            {data.users.length} portal user{data.users.length === 1 ? "" : "s"}
          </dd>
          <dd>
            {data.invitations.length} pending invitation{data.invitations.length === 1 ? "" : "s"}
          </dd>
        </div>
      </dl>
      <ol className="grid gap-2">
        {data.onboarding.steps.map((item) => (
          <li
            key={item.id}
            className="rounded-md border border-border px-3 py-2 text-[13px]"
            data-review-step={item.id}
            data-review-state={item.state}
          >
            <span className="font-semibold">{item.label}</span>
            <span className="text-steel"> · {item.state.replaceAll("_", " ")}</span>
            <p className="mt-1 text-steel">{item.summary}</p>
          </li>
        ))}
      </ol>
      {data.onboarding.next ? (
        <p className="text-[13px]">
          Outstanding: {data.onboarding.next.label}. {data.onboarding.next.summary}
        </p>
      ) : (
        <p className="text-[13px]">
          No required onboarding action is waiting. Optional items can still be open.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass()} onClick={() => onEdit(1)}>
          Edit details
        </button>
        <button type="button" className={buttonClass()} onClick={() => onEdit(2)}>
          Edit Autopart
        </button>
        <button
          type="button"
          className={buttonClass(true)}
          onClick={onFinish}
          data-wizard-finish=""
        >
          Finish and open customer
        </button>
      </div>
    </div>
  );
}
