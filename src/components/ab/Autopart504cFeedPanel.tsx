import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { formatOperationalDateTime, formatOrDash } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import {
  dryRunAutopart504cFn,
  getAutopart504cFeedSettingsFn,
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

function statusTone(label: string): Tone {
  if (label === "ENABLED") return "good";
  if (label === "DISABLED") return "warn";
  return "neutral";
}

function runTone(status: string): Tone {
  if (status === "SUCCESS" || status === "DRY_RUN") return "good";
  if (status === "PARTIAL") return "warn";
  if (status === "FAILED") return "bad";
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

export function Autopart504cFeedPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [preview, setPreview] = useState<DryRun | null>(null);
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
      toast.success("504C dry-run complete — no orders mutated");
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
          Report 504C — Listing of Invoices and Credits by Customer. Automatic mailbox import stays
          off until Autopart configures the scheduled report email. Use dry-run upload to test the
          parser safely.
        </p>
      </div>

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
            <dd className="text-right text-[12px]">{settings?.scheduleLabel ?? "13:00 · 16:00 Europe/London"}</dd>
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
            disabled={!configuredDraft}
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
          />
        </Field>
        <div className="flex items-end gap-2">
          <button
            type="button"
            className={buttonClass(true)}
            disabled={busy !== null}
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
          disabled={busy !== null || settings?.automaticPolling !== "ON"}
          title={
            settings?.automaticPolling === "ON"
              ? "Poll mailbox now"
              : "Live mailbox poll is disabled until the feed is enabled"
          }
          onClick={() => void onPollNow()}
        >
          {busy === "poll" ? "Polling…" : "Poll mailbox now"}
        </button>
      </div>

      {preview ? (
        <div className="rounded-md border border-border p-4 text-[13px]">
          <h3 className="font-display text-sm font-semibold uppercase">Dry-run preview</h3>
          <p className="mt-2 text-steel">
            Rows {preview.rowsRead} · AB refs {preview.abReferencesFound} · Credits {preview.abCredits}{" "}
            · Non-AB {preview.nonAbRows} · Malformed {preview.malformedRows}
          </p>
          {preview.unmatchedAbRefs.length > 0 ? (
            <p className="mt-2 text-warn">
              Unmatched AB refs: {preview.unmatchedAbRefs.join(", ")}
            </p>
          ) : null}
          {preview.abInvoices.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-[12px]">
                <thead className="border-b border-border text-[10px] uppercase text-steel">
                  <tr>
                    <th className="px-2 py-1">Document</th>
                    <th className="px-2 py-1">AB order</th>
                    <th className="px-2 py-1">Match</th>
                    <th className="px-2 py-1 text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.abInvoices.map((row) => (
                    <tr key={`${row.documentNumber}-${row.abOrderNumber}`} className="border-b border-border/50">
                      <td className="num px-2 py-1">{row.documentNumber}</td>
                      <td className="num px-2 py-1">{row.abOrderNumber}</td>
                      <td className="px-2 py-1">{row.match}</td>
                      <td className="num px-2 py-1 text-right">{row.value ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-steel">No AB invoice rows in this file.</p>
          )}
        </div>
      ) : null}

      <div>
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide">Import history</h3>
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="min-w-full text-left text-[13px]">
            <thead className="border-b border-border bg-ink/50 text-[11px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">AB</th>
                <th className="px-3 py-2 text-right">New</th>
                <th className="px-3 py-2 text-right">Dup</th>
                <th className="px-3 py-2 text-right">Despatched</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-4 text-steel">
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
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={runTone(run.status)}>{run.status}</StatusBadge>
                    </td>
                    <td className="num px-3 py-2 text-right">{run.abReferencesFound}</td>
                    <td className="num px-3 py-2 text-right">{run.newInvoices}</td>
                    <td className="num px-3 py-2 text-right">{run.duplicates}</td>
                    <td className="num px-3 py-2 text-right">{run.ordersDespatched}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
