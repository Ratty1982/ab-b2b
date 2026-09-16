import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Check } from "lucide-react";
import { PublicLayout } from "@/components/ab/PublicLayout";
import { StatusBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { brands } from "@/lib/data";
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
          "Apply for an Automotive Brands trade account. Company details, trading address and primary contact — reviewed by our credit team.",
      },
    ],
  }),
  component: Register,
});

function Register() {
  const [submitted, setSubmitted] = useState<{ reference: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [brandsInterest, setBrandsInterest] = useState<string[]>([]);

  const [form, setForm] = useState({
    companyName: "",
    tradingName: "",
    companyNumber: "",
    vatNumber: "",
    businessType: "",
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
    estimatedSpend: "",
    notes: "",
    websiteConfirm: "",
  });

  if (submitted) {
    return (
      <PublicLayout>
        <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-good/15 text-good">
            <Check className="size-7" aria-hidden />
          </span>
          <h1 className="mt-6 font-display text-3xl font-semibold uppercase tracking-tight">
            Application submitted
          </h1>
          <p className="num mt-2 text-sm text-steel">Reference {submitted.reference}</p>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-steel">
            Our credit team reviews trade applications within two working days. Submitting an
            application does not create an active account.
          </p>
          <ol className="mx-auto mt-8 grid max-w-md gap-2 text-left text-sm">
            {[
              { label: "Application submitted", state: "done" },
              { label: "Under review", state: "current" },
              { label: "Approved / more information required", state: "todo" },
            ].map((s) => (
              <li
                key={s.label}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3",
                  s.state === "current" && "border-primary/50 bg-primary/5",
                )}
              >
                <span>{s.label}</span>
                {s.state === "done" ? (
                  <StatusBadge tone="good">Complete</StatusBadge>
                ) : s.state === "current" ? (
                  <StatusBadge tone="brand">In progress</StatusBadge>
                ) : (
                  <StatusBadge>Pending</StatusBadge>
                )}
              </li>
            ))}
          </ol>
        </div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="font-display text-4xl font-semibold uppercase tracking-tight">
          Open a trade account
        </h1>
        <p className="mt-3 max-w-xl text-sm text-steel">
          Tell us about your business. We will review your application and set up portal access
          if approved.
        </p>

        <form
          className="mt-10 grid gap-8"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              setSaving(true);
              const result = await submitTradeApplicationFn({
                data: {
                  companyName: form.companyName,
                  tradingName: form.tradingName || null,
                  companyNumber: form.companyNumber || null,
                  vatNumber: form.vatNumber || null,
                  businessType: form.businessType || null,
                  website: form.website || null,
                  tradingAddress: {
                    line1: form.line1,
                    line2: form.line2 || null,
                    town: form.town,
                    county: form.county || null,
                    postcode: form.postcode,
                    country: "GB",
                  },
                  primaryContact: {
                    firstName: form.firstName,
                    lastName: form.lastName,
                    role: form.role || null,
                    email: form.email,
                    phone: form.phone || null,
                  },
                  estimatedSpend: form.estimatedSpend || null,
                  brandsInterest,
                  notes: form.notes || null,
                  websiteConfirm: form.websiteConfirm,
                },
              });
              setSaving(false);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              setSubmitted({ reference: result.data.reference });
            })();
          }}
        >
          {/* Honeypot */}
          <input
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            className="hidden"
            value={form.websiteConfirm}
            onChange={(e) => setForm({ ...form, websiteConfirm: e.target.value })}
          />

          <section className="grid gap-4">
            <h2 className="font-display text-xl uppercase">Business</h2>
            <Field label="Company / legal name">
              <input
                required
                className={inputClass}
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Trading name">
                <input
                  className={inputClass}
                  value={form.tradingName}
                  onChange={(e) => setForm({ ...form, tradingName: e.target.value })}
                />
              </Field>
              <Field label="Business type">
                <input
                  className={inputClass}
                  placeholder="Motor factor, workshop…"
                  value={form.businessType}
                  onChange={(e) => setForm({ ...form, businessType: e.target.value })}
                />
              </Field>
              <Field label="Company registration number">
                <input
                  className={inputClass}
                  value={form.companyNumber}
                  onChange={(e) => setForm({ ...form, companyNumber: e.target.value })}
                />
              </Field>
              <Field label="VAT number">
                <input
                  className={inputClass}
                  value={form.vatNumber}
                  onChange={(e) => setForm({ ...form, vatNumber: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Website">
              <input
                className={inputClass}
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
            </Field>
          </section>

          <section className="grid gap-4">
            <h2 className="font-display text-xl uppercase">Primary contact</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name">
                <input
                  required
                  className={inputClass}
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </Field>
              <Field label="Last name">
                <input
                  required
                  className={inputClass}
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </Field>
              <Field label="Role">
                <input
                  className={inputClass}
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                />
              </Field>
              <Field label="Phone">
                <input
                  className={inputClass}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Email">
              <input
                required
                type="email"
                className={inputClass}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
          </section>

          <section className="grid gap-4">
            <h2 className="font-display text-xl uppercase">Registered / trading address</h2>
            <Field label="Address line 1">
              <input
                required
                className={inputClass}
                value={form.line1}
                onChange={(e) => setForm({ ...form, line1: e.target.value })}
              />
            </Field>
            <Field label="Address line 2">
              <input
                className={inputClass}
                value={form.line2}
                onChange={(e) => setForm({ ...form, line2: e.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Town">
                <input
                  required
                  className={inputClass}
                  value={form.town}
                  onChange={(e) => setForm({ ...form, town: e.target.value })}
                />
              </Field>
              <Field label="County">
                <input
                  className={inputClass}
                  value={form.county}
                  onChange={(e) => setForm({ ...form, county: e.target.value })}
                />
              </Field>
              <Field label="Postcode">
                <input
                  required
                  className={inputClass}
                  value={form.postcode}
                  onChange={(e) => setForm({ ...form, postcode: e.target.value })}
                />
              </Field>
            </div>
          </section>

          <section className="grid gap-4">
            <h2 className="font-display text-xl uppercase">Commercial interest</h2>
            <Field label="Estimated monthly spend">
              <input
                className={inputClass}
                placeholder="e.g. £2,000–£5,000"
                value={form.estimatedSpend}
                onChange={(e) => setForm({ ...form, estimatedSpend: e.target.value })}
              />
            </Field>
            <div>
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-steel">
                Brands of interest
              </div>
              <div className="flex flex-wrap gap-2">
                {brands.map((b) => {
                  const on = brandsInterest.includes(b.slug);
                  return (
                    <button
                      key={b.slug}
                      type="button"
                      onClick={() =>
                        setBrandsInterest((prev) =>
                          on ? prev.filter((x) => x !== b.slug) : [...prev, b.slug],
                        )
                      }
                      className={cn(
                        "h-9 rounded-md border px-3 text-[12px] font-semibold",
                        on ? "border-primary bg-primary/10" : "border-border text-steel",
                      )}
                    >
                      {b.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <Field label="Notes">
              <textarea
                className={inputClass}
                rows={4}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
          </section>

          <button
            type="submit"
            disabled={saving}
            className="h-12 rounded-md bg-primary text-sm font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Submitting…" : "Submit application"}
          </button>
        </form>
      </div>
    </PublicLayout>
  );
}
