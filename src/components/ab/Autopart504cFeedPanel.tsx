import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { formatOperationalDateTime, formatOrDash } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import {
  dryRunAutopart504cFn,
  getAutopart504cFeedSettingsFn,
  getAutopart504cImportRunDetailFn,
  listAutopart504cImportRunsFn,
  pollAutopart504cMailboxFn,
  updateAutopart504cFeedSettingsFn,
} from "@/server/phase2/fns";

type Settings = Extract<
  Awaited<ReturnType<typeof getAutopart504cFeedSettingsFn>>,
  { ok: true }
>["data"];
type RunRow = Extract<
  Awaited<ReturnType<typeof listAutopart504cImportRunsFn>>,
  { ok: true }
>["data"][number];
type DryRun = Extract<Awaited<ReturnType<typeof dryRunAutopart504cFn>>, { ok: true }>["data"];
type RunDetail = Extract<
  Awaited<ReturnType<typeof getAutopart504cImportRunDetailFn>>,
  { ok: true }
>["data"];

function statusTone(label: string): Tone {
  if (label === "ENABLED") return "good";
  if (label === "DISABLED" || label === "RETIRED") return "warn";
  return "neutral";
}

function runTone(status: string): Tone {
  if (status === "SUCCESS" || status === "DRY_RUN") return "good";
  if (status === "PARTIAL") return "warn";
  if (status === "FAILED") return "bad";
  return "neutral";
}

function resultTone(result: string): Tone {
  if (result === "WOULD_CREATE" || result === "WOULD_DESPATCH") return "good";
  if (result === "DUPLICATE" || result === "ALREADY_DESPATCHED" || result === "CREDIT") return "neutral";
  if (result === "FINANCIAL_MISMATCH" || result === "UNKNOWN_AB_ORDER" || result === "STATUS_NOT_ELIGIBLE") {
    return "warn";
  }
  return "neutral";
}

function buttonClass(primary = false) {
  return cn(
    "h-10 rounded-md px-4 text-[12px] font-semibold uppercase tracking-wide disabled:cursor-wait disabled:opacity-50",
    primary
      ? "bg-primary text-primary-foreground"
      : "border border-border bg-surface/40 text-foreground hover:bg-surface",
  );
}

function gbp(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  return `£${value}`;
}

