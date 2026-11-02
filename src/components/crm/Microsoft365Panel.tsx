import { useState } from "react";

import { microsoft365ReturnNotice, type Microsoft365Status } from "@/domain/microsoft-365-crm";

export function Microsoft365Panel({
  status,
  noticeCode,
  includeCalendar,
  busy,
  error,
  onIncludeCalendar,
  onConnect,
  onDisconnect,
  onTaskSync,
  onCalendarSync,
  onAllowCalendar,
  onRetryOutbound,
  onRetryCalendarOutbound,
  onRecheckUncertain,
  onApproveUncertainCreate,
  onRequestInboundCheck,
  onUnlinkInboundMapping,
  onRecreateInboundMapping,
}: {
  status: Microsoft365Status;
  noticeCode?: string | undefined;
  includeCalendar: boolean;
  busy: boolean;
  error: string | null;
  onIncludeCalendar: (value: boolean) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onTaskSync: (value: boolean) => void;
  onCalendarSync: (value: boolean) => void;
  onAllowCalendar: () => void;
  onRetryOutbound: () => void;
  onRetryCalendarOutbound: () => void;
  onRecheckUncertain: (jobId: string) => void;
  onApproveUncertainCreate: (jobId: string) => void;
  onRequestInboundCheck: () => void;
  onUnlinkInboundMapping: (mappingId: string) => void;
  onRecreateInboundMapping: (mappingId: string) => void;
}) {
  const notice = microsoft365ReturnNotice(noticeCode);
  const connection = status.connection;
  const connected = connection?.status === "CONNECTED";
  const uncertainJobs = status.outbound?.uncertainJobs ?? [];
  const ordinaryRetryAvailable =
    (status.outbound?.failed ?? 0) > 0 ||
    (status.outbound?.needsReview ?? 0) > uncertainJobs.length;
  const [confirmJobId, setConfirmJobId] = useState<string | null>(null);
  const [ackDuplicate, setAckDuplicate] = useState(false);
  return (
    <div className="mx-4 my-6 max-w-3xl space-y-4 sm:mx-6">
      {notice ? (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <section className="rounded-md border border-border p-4">
        <h2 className="font-display text-sm font-semibold uppercase tracking-tight">Connection</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-steel">Status</dt>
            <dd>{connectionLabel(status)}</dd>
          </div>
          <div>
            <dt className="text-steel">Microsoft account</dt>
            <dd>{connection?.displayName || "Not connected"}</dd>
          </div>
          <div>
            <dt className="text-steel">Email</dt>
            <dd>{connection?.email || "—"}</dd>
          </div>
          <div>
            <dt className="text-steel">Last task sync</dt>
            <dd>{connection?.lastTaskSyncAt ? formatWhen(connection.lastTaskSyncAt) : "Not run"}</dd>
          </div>
          <div>
            <dt className="text-steel">Last calendar sync</dt>
            <dd>{connection?.lastCalendarSyncAt ? formatWhen(connection.lastCalendarSyncAt) : "Not run"}</dd>
          </div>
        </dl>
        {connection?.lastError ? <p className="mt-3 text-sm text-destructive">{connection.lastError}</p> : null}
        <p className="mt-3 text-[12px] text-steel">
          Connecting does not export existing CRM tasks. New tasks can sync after you turn task synchronisation on
          and an administrator enables the outbound engine.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {!connected ? (
            <button
              type="button"
              disabled={busy || !status.platformEnabled || !status.configured || !status.canConnect}
              onClick={onConnect}
              className="h-10 rounded-md bg-primary px-4 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
            >
              Connect Microsoft 365
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onDisconnect}
              className="h-10 rounded-md border border-border px-4 text-[13px] font-bold"
            >
              Disconnect
            </button>
          )}
        </div>
        {!connected ? (
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={includeCalendar}
              onChange={(event) => onIncludeCalendar(event.target.checked)}
            />
            <span>
              Also request Outlook Calendar permission. This release does not create Outlook appointments.
            </span>
          </label>
        ) : null}
        {!status.platformEnabled ? (
          <p className="mt-3 text-sm text-steel">Microsoft 365 integration is turned off.</p>
        ) : null}
        {status.platformEnabled && !status.configured ? (
          <p className="mt-3 text-sm text-steel">
            An administrator still needs to register the Entra application and set the environment variables.
          </p>
        ) : null}
      </section>

      <section className="rounded-md border border-border p-4">
        <h2 className="font-display text-sm font-semibold uppercase tracking-tight">Preferences</h2>
        <p className="mt-2 text-[12px] text-steel">
          Task synchronisation sends eligible new CRM tasks to a Microsoft To Do list named Automotive Brands CRM.
          It does not export older tasks unless you copy one task across. Calendar synchronisation still does not
          create appointments.
        </p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-steel">Outbound engine</dt>
            <dd>{status.outbound?.engineEnabled ? "Enabled" : "Off"}</dd>
          </div>
          <div>
            <dt className="text-steel">Inbound engine</dt>
            <dd>{status.inbound?.engineEnabled ? "Enabled" : "Off"}</dd>
          </div>
          <div>
            <dt className="text-steel">Outbound waiting</dt>
            <dd>{status.outbound?.pending ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Outbound failed</dt>
            <dd>{status.outbound?.failed ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Outbound needs review</dt>
            <dd>{status.outbound?.needsReview ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Last inbound sync</dt>
            <dd>{status.inbound?.lastInboundSyncAt ? formatWhen(status.inbound.lastInboundSyncAt) : "Not run"}</dd>
          </div>
        </dl>
        {ordinaryRetryAvailable ? (
          <button
            type="button"
            disabled={busy || !status.canConnect}
            onClick={onRetryOutbound}
            className="mt-3 h-10 rounded-md border border-border px-4 text-[13px] font-bold"
          >
            Retry failed sync
          </button>
        ) : null}
        <p className="mt-2 text-[12px] text-steel">
          Retry failed sync retries ordinary failures only. It does not authorise another Microsoft create after an
          uncertain outcome.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(connection?.taskSyncEnabled)}
            disabled={busy || !connected || !status.canConnect}
            onChange={(event) => onTaskSync(event.target.checked)}
          />
          Enable task synchronisation
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Boolean(connection?.calendarSyncEnabled)}
            disabled={busy || !connected || !status.canConnect || !connection?.calendarConsented}
            onChange={(event) => onCalendarSync(event.target.checked)}
          />
          Enable calendar synchronisation
        </label>
        {connected && !connection?.calendarConsented ? (
          <button
            type="button"
            disabled={busy || !status.canConnect}
            onClick={onAllowCalendar}
            className="mt-3 h-10 rounded-md border border-border px-4 text-[13px] font-bold"
          >
            Allow Outlook Calendar
          </button>
        ) : null}
        <p className="mt-3 text-[12px] text-steel">
          Calendar synchronisation only applies to CRM appointments that you explicitly add to Outlook. Ordinary tasks
          never become calendar events. The calendar engine stays off until an administrator sets
          MICROSOFT_365_CALENDAR_SYNC_ENABLED.
        </p>
      </section>

      <section className="rounded-md border border-border p-4">
        <h2 className="font-display text-sm font-semibold uppercase tracking-tight">Outlook Calendar jobs</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-steel">Calendar engine</dt>
            <dd>{status.calendar?.engineEnabled ? "Enabled" : "Off"}</dd>
          </div>
          <div>
            <dt className="text-steel">Calendar permission</dt>
            <dd>{connection?.calendarConsented ? "Granted" : "Not granted"}</dd>
          </div>
          <div>
            <dt className="text-steel">Outbound waiting</dt>
            <dd>{status.calendar?.outboundPending ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Outbound failed</dt>
            <dd>{status.calendar?.outboundFailed ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Needs review</dt>
            <dd>{status.calendar?.outboundNeedsReview ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Inbound waiting</dt>
            <dd>{status.calendar?.inboundPending ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Conflicts</dt>
            <dd>{status.calendar?.conflicts ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Calendar baseline</dt>
            <dd>
              {status.calendar?.calendarInboundBaselineAt
                ? formatWhen(status.calendar.calendarInboundBaselineAt)
                : "Not completed"}
            </dd>
          </div>
        </dl>
        <button
          type="button"
          disabled={
            busy ||
            !status.canConnect ||
            !status.calendar?.engineEnabled ||
            ((status.calendar?.outboundFailed ?? 0) === 0 &&
              (status.calendar?.outboundNeedsReview ?? 0) === 0)
          }
          onClick={onRetryCalendarOutbound}
          className="mt-3 h-10 rounded-md border border-border px-4 text-[13px] font-bold disabled:opacity-50"
        >
          Retry failed calendar sync
        </button>
      </section>

      <section className="rounded-md border border-border p-4">
        <h2 className="font-display text-sm font-semibold uppercase tracking-tight">Inbound from Microsoft To Do</h2>
        <p className="mt-2 text-[12px] text-steel">
          When inbound is enabled, changes in the Automotive Brands CRM list can update completion, due date, priority,
          title, and description on mapped CRM tasks. CRM ownership, cancellation, customers, and opportunities stay in
          Automotive Brands. The first inbound run only baselines mappings and does not rewrite CRM history.
        </p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-steel">Inbound waiting</dt>
            <dd>{status.inbound?.pending ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Inbound failed</dt>
            <dd>{status.inbound?.failed ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Conflicts</dt>
            <dd>{status.inbound?.conflicts ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Missing Microsoft tasks</dt>
            <dd>{status.inbound?.removed ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Baseline</dt>
            <dd>{status.inbound?.inboundBaselineAt ? formatWhen(status.inbound.inboundBaselineAt) : "Not completed"}</dd>
          </div>
          <div>
            <dt className="text-steel">Synced fields</dt>
            <dd>{(status.inbound?.syncedFields ?? []).join(", ") || "—"}</dd>
          </div>
        </dl>
        <button
          type="button"
          disabled={busy || !status.canConnect || !status.inbound?.engineEnabled || !connected}
          onClick={onRequestInboundCheck}
          className="mt-3 h-10 rounded-md border border-border px-4 text-[13px] font-bold disabled:opacity-50"
        >
          Request inbound sync check
        </button>
        {(status.inbound?.conflictsList?.length ?? 0) > 0 ? (
          <ul className="mt-4 space-y-3">
            {status.inbound!.conflictsList.map((row) => (
              <li key={row.mappingId} className="rounded-md border border-border p-3 text-sm">
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-steel">CRM task</dt>
                    <dd>{row.taskTitle || row.taskId || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Status</dt>
                    <dd>{row.syncStatus}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-steel">Detail</dt>
                    <dd>{row.lastError || "Needs reconciliation"}</dd>
                  </div>
                </dl>
                {status.inbound?.canReconcile ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onUnlinkInboundMapping(row.mappingId)}
                      className="h-10 rounded-md border border-border px-4 text-[13px] font-bold"
                    >
                      Unlink mapping
                    </button>
                    {row.syncStatus === "REMOVED" ? (
                      <button
                        type="button"
                        disabled={busy || !status.outbound?.engineEnabled}
                        onClick={() => onRecreateInboundMapping(row.mappingId)}
                        className="h-10 rounded-md border border-border px-4 text-[13px] font-bold disabled:opacity-50"
                      >
                        Recreate in Microsoft To Do
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {uncertainJobs.length > 0 ? (
        <section className="rounded-md border border-border p-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-tight">Review uncertain creation</h2>
          <p className="mt-2 text-[12px] text-steel">
            Microsoft may already have created these tasks after a timeout or interruption. Recheck looks for an
            existing To Do item. Approving another create requires an explicit acknowledgement and CRM manager or
            administrator permission.
          </p>
          <ul className="mt-4 space-y-4">
            {uncertainJobs.map((job) => (
              <li key={job.jobId} className="rounded-md border border-border p-3 text-sm">
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-steel">CRM task</dt>
                    <dd>{job.taskTitle || job.taskId}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Salesperson</dt>
                    <dd>{job.assigneeName || job.assigneeEmail || "—"}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-steel">Last error</dt>
                    <dd>{job.lastError || "Microsoft To Do create needs review"}</dd>
                  </div>
                  <div>
                    <dt className="text-steel">Known Microsoft task id</dt>
                    <dd>{job.knownMicrosoftTaskId || "Not known"}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || !status.canConnect || !status.outbound?.engineEnabled}
                    onClick={() => onRecheckUncertain(job.jobId)}
                    className="h-10 rounded-md border border-border px-4 text-[13px] font-bold disabled:opacity-50"
                  >
                    Recheck Microsoft To Do
                  </button>
                  {status.outbound?.canApproveUncertainCreate ? (
                    <button
                      type="button"
                      disabled={busy || !status.outbound.engineEnabled}
                      onClick={() => {
                        setConfirmJobId(job.jobId);
                        setAckDuplicate(false);
                      }}
                      className="h-10 rounded-md border border-border px-4 text-[13px] font-bold disabled:opacity-50"
                    >
                      Authorise another create
                    </button>
                  ) : null}
                </div>
                {confirmJobId === job.jobId ? (
                  <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/40 p-3">
                    <p className="text-[12px] text-steel">
                      Microsoft may already have created the original task. Another create may produce a duplicate in
                      To Do.
                    </p>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={ackDuplicate}
                        onChange={(event) => setAckDuplicate(event.target.checked)}
                      />
                      <span>
                        I understand Microsoft may already have created this task and that another create may cause a
                        duplicate.
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy || !ackDuplicate}
                        onClick={() => {
                          onApproveUncertainCreate(job.jobId);
                          setConfirmJobId(null);
                          setAckDuplicate(false);
                        }}
                        className="h-10 rounded-md bg-primary px-4 text-[13px] font-bold text-primary-foreground disabled:opacity-50"
                      >
                        Confirm create authorisation
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setConfirmJobId(null);
                          setAckDuplicate(false);
                        }}
                        className="h-10 rounded-md border border-border px-4 text-[13px] font-bold"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {status.health ? (
        <section className="rounded-md border border-border p-4">
          <h2 className="font-display text-sm font-semibold uppercase tracking-tight">Connection health</h2>
          <p className="mt-2 text-[12px] text-steel">Account status only. Microsoft task contents are not shown.</p>
          {status.health.length === 0 ? (
            <p className="mt-3 text-sm text-steel">No staff Microsoft accounts are stored.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-steel">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Staff</th>
                    <th className="py-2 pr-3 font-medium">Microsoft account</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Tasks</th>
                    <th className="py-2 pr-3 font-medium">Calendar</th>
                    <th className="py-2 font-medium">Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {status.health.map((row) => (
                    <tr key={row.userId} className="border-t border-border">
                      <td className="py-2 pr-3">{row.userEmail}</td>
                      <td className="py-2 pr-3">{row.microsoftEmail || row.displayName || "—"}</td>
                      <td className="py-2 pr-3">{row.status}</td>
                      <td className="py-2 pr-3">{row.taskSyncEnabled ? "On" : "Off"}</td>
                      <td className="py-2 pr-3">{row.calendarSyncEnabled ? "On" : "Off"}</td>
                      <td className="py-2">{row.lastError || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function connectionLabel(status: Microsoft365Status): string {
  if (!status.platformEnabled) return "Turned off";
  if (!status.connection) return "Not connected";
  if (status.connection.status === "CONNECTED") return "Connected";
  if (status.connection.status === "REVOKED") return "Reconnect required";
  return "Needs attention";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not run";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  }).format(date);
}
