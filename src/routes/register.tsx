import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import { PublicLayout } from "@/components/ab/PublicLayout";
import { Field, inputClass } from "@/components/ab/Drawer";
import {
  BUSINESS_TYPES,
  ESTIMATED_SPEND_RANGES,
  HOW_HEARD_OPTIONS,
  LAUNCH_BRAND_INTERESTS,
} from "@/domain/trade-application";
import { submitTradeApplicationFn } from "@/server/phase2/fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Open a Trade Account — Automotive Brands" },
      {
        name: "description",
        content:
          "Apply for an Automotive Brands trade account to access trade pricing, online ordering and account services across Power Maxed and Steel Seal.",
      },
    ],
  }),
  component: Register,
});

const BRAND_LABELS: Record<(typeof LAUNCH_BRAND_INTERESTS)[number], string> = {
  "power-maxed": "Power Maxed",
  "steel-seal": "Steel Seal",
};

type FormState = {
  companyName: string;
  tradingName: string;
  companyNumber: string;
  vatNumber: string;
  businessType: (typeof BUSINESS_TYPES)[number] | "";
  businessTypeOther: string;
  website: string;
  firstName: string;
  lastName: string;
  role: string;
  email: string;
  phone: string;
  line1: string;
  line2: string;
  town: string;
  county: string;
  postcode: string;
  country: string;
  existingAccountClaim: "yes" | "no" | "not_sure";
  claimedAutopartCustomerCode: string;
  estimatedSpend: string;
  howHeardAboutUs: string;
  notes: string;
  consentAccepted: boolean;
  websiteConfirm: string;
};

