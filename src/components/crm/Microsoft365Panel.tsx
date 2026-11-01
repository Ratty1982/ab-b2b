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
}) {
  const notice = microsoft365ReturnNotice(noticeCode);
  const connection = status.connection;
  const connected = connection?.status === "CONNECTED";
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
            <dt className="text-steel">Waiting</dt>
            <dd>{status.outbound?.pending ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Failed</dt>
            <dd>{status.outbound?.failed ?? 0}</dd>
          </div>
          <div>
            <dt className="text-steel">Needs review</dt>
            <dd>{status.outbound?.needsReview ?? 0}</dd>
          </div>
        </dl>
        {(status.outbound?.failed ?? 0) + (status.outbound?.needsReview ?? 0) > 0 ? (
          <button
            type="button"
            disabled={busy || !status.canConnect}
            onClick={onRetryOutbound}
            className="mt-3 h-10 rounded-md border border-border px-4 text-[13px] font-bold"
          >
            Retry failed sync
          </button>
        ) : null}
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
      </section>

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
