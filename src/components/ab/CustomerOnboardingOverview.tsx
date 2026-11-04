import { Link } from "@tanstack/react-router";
import type { CustomerOnboarding, OnboardingStep } from "@/domain/customer-onboarding";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";

const STATE_LABEL = {
  complete: "Complete",
  required: "Required",
  optional: "Optional",
  awaiting_verification: "Awaiting verification",
  blocked: "Blocked",
} as const;

export function CustomerOnboardingOverview({
  companyId,
  onboarding,
  availableTabs,
  onOpenTab,
}: {
  companyId: string;
  onboarding: CustomerOnboarding & {
    orders: { count: number; recent: Array<{ id: string; orderNumber: string; status: string; at: string }> };
    quotes: { count: number };
    masterLinked: boolean;
  };
  availableTabs: readonly string[];
  onOpenTab: (tab: string) => void;
}) {
  return (
    <section className="grid gap-4" data-onboarding-overview="">
      <div className="rounded-lg border border-border bg-surface/40 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg uppercase">Onboarding</h2>
            <p className="mt-1 text-[13px] text-steel">
              {onboarding.activationComplete
                ? "This account is active. That does not mean every onboarding step is finished."
                : "This account is not active. Activation is a separate decision from Autopart, history, and portal access."}
            </p>
          </div>
          <p className="rounded-md border border-border px-3 py-2 text-[12px] font-semibold uppercase" data-onboarding-readiness={onboarding.readiness}>
            {onboarding.readinessLabel}
          </p>
        </div>
        {onboarding.next ? (
          <div className="mt-4 rounded-md border border-border bg-background px-4 py-3" data-onboarding-next={onboarding.next.id}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-steel">Next action</p>
            <p className="mt-1 text-[15px] font-semibold">{onboarding.next.label}</p>
            <p className="mt-1 text-[13px] text-steel">{onboarding.next.summary}</p>
            <StepAction
              step={onboarding.next}
              companyId={companyId}
              availableTabs={availableTabs}
              onOpenTab={onOpenTab}
            />
          </div>
        ) : (
          <p className="mt-4 text-[13px]" data-onboarding-next="none">
            No required onboarding action is waiting.
          </p>
        )}
      </div>

      <ol className="grid gap-3 md:grid-cols-2">
        {onboarding.steps.map((item) => (
          <li key={item.id} className="rounded-lg border border-border p-4" data-onboarding-step={item.id} data-onboarding-state={item.state}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[14px] font-semibold">{item.label}</h3>
              <span className={cn("shrink-0 text-[11px] font-bold uppercase", stateClass(item.state))}>
                {STATE_LABEL[item.state]}
              </span>
            </div>
            <p className="mt-2 text-[13px] text-steel">{item.summary}</p>
            <StepAction step={item} companyId={companyId} availableTabs={availableTabs} onOpenTab={onOpenTab} />
          </li>
        ))}
      </ol>

      {onboarding.optional.length > 0 ? (
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-[13px] font-semibold">Optional</h3>
          <ul className="mt-2 grid gap-2">
            {onboarding.optional.map((item, index) => (
              <li key={`${item.id}-${index}`} className="text-[13px] text-steel">
                <span>{item.summary}</span>
                <StepAction step={item} companyId={companyId} availableTabs={availableTabs} onOpenTab={onOpenTab} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-[13px] font-semibold">Orders</h3>
          <p className="mt-1 text-[13px] text-steel">{onboarding.orders.count} order{onboarding.orders.count === 1 ? "" : "s"}</p>
          {onboarding.orders.recent.length > 0 ? (
            <ul className="mt-2 grid gap-1 text-[13px]">
              {onboarding.orders.recent.map((order) => (
                <li key={order.id} className="flex justify-between gap-3">
                  <span className="font-mono">{order.orderNumber}</span>
                  <span className="text-steel">{order.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-steel">No orders yet.</p>
          )}
          {availableTabs.includes("Orders") ? (
            <button type="button" className="mt-3 inline-flex min-h-11 items-center text-[12px] font-bold uppercase" onClick={() => onOpenTab("Orders")}>
              Open orders
            </button>
          ) : null}
        </div>
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-[13px] font-semibold">Sales</h3>
          <p className="mt-1 text-[13px] text-steel">{onboarding.quotes.count} quote{onboarding.quotes.count === 1 ? "" : "s"}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to={ROUTES.salesIntelligence}
              search={{ mode: "customers", companyId }}
              className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-[12px] font-bold uppercase"
            >
              Sales Enquiry
            </Link>
            {availableTabs.includes("Quotes") ? (
              <button type="button" className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-[12px] font-bold uppercase" onClick={() => onOpenTab("Quotes")}>
                Quotes
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function StepAction({
  step,
  companyId,
  availableTabs,
  onOpenTab,
}: {
  step: OnboardingStep;
  companyId: string;
  availableTabs: readonly string[];
  onOpenTab: (tab: string) => void;
}) {
  if (step.state === "complete" && step.id === "history") {
    return (
      <Link
        to={ROUTES.salesIntelligence}
        search={{ mode: "customers", companyId }}
        className="mt-3 inline-flex min-h-11 items-center text-[12px] font-bold uppercase"
      >
        View Sales Enquiry
      </Link>
    );
  }
  if (step.action?.anchor) {
    if (!availableTabs.includes("Overview")) return null;
    return (
      <button
        type="button"
        className="mt-3 inline-flex min-h-11 items-center text-[12px] font-bold uppercase"
        onClick={() => {
          onOpenTab("Overview");
          window.setTimeout(() => {
            document.getElementById(step.action?.anchor ?? "")?.scrollIntoView({ block: "start" });
          }, 0);
        }}
      >
        {step.action.label}
      </button>
    );
  }
  if (!step.action || !availableTabs.includes(step.action.tab)) return null;
  return (
    <button
      type="button"
      className="mt-3 inline-flex min-h-11 items-center text-[12px] font-bold uppercase"
      onClick={() => onOpenTab(step.action!.tab)}
    >
      {step.action.label}
    </button>
  );
}

function stateClass(state: OnboardingStep["state"]): string {
  if (state === "complete") return "text-good";
  if (state === "blocked" || state === "required") return "text-bad";
  if (state === "awaiting_verification") return "text-warn";
  return "text-steel";
}
