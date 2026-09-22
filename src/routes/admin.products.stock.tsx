import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { Field, inputClass } from "@/components/ab/Drawer";
import {
  getStockSyncRunFn,
  listStockSyncRunsFn,
  listUnmatchedStockSkusFn,
  pollImapNowFn,
  runManualStockSyncFn,
  saveImapSettingsFn,
  stockOperationsOverviewFn,
  testImapConnectionFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/admin/products/stock")({
  head: () => ({ meta: [{ title: "Autopart stock — Automotive Brands Admin" }] }),
  component: AutopartStockOps,
});

type Overview = Extract<Awaited<ReturnType<typeof stockOperationsOverviewFn>>, { ok: true }>["data"];
type RunRow = Extract<Awaited<ReturnType<typeof listStockSyncRunsFn>>, { ok: true }>["data"][number];
type UnmatchedList = Extract<Awaited<ReturnType<typeof listUnmatchedStockSkusFn>>, { ok: true }>["data"];
type UnmatchedRow = UnmatchedList["items"][number];
type RunDetail = Extract<Awaited<ReturnType<typeof getStockSyncRunFn>>, { ok: true }>["data"];

function statusTone(status: string): Tone {
  if (status === "SUCCESS") return "good";
  if (status === "PARTIAL" || status === "RUNNING") return "warn";
  if (status === "FAILED") return "bad";
  return "warn";
}

function formatUtc(value: string | null | undefined) {
  if (!value) return "—";
  return `${new Date(value).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`;
}

type ActionNotice = { tone: "good" | "warn" | "bad"; title: string; detail: string };

type SyncResult = {
  runId?: string | null;
  status?: string;
  dryRun?: boolean;
  rowsRead?: number;
  matched?: number;
  wouldUpdate?: number;
  updated?: number;
  unmatched?: number;
  unchanged?: number;
  invalid?: number;
  duplicates?: number;
  summary?: string | null;
  errorSummary?: string | null;
  emailsExamined?: number;
  attachmentFilename?: string;
};

function buttonClass(primary = false) {
  return cn(
    "h-10 rounded-md px-4 text-[12px] font-semibold uppercase tracking-wide disabled:cursor-wait disabled:opacity-50",
    primary
      ? "bg-primary text-primary-foreground"
      : "border border-border bg-surface/40 text-foreground hover:bg-surface",
  );
}

function noticeFromSync(kind: string, data: SyncResult): ActionNotice {
  const counts =
    data.summary ??
    [
      `Rows read: ${data.rowsRead ?? 0}`,
      `AB products matched: ${data.matched ?? 0}`,
      data.dryRun ? `Would update: ${data.wouldUpdate ?? 0}` : `Updated: ${data.updated ?? 0}`,
      `Unchanged: ${data.unchanged ?? 0}`,
      `Not in AB catalogue: ${data.unmatched ?? 0}`,
      `Invalid: ${data.invalid ?? 0}`,
      data.duplicates ? `Duplicates: ${data.duplicates}` : null,
    ]
      .filter(Boolean)
      .join(". ");
  const extra = [
    data.attachmentFilename ? `Attachment ${data.attachmentFilename}` : null,
    data.emailsExamined != null ? `${data.emailsExamined} email(s) examined` : null,
    data.errorSummary,
  ]
    .filter(Boolean)
    .join(". ");
  if (data.status === "SKIPPED" || data.status === "FAILED" || (data.runId == null && !(data.rowsRead ?? 0))) {
    return {
      tone: "warn",
      title: `${kind}: no stock was changed`,
      detail: extra || "No 231PO3NEW feed was acquired. Configure IMAP, test the connection, or upload a file.",
    };
  }
  if (data.status === "PARTIAL") {
    return { tone: "warn", title: `${kind}: ${data.status}`, detail: `${counts}. ${extra}`.trim() };
  }
  return { tone: "good", title: `${kind}: ${data.status ?? "done"}`, detail: `${counts}${extra ? `. ${extra}` : ""}`.trim() };
}

