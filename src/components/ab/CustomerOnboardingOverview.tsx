import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
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

const OUTSTANDING_STATES = new Set<OnboardingStep["state"]>([
  "required",
  "awaiting_verification",
  "blocked",
]);

export type CustomerOnboardingOverviewData = CustomerOnboarding & {
  orders: {
    count: number;
    recent: Array<{ id: string; orderNumber: string; status: string; at: string }>;
  };
  quotes: { count: number };
  masterLinked: boolean;
};

export function CustomerOnboardingOverview({
  companyId,
  onboarding,
  availableTabs,
  onOpenTab,
}: {
  companyId: string;
  onboarding: CustomerOnboardingOverviewData;
  availableTabs: readonly string[];
  onOpenTab: (tab: string) => void;
}) {
  const panelId = useId();
  const detailsId = `${panelId}-details`;
  const completedId = `${panelId}-completed`;

  const outstanding = onboarding.steps.filter((item) => OUTSTANDING_STATES.has(item.state));
  const completed = onboarding.steps.filter((item) => item.state === "complete");
  const optionalSteps = onboarding.steps.filter((item) => item.state === "optional");
  const hasOptional = optionalSteps.length > 0 || onboarding.optional.length > 0;
  const allRequiredComplete = onboarding.onboardingComplete;

  const [panelOpen, setPanelOpen] = useState(!allRequiredComplete);
  const [completedOpen, setCompletedOpen] = useState(false);

  useEffect(() => {
    setPanelOpen(!onboarding.onboardingComplete);
    setCompletedOpen(false);
  }, [companyId, onboarding.onboardingComplete]);

  const actionProps = { companyId, availableTabs, onOpenTab };

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-display text-lg uppercase">Onboarding</h2>
        <p className="mt-1 text-[13px] text-steel">
          {onboarding.activationComplete
            ? "This account is active. That does not mean every onboarding step is finished."
            : "This account is not active. Activation is a separate decision from Autopart, history, and portal access."}
        </p>
      </div>
      <p
        className="rounded-md border border-border px-3 py-2 text-[12px] font-semibold uppercase"
        data-onboarding-readiness={onboarding.readiness}
      >
        {onboarding.readinessLabel}
      </p>
    </div>
  );

  const nextAction = onboarding.next ? (
    <div
      className="mt-4 rounded-md border border-border bg-background px-4 py-3"
      data-onboarding-next={onboarding.next.id}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-steel">Next action</p>
      <p className="mt-1 text-[15px] font-semibold">{onboarding.next.label}</p>
      <p className="mt-1 text-[13px] text-steel">{onboarding.next.summary}</p>
      <StepAction step={onboarding.next} {...actionProps} />
    </div>
  ) : (
    <p className="mt-4 text-[13px]" data-onboarding-next="none">
      No required onboarding action is waiting.
    </p>
  );

  const outstandingSection =
    outstanding.length > 0 ? (
      <ol className="grid gap-3 md:grid-cols-2" data-onboarding-outstanding="">
        {outstanding.map((item) => (
          <StepCard key={item.id} step={item} {...actionProps} />
        ))}
      </ol>
    ) : null;

  const optionalSection = hasOptional ? (
    <div className="rounded-lg border border-border p-4" data-onboarding-optional-section="">
      <h3 className="text-[13px] font-semibold">Optional actions</h3>
      {optionalSteps.length > 0 ? (
        <ol className="mt-3 grid gap-3 md:grid-cols-2">
          {optionalSteps.map((item) => (
            <StepCard key={`optional-step-${item.id}`} step={item} {...actionProps} />
          ))}
        </ol>
      ) : null}
      {onboarding.optional.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {onboarding.optional.map((item, index) => (
            <li
              key={`${item.id}-${index}`}
              className="text-[13px] text-steel"
              data-onboarding-optional={item.id}
            >
              <span>{item.summary}</span>
              <StepAction step={item} {...actionProps} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  ) : null;

  const completedSection =
    completed.length > 0 ? (
      <div
        className="rounded-lg border border-border"
        data-onboarding-completed=""
        data-completed-setup-open={completedOpen ? "true" : "false"}
      >
        <button
          type="button"
          className={cn(
            "flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left",
            "hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
          aria-expanded={completedOpen}
          aria-controls={completedId}
          data-completed-setup-trigger=""
          onClick={() => setCompletedOpen((open) => !open)}
        >
          <span className="text-[13px] font-semibold">
            Completed setup
            <span className="ml-2 font-normal text-steel" data-completed-setup-count="">
              ({completed.length})
            </span>
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-steel transition-transform duration-200",
              completedOpen && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
        {completedOpen ? (
          <ol id={completedId} className="grid gap-3 border-t border-border p-4 md:grid-cols-2">
            {completed.map((item) => (
              <StepCard key={item.id} step={item} {...actionProps} />
            ))}
          </ol>
        ) : null}
      </div>
    ) : null;

  const activity = (
    <div className="grid gap-3 sm:grid-cols-2" data-onboarding-activity="">
      <div className="rounded-lg border border-border p-4">
        <h3 className="text-[13px] font-semibold">Orders</h3>
        <p className="mt-1 text-[13px] text-steel">
          {onboarding.orders.count} order{onboarding.orders.count === 1 ? "" : "s"}
        </p>
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
          <button
            type="button"
            className="mt-3 inline-flex min-h-11 items-center text-[12px] font-bold uppercase"
            onClick={() => onOpenTab("Orders")}
          >
            Open orders
          </button>
        ) : null}
      </div>
      <div className="rounded-lg border border-border p-4">
        <h3 className="text-[13px] font-semibold">Sales</h3>
        <p className="mt-1 text-[13px] text-steel">
          {onboarding.quotes.count} quote{onboarding.quotes.count === 1 ? "" : "s"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to={ROUTES.salesIntelligence}
            search={{ mode: "customers", companyId }}
            className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-[12px] font-bold uppercase"
          >
            Sales Enquiry
          </Link>
          {availableTabs.includes("Quotes") ? (
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-[12px] font-bold uppercase"
              onClick={() => onOpenTab("Quotes")}
            >
              Quotes
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );

  const details = (
    <div className="grid gap-4" data-onboarding-details="">
      {header}
      {nextAction}
      {outstandingSection}
      {optionalSection}
      {completedSection}
      {activity}
    </div>
  );

  if (allRequiredComplete) {
    return (
      <section
        className="grid gap-4"
        data-onboarding-overview=""
        data-onboarding-panel="complete"
        data-onboarding-panel-open={panelOpen ? "true" : "false"}
      >
        <div className="rounded-lg border border-border bg-surface/40">
          <button
            type="button"
            className={cn(
              "flex min-h-11 w-full items-start justify-between gap-3 p-4 text-left sm:p-5",
              "hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
            aria-expanded={panelOpen}
            aria-controls={detailsId}
            data-onboarding-complete-summary=""
            onClick={() => setPanelOpen((open) => !open)}
          >
            <div>
              <p className="font-display text-lg uppercase">Customer onboarding complete</p>
              <p className="mt-1 text-[13px] text-steel">
                Required setup is finished. Optional actions and completed details stay available
                here.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <p
                className="rounded-md border border-border px-3 py-2 text-[12px] font-semibold uppercase"
                data-onboarding-readiness={onboarding.readiness}
              >
                {onboarding.readinessLabel}
              </p>
              <ChevronDown
                className={cn(
                  "mt-1 h-4 w-4 shrink-0 text-steel transition-transform duration-200",
                  panelOpen && "rotate-180",
                )}
                aria-hidden="true"
              />
            </div>
          </button>
          {panelOpen ? (
            <div id={detailsId} className="border-t border-border p-4 sm:p-5">
              {details}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      className="grid gap-4"
      data-onboarding-overview=""
      data-onboarding-panel="incomplete"
      data-onboarding-panel-open="true"
    >
      <div className="rounded-lg border border-border bg-surface/40 p-4 sm:p-5">
        {header}
        {nextAction}
      </div>
      {outstandingSection}
      {optionalSection}
      {completedSection}
      {activity}
    </section>
  );
}

function StepCard({
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
  return (
    <li
      className={cn("rounded-lg border p-4", stepBorderClass(step.state))}
      data-onboarding-step={step.id}
      data-onboarding-state={step.state}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[14px] font-semibold">{step.label}</h3>
        <span className={cn("shrink-0 text-[11px] font-bold uppercase", stateClass(step.state))}>
          {STATE_LABEL[step.state]}
        </span>
      </div>
      <p className="mt-2 text-[13px] text-steel">{step.summary}</p>
      <StepAction
        step={step}
        companyId={companyId}
        availableTabs={availableTabs}
        onOpenTab={onOpenTab}
      />
    </li>
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

function stepBorderClass(state: OnboardingStep["state"]): string {
  if (state === "blocked" || state === "required") return "border-bad/40 bg-bad/5";
  if (state === "awaiting_verification") return "border-warn/40 bg-warn/5";
  return "border-border";
}
