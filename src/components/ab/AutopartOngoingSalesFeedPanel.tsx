import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { MapAutopartAccountDrawer } from "@/components/ab/MapAutopartAccountDrawer";
import { formatOperationalDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import {
  confirmAutopart504Fn,
  confirmAutopartTrm21qcFn,
  exportOngoingSalesImportDiagnosticsCsvFn,
  get504TrmFulfilmentSettingsFn,
  getOngoingSalesFeedSettingsFn,
  getOngoingSalesImportRunDetailFn,
  listOngoingSalesImportDiagnosticsFn,
  listOngoingSalesImportRunsFn,
  pollOngoingSalesMailboxFn,
  preview504TrmFulfilmentFn,
  previewAutopart504Fn,
  previewAutopartTrm21qcFn,
  update504TrmFulfilmentSettingsFn,
  updateOngoingSalesFeedSettingsFn,
} from "@/server/phase2/fns";

type Settings = Extract<
  Awaited<ReturnType<typeof getOngoingSalesFeedSettingsFn>>,
  { ok: true }
>["data"];
type RunRow = Extract<
  Awaited<ReturnType<typeof listOngoingSalesImportRunsFn>>,
  { ok: true }
>["data"][number];
type RunDetail = Extract<
  Awaited<ReturnType<typeof getOngoingSalesImportRunDetailFn>>,
  { ok: true }
>["data"];
type DiagPage = Extract<
  Awaited<ReturnType<typeof listOngoingSalesImportDiagnosticsFn>>,
  { ok: true }
>["data"];
type Preview504 = Extract<Awaited<ReturnType<typeof previewAutopart504Fn>>, { ok: true }>["data"];
type PreviewTrm = Extract<
  Awaited<ReturnType<typeof previewAutopartTrm21qcFn>>,
  { ok: true }
>["data"];
type PollResult = Extract<
  Awaited<ReturnType<typeof pollOngoingSalesMailboxFn>>,
  { ok: true }
>["data"];
type FulfilmentSettings = Extract<
  Awaited<ReturnType<typeof get504TrmFulfilmentSettingsFn>>,
  { ok: true }
>["data"];
type FulfilmentPreview = Extract<
  Awaited<ReturnType<typeof preview504TrmFulfilmentFn>>,
  { ok: true }
>["data"];

function buttonClass(primary = false) {
  return cn(
    "h-10 rounded-md px-4 text-[12px] font-semibold uppercase tracking-wide disabled:opacity-50",
    primary
      ? "bg-primary text-primary-foreground"
      : "border border-border bg-surface/40 text-foreground hover:bg-surface",
  );
}

function statusTone(enabled: boolean, configured: boolean): Tone {
  if (enabled && configured) return "good";
  if (configured) return "warn";
  return "neutral";
}

function runStatusTone(status: string): Tone {
  if (status === "COMMITTED") return "good";
  if (status === "FAILED" || status === "BLOCKED") return "bad";
  if (status === "PROCESSING") return "warn";
  return "neutral";
}

const DIAG_FILTERS = [
  "ALL",
  "IMPORTED",
  "UPDATED",
  "UNCHANGED",
  "SKIPPED",
  "WARNINGS",
  "ERRORS",
] as const;

export function AutopartOngoingSalesFeedPanel() {
  const file504Ref = useRef<HTMLInputElement>(null);
  const fileTrmRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [configuredDraft, setConfiguredDraft] = useState(false);
  const [enabledDraft, setEnabledDraft] = useState(false);
  const [senderDraft, setSenderDraft] = useState("");
  const [preview504, setPreview504] = useState<Preview504 | null>(null);
  const [previewTrm, setPreviewTrm] = useState<PreviewTrm | null>(null);
  const [pending504, setPending504] = useState<{ text: string; filename: string } | null>(null);
  const [pendingTrm, setPendingTrm] = useState<{ text: string; filename: string } | null>(null);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [diagPage, setDiagPage] = useState<DiagPage | null>(null);
  const [diagFilter, setDiagFilter] = useState<(typeof DIAG_FILTERS)[number]>("ALL");
  const [diagQ, setDiagQ] = useState("");
  const [mapAccount, setMapAccount] = useState<{
    accountCode: string;
    diagnosticId?: string;
  } | null>(null);
  const [pollResult, setPollResult] = useState<PollResult | null>(null);
  const [fulfilment, setFulfilment] = useState<FulfilmentSettings | null>(null);
  const [fulfilmentModeDraft, setFulfilmentModeDraft] = useState<"OFF" | "PREVIEW" | "ACTIVE">("OFF");
  const [fulfilmentFromDraft, setFulfilmentFromDraft] = useState("");
  const [fulfilmentPreview, setFulfilmentPreview] = useState<FulfilmentPreview | null>(null);

  const load = useCallback(async () => {
    const [s, history, fulfilmentSettings] = await Promise.all([
      getOngoingSalesFeedSettingsFn(),
      listOngoingSalesImportRunsFn({ data: { limit: 40 } }),
      get504TrmFulfilmentSettingsFn(),
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
    if (fulfilmentSettings.ok) {
      setFulfilment(fulfilmentSettings.data);
      setFulfilmentModeDraft(fulfilmentSettings.data.fulfilmentMode);
      setFulfilmentFromDraft(fulfilmentSettings.data.fulfilmentFrom?.slice(0, 10) ?? "");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadRunDetail = useCallback(
    async (runId: string, filter = diagFilter, q = diagQ) => {
      setBusy("detail");
      const [d, list] = await Promise.all([
        getOngoingSalesImportRunDetailFn({ data: { runId } }),
        listOngoingSalesImportDiagnosticsFn({
          data: { runId, filter, q, page: 1, pageSize: 100 },
        }),
      ]);
      setBusy(null);
      if (!d.ok) {
        toast.error(d.error);
        return;
      }
      setDetail(d.data);
      if (list.ok) setDiagPage(list.data);
      else setDiagPage(null);
    },
    [diagFilter, diagQ],
  );

  async function openRun(runId: string) {
    setSelectedRunId(runId);
    setDiagFilter("ALL");
    setDiagQ("");
    await loadRunDetail(runId, "ALL", "");
  }

  async function saveSettings() {
    setBusy("save");
    const res = await updateOngoingSalesFeedSettingsFn({
      data: {
        configured: configuredDraft,
        enabled: enabledDraft,
        allowedSender: senderDraft.trim() || null,
      },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Ongoing sales feed settings saved");
    await load();
  }

  async function saveFulfilmentSettings() {
    if (fulfilmentModeDraft === "ACTIVE") {
      const ok = window.confirm(
        "Switching 504/TRM fulfilment to ACTIVE retires legacy 504C. 504 + TRM21QC becomes the only order fulfilment mutator. Continue?",
      );
      if (!ok) return;
    }
    setBusy("fulfilment");
    const res = await update504TrmFulfilmentSettingsFn({
      data: {
        fulfilmentMode: fulfilmentModeDraft,
        fulfilmentFrom: fulfilmentFromDraft || null,
        retire504c: fulfilmentModeDraft === "ACTIVE",
      },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setFulfilment(res.data);
    toast.success(
      res.data.fulfilmentMode === "ACTIVE"
        ? "504/TRM fulfilment is ACTIVE. Legacy 504C is retired."
        : "504/TRM fulfilment settings saved",
    );
    await load();
  }

  async function previewFulfilment() {
    setBusy("fulfilment-preview");
    const res = await preview504TrmFulfilmentFn();
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setFulfilmentPreview(res.data);
    toast.success("504/TRM fulfilment preview generated — no orders were mutated");
  }

  async function on504File(file: File | null) {
    if (!file) return;
    setBusy("preview504");
    const text = await file.text();
    const res = await previewAutopart504Fn({ data: { text, filename: file.name } });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setPending504({ text, filename: file.name });
    setPreview504(res.data);
  }

  async function confirm504() {
    if (!pending504) return;
    setBusy("confirm504");
    const res = await confirmAutopart504Fn({
      data: { text: pending504.text, filename: pending504.filename },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("504 import committed");
    setPending504(null);
    setPreview504(null);
    if (file504Ref.current) file504Ref.current.value = "";
    await load();
  }

  async function onTrmFile(file: File | null) {
    if (!file) return;
    setBusy("previewTrm");
    const text = await file.text();
    const res = await previewAutopartTrm21qcFn({ data: { text, filename: file.name } });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setPendingTrm({ text, filename: file.name });
    setPreviewTrm(res.data);
  }

  async function confirmTrm() {
    if (!pendingTrm) return;
    setBusy("confirmTrm");
    const res = await confirmAutopartTrm21qcFn({
      data: { text: pendingTrm.text, filename: pendingTrm.filename },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("TRM21QC import committed");
    setPendingTrm(null);
    setPreviewTrm(null);
    if (fileTrmRef.current) fileTrmRef.current.value = "";
    await load();
  }

  async function pollNow() {
    setBusy("poll");
    const res = await pollOngoingSalesMailboxFn();
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (!res.data.ran) {
      toast.message(res.data.reason ?? "Poll did not run");
    } else {
      setPollResult(res.data);
      toast.success(
        `504: ${res.data.processed504} · TRM21QC: ${res.data.processedTrm21qc} · duplicates: ${res.data.duplicatesIgnored}`,
      );
      if (res.data.errors.length) toast.error(res.data.errors[0]);
      const skipped = res.data.attachments.filter((a) => a.result === "skipped" || a.result === "failed");
      if (skipped.length) {
        toast.message(
          skipped
            .slice(0, 3)
            .map((a) => `${a.filename}: ${a.detectedType === "NOT_EXAMINED" ? a.skipReason : a.detectedType}`)
            .join(" · "),
        );
      }
    }
    await load();
  }

  async function exportCsv() {
    if (!selectedRunId) return;
    setBusy("export");
    const res = await exportOngoingSalesImportDiagnosticsCsvFn({
      data: { runId: selectedRunId },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const blob = new Blob([res.data.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.data.filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Diagnostics CSV downloaded");
  }

  return (
    <section className="space-y-4 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold uppercase">
            Autopart ongoing sales feeds
          </h2>
          <p className="mt-1 text-[12px] text-steel">
            Autopart 504 — Invoice &amp; Credit Documents · Autopart TRM21QC — Product Sales &amp;
            Credits (NET / EX VAT). Expected email windows 13:00 and 18:00 Europe/London Mon–Fri.
            {fulfilment?.runtime504c === "RETIRED" || fulfilment?.fulfilmentMode === "ACTIVE"
              ? " Legacy 504C is retired. Order fulfilment uses 504 + TRM21QC."
              : " Default fulfilment mode is OFF so legacy 504C can still bridge despatch until 504 + TRM is proven."}
          </p>
        </div>
        {settings ? (
          <StatusBadge tone={statusTone(settings.enabled, settings.configured)}>
            {settings.enabled ? "ENABLED" : settings.configured ? "CONFIGURED / OFF" : "NOT CONFIGURED"}
          </StatusBadge>
        ) : null}
      </div>

      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

      <div className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={configuredDraft}
            onChange={(e) => setConfiguredDraft(e.target.checked)}
          />
          Autopart has configured 504 + TRM21QC emails
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={enabledDraft}
            onChange={(e) => setEnabledDraft(e.target.checked)}
          />
          Enable automatic polling
        </label>
        <Field label="Allowed sender (optional override)">
          <input
            className={inputClass}
            value={senderDraft}
            onChange={(e) => setSenderDraft(e.target.value)}
            placeholder="Uses stock IMAP allow-list when blank"
          />
        </Field>
        <div className="flex items-end gap-2">
          <button type="button" className={buttonClass(true)} disabled={!!busy} onClick={() => void saveSettings()}>
            Save feed settings
          </button>
          <button type="button" className={buttonClass()} disabled={!!busy} onClick={() => void pollNow()}>
            Poll Now
          </button>
        </div>
      </div>

      <div
        data-admin-section="autopart-504-trm-fulfilment"
        className="space-y-3 rounded-lg border border-border p-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-semibold uppercase">
              504 + TRM21QC order fulfilment
            </h3>
            <p className="mt-1 text-[12px] text-steel">
              OFF keeps 504C as the despatch bridge. PREVIEW inspects 504 + TRM without mutating
              orders. ACTIVE retires 504C and becomes the sole fulfilment mutator. Join is Autopart
              document number; AB match is exact AB-###### only.
            </p>
          </div>
          {fulfilment ? (
            <StatusBadge
              tone={
                fulfilment.fulfilmentMode === "ACTIVE"
                  ? "good"
                  : fulfilment.fulfilmentMode === "PREVIEW"
                    ? "warn"
                    : "neutral"
              }
            >
              {fulfilment.fulfilmentMode}
            </StatusBadge>
          ) : null}
        </div>
        <fieldset className="grid gap-2 sm:grid-cols-3">
          {(["OFF", "PREVIEW", "ACTIVE"] as const).map((mode) => (
            <label
              key={mode}
              className="flex items-start gap-2 rounded-md border border-border/80 px-3 py-2 text-[13px]"
            >
              <input
                type="radio"
                name="504-trm-fulfilment-mode"
                checked={fulfilmentModeDraft === mode}
                onChange={() => setFulfilmentModeDraft(mode)}
              />
              <span>
                <span className="font-semibold">{mode}</span>
                <span className="mt-0.5 block text-[11px] text-steel">
                  {mode === "OFF"
                    ? "504C may still despatch"
                    : mode === "PREVIEW"
                      ? "Inspect only — no mutations"
                      : "Retires 504C and applies despatch"}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <Field label="Fulfilment from (UTC date)">
            <input
              type="date"
              className={inputClass}
              value={fulfilmentFromDraft}
              onChange={(e) => setFulfilmentFromDraft(e.target.value)}
            />
          </Field>
          <div className="flex items-end gap-2">
            <button
              type="button"
              className={buttonClass(true)}
              disabled={!!busy}
              onClick={() => void saveFulfilmentSettings()}
            >
              {busy === "fulfilment" ? "Saving…" : "Save fulfilment mode"}
            </button>
            <button
              type="button"
              className={buttonClass()}
              disabled={!!busy}
              onClick={() => void previewFulfilment()}
            >
              {busy === "fulfilment-preview" ? "Previewing…" : "Preview fulfilment"}
            </button>
          </div>
        </div>
        {fulfilment ? (
          <p className="text-[12px] text-steel">
            504C runtime {fulfilment.runtime504c}
            {fulfilment.fulfilmentLastPreviewAt
              ? ` · Last preview ${formatOperationalDateTime(fulfilment.fulfilmentLastPreviewAt)}`
              : ""}
            {fulfilment.fulfilmentLastAppliedAt
              ? ` · Last applied ${formatOperationalDateTime(fulfilment.fulfilmentLastAppliedAt)}`
              : ""}
          </p>
        ) : null}
        {fulfilmentPreview ? (
          <div className="rounded-md border border-border bg-surface/30 p-3 text-[12px]">
            <p className="font-semibold">Preview — no orders mutated</p>
            <p className="mt-1 text-steel">
              Matched {fulfilmentPreview.ordersMatched} · Would partial{" "}
              {fulfilmentPreview.wouldBecomePartial} · Would despatch{" "}
              {fulfilmentPreview.wouldBecomeDespatched} · Review {fulfilmentPreview.reviewRequired} ·
              Waiting {fulfilmentPreview.waiting}
            </p>
            {fulfilmentPreview.orders.length ? (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {fulfilmentPreview.orders.slice(0, 40).map((row) => (
                  <li key={row.orderId}>
                    {row.orderNumber} · {row.previousStatus} → {row.nextStatus ?? "no change"} ·{" "}
                    {row.conceptually}
                    {row.warnings[0] ? ` · ${row.warnings[0]}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-steel">No AB-###### documents in scope.</p>
            )}
          </div>
        ) : null}
      </div>

      {pollResult?.ran && pollResult.attachments.length ? (
        <div className="rounded-lg border border-border p-4">
          <h3 className="font-display text-sm font-semibold uppercase">Last poll attachments</h3>
          <p className="mt-1 text-[12px] text-steel">
            Filenames and content detection only — no mailbox credentials or message headers.
          </p>
          <ul className="mt-3 space-y-2 text-[13px]">
            {pollResult.attachments.map((row, i) => (
              <li key={`${row.filename}-${i}`} className="rounded-md border border-border/70 px-3 py-2">
                <div className="font-mono">{row.filename}</div>
                <div className="text-[12px] text-steel">
                  MIME {row.mime || "unknown"} · Candidate{" "}
                  {row.candidateType === "NOT_CANDIDATE" ? "no" : row.candidateType} · Detected{" "}
                  {row.detectedType}
                </div>
                <div>
                  {row.result === "imported"
                    ? "Imported"
                    : row.result === "duplicate"
                      ? "Duplicate"
                      : row.result === "failed"
                        ? `Failed — ${row.skipReason ?? "import failed"}`
                        : `Skipped${row.skipReason ? ` — ${row.skipReason}` : ""}`}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : settings?.lastError ? (
        <p className="rounded-lg border border-border px-4 py-3 text-[13px] text-steel whitespace-pre-wrap">
          {settings.lastError}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-display text-sm font-semibold uppercase">
            Autopart 504 — Invoice &amp; Credit Documents
          </h3>
          <input
            ref={file504Ref}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="text-[12px]"
            onChange={(e) => void on504File(e.target.files?.[0] ?? null)}
          />
          {preview504 ? (
            <Preview504Block preview={preview504} filename={pending504?.filename ?? "504.csv"} />
          ) : null}
          <button
            type="button"
            className={buttonClass(true)}
            disabled={!pending504 || !!busy}
            onClick={() => void confirm504()}
          >
            Confirm 504 import
          </button>
        </div>

        <div className="space-y-3 rounded-lg border border-border p-4">
          <h3 className="font-display text-sm font-semibold uppercase">
            Autopart TRM21QC — Product Sales &amp; Credits
          </h3>
          <p className="text-[11px] text-steel">Sales values are NET / EX VAT (not gross).</p>
          <input
            ref={fileTrmRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="text-[12px]"
            onChange={(e) => void onTrmFile(e.target.files?.[0] ?? null)}
          />
          {previewTrm ? (
            <PreviewTrmBlock preview={previewTrm} filename={pendingTrm?.filename ?? "TRM21QC.csv"} />
          ) : null}
          <button
            type="button"
            className={buttonClass(true)}
            disabled={!pendingTrm || !!busy}
            onClick={() => void confirmTrm()}
          >
            Confirm TRM21QC import
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-steel">
          Import history
        </div>
        <ul className="divide-y divide-border text-[12px]">
          {runs.length === 0 ? (
            <li className="px-3 py-3 text-steel">No ongoing 504 / TRM21QC imports yet.</li>
          ) : (
            runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  className="grid w-full gap-1 px-3 py-2 text-left hover:bg-surface/60 sm:grid-cols-[1fr_auto_auto]"
                  onClick={() => void openRun(run.id)}
                >
                  <span>
                    <span className="font-semibold">{run.feed}</span> · {run.filename ?? "—"}
                    <span className="ml-2 text-steel">{run.source.replace(/_/g, " ")}</span>
                  </span>
                  <span className="text-steel">
                    {formatOperationalDateTime(run.createdAt)}
                    {run.completedAt
                      ? ` → ${formatOperationalDateTime(run.completedAt)}`
                      : ""}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={runStatusTone(run.status)}>{run.status}</StatusBadge>
                    <span className="text-steel">
                      Inserted {run.rowsImported} · Updated {run.rowsUpdated}
                      {run.rowsUnchanged ? ` · Unchanged ${run.rowsUnchanged}` : ""}
                      {" · "}Skipped {run.rowsSkipped}
                      {run.warnings ? ` · Warnings ${run.warnings}` : ""}
                      {run.errors ? ` · Errors ${run.errors}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      <Drawer
        open={Boolean(selectedRunId && detail)}
        onClose={() => {
          setSelectedRunId(null);
          setDetail(null);
          setDiagPage(null);
        }}
        title={detail ? `${detail.feed} import run` : "Import run"}
        {...(detail?.filename ? { sub: detail.filename } : {})}
        width="xl"
        footer={
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass()} disabled={!!busy} onClick={() => void exportCsv()}>
              Export run diagnostics CSV
            </button>
            <button
              type="button"
              className={buttonClass()}
              onClick={() => {
                setSelectedRunId(null);
                setDetail(null);
              }}
            >
              Close
            </button>
          </div>
        }
      >
        {detail ? (
          <div className="space-y-4 p-4 text-[13px]">
            <dl className="grid gap-2 sm:grid-cols-2">
              <Metric label="Feed" value={detail.feed} />
              <Metric label="Status" value={detail.status} />
              <Metric label="Source" value={detail.source.replace(/_/g, " ")} />
              <Metric
                label="Duration"
                value={
                  detail.durationSeconds == null ? "—" : `${detail.durationSeconds}s`
                }
              />
              <Metric label="Started" value={formatOperationalDateTime(detail.startedAt) ?? "—"} />
              <Metric
                label="Finished"
                value={formatOperationalDateTime(detail.completedAt) ?? "—"}
              />
              <Metric label="Total source rows" value={String(detail.rowsRead)} />
              <Metric label="Inserted" value={String(detail.counts.inserted)} />
              <Metric label="Updated" value={String(detail.counts.updated)} />
              <Metric label="Unchanged" value={String(detail.counts.unchanged)} />
              <Metric label="Skipped" value={String(detail.counts.skipped)} />
              <Metric label="Warnings" value={String(detail.warnings)} />
              <Metric label="Errors" value={String(detail.errors)} />
            </dl>

            <FeedMetricsBlock detail={detail} />

            {detail.aggregateNote ? (
              <p className="rounded-md border border-border bg-surface/40 px-3 py-2 text-[12px] text-steel">
                {detail.aggregateNote}
              </p>
            ) : null}

            {detail.errors > 0 ? (
              <div className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-[12px]">
                <p className="font-semibold text-bad">
                  {detail.errors} error{detail.errors === 1 ? "" : "s"} in this run
                </p>
                <p className="mt-1 text-steel">
                  Filter <span className="font-semibold">Errors</span> for row-level parse failures
                  (e.g. <span className="font-semibold">INVALID_NET_SALES</span>,{" "}
                  <span className="font-semibold">MISSING_DOCUMENT</span>,{" "}
                  <span className="font-semibold">UNRECOGNISED_ROW_TYPE</span>). Unmapped customers
                  and NOT_IN_AB_CATALOGUE warnings are not counted as errors.
                </p>
                {detail.parserErrors?.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-steel">
                    {detail.parserErrors.slice(0, 5).map((msg, i) => (
                      <li key={`${i}-${msg.slice(0, 40)}`}>{msg}</li>
                    ))}
                  </ul>
                ) : null}
                <button
                  type="button"
                  className="mt-2 text-[11px] font-semibold uppercase text-cyan underline"
                  onClick={() => {
                    setDiagFilter("ERRORS");
                    if (selectedRunId) void loadRunDetail(selectedRunId, "ERRORS", diagQ);
                  }}
                >
                  Show errors
                </button>
              </div>
            ) : null}

            <p className="text-[12px]">
              <a href="/admin/customers/autopart-accounts" className="font-semibold text-cyan underline">
                Open Autopart Account Mapping workspace
              </a>{" "}
              <span className="text-steel">to resolve multiple unmapped accounts.</span>
            </p>

            {detail.hasRowDiagnostics ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {DIAG_FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={cn(
                        "h-8 rounded-md border px-2 text-[10px] font-semibold uppercase",
                        diagFilter === f
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-steel",
                      )}
                      onClick={() => {
                        setDiagFilter(f);
                        if (selectedRunId) void loadRunDetail(selectedRunId, f, diagQ);
                      }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <Field label="Search">
                  <input
                    className={inputClass}
                    value={diagQ}
                    placeholder={
                      detail.feed === "504"
                        ? "Document, customer account, AB order…"
                        : "Document, customer account, SKU…"
                    }
                    onChange={(e) => setDiagQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && selectedRunId) {
                        void loadRunDetail(selectedRunId, diagFilter, diagQ);
                      }
                    }}
                  />
                </Field>
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="min-w-full text-left text-[11px]">
                    <thead className="bg-surface/50 text-steel">
                      <tr>
                        <th className="px-2 py-1.5 font-semibold">Row</th>
                        <th className="px-2 py-1.5 font-semibold">Status</th>
                        <th className="px-2 py-1.5 font-semibold">Reason</th>
                        <th className="px-2 py-1.5 font-semibold">Account</th>
                        <th className="px-2 py-1.5 font-semibold">Document</th>
                        <th className="px-2 py-1.5 font-semibold">SKU</th>
                        <th className="px-2 py-1.5 font-semibold">Qty</th>
                        <th className="px-2 py-1.5 font-semibold">Net sales</th>
                        <th className="px-2 py-1.5 font-semibold">Links</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diagPage && "items" in diagPage && diagPage.items.length ? (
                        diagPage.items.map((row) => (
                          <tr key={row.id} className="border-t border-border align-top">
                            <td className="px-2 py-1.5">{row.rowNumber ?? "—"}</td>
                            <td className="px-2 py-1.5">{row.status}</td>
                            <td className="px-2 py-1.5">
                              <div className="font-semibold">{row.reasonCode}</div>
                              <div className="text-steel">{row.reason}</div>
                            </td>
                            <td className="px-2 py-1.5">{row.customerAccount ?? "—"}</td>
                            <td className="px-2 py-1.5">
                              {row.documentReference ?? "—"}
                              {row.documentDate ? (
                                <div className="text-steel">{row.documentDate}</div>
                              ) : null}
                            </td>
                            <td className="px-2 py-1.5">{row.sku ?? "—"}</td>
                            <td className="px-2 py-1.5 num">{row.quantity ?? "—"}</td>
                            <td className="px-2 py-1.5 num">{row.salesNet ?? "—"}</td>
                            <td className="px-2 py-1.5">
                              <div className="flex flex-col gap-1">
                                {row.links.customer ? (
                                  <a className="text-cyan underline" href={row.links.customer}>
                                    Customer
                                  </a>
                                ) : null}
                                {row.reasonCode === "UNMAPPED_CUSTOMER" && row.customerAccount ? (
                                  <button
                                    type="button"
                                    className="text-left text-cyan underline"
                                    onClick={() =>
                                      setMapAccount({
                                        accountCode: row.customerAccount!,
                                        diagnosticId: row.id,
                                      })
                                    }
                                  >
                                    Map account
                                  </button>
                                ) : null}
                                {row.links.productsSearch &&
                                (row.reasonCode === "NOT_IN_AB_CATALOGUE" || row.isWarning) ? (
                                  <a className="text-cyan underline" href={row.links.productsSearch}>
                                    Find SKU
                                  </a>
                                ) : null}
                                {row.abOrderReference ? (
                                  <a
                                    className="text-cyan underline"
                                    href={`/admin/orders?q=${encodeURIComponent(row.abOrderReference)}`}
                                  >
                                    {row.abOrderReference}
                                  </a>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={9} className="px-2 py-3 text-steel">
                            No diagnostic rows for this filter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        ) : (
          <p className="p-4 text-[13px] text-steel">Loading…</p>
        )}
      </Drawer>

      <MapAutopartAccountDrawer
        open={Boolean(mapAccount)}
        accountCode={mapAccount?.accountCode ?? ""}
        {...(selectedRunId ? { importRunId: selectedRunId } : {})}
        {...(mapAccount?.diagnosticId ? { diagnosticId: mapAccount.diagnosticId } : {})}
        onClose={() => setMapAccount(null)}
        onMapped={() => {
          if (selectedRunId) void loadRunDetail(selectedRunId, diagFilter, diagQ);
        }}
      />
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-steel">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function FeedMetricsBlock({ detail }: { detail: RunDetail }) {
  const m = detail.feedMetrics as Record<string, number>;
  const entries = Object.entries(m);
  if (!entries.length) return null;
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-steel">
        {detail.feed} metrics
      </h4>
      <dl className="grid gap-2 sm:grid-cols-2">
        {entries.map(([k, v]) => (
          <Metric
            key={k}
            label={k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
            value={String(v)}
          />
        ))}
      </dl>
    </div>
  );
}

function Preview504Block({ preview, filename }: { preview: Preview504; filename: string }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface/30 p-3 text-[12px]">
      <p className="font-semibold">Preview — {filename} (not committed)</p>
      <p className="text-steel">
        Detected feed: 504 · Documents {preview.documents} · Invoices {preview.invoices} · Credits{" "}
        {preview.credits}
      </p>
      <p>
        Would insert {preview.wouldInsert} · Would update/enrich {preview.wouldUpdate} · Would skip{" "}
        {preview.wouldSkip}
        {preview.errorCount ? ` · Errors ${preview.errorCount}` : ""}
        {preview.warningCount ? ` · Warnings ${preview.warningCount}` : ""}
      </p>
      <p className="text-steel">
        Net goods £{preview.netGoods} (EX VAT) · Gross £{preview.grossValue} · AB matches{" "}
        {preview.abMatches}
      </p>
      {preview.diagnostics.filter((d) => d.status === "SKIPPED" || d.status === "ERROR").length ? (
        <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px] text-steel">
          {preview.diagnostics
            .filter((d) => d.status === "SKIPPED" || d.status === "ERROR" || d.isWarning)
            .slice(0, 40)
            .map((d, i) => (
              <li key={`${d.rowNumber}-${i}`}>
                Row {d.rowNumber ?? "—"} · {d.reasonCode}: {d.reason}
                {d.documentReference ? ` · Doc ${d.documentReference}` : ""}
              </li>
            ))}
        </ul>
      ) : (
        <p className="text-[11px] text-steel">No skip/warning/error rows in preview.</p>
      )}
    </div>
  );
}

function PreviewTrmBlock({ preview, filename }: { preview: PreviewTrm; filename: string }) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-surface/30 p-3 text-[12px]">
      <p className="font-semibold">Preview — {filename} (not committed)</p>
      <p className="text-steel">
        Detected feed: TRM21QC · Lines {preview.rows} · Documents {preview.documents} · Credit lines{" "}
        {preview.creditLines}
      </p>
      <p>
        Would insert {preview.wouldInsert} · Would update/enrich {preview.wouldUpdate} · Would skip{" "}
        {preview.wouldSkip}
        {preview.errorCount ? ` · Errors ${preview.errorCount}` : ""}
        {preview.warningCount ? ` · Warnings ${preview.warningCount}` : ""}
      </p>
      <p className="text-steel">
        Net sales £{preview.netSales} (EX VAT) · Unmapped customers {preview.unmatchedCustomers} ·
        Not in catalogue {preview.notInCatalogue}
      </p>
      {preview.diagnostics.filter(
        (d) => d.status === "SKIPPED" || d.status === "ERROR" || d.isWarning,
      ).length ? (
        <ul className="max-h-40 space-y-1 overflow-y-auto text-[11px] text-steel">
          {preview.diagnostics
            .filter((d) => d.status === "SKIPPED" || d.status === "ERROR" || d.isWarning)
            .slice(0, 40)
            .map((d, i) => (
              <li key={`${d.rowNumber}-${i}`}>
                Row {d.rowNumber ?? "—"} · {d.reasonCode}: {d.reason}
                {d.sku ? ` · ${d.sku}` : ""}
                {d.documentReference ? ` · Doc ${d.documentReference}` : ""}
                {d.customerAccount ? ` · ${d.customerAccount}` : ""}
              </li>
            ))}
        </ul>
      ) : (
        <p className="text-[11px] text-steel">No skip/warning/error rows in preview.</p>
      )}
    </div>
  );
}
