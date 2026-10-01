import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { formatOperationalDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import {
  confirmAutopart504Fn,
  confirmAutopartTrm21qcFn,
  exportOngoingSalesImportDiagnosticsCsvFn,
  getOngoingSalesFeedSettingsFn,
  getOngoingSalesImportRunDetailFn,
  listOngoingSalesImportDiagnosticsFn,
  listOngoingSalesImportRunsFn,
  pollOngoingSalesMailboxFn,
  previewAutopart504Fn,
  previewAutopartTrm21qcFn,
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

  const load = useCallback(async () => {
    const [s, history] = await Promise.all([
      getOngoingSalesFeedSettingsFn(),
      listOngoingSalesImportRunsFn({ data: { limit: 40 } }),
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
      toast.success(
        `504: ${res.data.processed504} · TRM21QC: ${res.data.processedTrm21qc} · duplicates: ${res.data.duplicatesIgnored}`,
      );
      if (res.data.errors.length) toast.error(res.data.errors[0]);
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
            Legacy 504C remains available above until 504 is proven in production.
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
                                {row.reasonCode === "UNMAPPED_CUSTOMER" ? (
                                  <a className="text-cyan underline" href="/admin/customers">
                                    Map account
                                  </a>
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
