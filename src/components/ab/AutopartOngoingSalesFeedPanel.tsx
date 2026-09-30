import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { formatOperationalDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import {
  confirmAutopart504Fn,
  confirmAutopartTrm21qcFn,
  getOngoingSalesFeedSettingsFn,
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
  const [preview504, setPreview504] = useState<string | null>(null);
  const [previewTrm, setPreviewTrm] = useState<string | null>(null);
  const [pending504, setPending504] = useState<{ text: string; filename: string } | null>(null);
  const [pendingTrm, setPendingTrm] = useState<{ text: string; filename: string } | null>(null);

  const load = useCallback(async () => {
    const [s, history] = await Promise.all([
      getOngoingSalesFeedSettingsFn(),
      listOngoingSalesImportRunsFn({ data: { limit: 20 } }),
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
    setPreview504(
      `${res.data.documents} documents · ${res.data.invoices} invoices · ${res.data.credits} credits · AB matches ${res.data.abMatches} · Net goods £${res.data.netGoods} · Gross £${res.data.grossValue}`,
    );
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
    setPreviewTrm(
      `${res.data.rows} lines · ${res.data.documents} documents · ${res.data.creditLines} credit lines · Net sales £${res.data.netSales} (EX VAT) · Unmatched customers ${res.data.unmatchedCustomers}`,
    );
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
          {preview504 ? <p className="text-[12px] text-steel">{preview504}</p> : null}
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
          {previewTrm ? <p className="text-[12px] text-steel">{previewTrm}</p> : null}
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
              <li key={run.id} className="grid gap-1 px-3 py-2 sm:grid-cols-[1fr_auto_auto]">
                <span>
                  {run.type === "ONGOING_504" ? "504" : "TRM21QC"} · {run.filename ?? "—"}
                </span>
                <span className="text-steel">
                  {formatOperationalDateTime(run.createdAt)} · {run.status}
                </span>
                <span className="text-steel">
                  +{run.rowsImported} / ~{run.rowsUpdated} / skip {run.rowsSkipped}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </section>
  );
}
