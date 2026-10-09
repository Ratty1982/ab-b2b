import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  cancelAutopartProspectConversionFn,
  confirmAutopartProspectConversionFn,
  getAutopartProspectConversionFn,
  getLatestAutopartProspectConversionFn,
  previewAutopartProspectConversionFn,
  resumeAutopartProspectConversionFn,
} from "@/server/companies/autopart-master-fns";

type Run = Extract<
  Awaited<ReturnType<typeof getAutopartProspectConversionFn>>,
  { ok: true }
>["data"];

export function AutopartProspectConversionPanel() {
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function refresh(runId: string) {
    const result = await getAutopartProspectConversionFn({ data: { runId } });
    if (result.ok) setRun(result.data);
  }

  useEffect(() => {
    let cancelled = false;
    void getLatestAutopartProspectConversionFn().then((result) => {
      if (cancelled) return;
      if (result.ok) setRun(result.data);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runId = run?.id;
  const runStatus = run?.status;
  useEffect(() => {
    if (!runId || runStatus !== "RUNNING") return;
    const timer = setInterval(() => {
      void refresh(runId);
    }, 2000);
    return () => clearInterval(timer);
  }, [runId, runStatus]);

  async function preview() {
    setBusy(true);
    setAcknowledged(false);
    const result = await previewAutopartProspectConversionFn();
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setRun(result.data);
  }

  async function confirm() {
    if (!run || !acknowledged) return;
    setBusy(true);
    const result = await confirmAutopartProspectConversionFn({
      data: { runId: run.id, confirmed: true },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setRun(result.data);
  }

  async function resume() {
    if (!run) return;
    setBusy(true);
    const result = await resumeAutopartProspectConversionFn({ data: { runId: run.id } });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setRun(result.data);
  }

  async function cancel() {
    if (!run) return;
    setBusy(true);
    const result = await cancelAutopartProspectConversionFn({ data: { runId: run.id } });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await refresh(run.id);
  }

  const summary = run?.summary;
  const excluded = summary
    ? Object.entries(summary.excludedByClassification).filter(([, count]) => count > 0)
    : [];

  return (
    <section className="border border-border px-4 py-3 text-[13px]">
      <h2 className="font-display text-sm font-semibold uppercase">
        Convert eligible accounts to prospects
      </h2>
      <p className="mt-1 text-steel">
        Creates internal CRM prospects from trade-candidate Autopart accounts. It does not copy
        invoice or ledger rows, create logins, enable ordering, or send email. Nothing runs until an
        administrator previews and confirms.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || run?.status === "RUNNING"}
          onClick={() => void preview()}
          className="h-9 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-60"
        >
          Convert Eligible Accounts to Prospects
        </button>
        {run && (run.status === "FAILED" || run.status === "RUNNING") ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void resume()}
            className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold disabled:opacity-60"
          >
            Resume
          </button>
        ) : null}
        {run && run.status !== "COMMITTED" && run.status !== "CANCELLED" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void cancel()}
            className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold disabled:opacity-60"
          >
            Cancel
          </button>
        ) : null}
        {run ? (
          <a
            className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold"
            href={`/api/autopart-imports/prospect-exceptions/csv?runId=${encodeURIComponent(run.id)}`}
          >
            Download exceptions report
          </a>
        ) : null}
      </div>
      {!loaded ? <p className="mt-3 text-steel">Loading conversion status…</p> : null}
      {run && summary ? (
        <div className="mt-3 grid gap-2">
          <p>
            Status {run.status}
            {run.dryRun ? " · dry run" : ""} · {run.percent}% · processed {run.processed} · created{" "}
            {run.createdProspects} · reused {run.reusedCompanies} · conflicts {run.conflicts} ·
            errors {run.errors}
          </p>
          {run.errorSummary ? <p className="text-bad">{run.errorSummary}</p> : null}
          <ul className="grid gap-1 text-steel sm:grid-cols-2">
            <li>Total Autopart accounts: {summary.totalAccounts.toLocaleString("en-GB")}</li>
            <li>Eligible for conversion: {summary.eligible.toLocaleString("en-GB")}</li>
            <li>Already linked: {summary.alreadyLinked.toLocaleString("en-GB")}</li>
            <li>
              Eligible already linked: {summary.eligibleAlreadyLinked.toLocaleString("en-GB")}
            </li>
            <li>
              Newly created prospects expected: {summary.createExpected.toLocaleString("en-GB")}
            </li>
            <li>Existing companies reused: {summary.reuseExpected.toLocaleString("en-GB")}</li>
            <li>Conflicts: {summary.conflicts.toLocaleString("en-GB")}</li>
            <li>
              Same-name Autopart groups: {summary.nameDuplicateGroups.toLocaleString("en-GB")} (
              {summary.nameDuplicateAccounts.toLocaleString("en-GB")} accounts)
            </li>
            <li>
              Same name, different CRM code: {summary.sameNameDifferentCode.toLocaleString("en-GB")}
            </li>
            <li>
              Eligible with 561L history: {summary.eligibleWithInvoiceLines.toLocaleString("en-GB")}
            </li>
            <li>
              Eligible without 561L history:{" "}
              {summary.eligibleWithoutInvoiceLines.toLocaleString("en-GB")}
            </li>
            <li>
              Eligible with SLRB records: {summary.eligibleWithLedger.toLocaleString("en-GB")}
            </li>
            <li>
              Unmatched invoice codes: {summary.unmatchedInvoiceCodes.toLocaleString("en-GB")}
            </li>
            <li>Unmatched ledger codes: {summary.unmatchedLedgerCodes.toLocaleString("en-GB")}</li>
            <li>
              Estimated batches: {summary.estimatedBatches.toLocaleString("en-GB")} of{" "}
              {summary.batchSize}
            </li>
          </ul>
          {excluded.length ? (
            <p className="text-steel">
              Excluded by classification:{" "}
              {excluded
                .map(([name, count]) => `${name} ${count.toLocaleString("en-GB")}`)
                .join(" · ")}
            </p>
          ) : null}
          {summary.reconciliation ? (
            <p>
              Reconciliation: eligible linked{" "}
              {summary.reconciliation.eligibleLinked.toLocaleString("en-GB")} · eligible still
              unlinked {summary.reconciliation.eligibleUnlinked.toLocaleString("en-GB")}
            </p>
          ) : null}
          {run.status === "PREVIEWED" ? (
            <label className="mt-1 flex items-start gap-2">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                I have reviewed this dry run and confirm creation of CRM prospects. No customer
                email will be sent and website ordering stays off.
              </span>
            </label>
          ) : null}
          {run.status === "PREVIEWED" ? (
            <button
              type="button"
              disabled={busy || !acknowledged}
              onClick={() => void confirm()}
              className="h-9 w-fit rounded-md border border-border px-3 text-[12px] font-bold uppercase disabled:opacity-60"
            >
              Create prospects
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
