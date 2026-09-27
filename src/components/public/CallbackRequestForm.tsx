import { useEffect, useId, useState, type FormEvent } from "react";
import {
  getCallbackPrefillFn,
  submitCallbackEnquiryFn,
} from "@/server/phase2/fns";
import { cn } from "@/lib/utils";

type FieldErrors = Partial<Record<string, string>>;

type Prefill = {
  name: string;
  company: string;
  email: string;
  telephone: string;
  accountManagerName: string | null;
  supportingCopy: string;
  authenticated: boolean;
};

function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Public / trade "Request a callback" form.
 * Authenticated company identity is resolved server-side on submit.
 */
export function CallbackRequestForm() {
  const formId = useId();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    firstName: string;
    accountManagerName: string | null;
  } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [clientRequestId] = useState(newClientRequestId);

  useEffect(() => {
    let cancelled = false;
    void getCallbackPrefillFn().then((result) => {
      if (cancelled || !result.ok) return;
      setPrefill(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || done) return;
    setBusy(true);
    setErrors({});
    setFormError(null);

    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") ?? ""),
      company: String(data.get("company") ?? ""),
      email: String(data.get("email") ?? ""),
      telephone: String(data.get("telephone") ?? ""),
      message: String(data.get("message") ?? ""),
      websiteConfirm: String(data.get("websiteConfirm") ?? ""),
      clientRequestId,
    };

    try {
      const result = await submitCallbackEnquiryFn({ data: payload });
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
      setDone({
        firstName: result.data.customerFirstName,
        accountManagerName: result.data.accountManagerName,
      });
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
        data-callback-enquiry="success"
      >
        <p className="font-display text-2xl font-semibold uppercase tracking-tight">
          Request received
        </p>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-steel">
          Thanks {done.firstName}.
        </p>
        <p className="mx-auto mt-2 max-w-lg text-[15px] leading-relaxed text-steel">
          {done.accountManagerName
            ? "Your account manager has been notified."
            : "Your callback request has been sent to our trade team."}
        </p>
        <p className="mx-auto mt-2 max-w-lg text-[15px] leading-relaxed text-steel">
          We&apos;ll contact you using the details provided.
        </p>
      </div>
    );
  }

  const supporting =
    prefill?.supportingCopy ??
    "Need to speak to our trade team? Send us your details and we'll get back to you.";

  const field = (name: string, label: string, required = false) => {
    const id = `${formId}-${name}`;
    const err = errors[name];
    return { id, label, required, err, describedBy: err ? `${id}-error` : undefined };
  };

  const defaults = prefill ?? {
    name: "",
    company: "",
    email: "",
    telephone: "",
  };

  return (
    <form
      className="rounded-lg border border-border bg-surface/50 p-5"
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      data-callback-enquiry="form"
      aria-busy={busy}
    >
      <h2 className="font-display text-lg font-semibold uppercase">Request a callback</h2>
      <p className="mt-2 text-[13px] text-steel">{supporting}</p>

      {/* Honeypot */}
      <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden>
        <label htmlFor={`${formId}-websiteConfirm`}>Website</label>
        <input
          id={`${formId}-websiteConfirm`}
          name="websiteConfirm"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(() => {
          const f = field("name", "Your name", true);
          return (
            <div className="grid gap-1.5">
              <label
                htmlFor={f.id}
                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel"
              >
                {f.label} <span aria-hidden>*</span>
              </label>
              <input
                id={f.id}
                name="name"
                required
                maxLength={120}
                autoComplete="name"
                defaultValue={defaults.name}
                key={`name-${defaults.name}`}
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
          const f = field("company", "Company");
          return (
            <div className="grid gap-1.5">
              <label
                htmlFor={f.id}
                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel"
              >
                {f.label}
              </label>
              <input
                id={f.id}
                name="company"
                maxLength={200}
                autoComplete="organization"
                defaultValue={defaults.company}
                key={`company-${defaults.company}`}
                className={inputClass}
                disabled={busy}
              />
            </div>
          );
        })()}
        {(() => {
          const f = field("email", "Email");
          return (
            <div className="grid gap-1.5">
              <label
                htmlFor={f.id}
                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel"
              >
                {f.label}
              </label>
              <input
                id={f.id}
                name="email"
                type="email"
                maxLength={200}
                autoComplete="email"
                defaultValue={defaults.email}
                key={`email-${defaults.email}`}
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
              <label
                htmlFor={f.id}
                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel"
              >
                {f.label}
              </label>
              <input
                id={f.id}
                name="telephone"
                type="tel"
                maxLength={40}
                autoComplete="tel"
                defaultValue={defaults.telephone}
                key={`telephone-${defaults.telephone}`}
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
          const f = field("message", "How can we help?", true);
          return (
            <div className="grid gap-1.5 sm:col-span-2">
              <label
                htmlFor={f.id}
                className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel"
              >
                {f.label} <span aria-hidden>*</span>
              </label>
              <textarea
                id={f.id}
                name="message"
                required
                rows={4}
                maxLength={4000}
                aria-invalid={Boolean(f.err)}
                aria-describedby={f.describedBy}
                className={cn(inputClass, "min-h-[6rem] py-2")}
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

        {formError ? (
          <p className="text-[13px] font-medium text-bad sm:col-span-2" role="alert">
            {formError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-2 h-11 rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110 disabled:opacity-60 sm:col-span-2 sm:w-fit sm:px-8"
          data-callback-enquiry-action="submit"
        >
          {busy ? "Sending…" : "Send enquiry"}
        </button>
      </div>
    </form>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-border bg-ink px-3 text-[14px] outline-none focus-visible:border-primary disabled:opacity-60";