export function Autopart504cFeedPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [preview, setPreview] = useState<DryRun | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [configuredDraft, setConfiguredDraft] = useState(false);
  const [enabledDraft, setEnabledDraft] = useState(false);
  const [senderDraft, setSenderDraft] = useState("");

  const load = useCallback(async () => {
    const [s, history] = await Promise.all([
      getAutopart504cFeedSettingsFn(),
      listAutopart504cImportRunsFn({ data: { limit: 20 } }),
    ]);
    if (s.ok) {
      setSettings(s.data);
      setConfiguredDraft(s.data.configured);
      setEnabledDraft(s.data.enabled);
      setSenderDraft(s.data.allowedSender ?? "");
      setError(null);
    } else {
      setError(s.error);
    }
    if (history.ok) setRuns(history.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSettings() {
    setBusy("save");
    const result = await updateAutopart504cFeedSettingsFn({
      data: {
        configured: configuredDraft,
        enabled: enabledDraft,
        allowedSender: senderDraft.trim() || null,
      },
    });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setSettings(result.data);
    toast.success("504C feed settings saved");
  }

  async function onDryRunFile(file: File) {
    setBusy("dry-run");
    setPreview(null);
    try {
      const text = await file.text();
      const result = await dryRunAutopart504cFn({
        data: { text, filename: file.name },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPreview(result.data);
      toast.success("504C dry-run complete — predictive plan only, no mutations");
      await load();
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onPollNow() {
    setBusy("poll");
    const result = await pollAutopart504cMailboxFn();
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.message(result.data.reason);
    await load();
  }

  async function openDetail(runId: string) {
    setDetailBusy(true);
    setDetail(null);
    const result = await getAutopart504cImportRunDetailFn({ data: { runId } });
    setDetailBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setDetail(result.data);
  }

  return (
    <section
      data-admin-section="autopart-504c-feed"
      className="space-y-5 rounded-lg border border-border bg-surface/30 p-4 sm:p-5 lg:col-span-2"
    >
      <div>
        <h2 className="font-display text-lg font-semibold uppercase">
          Autopart invoice / despatch feed
        </h2>
        <p className="mt-1 max-w-3xl text-[13px] text-steel">
          {settings?.runtimeMode === "RETIRED"
            ? "Legacy 504C is retired. Historical imports remain readable. Order fulfilment uses 504 + TRM21QC."
            : "Report 504C — Listing of Invoices and Credits by Customer. Automatic mailbox import stays off until Autopart configures the scheduled report email. Upload a test file for a predictive dry-run (what would happen) without mutating orders."}
        </p>
      </div>

      {settings?.runtimeMode === "RETIRED" ? (
        <p
          className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-foreground"
          role="status"
        >
          504C Invoice Feed is RETIRED. Settings, polling, and live apply are disabled. Import
          history below is retained for audit.
        </p>
      ) : null}

      {error ? (
        <p className="text-[13px] text-warn" role="status">
          {error}
        </p>
      ) : null}

      <div className="rounded-md border border-border bg-ink/40 p-4">
        <dl className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-center justify-between gap-2 rounded border border-border/60 px-3 py-2">
            <dt className="text-steel">Status</dt>
            <dd>
              <StatusBadge tone={statusTone(settings?.statusLabel ?? "NOT_CONFIGURED")}>
                {settings?.statusLabel === "NOT_CONFIGURED"
                  ? "Not configured"
                  : settings?.statusLabel === "ENABLED"
                    ? "Enabled"
                    : settings?.statusLabel === "RETIRED"
                      ? "Retired"
                      : "Disabled"}
              </StatusBadge>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded border border-border/60 px-3 py-2">
            <dt className="text-steel">Automatic polling</dt>
            <dd>
              <StatusBadge tone={settings?.automaticPolling === "ON" ? "good" : "warn"}>
                {settings?.automaticPolling ?? "OFF"}
              </StatusBadge>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2 rounded border border-border/60 px-3 py-2 sm:col-span-2 lg:col-span-1">
            <dt className="text-steel">Schedule</dt>
            <dd className="text-right text-[12px]">
              {settings?.scheduleLabel ?? "13:00 · 16:00 Europe/London"}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] text-steel">
          Intended production schedule: 13:00 and 16:00 Europe/London on working days. Coolify cron
          is not required — the in-app scheduler ticks this feed only when explicitly enabled.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-start gap-3 rounded-md border border-border/80 px-3 py-3 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={configuredDraft}
            onChange={(e) => setConfiguredDraft(e.target.checked)}
            disabled={settings?.runtimeMode === "RETIRED"}
          />
          <span>
            <span className="font-semibold">Mark configured</span>
            <span className="mt-1 block text-steel">
              Set only after Autopart confirms the 504C report email is being sent to AB.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-md border border-border/80 px-3 py-3 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={enabledDraft}
            onChange={(e) => setEnabledDraft(e.target.checked)}
            disabled={!configuredDraft || settings?.runtimeMode === "RETIRED"}
          />
          <span>
            <span className="font-semibold">Enable automatic import</span>
            <span className="mt-1 block text-steel">
              Requires configured. Default remains OFF for production until a later enable task.
            </span>
          </span>
        </label>
        <Field label="Allowed sender (future)">
          <input
            className={inputClass}
            value={senderDraft}
            onChange={(e) => setSenderDraft(e.target.value)}
            placeholder="reports@autopart.example"
            autoComplete="off"
            disabled={settings?.runtimeMode === "RETIRED"}
          />
        </Field>
        <div className="flex items-end gap-2">
          <button
            type="button"
            className={buttonClass(true)}
            disabled={busy !== null || settings?.runtimeMode === "RETIRED"}
            onClick={() => void saveSettings()}
          >
            {busy === "save" ? "Saving…" : "Save feed settings"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.csv,.rpt,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onDryRunFile(file);
          }}
        />
        <button
          type="button"
          className={buttonClass()}
          disabled={busy !== null}
          onClick={() => fileRef.current?.click()}
        >
          {busy === "dry-run" ? "Parsing…" : "Upload 504C test file"}
        </button>
        <button
          type="button"
          className={buttonClass()}
          disabled={
            busy !== null ||
            settings?.automaticPolling !== "ON" ||
            settings?.runtimeMode === "RETIRED"
          }
          title={
            settings?.runtimeMode === "RETIRED"
              ? "504C is retired — mailbox polling is off"
              : settings?.automaticPolling === "ON"
                ? "Poll mailbox now"
                : "Live mailbox poll is disabled until the feed is enabled"
          }
          onClick={() => void onPollNow()}
        >
          {busy === "poll" ? "Polling…" : "Poll mailbox now"}
        </button>
      </div>

      {preview ? (
        <div className="rounded-md border border-border p-4 text-[13px]" data-504c-preview="dry-run">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold uppercase">
              Dry-run preview — what would happen
            </h3>
            <StatusBadge tone="good">PREDICTIVE</StatusBadge>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded border border-border/60 px-2 py-1.5">
              <dt className="text-[10px] uppercase text-steel">AB matches</dt>
              <dd className="num text-base font-semibold">{preview.summary.abMatches}</dd>
            </div>
            <div className="rounded border border-border/60 px-2 py-1.5">
              <dt className="text-[10px] uppercase text-steel">Would create</dt>
              <dd className="num text-base font-semibold">{preview.summary.wouldCreate}</dd>
            </div>
            <div className="rounded border border-border/60 px-2 py-1.5">
              <dt className="text-[10px] uppercase text-steel">Duplicates</dt>
              <dd className="num text-base font-semibold">{preview.summary.duplicates}</dd>
            </div>
            <div className="rounded border border-border/60 px-2 py-1.5">
              <dt className="text-[10px] uppercase text-steel">Would despatch</dt>
              <dd className="num text-base font-semibold">{preview.summary.wouldDespatch}</dd>
            </div>
            <div className="rounded border border-border/60 px-2 py-1.5">
              <dt className="text-[10px] uppercase text-steel">Issues</dt>
              <dd className="num text-base font-semibold">{preview.summary.issues}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[12px] text-steel">
            Rows {preview.rowsRead} · Credits {preview.abCredits} · Non-AB ignored{" "}
            {preview.nonAbRows} · Malformed {preview.malformedRows}. No invoices, status changes,
            reservations, or emails were written.
          </p>
          {preview.plan.filter((p) => p.kind === "INVOICE" || p.kind === "CREDIT").length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-[12px]">
                <thead className="border-b border-border text-[10px] uppercase text-steel">
                  <tr>
                    <th className="px-2 py-1">AB order</th>
                    <th className="px-2 py-1">Document</th>
                    <th className="px-2 py-1">Type</th>
                    <th className="px-2 py-1 text-right">Goods</th>
                    <th className="px-2 py-1 text-right">VAT</th>
                    <th className="px-2 py-1 text-right">Total</th>
                    <th className="px-2 py-1">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.plan
                    .filter((p) => p.result !== "NON_AB")
                    .map((row) => (
                      <tr
                        key={`${row.documentNumber}-${row.abOrderNumber ?? "x"}-${row.kind}`}
                        className="border-b border-border/50"
                      >
                        <td className="num px-2 py-1">{row.abOrderNumber ?? "—"}</td>
                        <td className="num px-2 py-1">{row.documentNumber}</td>
                        <td className="px-2 py-1">{row.kind}</td>
                        <td className="num px-2 py-1 text-right">{gbp(row.goods)}</td>
                        <td className="num px-2 py-1 text-right">{gbp(row.vat)}</td>
                        <td className="num px-2 py-1 text-right">{gbp(row.value)}</td>
                        <td className="px-2 py-1">
                          <StatusBadge tone={resultTone(row.result)}>{row.resultLabel}</StatusBadge>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-steel">No AB invoice/credit rows in this file.</p>
          )}
          <button
            type="button"
            className={cn(buttonClass(), "mt-3")}
            onClick={() => void openDetail(preview.runId)}
          >
            View full dry-run detail
          </button>
        </div>
      ) : null}

      <div>
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide">Import history</h3>
        <p className="mt-1 text-[12px] text-steel">
          Dry-run columns show what <span className="text-foreground">would</span> happen. Live
          imports show what <span className="text-foreground">did</span> happen.
        </p>
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="min-w-full text-left text-[13px]">
            <thead className="border-b border-border bg-ink/50 text-[11px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right" title="AB order matches">
                  AB
                </th>
                <th className="px-3 py-2 text-right" title="Invoices created (live) or would create (dry-run)">
                  New
                </th>
                <th className="px-3 py-2 text-right">Dup</th>
                <th className="px-3 py-2 text-right" title="Despatched (live) or would despatch (dry-run)">
                  Desp.
                </th>
                <th className="px-3 py-2 text-right">Issues</th>
                <th className="px-3 py-2"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-4 text-steel">
                    No 504C import runs yet
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr key={run.id}>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatOrDash(formatOperationalDateTime(run.startedAt))}
                    </td>
                    <td className="px-3 py-2">
                      {run.source}
                      {run.filename ? (
                        <span className="mt-0.5 block text-[11px] text-steel">{run.filename}</span>
                      ) : null}
                      {run.isDryRun ? (
                        <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-primary">
                          Preview
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={runTone(run.status)}>{run.status}</StatusBadge>
                    </td>
                    <td className="num px-3 py-2 text-right">{run.ordersMatched}</td>
                    <td
                      className="num px-3 py-2 text-right"
                      title={run.isDryRun ? "Would create (predictive)" : "Invoices created"}
                    >
                      {run.newInvoices}
                      {run.isDryRun ? (
                        <span className="block text-[9px] uppercase text-steel">would</span>
                      ) : null}
                    </td>
                    <td className="num px-3 py-2 text-right">{run.duplicates}</td>
                    <td
                      className="num px-3 py-2 text-right"
                      title={run.isDryRun ? "Would despatch (predictive)" : "Orders despatched"}
                    >
                      {run.ordersDespatched}
                      {run.isDryRun ? (
                        <span className="block text-[9px] uppercase text-steel">would</span>
                      ) : null}
                    </td>
                    <td className="num px-3 py-2 text-right">{run.issues}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-[11px] font-semibold uppercase tracking-wide text-primary hover:underline"
                        onClick={() => void openDetail(run.id)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailBusy || detail ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="504C import run detail"
        >
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-surface p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold uppercase">
                  {detail?.isDryRun ? "Dry-run detail — what would happen" : "Import run detail — what happened"}
                </h3>
                {detail ? (
                  <p className="mt-1 text-[12px] text-steel">
                    {detail.source}
                    {detail.filename ? ` · ${detail.filename}` : ""} ·{" "}
                    {formatOrDash(formatOperationalDateTime(detail.startedAt))}
                  </p>
                ) : (
                  <p className="mt-1 text-[12px] text-steel">Loading…</p>
                )}
              </div>
              <button
                type="button"
                className={buttonClass()}
                onClick={() => setDetail(null)}
              >
                Close
              </button>
            </div>

            {detail ? (
              <div className="mt-4 space-y-4 text-[13px]">
                <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div className="rounded border border-border/60 px-2 py-1.5">
                    <dt className="text-[10px] uppercase text-steel">
                      {detail.isDryRun ? "AB matches" : "AB matches"}
                    </dt>
                    <dd className="num text-base font-semibold">{detail.summary.abMatches}</dd>
                  </div>
                  <div className="rounded border border-border/60 px-2 py-1.5">
                    <dt className="text-[10px] uppercase text-steel">
                      {detail.isDryRun ? "Would create" : "Created"}
                    </dt>
                    <dd className="num text-base font-semibold">
                      {detail.isDryRun ? detail.summary.wouldCreate : detail.newInvoices}
                    </dd>
                  </div>
                  <div className="rounded border border-border/60 px-2 py-1.5">
                    <dt className="text-[10px] uppercase text-steel">Duplicates</dt>
                    <dd className="num text-base font-semibold">{detail.summary.duplicates}</dd>
                  </div>
                  <div className="rounded border border-border/60 px-2 py-1.5">
                    <dt className="text-[10px] uppercase text-steel">
                      {detail.isDryRun ? "Would despatch" : "Despatched"}
                    </dt>
                    <dd className="num text-base font-semibold">
                      {detail.isDryRun ? detail.summary.wouldDespatch : detail.ordersDespatched}
                    </dd>
                  </div>
                  <div className="rounded border border-border/60 px-2 py-1.5">
                    <dt className="text-[10px] uppercase text-steel">Issues</dt>
                    <dd className="num text-base font-semibold">{detail.issues}</dd>
                  </div>
                </dl>

                {detail.nonAbRows > 0 ? (
                  <p className="text-[12px] text-steel">
                    Non-AB rows ignored: {detail.nonAbRows} (not errors)
                  </p>
                ) : null}

                {detail.plan.length === 0 ? (
                  <p className="text-steel">
                    {detail.isDryRun
                      ? "No AB plan rows stored for this run."
                      : "Live runs before predictive diagnostics may not include a detailed plan."}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {detail.plan.map((row) => (
                      <article
                        key={`${row.documentNumber}-${row.kind}-${row.abOrderNumber ?? "x"}`}
                        className="rounded-md border border-border/80 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold">
                            {row.abOrderNumber ?? "—"} · {row.documentNumber}
                          </div>
                          <StatusBadge tone={resultTone(row.result)}>{row.resultLabel}</StatusBadge>
                        </div>
                        <dl className="mt-2 grid gap-1 text-[12px] sm:grid-cols-2">
                          <div>
                            <dt className="text-steel">Type</dt>
                            <dd>{row.kind}</dd>
                          </div>
                          <div>
                            <dt className="text-steel">Account</dt>
                            <dd className="num">{row.accountCode || "—"}</dd>
                          </div>
                          <div>
                            <dt className="text-steel">504C Goods / VAT / Total</dt>
                            <dd className="num">
                              {gbp(row.goods)} · {gbp(row.vat)} · {gbp(row.value)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-steel">Fulfilment</dt>
                            <dd>
                              {row.fulfilmentFrom && row.fulfilmentTo && row.wouldDespatch
                                ? `${row.fulfilmentFrom} → ${row.fulfilmentTo}`
                                : row.fulfilmentFrom ?? "—"}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-steel">Email</dt>
                            <dd>{row.emailAction}</dd>
                          </div>
                          <div>
                            <dt className="text-steel">Action</dt>
                            <dd>{row.action}</dd>
                          </div>
                        </dl>
                        {row.financial ? (
                          <div className="mt-3 rounded border border-border/50 bg-ink/30 p-2 text-[12px]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold uppercase tracking-wide text-steel">
                                Financial comparison
                              </span>
                              <StatusBadge
                                tone={row.financial.status === "OK" ? "good" : "warn"}
                              >
                                {row.financial.status === "OK" ? "OK" : "MISMATCH"}
                              </StatusBadge>
                            </div>
                            <p className="mt-1 text-[11px] text-steel">
                              504C Goods includes Autopart SDEL delivery. AB net = merchandise goods +
                              delivery snapshot.
                            </p>
                            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 num">
                              <div>
                                <dt className="text-steel">AB goods</dt>
                                <dd>{gbp(row.financial.abGoods)}</dd>
                              </div>
                              <div>
                                <dt className="text-steel">AB delivery</dt>
                                <dd>{gbp(row.financial.abDelivery)}</dd>
                              </div>
                              <div>
                                <dt className="text-steel">Expected net</dt>
                                <dd>{gbp(row.financial.abNet)}</dd>
                              </div>
                              <div>
                                <dt className="text-steel">504C net</dt>
                                <dd>{gbp(row.financial.c504Goods)}</dd>
                              </div>
                              <div>
                                <dt className="text-steel">Expected VAT</dt>
                                <dd>{gbp(row.financial.abVat)}</dd>
                              </div>
                              <div>
                                <dt className="text-steel">504C VAT</dt>
                                <dd>{gbp(row.financial.c504Vat)}</dd>
                              </div>
                              <div>
                                <dt className="text-steel">Expected total</dt>
                                <dd>{gbp(row.financial.abTotal)}</dd>
                              </div>
                              <div>
                                <dt className="text-steel">504C total</dt>
                                <dd>{gbp(row.financial.c504Value)}</dd>
                              </div>
                            </dl>
                          </div>
                        ) : null}
                        {row.livePolicyNote ? (
                          <p className="mt-2 text-[11px] text-steel">{row.livePolicyNote}</p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
