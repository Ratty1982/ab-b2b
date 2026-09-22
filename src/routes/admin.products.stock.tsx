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
type UnmatchedRow = Extract<Awaited<ReturnType<typeof listUnmatchedStockSkusFn>>, { ok: true }>["data"][number];
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
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const [pollMinutes, setPollMinutes] = useState("15");
  const [enabled, setEnabled] = useState(false);

  const load = useCallback(async () => {
    const [ov, history, unmatchedRows] = await Promise.all([
      stockOperationsOverviewFn(),
      listStockSyncRunsFn(),
      listUnmatchedStockSkusFn(),
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
        setPollMinutes(String(imap.pollIntervalMinutes ?? 15));
        setImapPassword("");
      }
    } else setError(ov.error);
    if (history.ok) setRuns(history.data);
    if (unmatchedRows.ok) setUnmatched(unmatchedRows.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runSync(dryRun: boolean, csv?: string) {
    setBusy(true);
    try {
      const r = await runManualStockSyncFn({ data: { dryRun, csv } });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(dryRun ? `Dry run ${r.data.status}` : `Sync ${r.data.status}`);
      await load();
      if (r.data.runId) {
        const detail = await getStockSyncRunFn({ data: { id: r.data.runId } });
        if (detail.ok) {
          setSelected(detail.data);
          setTab("issues");
        }
      }
    } finally {
      setBusy(false);
    }
  }

  const failed = overview?.lastAttempt?.status === "FAILED";
  const stale = overview?.freshness.stale;

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
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void file.text().then((csv) => runSync(false, csv));
                }}
              />
              <button
                type="button"
                disabled={busy}
                className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase"
                onClick={() => void runSync(true)}
              >
                Dry run
              </button>
              <button
                type="button"
                disabled={busy}
                className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase"
                onClick={() => {
                  setBusy(true);
                  void pollImapNowFn({ data: { dryRun: true } })
                    .then((r) => {
                      if (!r.ok) toast.error(r.error);
                      else toast.success(r.data.errorSummary ? `Poll dry run: ${r.data.errorSummary}` : `Poll dry run ${r.data.status}`);
                      return load();
                    })
                    .finally(() => setBusy(false));
                }}
              >
                Poll now (dry run)
              </button>
              <button
                type="button"
                disabled={busy}
                className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase"
                onClick={() => {
                  setBusy(true);
                  void pollImapNowFn({ data: { dryRun: false } })
                    .then((r) => {
                      if (!r.ok) toast.error(r.error);
                      else toast.success(`Poll live ${r.data.status}`);
                      return load();
                    })
                    .finally(() => setBusy(false));
                }}
              >
                Poll now (live)
              </button>
              <button
                type="button"
                disabled={busy}
                className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase"
                onClick={() => fileRef.current?.click()}
              >
                Upload 231PO3NEW
              </button>
              <button
                type="button"
                disabled={busy}
                className="h-10 rounded-md bg-primary px-4 text-[12px] font-semibold uppercase text-primary-foreground"
                onClick={() => void runSync(false)}
              >
                Sync Autopart stock
              </button>
            </div>
          ) : null
        }
      />

      {error ? <div className="mb-4 rounded-md border border-bad/40 bg-bad/10 px-4 py-3 text-sm">{error}</div> : null}

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
          value={`${overview?.config.scheduleMinutes ?? 15} min · ${overview?.config.scheduleTimezone ?? "UTC"}`}
        />
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
          setBusy(true);
          void saveImapSettingsFn({
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
              pollIntervalMinutes: Number(pollMinutes) || 15,
            },
          })
            .then((r) => {
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success("IMAP settings saved");
              setImapPassword("");
              return load();
            })
            .finally(() => setBusy(false));
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide">Email / IMAP (production source)</h2>
          {canSync ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase"
                onClick={() => {
                  setBusy(true);
                  void testImapConnectionFn()
                    .then((r) => {
                      if (!r.ok) toast.error(r.error);
                      else toast.success(r.data.message);
                    })
                    .finally(() => setBusy(false));
                }}
              >
                Test connection
              </button>
              <button type="submit" disabled={busy} className="h-9 rounded-md bg-primary px-3 text-[11px] font-semibold uppercase text-primary-foreground">
                Save IMAP
              </button>
            </div>
          ) : null}
        </div>
        <p className="text-[12px] text-steel">
          Production receives 231PO3NEW from the mailbox. Password is write-only
          {overview?.imap?.hasImapPassword ? " (saved)" : ""}
          {overview?.imap?.passwordFromEnv ? " — supplied by environment" : ""}. Coolify should POST /api/internal/stock-sync every 15 minutes UTC; do not also enable the in-process scheduler.
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
          <Field label="Poll interval (minutes)" htmlFor="imap-int">
            <input id="imap-int" value={pollMinutes} onChange={(e) => setPollMinutes(e.target.value)} className={inputClass} />
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
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
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
                <th className="px-3 py-2 text-right">Unmatched</th>
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
                          setTab("issues");
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
      ) : null}

      {tab === "unmatched" ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[800px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                <th className="px-3 py-2">Autopart SKU</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Avail</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Last seen</th>
                <th className="px-3 py-2 text-right">Occurrences</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-steel">
                    No unmatched SKUs from live syncs.
                  </td>
                </tr>
              ) : (
                unmatched.map((row) => (
                  <tr key={row.sku} className="border-b border-border/60">
                    <td className="num px-3 py-2">{row.sku}</td>
                    <td className="px-3 py-2">{row.description ?? "—"}</td>
                    <td className="num px-3 py-2">{row.avail ?? "—"}</td>
                    <td className="px-3 py-2 text-steel">{row.reason}</td>
                    <td className="px-3 py-2">{formatUtc(row.lastSeenAt)}</td>
                    <td className="num px-3 py-2 text-right">{row.occurrenceCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[12px] text-steel">
            Unmatched rows are never turned into products. Create the catalogue SKU first, then sync again.
          </p>
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
            <p className="text-[13px] text-steel">Select a sync run from history to inspect invalid, duplicate, and unmatched rows.</p>
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