const initialForm: FormState = {
  companyName: "",
  tradingName: "",
  companyNumber: "",
  vatNumber: "",
  businessType: "",
  businessTypeOther: "",
  website: "",
  firstName: "",
  lastName: "",
  role: "",
  email: "",
  phone: "",
  line1: "",
  line2: "",
  town: "",
  county: "",
  postcode: "",
  country: "GB",
  existingAccountClaim: "no",
  claimedAutopartCustomerCode: "",
  estimatedSpend: "",
  howHeardAboutUs: "",
  notes: "",
  consentAccepted: false,
  websiteConfirm: "",
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4 border-t border-border/60 pt-8 first:border-t-0 first:pt-0">
      <h2 className="font-display text-xl font-semibold uppercase tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Register() {
  const [submitted, setSubmitted] = useState<{ reference: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [brandsInterest, setBrandsInterest] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [errorSummary, setErrorSummary] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorSummary(null);
    if (!form.businessType) {
      setErrorSummary("Please select a business type.");
      return;
    }
    if (!form.consentAccepted) {
      setErrorSummary("Please confirm you have read the privacy notice before submitting.");
      return;
    }
    setSaving(true);
    const result = await submitTradeApplicationFn({
      data: {
        companyName: form.companyName,
        tradingName: form.tradingName || null,
        companyNumber: form.companyNumber || null,
        vatNumber: form.vatNumber || null,
        businessType: form.businessType,
        businessTypeOther: form.businessTypeOther || null,
        website: form.website || null,
        tradingAddress: {
          line1: form.line1,
          line2: form.line2 || null,
          town: form.town,
          county: form.county || null,
          postcode: form.postcode,
          country: form.country || "GB",
        },
        primaryContact: {
          firstName: form.firstName,
          lastName: form.lastName,
          role: form.role || null,
          email: form.email,
          phone: form.phone,
        },
        existingAccountClaim: form.existingAccountClaim,
        claimedAutopartCustomerCode:
          form.existingAccountClaim === "yes"
            ? form.claimedAutopartCustomerCode || null
            : null,
        estimatedSpend: form.estimatedSpend || null,
        howHeardAboutUs: form.howHeardAboutUs || null,
        brandsInterest,
        notes: form.notes || null,
        consentAccepted: true as const,
        websiteConfirm: form.websiteConfirm,
      },
    });
    setSaving(false);
    if (!result.ok) {
      setErrorSummary(result.error);
      toast.error(result.error);
      return;
    }
    setSubmitted({ reference: result.data.reference });
  }

  if (submitted) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:py-20">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-good/15 text-good">
            <Check className="size-7" aria-hidden />
          </span>
          <h1 className="mt-6 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
            Application received
          </h1>
          <p className="num mt-3 text-sm text-steel">Reference {submitted.reference}</p>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-steel">
            Thank you for applying for an Automotive Brands trade account. Our team will review
            your application and contact you if any further information is required.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/"
              className="inline-flex h-11 items-center rounded-md border border-border px-5 text-[13px] font-semibold transition-colors hover:border-steel"
            >
              Return to homepage
            </Link>
            <Link
              to="/login"
              className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
            >
              Trade login
            </Link>
          </div>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
          Open a trade account
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-steel">
          Apply for an Automotive Brands trade account to access trade pricing, online ordering
          and account services across Power Maxed and Steel Seal.
        </p>

        <form className="mt-10 grid gap-2" onSubmit={(e) => void onSubmit(e)} noValidate>
          <input
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            className="hidden"
            name="websiteConfirm"
            value={form.websiteConfirm}
            onChange={(e) => update("websiteConfirm", e.target.value)}
          />

          {errorSummary ? (
            <div
              role="alert"
              className="mb-4 rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad"
            >
              {errorSummary}
            </div>
          ) : null}

          <Section title="1. Your business">
            <Field label="Company / trading name *">
              <input
                required
                name="organization"
                autoComplete="organization"
                className={inputClass}
                value={form.companyName}
                onChange={(e) => update("companyName", e.target.value)}
              />
            </Field>
            <Field label="Legal company name">
              <input
                className={inputClass}
                value={form.tradingName}
                onChange={(e) => update("tradingName", e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company registration number">
                <input
                  className={inputClass}
                  value={form.companyNumber}
                  onChange={(e) => update("companyNumber", e.target.value)}
                />
              </Field>
              <Field label="VAT number">
                <input
                  className={inputClass}
                  value={form.vatNumber}
                  onChange={(e) => update("vatNumber", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Business type *">
              <select
                required
                className={inputClass}
                value={form.businessType}
                onChange={(e) =>
                  update("businessType", e.target.value as FormState["businessType"])
                }
              >
                <option value="">Select business type</option>
                {BUSINESS_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>
            {form.businessType === "Other" ? (
              <Field label="Business type description *">
                <input
                  required
                  className={inputClass}
                  value={form.businessTypeOther}
                  onChange={(e) => update("businessTypeOther", e.target.value)}
                />
              </Field>
            ) : null}
            <Field label="Website">
              <input
                type="url"
                inputMode="url"
                className={inputClass}
                placeholder="https://"
                value={form.website}
                onChange={(e) => update("website", e.target.value)}
              />
            </Field>
          </Section>

          <Section title="2. Business address">
            <Field label="Address line 1 *">
              <input
                required
                autoComplete="address-line1"
                className={inputClass}
                value={form.line1}
                onChange={(e) => update("line1", e.target.value)}
              />
            </Field>
            <Field label="Address line 2">
              <input
                autoComplete="address-line2"
                className={inputClass}
                value={form.line2}
                onChange={(e) => update("line2", e.target.value)}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Town / city *">
                <input
                  required
                  autoComplete="address-level2"
                  className={inputClass}
                  value={form.town}
                  onChange={(e) => update("town", e.target.value)}
                />
              </Field>
              <Field label="County">
                <input
                  autoComplete="address-level1"
                  className={inputClass}
                  value={form.county}
                  onChange={(e) => update("county", e.target.value)}
                />
              </Field>
              <Field label="Postcode *">
                <input
                  required
                  autoComplete="postal-code"
                  className={inputClass}
                  value={form.postcode}
                  onChange={(e) => update("postcode", e.target.value)}
                />
              </Field>
              <Field label="Country *">
                <select
                  required
                  className={inputClass}
                  value={form.country}
                  onChange={(e) => update("country", e.target.value)}
                >
                  <option value="GB">United Kingdom</option>
                  <option value="IE">Ireland</option>
                </select>
              </Field>
            </div>
          </Section>

          <Section title="3. Your details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name *">
                <input
                  required
                  autoComplete="given-name"
                  className={inputClass}
                  value={form.firstName}
                  onChange={(e) => update("firstName", e.target.value)}
                />
              </Field>
              <Field label="Last name *">
                <input
                  required
                  autoComplete="family-name"
                  className={inputClass}
                  value={form.lastName}
                  onChange={(e) => update("lastName", e.target.value)}
                />
              </Field>
              <Field label="Job title">
                <input
                  autoComplete="organization-title"
                  className={inputClass}
                  value={form.role}
                  onChange={(e) => update("role", e.target.value)}
                />
              </Field>
              <Field label="Telephone *">
                <input
                  required
                  type="tel"
                  autoComplete="tel"
                  className={inputClass}
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Email address *">
              <input
                required
                type="email"
                autoComplete="email"
                className={inputClass}
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </Field>
          </Section>

          <Section title="4. Existing Automotive Brands account">
            <fieldset>
              <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-steel">
                Do you already have an Automotive Brands trade account?
              </legend>
              <div className="flex flex-wrap gap-4 text-[13px]">
                {(
                  [
                    ["no", "No"],
                    ["yes", "Yes"],
                    ["not_sure", "Not sure"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="existingAccountClaim"
                      checked={form.existingAccountClaim === value}
                      onChange={() => {
                        update("existingAccountClaim", value);
                        if (value !== "yes") update("claimedAutopartCustomerCode", "");
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {form.existingAccountClaim === "yes" ? (
              <Field label="Existing account number">
                <input
                  className={inputClass}
                  value={form.claimedAutopartCustomerCode}
                  onChange={(e) => update("claimedAutopartCustomerCode", e.target.value)}
                  placeholder="If known"
                  autoComplete="off"
                />
                <p className="mt-1 text-[12px] text-steel">
                  If you already buy from Automotive Brands, enter your existing account number if
                  known. We will verify it before linking it to your online account.
                </p>
              </Field>
            ) : null}
          </Section>

          <Section title="5. Trade information">
            <Field label="Estimated monthly spend">
              <select
                className={inputClass}
                value={form.estimatedSpend}
                onChange={(e) => update("estimatedSpend", e.target.value)}
              >
                <option value="">Prefer not to say / skip</option>
                {ESTIMATED_SPEND_RANGES.map((range) => (
                  <option key={range} value={range}>
                    {range}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="How did you hear about us?">
              <select
                className={inputClass}
                value={form.howHeardAboutUs}
                onChange={(e) => update("howHeardAboutUs", e.target.value)}
              >
                <option value="">Select an option</option>
                {HOW_HEARD_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-steel">
                Brands / product areas of interest
              </div>
              <div className="flex flex-wrap gap-2">
                {LAUNCH_BRAND_INTERESTS.map((slug) => {
                  const on = brandsInterest.includes(slug);
                  return (
                    <button
                      key={slug}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setBrandsInterest((prev) =>
                          on ? prev.filter((x) => x !== slug) : [...prev, slug],
                        )
                      }
                      className={cn(
                        "h-9 rounded-md border px-3 text-[12px] font-semibold",
                        on ? "border-primary bg-primary/10 text-foreground" : "border-border text-steel",
                      )}
                    >
                      {BRAND_LABELS[slug]}
                    </button>
                  );
                })}
              </div>
            </div>
            <Field label="Additional information">
              <textarea
                className={inputClass}
                rows={4}
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
              />
            </Field>
          </Section>

          <Section title="6. Submission">
            <label className="flex items-start gap-3 text-sm text-steel">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.consentAccepted}
                onChange={(e) => update("consentAccepted", e.target.checked)}
                required
              />
              <span>
                I confirm the information provided is accurate and I understand Automotive Brands
                will use it to review this trade account application in line with the site privacy
                notice. Legal pages will be linked here when published.
              </span>
            </label>
            <button
              type="submit"
              disabled={saving}
              className="mt-2 h-12 w-full rounded-md bg-primary text-sm font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110 disabled:opacity-50 sm:w-auto sm:px-10"
            >
              {saving ? "Submitting…" : "Submit application"}
            </button>
          </Section>
        </form>
      </div>
    </PublicLayout>
  );
}