function AutopartStockOps() {
  const session = useSession();
  const canSync =
    session.signedIn &&
    (session.user.navPermissions.includes("products.import") ||
      session.user.navPermissions.includes("products.edit") ||
      session.user.navPermissions.includes("admin.access"));
  const fileRef = useRef<HTMLInputElement>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [unmatchedTotal, setUnmatchedTotal] = useState(0);
  const [unmatchedPage, setUnmatchedPage] = useState(1);
  const [unmatchedQuery, setUnmatchedQuery] = useState("");
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [tab, setTab] = useState<"history" | "unmatched" | "issues">("history");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapSecure, setImapSecure] = useState(true);
  const [imapUser, setImapUser] = useState("");
  const [imapPassword, setImapPassword] = useState("");
  const [inbound, setInbound] = useState("");
  const [mailbox, setMailbox] = useState("INBOX");
  const [allowed, setAllowed] = useState("");
  const [pattern, setPattern] = useState("231PO3NEW*.txt");
  const [enabled, setEnabled] = useState(false);

  const load = useCallback(async () => {
    const [ov, history, unmatchedRows] = await Promise.all([
      stockOperationsOverviewFn(),
      listStockSyncRunsFn(),
      listUnmatchedStockSkusFn({ data: { q: unmatchedQuery, page: unmatchedPage, pageSize: 50 } }),
    ]);
    if (ov.ok) {
      setError(null);
      setOverview(ov.data);
      const imap = ov.data.imap;
      if (imap) {
        setEnabled(imap.enabled);
        setImapHost(imap.imapHost ?? "");
        setImapPort(String(imap.imapPort ?? 993));
        setImapSecure(imap.imapSecure);
        setImapUser(imap.imapUsername ?? "");
        setInbound(imap.inboundEmailAddress ?? "");
        setMailbox(imap.mailbox ?? "INBOX");
        setAllowed((imap.allowedSenderEmails ?? []).join("\n"));
        setPattern(imap.attachmentFilenamePattern ?? "231PO3NEW*.txt");
        setImapPassword("");
      }
    } else setError(ov.error);
    if (history.ok) setRuns(history.data);
    if (unmatchedRows.ok) {
      setUnmatched(unmatchedRows.data.items);
      setUnmatchedTotal(unmatchedRows.data.total);
      setUnmatchedPage(unmatchedRows.data.page);
    }
  }, [unmatchedPage, unmatchedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(label: string, work: () => Promise<ActionNotice>) {
    if (busy) return;
    setBusy(label);
    setNotice({ tone: "warn", title: `${label} in progress`, detail: "Connecting to the server. This can take a few seconds." });
    try {
      const next = await work();
      setNotice(next);
      if (next.tone === "bad") toast.error(next.detail || next.title);
      else if (next.tone === "warn") toast.message(next.title);
      else toast.success(next.title);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "The request failed";
      setNotice({ tone: "bad", title: `${label} failed`, detail });
      toast.error(detail);
    } finally {
      setBusy(null);
    }
  }

  async function applySyncResult(kind: string, r: { ok: true; data: SyncResult } | { ok: false; error: string }) {
    if (!r.ok) return { tone: "bad" as const, title: `${kind} failed`, detail: r.error };
    await load();
    if (r.data.runId) {
      const detail = await getStockSyncRunFn({ data: { id: r.data.runId } });
      if (detail.ok) {
        setSelected(detail.data);
        const actionable = (r.data.invalid ?? 0) + (r.data.duplicates ?? 0);
        setTab(actionable ? "issues" : "history");
      }
    }
    return noticeFromSync(kind, r.data);
  }

  async function runSync(dryRun: boolean, csv?: string) {
    const kind = csv ? "Upload" : dryRun ? "Dry run" : "Live sync";
    await runAction(kind, async () =>
      applySyncResult(kind, await runManualStockSyncFn({ data: { dryRun, ...(csv ? { csv } : {}) } })),
    );
  }

  async function runPoll(dryRun: boolean) {
    const kind = dryRun ? "Poll dry run" : "Poll live";
    await runAction(kind, async () => applySyncResult(kind, await pollImapNowFn({ data: { dryRun } })));
  }

  const failed = overview?.lastAttempt?.status === "FAILED";
  const stale = overview?.freshness.stale;
  const working = Boolean(busy);

  return (
    <div>
      <PanelHeader
        title="Autopart stock"
        sub="231PO3NEW Avail is the sellable quantity. Customers never see the exact count."
        actions={
          canSync ? (
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void file.text().then((csv) => runSync(false, csv));
                }}
              />
              <button type="button" disabled={working} className={buttonClass()} onClick={() => void runSync(true)}>
                {busy === "Dry run" ? "Working…" : "Dry run"}
              </button>
              <button type="button" disabled={working} className={buttonClass()} onClick={() => void runPoll(true)}>
                {busy === "Poll dry run" ? "Working…" : "Poll now (dry run)"}
              </button>
              <button type="button" disabled={working} className={buttonClass()} onClick={() => void runPoll(false)}>
                {busy === "Poll live" ? "Working…" : "Poll now (live)"}
              </button>
              <button type="button" disabled={working} className={buttonClass()} onClick={() => fileRef.current?.click()}>
                {busy === "Upload" ? "Working…" : "Upload 231PO3NEW"}
              </button>
              <button type="button" disabled={working} className={buttonClass(true)} onClick={() => void runSync(false)}>
                {busy === "Live sync" ? "Working…" : "Sync Autopart stock"}
              </button>
            </div>
          ) : null
        }
      />

      <div className="space-y-4 px-4 py-4 sm:px-6">
      {notice ? (
        <div
          role="status"
          className={cn(
            "rounded-md border px-4 py-3 text-sm",
            notice.tone === "bad" && "border-bad/40 bg-bad/10",
            notice.tone === "warn" && "border-warn/50 bg-warn/10",
            notice.tone === "good" && "border-good/40 bg-good/10",
          )}
        >
          <p className="font-semibold">{notice.title}</p>
          <p className="mt-1 text-steel">{notice.detail}</p>
        </div>
      ) : null}

      {error ? <div className="rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">{error}</div> : null}

      {failed || stale ? (
        <div className="mb-4 rounded-md border border-warn/50 bg-warn/10 px-4 py-3 text-sm">
          {failed ? (
            <p>
              Last attempted sync failed
              {overview?.lastAttempt?.errorSummary ? `: ${overview.lastAttempt.errorSummary}` : "."}
            </p>
          ) : null}
          {stale ? (
            <p>
              Stock is stale — last successful live sync{" "}
              {formatUtc(overview?.freshness.lastSuccessAt)}. Customer IN/LOW STOCK badges are withheld until a successful refresh.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard label="Configuration" value={overview?.config.configured ? "Configured" : "Not configured"} />
        <StatusCard label="Source type" value={overview?.config.sourceType ?? "none"} />
        <StatusCard
          label="Schedule"
          value={overview?.config.scheduleLabel ?? "09:00 · 12:00 · 15:00 · 18:00"}
        />
        <StatusCard label="Timezone" value={overview?.config.scheduleTimezone ?? "Europe/London"} />
        <StatusCard label="Last success" value={formatUtc(overview?.freshness.lastSuccessAt)} />
        <StatusCard label="Last attempt" value={formatUtc(overview?.lastAttempt?.startedAt)} />
        <StatusCard label="Current status" value={overview?.running ? "RUNNING" : (overview?.lastAttempt?.status ?? "—")} />
        <StatusCard label="Stale after" value={`${overview?.freshness.staleHours ?? 36} hours`} />
        <StatusCard
          label="In-process scheduler"
          value={overview?.config.schedulerEnabled ? "Enabled (avoid with Coolify cron)" : "Coolify HTTP cron"}
        />
      </div>

      <form
        className="mt-6 space-y-3 rounded-lg border border-border bg-surface/30 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSync) return;
          void runAction("Save IMAP", async () => {
            const r = await saveImapSettingsFn({
              data: {
                enabled,
                inboundEmailAddress: inbound,
                imapHost,
                imapPort: Number(imapPort) || 993,
                imapSecure,
                imapUsername: imapUser,
                ...(imapPassword.trim() ? { imapPassword: imapPassword.trim() } : {}),
                mailbox,
                allowedSenderEmails: allowed,
                attachmentFilenamePattern: pattern,
              },
            });
            if (!r.ok) return { tone: "bad" as const, title: "IMAP settings not saved", detail: r.error };
            setImapPassword("");
            await load();
            return { tone: "good" as const, title: "IMAP settings saved", detail: "Password is write-only and was not returned." };
          });
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide">Email / IMAP (production source)</h2>
          {canSync ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={working}
                className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase disabled:opacity-50"
                onClick={() => {
                  void runAction("Test connection", async () => {
                    const r = await testImapConnectionFn();
                    if (!r.ok) return { tone: "bad" as const, title: "IMAP connection failed", detail: r.error };
                    return { tone: "good" as const, title: "IMAP connection successful", detail: r.data.message };
                  });
                }}
              >
                {busy === "Test connection" ? "Working…" : "Test connection"}
              </button>
              <button type="submit" disabled={working} className="h-9 rounded-md bg-primary px-3 text-[11px] font-semibold uppercase text-primary-foreground disabled:opacity-50">
                {busy === "Save IMAP" ? "Working…" : "Save IMAP"}
              </button>
            </div>
          ) : null}
        </div>
        <p className="text-[12px] text-steel">
          Production receives 231PO3NEW from the mailbox at 09:00, 12:00, 15:00 and 18:00 Europe/London
          (same Autopart operating windows as AlphaOps). Coolify should POST /api/internal/stock-sync;
          the server only imports inside those windows, including during BST. Manual Poll now still works
          at any time. Password is write-only
          {overview?.imap?.hasImapPassword ? " (saved)" : ""}
          {overview?.imap?.passwordFromEnv ? " — supplied by environment" : ""}. Leave the in-process scheduler off.
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Polling enabled
          </label>
          <Field label="Inbound mailbox/address" htmlFor="imap-inbound">
            <input id="imap-inbound" value={inbound} onChange={(e) => setInbound(e.target.value)} className={inputClass} />
          </Field>
          <Field label="IMAP host" htmlFor="imap-host">
            <input id="imap-host" value={imapHost} onChange={(e) => setImapHost(e.target.value)} className={inputClass} />
          </Field>
          <Field label="IMAP port" htmlFor="imap-port">
            <input id="imap-port" value={imapPort} onChange={(e) => setImapPort(e.target.value)} className={inputClass} />
          </Field>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={imapSecure} onChange={(e) => setImapSecure(e.target.checked)} />
            Secure / TLS
          </label>
          <Field label="IMAP username" htmlFor="imap-user">
            <input id="imap-user" value={imapUser} onChange={(e) => setImapUser(e.target.value)} className={inputClass} autoComplete="off" />
          </Field>
          <Field label="Password (write-only)" htmlFor="imap-pass">
            <input id="imap-pass" type="password" value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} className={inputClass} placeholder={overview?.imap?.hasImapPassword ? "••••••••" : ""} autoComplete="new-password" />
          </Field>
          <Field label="Mailbox" htmlFor="imap-box">
            <input id="imap-box" value={mailbox} onChange={(e) => setMailbox(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Allowed senders" htmlFor="imap-from">
            <textarea id="imap-from" value={allowed} onChange={(e) => setAllowed(e.target.value)} className={inputClass} rows={2} placeholder="one address per line" />
          </Field>
          <Field label="Attachment pattern" htmlFor="imap-pat">
            <input id="imap-pat" value={pattern} onChange={(e) => setPattern(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatusCard label="Last poll" value={formatUtc(overview?.imap?.lastPollAt)} />
          <StatusCard label="Last poll error" value={overview?.imap?.lastPollError || "—"} />
          <StatusCard
            label="Last email"
            value={
              overview?.imap?.lastEmailFrom
                ? `${overview.imap.lastEmailFrom}${overview.imap.lastEmailSubject ? ` · ${overview.imap.lastEmailSubject}` : ""}`
                : overview?.imap?.lastEmailSubject || "—"
            }
          />
          <StatusCard label="Last attachment" value={overview?.imap?.lastAttachmentFilename || "—"} />
        </div>
      </form>

      <div className="mt-6 flex gap-2 border-b border-border">
        {(["history", "unmatched", "issues"] as const).map((id) => (
          <button
            key={id}
            type="button"
            className={cn(
              "h-10 px-3 text-[12px] font-semibold uppercase",
              tab === id ? "border-b-2 border-primary" : "text-steel",
            )}
            onClick={() => setTab(id)}
          >
            {id === "history" ? "Sync history" : id === "unmatched" ? "Unmatched Autopart SKUs" : "Invalid rows"}
          </button>
        ))}
      </div>

      {tab === "history" ? (
        <div className="mt-4 space-y-3">
          {selected ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatusCard label="Status" value={selected.status} />
              <StatusCard label="Rows read" value={String(selected.rowsRead)} />
              <StatusCard label="AB products matched" value={String(selected.matched)} />
              <StatusCard label="Updated" value={String(selected.updated)} />
              <StatusCard label="Unchanged" value={String(selected.unchanged)} />
              <StatusCard label="Not in AB catalogue" value={String(selected.unmatched)} />
              <StatusCard label="Invalid" value={String(selected.invalid)} />
              <StatusCard label="Duplicates" value={String(selected.duplicates)} />
            </div>
          ) : null}
          <p className="text-[12px] text-steel">
            231PO3NEW is Autopart’s master file. SKUs that Automotive Brands does not sell are skipped as
            not in catalogue — they are not invalid and do not make a run PARTIAL.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[960px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">Read</th>
                <th className="px-3 py-2 text-right">Matched</th>
                <th className="px-3 py-2 text-right">Updated</th>
                <th className="px-3 py-2 text-right">Unchanged</th>
                <th className="px-3 py-2 text-right">Not in AB catalogue</th>
                <th className="px-3 py-2 text-right">Invalid</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-steel">
                    No sync runs yet. Deploy does not import stock — run a dry run, then a live sync.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr
                    key={run.id}
                    className="cursor-pointer border-b border-border/60 hover:bg-surface/40"
                    onClick={() => {
                      void getStockSyncRunFn({ data: { id: run.id } }).then((r) => {
                        if (r.ok) {
                          setSelected(r.data);
                          setTab(r.data.issues.length ? "issues" : "history");
                        }
                      });
                    }}
                  >
                    <td className="px-3 py-2">
                      <StatusBadge tone={statusTone(run.status)}>{run.status}</StatusBadge>
                    </td>
                    <td className="px-3 py-2">{run.mode}</td>
                    <td className="px-3 py-2">{formatUtc(run.startedAt)}</td>
                    <td className="px-3 py-2 text-steel">{run.source}</td>
                    <td className="num px-3 py-2 text-right">{run.rowsRead}</td>
                    <td className="num px-3 py-2 text-right">{run.matched}</td>
                    <td className="num px-3 py-2 text-right">{run.updated}</td>
                    <td className="num px-3 py-2 text-right">{run.unchanged}</td>
                    <td className="num px-3 py-2 text-right">{run.unmatched}</td>
                    <td className="num px-3 py-2 text-right">{run.invalid}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}

      {tab === "unmatched" ? (
        <div className="mt-4 space-y-3">
          <p className="text-[13px] text-steel">
            {unmatchedTotal.toLocaleString("en-GB")} Autopart SKU(s) not in the AB catalogue. This is expected
            for the master 231PO3NEW file. Rows are current-state diagnostics only — they are not import errors
            and products are never auto-created. Add the SKU in AB and the next import will match Avail automatically.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={unmatchedQuery}
              onChange={(e) => {
                setUnmatchedQuery(e.target.value);
                setUnmatchedPage(1);
              }}
              className={inputClass}
              placeholder="Search Autopart SKU or description"
              aria-label="Search unmatched Autopart SKUs"
            />
            <p className="text-[12px] text-steel">
              Page {unmatchedPage} of {Math.max(1, Math.ceil(unmatchedTotal / 50))}
            </p>
            <button
              type="button"
              className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase disabled:opacity-40"
              disabled={unmatchedPage <= 1}
              onClick={() => setUnmatchedPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase disabled:opacity-40"
              disabled={unmatchedPage >= Math.ceil(unmatchedTotal / 50)}
              onClick={() => setUnmatchedPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[800px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                <th className="px-3 py-2">Autopart SKU</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Latest Avail</th>
                <th className="px-3 py-2">First seen</th>
                <th className="px-3 py-2">Last seen</th>
                <th className="px-3 py-2 text-right">Times seen</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-steel">
                    {unmatchedTotal === 0
                      ? "No unmatched Autopart SKUs from live syncs."
                      : "No SKUs match this search."}
                  </td>
                </tr>
              ) : (
                unmatched.map((row) => (
                  <tr key={row.sku} className="border-b border-border/60">
                    <td className="num px-3 py-2">{row.sku}</td>
                    <td className="px-3 py-2">{row.description ?? "—"}</td>
                    <td className="num px-3 py-2">{row.avail ?? "—"}</td>
                    <td className="px-3 py-2">{formatUtc(row.firstSeenAt)}</td>
                    <td className="px-3 py-2">{formatUtc(row.lastSeenAt)}</td>
                    <td className="num px-3 py-2 text-right">{row.occurrenceCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </div>
      ) : null}

      {tab === "issues" ? (
        <div className="mt-4 space-y-3">
          {selected ? (
            <p className="text-[13px] text-steel">
              {selected.status} · {selected.mode} · {selected.source} · started {formatUtc(selected.startedAt)}
              {selected.errorSummary ? ` · ${selected.errorSummary}` : ""}
            </p>
          ) : (
            <p className="text-[13px] text-steel">
              Select a sync run from history to inspect genuine invalid, duplicate, or conflict rows. Valid
              Autopart SKUs that AB does not sell are listed under Unmatched Autopart SKUs, not here.
            </p>
          )}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[800px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Avail</th>
                  <th className="px-3 py-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {!selected?.issues.length ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-steel">
                      No diagnostic rows for this run.
                    </td>
                  </tr>
                ) : (
                  selected.issues.map((issue) => (
                    <tr key={issue.id} className="border-b border-border/60">
                      <td className="px-3 py-2">{issue.kind}</td>
                      <td className="num px-3 py-2">{issue.line ?? "—"}</td>
                      <td className="num px-3 py-2">{issue.sku ?? "—"}</td>
                      <td className="num px-3 py-2">{issue.availRaw ?? "—"}</td>
                      <td className="px-3 py-2 text-steel">{issue.message}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p className="mt-6 text-[13px]">
        <Link to={ROUTES.adminProducts} className="text-primary hover:underline">
          Back to catalogue
        </Link>
      </p>
      </div>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-steel">{label}</p>
      <p className="mt-1 text-[15px] font-semibold">{value}</p>
    </div>
  );
}
