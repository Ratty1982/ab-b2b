import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Upload } from "lucide-react";
import { PublicLayout } from "@/components/ab/PublicLayout";
import { StatusBadge } from "@/components/ab/Badges";
import { brands } from "@/lib/data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Open a Trade Account — Automotive Brands" },
      {
        name: "description",
        content:
          "Apply for an Automotive Brands trade account. Company details, trading addresses, contacts and purchasing requirements — reviewed by our credit team.",
      },
      { property: "og:title", content: "Open a Trade Account — Automotive Brands" },
      {
        property: "og:description",
        content: "Apply for a trade account covering the full Automotive Brands portfolio.",
      },
    ],
  }),
  component: Register,
});

const steps = [
  "Company",
  "Addresses",
  "Contacts",
  "Trading",
  "Documents",
  "Review",
] as const;

function Register() {
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);

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
          <p className="num mt-2 text-sm text-steel">Reference APP-2026-0418</p>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-steel">
            Our credit team reviews trade applications within two working days. Submitting an
            application does not create an active account — pricing and catalogue access are
            released once your account is approved.
          </p>
          <ol className="mx-auto mt-8 grid max-w-md gap-2 text-left text-sm">
            {[
              { label: "Application submitted", state: "done" },
              { label: "Under review — credit & trade references", state: "current" },
              { label: "Approved / More information required", state: "todo" },
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
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
          Trade Registration
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
          Open a Trade Account
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-steel">
          Accounts are opened for motor factors, retailers, workshops, garages and distributors. All
          applications are reviewed before catalogue and pricing access is granted.
        </p>

        <ol className="mt-8 flex flex-wrap gap-2" aria-label="Application steps">
          {steps.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={i === step ? "step" : undefined}
                className={cn(
                  "num inline-flex h-9 items-center gap-2 rounded-md border px-3 text-[12px] font-semibold",
                  i === step
                    ? "border-primary bg-primary/10 text-foreground"
                    : i < step
                      ? "border-good/40 text-good"
                      : "border-border text-steel",
                )}
              >
                {i + 1}. {s}
              </button>
            </li>
          ))}
        </ol>

        <form
          className="mt-6 rounded-lg border border-border bg-surface/50 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (step < steps.length - 1) setStep(step + 1);
            else setSubmitted(true);
          }}
        >
          {step === 0 ? (
            <Fields
              title="Company details"
              fields={[
                { label: "Registered company name", required: true },
                { label: "Trading name" },
                { label: "Company registration number", required: true },
                { label: "VAT number" },
                { label: "Website", type: "url" },
                {
                  label: "Business type",
                  select: [
                    "Motor factor",
                    "Automotive retailer",
                    "Workshop / garage",
                    "Distributor",
                    "Buying group member",
                    "Other",
                  ],
                },
              ]}
            />
          ) : null}

          {step === 1 ? (
            <Fields
              title="Trading & delivery address"
              fields={[
                { label: "Trading address line 1", required: true },
                { label: "Trading address line 2" },
                { label: "Town / city", required: true },
                { label: "Postcode", required: true },
                { label: "Delivery address line 1" },
                { label: "Delivery postcode" },
              ]}
            />
          ) : null}

          {step === 2 ? (
            <Fields
              title="Contacts"
              fields={[
                { label: "Primary contact name", required: true },
                { label: "Primary contact email", type: "email", required: true },
                { label: "Telephone", type: "tel", required: true },
                { label: "Accounts contact name" },
                { label: "Accounts email", type: "email" },
                { label: "Accounts telephone", type: "tel" },
              ]}
            />
          ) : null}

          {step === 3 ? (
            <div>
              <h2 className="font-display text-xl font-semibold uppercase">Trading requirements</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field
                  label="Estimated monthly purchasing volume"
                  select={["Under £1,000", "£1,000 – £5,000", "£5,000 – £20,000", "Over £20,000"]}
                />
                <Field label="Existing account / trade reference" />
              </div>
              <fieldset className="mt-6">
                <legend className="text-[11px] font-semibold uppercase tracking-[0.16em] text-steel">
                  Brands of interest
                </legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  {brands.map((b) => (
                    <label
                      key={b.slug}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px] text-steel hover:text-foreground"
                    >
                      <input type="checkbox" className="accent-primary" />
                      {b.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}

          {step === 4 ? (
            <div>
              <h2 className="font-display text-xl font-semibold uppercase">Supporting documents</h2>
              <p className="mt-2 text-sm text-steel">
                Optional, but faster approval: headed paper, VAT certificate, or a trade reference
                letter.
              </p>
              <label className="mt-4 grid cursor-pointer place-items-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center transition-colors hover:border-primary/60">
                <Upload className="size-6 text-steel" aria-hidden />
                <span className="text-sm font-semibold">Drop files or browse</span>
                <span className="text-[12px] text-steel">PDF, JPG or PNG up to 10MB each</span>
                <input type="file" multiple className="sr-only" />
              </label>
            </div>
          ) : null}

          {step === 5 ? (
            <div>
              <h2 className="font-display text-xl font-semibold uppercase">Review & submit</h2>
              <p className="mt-2 text-sm text-steel">
                Check your details before submitting. You will receive an acknowledgement by email
                with your application reference.
              </p>
              <div className="mt-4 rounded-md border border-border bg-ink/60 p-4 text-sm">
                <p className="text-steel">
                  Trade registration does not automatically give unrestricted access. Accounts
                  require approval, and pricing, credit limits and available catalogues are set by
                  the Automotive Brands credit team.
                </p>
              </div>
              <label className="mt-4 flex items-start gap-2 text-sm text-steel">
                <input type="checkbox" required className="mt-1 accent-primary" />I confirm I am
                authorised to open a credit account on behalf of this business and accept the trade
                terms and conditions.
              </label>
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="h-11 rounded-md border border-border px-5 text-sm font-semibold disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="submit"
              className="h-11 rounded-md bg-primary px-6 text-sm font-bold text-primary-foreground transition hover:brightness-110"
            >
              {step === steps.length - 1 ? "Submit application" : "Continue"}
            </button>
          </div>
        </form>
      </div>
    </PublicLayout>
  );
}

interface FieldDef {
  label: string;
  required?: boolean;
  type?: string;
  select?: string[];
}

function Fields({ title, fields }: { title: string; fields: FieldDef[] }) {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold uppercase">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.label} {...f} />
        ))}
      </div>
    </div>
  );
}

function Field({ label, required, type = "text", select }: FieldDef) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div>
      <label htmlFor={id} className="block text-[12px] font-medium text-steel">
        {label}
        {required ? <span className="text-primary"> *</span> : null}
      </label>
      {select ? (
        <select
          id={id}
          required={required}
          className="mt-1.5 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
        >
          <option value="">Please select…</option>
          {select.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={type}
          required={required}
          className="mt-1.5 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
        />
      )}
    </div>
  );
}
