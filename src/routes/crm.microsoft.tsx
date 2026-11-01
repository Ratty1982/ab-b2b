import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PanelHeader } from "@/components/ab/AppShell";
import { Microsoft365Panel } from "@/components/crm/Microsoft365Panel";
import { assertMicrosoftAuthorizeUrl, type Microsoft365Status } from "@/domain/microsoft-365-crm";
import { guardStaffPage } from "@/lib/guard-staff-page";
import {
  approveMicrosoftTodoUncertainCreateFn,
  beginMicrosoft365ConnectFn,
  disconnectMicrosoft365Fn,
  getMicrosoft365StatusFn,
  recheckMicrosoftTodoUncertainFn,
  retryMicrosoftTodoOutboundFn,
  updateMicrosoft365PreferencesFn,
} from "@/server/microsoft-365/fns";

type Search = { microsoft?: string };

export const Route = createFileRoute("/crm/microsoft")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const value = search["microsoft"];
    if (typeof value !== "string") return {};
    if (
      value === "connected" ||
      value === "disabled" ||
      value === "not_configured" ||
      value === "state" ||
      value === "tenant" ||
      value === "denied" ||
      value === "token" ||
      value === "forbidden"
    ) {
      return { microsoft: value };
    }
    return {};
  },
  beforeLoad: ({ location }) => guardStaffPage("tasks.view", location.href, "/crm"),
  head: () => ({
    meta: [{ title: "Microsoft 365 — CRM — Automotive Brands" }],
  }),
  component: CrmMicrosoftPage,
});

function CrmMicrosoftPage() {
  const search = Route.useSearch();
  const [status, setStatus] = useState<Microsoft365Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeCalendar, setIncludeCalendar] = useState(false);
  const [busy, setBusy] = useState(false);

  function load() {
    void getMicrosoft365StatusFn().then((result) => {
      if (!result.ok || !result.data) {
        setError(result.ok ? "Microsoft 365 status is unavailable" : result.error);
        setStatus(null);
        return;
      }
      setError(null);
      setStatus(result.data);
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function connect(calendar: boolean) {
    setBusy(true);
    const result = await beginMicrosoft365ConnectFn({ data: { includeCalendar: calendar } });
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.ok ? "Microsoft 365 could not be started" : result.error);
      return;
    }
    try {
      window.location.assign(assertMicrosoftAuthorizeUrl(result.data.authorizationUrl));
    } catch {
      setError("Microsoft sign-in URL was rejected");
    }
  }

  async function disconnect() {
    setBusy(true);
    const result = await disconnectMicrosoft365Fn();
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.ok ? "Microsoft 365 could not be disconnected" : result.error);
      return;
    }
    load();
  }

  async function save(taskSyncEnabled: boolean, calendarSyncEnabled: boolean) {
    setBusy(true);
    const result = await updateMicrosoft365PreferencesFn({ data: { taskSyncEnabled, calendarSyncEnabled } });
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(result.ok ? "Microsoft 365 preferences could not be saved" : result.error);
      return;
    }
    if (result.data.needsCalendarConsent) {
      await connect(true);
      return;
    }
    load();
  }

  return (
    <div>
      <PanelHeader
        title="Microsoft 365"
        sub="Connect your work account. CRM tasks stay in Automotive Brands."
      />
      {!status ? (
        <p className="px-4 py-6 text-sm text-steel sm:px-6">{error ?? "Loading…"}</p>
      ) : (
        <Microsoft365Panel
          status={status}
          noticeCode={search.microsoft}
          includeCalendar={includeCalendar}
          busy={busy}
          error={error}
          onIncludeCalendar={setIncludeCalendar}
          onConnect={() => void connect(includeCalendar)}
          onDisconnect={() => void disconnect()}
          onTaskSync={(value) => void save(value, Boolean(status.connection?.calendarSyncEnabled))}
          onCalendarSync={(value) => void save(Boolean(status.connection?.taskSyncEnabled), value)}
          onAllowCalendar={() => void connect(true)}
          onRetryOutbound={() => {
            setBusy(true);
            void retryMicrosoftTodoOutboundFn().then((result) => {
              setBusy(false);
              if (!result.ok) setError(result.error);
              load();
            });
          }}
          onRecheckUncertain={(jobId) => {
            setBusy(true);
            void recheckMicrosoftTodoUncertainFn({ data: { jobId } }).then((result) => {
              setBusy(false);
              if (!result.ok) setError(result.error);
              load();
            });
          }}
          onApproveUncertainCreate={(jobId) => {
            setBusy(true);
            void approveMicrosoftTodoUncertainCreateFn({
              data: { jobId, acknowledgedDuplicateRisk: true },
            }).then((result) => {
              setBusy(false);
              if (!result.ok) setError(result.error);
              load();
            });
          }}
        />
      )}
    </div>
  );
}
