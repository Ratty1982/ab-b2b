import { useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import {
  confirmSkippedOngoingSalesRecoveryFn,
  diagnoseSalesCutoverIncidentFn,
  previewSkippedOngoingSalesRecoveryFn,
} from "@/server/phase2/fns";

/**
 * Controlled recovery for invoices skipped while cutover was incomplete.
 * Requires authoritative 504/TRM source text — diagnostics alone are not enough.
 */
export function SalesCutoverRecoveryPanel({
  companyId,
  orderNumber,
  documentReference,
}: {
  companyId: string;
  orderNumber?: string;
  documentReference?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState<unknown>(null);
  const [preview, setPreview] = useState<unknown>(null);
  const [text504, setText504] = useState("");
  const [textTrm, setTextTrm] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function runDiagnostic() {
    setBusy(true);
    const result = await diagnoseSalesCutoverIncidentFn({
      data: {
        companyId,
        ...(orderNumber ? { orderNumber } : {}),
        ...(documentReference ? { documentReference } : {}),
      },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDiagnostic(result.data);
    toast.success("Read-only diagnostic loaded");
  }

  async function runPreview() {
    setBusy(true);
    const result = await previewSkippedOngoingSalesRecoveryFn({
      data: {
        companyId,
        text504: text504 || undefined,
        textTrm21qc: textTrm || undefined,
        documentReference: documentReference || undefined,
        suppressDispatchEmail: true,
      },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setPreview(result.data);
    toast.success("Recovery preview ready — confirm only after reviewing changes");
  }

  async function runConfirm() {
    setBusy(true);
    const result = await confirmSkippedOngoingSalesRecoveryFn({
      data: {
        companyId,
        text504: text504 || undefined,
        textTrm21qc: textTrm || undefined,
        documentReference: documentReference || undefined,
        suppressDispatchEmail: true,
      },
    });
    setBusy(false);
    setConfirmOpen(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Recovery applied. Customer dispatch email was suppressed.");
    setPreview(result.data);
    await runDiagnostic();
  }

  return (
    <section className="grid gap-3 rounded-md border border-border p-4" data-sales-cutover-recovery="">
      <div>
        <h3 className="font-display text-base uppercase">Skipped invoice recovery</h3>
        <p className="mt-1 text-[13px] text-steel">
          For invoices skipped with HISTORY_CUTOVER_INCOMPLETE after the sales baseline is complete.
          Paste the original 504 and/or TRM21QC source. Diagnostics do not store amounts. Customer
          dispatch email stays suppressed by default.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 text-[13px] font-semibold uppercase"
          disabled={busy}
          onClick={() => void runDiagnostic()}
        >
          Run diagnostic
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 text-[13px] font-semibold uppercase"
          disabled={busy || (!text504.trim() && !textTrm.trim())}
          onClick={() => void runPreview()}
        >
          Preview recovery
        </button>
        <button
          type="button"
          className="rounded-md bg-ink px-3 py-2 text-[13px] font-semibold uppercase text-paper disabled:opacity-40"
          disabled={busy || !preview}
          onClick={() => setConfirmOpen(true)}
        >
          Confirm recovery
        </button>
      </div>
      <label className="grid gap-1 text-[13px]">
        <span className="font-semibold">504 source text</span>
        <textarea
          className="min-h-24 rounded-md border border-border bg-surface/40 p-2 font-mono text-[12px]"
          value={text504}
          onChange={(event) => setText504(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-[13px]">
        <span className="font-semibold">TRM21QC source text</span>
        <textarea
          className="min-h-24 rounded-md border border-border bg-surface/40 p-2 font-mono text-[12px]"
          value={textTrm}
          onChange={(event) => setTextTrm(event.target.value)}
        />
      </label>
      {diagnostic ? (
        <pre className="max-h-64 overflow-auto rounded-md bg-surface/60 p-3 text-[11px]">
          {JSON.stringify(diagnostic, null, 2)}
        </pre>
      ) : null}
      {preview ? (
        <pre className="max-h-64 overflow-auto rounded-md bg-surface/60 p-3 text-[11px]">
          {JSON.stringify(preview, null, 2)}
        </pre>
      ) : null}
      <ConfirmAction
        open={confirmOpen}
        title="Confirm skipped-invoice recovery"
        description="This reprocesses the pasted Autopart source for this customer, applies fulfilment matching, and does not send a customer dispatch email. It does not invent invoice or despatch data."
        confirmLabel="Apply recovery"
        onOpenChange={setConfirmOpen}
        onConfirm={() => void runConfirm()}
      />
    </section>
  );
}
