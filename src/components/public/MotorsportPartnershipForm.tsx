import { useId, useState, type FormEvent } from "react";
import {
  MOTORSPORT_BUDGET_OPTIONS,
  MOTORSPORT_INTEREST_OPTIONS,
} from "@/domain/motorsport";
import { submitMotorsportPartnershipEnquiryFn } from "@/server/phase2/fns";
import { cn } from "@/lib/utils";

type FieldErrors = Partial<Record<string, string>>;

/**
 * Public partnership enquiry — creates a Lead with source MOTORSPORT_PARTNERSHIP.
 * No pricing packages; lead generation only.
 */
export function MotorsportPartnershipForm() {
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || done) return;
    setBusy(true);
    setErrors({});
    setFormError(null);

    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      companyName: String(data.get("companyName") ?? ""),
      contactName: String(data.get("contactName") ?? ""),
      email: String(data.get("email") ?? ""),
      telephone: String(data.get("telephone") ?? ""),
      industry: String(data.get("industry") ?? ""),
      interestedIn: String(data.get("interestedIn") ?? ""),
      approximateBudget: String(data.get("approximateBudget") ?? ""),
      message: String(data.get("message") ?? ""),
      consent: data.get("consent") === "on",
      websiteConfirm: String(data.get("websiteConfirm") ?? ""),
    };

    try {
      const result = await submitMotorsportPartnershipEnquiryFn({ data: payload });
      if (!result.ok) {
        const failed = result as {
          ok: false;
          error: string;
          fieldErrors?: Record<string, string>;
        };
        if (failed.fieldErrors) setErrors(failed.fieldErrors);
        setFormError(failed.error);
        setBusy(false);
        return;
      }
      setDone(true);
      form.reset();
    } catch {
      setFormError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <div
        className="rounded-lg border border-good/40 bg-good/10 px-5 py-8 text-center sm:px-8"
        role="status"
        data-motorsport-enquiry="success"
      >
        <p className="font-display text-2xl font-semibold uppercase tracking-tight">Thank you</p>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-steel">
          Your partnership enquiry has been received. A member of the Automotive Brands team will be
          in touch.
        </p>
      </div>
    );
  }

  const field = (name: string, label: string, required = false) => {
    const id = `${formId}-${name}`;
    const err = errors[name];
    return { id, label, required, err, describedBy: err ? `${id}-error` : undefined };
  };

  return (
    <form
      className="rounded-lg border border-border bg-surface/40 p-5 sm:p-7"
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      data-motorsport-enquiry="form"
      aria-busy={busy}
    >
      <h3 className="font-display text-xl font-semibold uppercase tracking-tight">
        Send a partnership enquiry
      </h3>
      <p className="mt-2 text-[13px] text-steel">
        Tell us about your business and which opportunities you would like to discuss. We do not
        publish sponsorship packages or pricing on this page.
      </p>

      {/* Honeypot */}
      <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
        <label htmlFor={`${formId}-websiteConfirm`}>Website</label>
        <input id={`${formId}-websiteConfirm`} name="websiteConfirm" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {(() => {
          const f = field("companyName", "Company name", true);
          return (
            <div className="grid gap-1.5">
              <label htmlFor={f.id} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                {f.label} {f.required ? <span aria-hidden>*</span> : null}
              </label>
              <input
                id={f.id}
                name="companyName"
                required
                maxLength={200}
                aria-invalid={Boolean(f.err)}
                aria-describedby={f.describedBy}
                className={inputClass}
                disabled={busy}
              />
              {f.err ? (
                <p id={f.describedBy} className="text-[12px] text-bad" role="alert">
                  {f.err}
                </p>
              ) : null}
            </div>
          );
        })()}
        {(() => {
          const f = field("contactName", "Contact name", true);
          return (
            <div className="grid gap-1.5">
              <label htmlFor={f.id} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                {f.label} <span aria-hidden>*</span>
              </label>
              <input
                id={f.id}
                name="contactName"
                required
                maxLength={120}
                aria-invalid={Boolean(f.err)}
                aria-describedby={f.describedBy}
                className={inputClass}
                disabled={busy}
              />
              {f.err ? (
                <p id={f.describedBy} className="text-[12px] text-bad" role="alert">
                  {f.err}
                </p>
              ) : null}
            </div>
          );
        })()}
        {(() => {
          const f = field("email", "Email", true);
          return (
            <div className="grid gap-1.5">
              <label htmlFor={f.id} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                {f.label} <span aria-hidden>*</span>
              </label>
              <input
                id={f.id}
                name="email"
                type="email"
                required
                maxLength={200}
                autoComplete="email"
                aria-invalid={Boolean(f.err)}
                aria-describedby={f.describedBy}
                className={inputClass}
                disabled={busy}
              />
              {f.err ? (
                <p id={f.describedBy} className="text-[12px] text-bad" role="alert">
                  {f.err}
                </p>
              ) : null}
            </div>
          );
        })()}
        {(() => {
          const f = field("telephone", "Telephone");
          return (
            <div className="grid gap-1.5">
              <label htmlFor={f.id} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                {f.label}
              </label>
              <input
                id={f.id}
                name="telephone"
                type="tel"
                maxLength={40}
                autoComplete="tel"
                className={inputClass}
                disabled={busy}
              />
            </div>
          );
        })()}
        {(() => {
          const f = field("industry", "Industry");
          return (
            <div className="grid gap-1.5">
              <label htmlFor={f.id} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                {f.label}
              </label>
              <input id={f.id} name="industry" maxLength={120} className={inputClass} disabled={busy} />
            </div>
          );
        })()}
        {(() => {
          const f = field("interestedIn", "Interested in", true);
          return (
            <div className="grid gap-1.5">
              <label htmlFor={f.id} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                {f.label} <span aria-hidden>*</span>
              </label>
              <select
                id={f.id}
                name="interestedIn"
                required
                aria-invalid={Boolean(f.err)}
                aria-describedby={f.describedBy}
                className={inputClass}
                disabled={busy}
                defaultValue=""
              >
                <option value="" disabled>
                  Select…
                </option>
                {MOTORSPORT_INTEREST_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              {f.err ? (
                <p id={f.describedBy} className="text-[12px] text-bad" role="alert">
                  {f.err}
                </p>
              ) : null}
            </div>
          );
        })()}
        {(() => {
          const f = field("approximateBudget", "Approximate budget");
          return (
            <div className="grid gap-1.5 sm:col-span-2">
              <label htmlFor={f.id} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                {f.label}
              </label>
              <select id={f.id} name="approximateBudget" className={inputClass} disabled={busy} defaultValue="">
                <option value="">Optional</option>
                {MOTORSPORT_BUDGET_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          );
        })()}
        {(() => {
          const f = field("message", "Message", true);
          return (
            <div className="grid gap-1.5 sm:col-span-2">
              <label htmlFor={f.id} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                {f.label} <span aria-hidden>*</span>
              </label>
              <textarea
                id={f.id}
                name="message"
                required
                rows={5}
                maxLength={4000}
                aria-invalid={Boolean(f.err)}
                aria-describedby={f.describedBy}
                className={cn(inputClass, "min-h-[7rem] py-2")}
                disabled={busy}
              />
              {f.err ? (
                <p id={f.describedBy} className="text-[12px] text-bad" role="alert">
                  {f.err}
                </p>
              ) : null}
            </div>
          );
        })()}
        {(() => {
          const f = field("consent", "Consent", true);
          return (
            <div className="sm:col-span-2">
              <label className="flex items-start gap-3 text-[13px] text-steel" htmlFor={f.id}>
                <input
                  id={f.id}
                  name="consent"
                  type="checkbox"
                  required
                  className="mt-1 size-4 rounded border-border"
                  disabled={busy}
                  aria-invalid={Boolean(f.err)}
                  aria-describedby={f.describedBy}
                />
                <span>
                  I agree that Automotive Brands may contact me about this partnership enquiry.{" "}
                  <span aria-hidden>*</span>
                </span>
              </label>
              {f.err ? (
                <p id={f.describedBy} className="mt-1 text-[12px] text-bad" role="alert">
                  {f.err}
                </p>
              ) : null}
            </div>
          );
        })()}
      </div>

      {formError ? (
        <p className="mt-4 text-[13px] font-medium text-bad" role="alert">
          {formError}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-6 flex h-12 w-full items-center justify-center rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110 disabled:opacity-60 sm:w-auto sm:px-10"
        data-motorsport-enquiry-action="submit"
      >
        {busy ? "Sending…" : "Send partnership enquiry"}
      </button>
    </form>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-border bg-ink px-3 text-[14px] outline-none focus-visible:border-primary disabled:opacity-60";
