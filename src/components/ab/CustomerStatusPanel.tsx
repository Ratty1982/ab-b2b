import { useState } from "react";
import { StatusBadge } from "@/components/ab/Badges";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import {
  companyActivationWarnings,
  companyOverviewStatusActions,
  companyStatusLabel,
  type CompanyStatusAction,
} from "@/domain/company-status-actions";
import type { CompanyStatusKey } from "@/domain/company";
import { updateCompanyFn } from "@/server/phase2/fns";
import { toast } from "sonner";

export function CustomerStatusPanel({
  company,
  canEdit,
  onChanged,
}: {
  company: {
    id: string;
    status: string;
    paymentTerms: string | null;
    priceList: { name: string } | null;
    autopartAccount?: { code: string | null; verified: boolean } | null;
    salesperson?: { name: string } | null;
  };
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const status = company.status as CompanyStatusKey;
  const actions = companyOverviewStatusActions(status);
  const warnings =
    status === "PROSPECT" || status === "PENDING_APPROVAL"
      ? companyActivationWarnings({
          autopartVerified: Boolean(company.autopartAccount?.verified),
          autopartCode: company.autopartAccount?.code ?? null,
          paymentTerms: company.paymentTerms,
          priceListName: company.priceList?.name ?? null,
          salespersonName: company.salesperson?.name ?? null,
        })
      : [];
  const [pending, setPending] = useState<CompanyStatusAction | null>(null);
  const [saving, setSaving] = useState(false);
  const tone =
    status === "ACTIVE" ? "good" : status === "SUSPENDED" || status === "ON_HOLD" || status === "CLOSED" ? "warn" : "brand";

  return (
    <section className="border border-border bg-surface/40 p-5 lg:col-span-2" data-customer-status={status}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg uppercase">Account status</h2>
          <p className="mt-1 text-[13px] text-steel">
            Current status is shown here. Activation does not invite users or import sales.
          </p>
        </div>
        <StatusBadge tone={tone}>{companyStatusLabel(status)}</StatusBadge>
      </div>
      {warnings.length ? (
        <ul className="mt-4 grid gap-1 text-[13px] text-steel">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      {canEdit && actions.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.nextStatus}
              type="button"
              data-customer-action={action.nextStatus === "ACTIVE" ? "activate" : action.nextStatus.toLowerCase()}
              onClick={() => setPending(action)}
              className={
                action.tone === "primary"
                  ? "h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
                  : action.tone === "danger"
                    ? "h-10 rounded-md border border-bad px-4 text-[12px] font-bold uppercase text-bad"
                    : "h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase"
              }
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      <ConfirmAction
        open={pending != null}
        title={pending?.confirmTitle ?? "Confirm status change"}
        description={[pending?.confirmBody, warnings.length && pending?.nextStatus === "ACTIVE" ? warnings.join(" ") : ""]
          .filter(Boolean)
          .join(" ")}
        confirmLabel={pending?.label ?? "Confirm"}
        onOpenChange={(open) => {
          if (!open && !saving) setPending(null);
        }}
        onConfirm={() => {
          if (!pending) return;
          const action = pending;
          void (async () => {
            setSaving(true);
            const result = await updateCompanyFn({ data: { id: company.id, status: action.nextStatus } });
            setSaving(false);
            setPending(null);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(`Status is now ${companyStatusLabel(action.nextStatus)}`);
            await onChanged();
          })();
        }}
      />
    </section>
  );
}
