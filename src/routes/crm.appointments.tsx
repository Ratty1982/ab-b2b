import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer } from "@/components/ab/Drawer";
import { ScheduleAppointmentDrawer } from "@/components/crm/ScheduleAppointmentDrawer";
import { APPOINTMENT_TYPES } from "@/domain/crm-appointments";
import { formatDateTime } from "@/lib/datetime";
import { ROUTES } from "@/lib/app-nav";
import { guardStaffPage } from "@/lib/guard-staff-page";
import {
  cancelCrmAppointmentFn,
  getCrmAppointmentFn,
  listCrmAppointmentsFn,
  retryCrmAppointmentCalendarSyncFn,
  updateCrmAppointmentFn,
} from "@/server/phase2/fns";

type Search = { appointmentId?: string; range?: string };

export const Route = createFileRoute("/crm/appointments")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const out: Search = {};
    if (typeof search["appointmentId"] === "string" && search["appointmentId"]) {
      out.appointmentId = search["appointmentId"];
    }
    if (typeof search["range"] === "string" && search["range"]) out.range = search["range"];
    return out;
  },
  beforeLoad: ({ location }) => guardStaffPage("crm.activities.view", location.href, "/crm"),
  head: () => ({
    meta: [{ title: "Appointments — CRM — Automotive Brands" }],
  }),
  component: CrmAppointmentsPage,
});

type ListData = Extract<Awaited<ReturnType<typeof listCrmAppointmentsFn>>, { ok: true }>["data"];
type Detail = Extract<Awaited<ReturnType<typeof getCrmAppointmentFn>>, { ok: true }>["data"];

function CrmAppointmentsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [data, setData] = useState<ListData | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState(search.range ?? "UPCOMING");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [q, setQ] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);

  function reloadList() {
    void listCrmAppointmentsFn({
      data: {
        q: q.trim() || null,
        range: range === "ALL" ? "ALL" : range,
        type: typeFilter === "ALL" ? "ALL" : typeFilter,
        page: 1,
        pageSize: 50,
      },
    }).then((result) => {
      if (!result.ok) {
        setError(result.error);
        setData(null);
      } else {
        setError(null);
        setData(result.data);
      }
    });
  }

  useEffect(() => {
    reloadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, range, typeFilter]);

  useEffect(() => {
    if (!search.appointmentId) {
      setDetail(null);
      return;
    }
    void getCrmAppointmentFn({ data: { appointmentId: search.appointmentId } }).then((result) => {
      if (!result.ok) {
        setError(result.error);
        setDetail(null);
      } else {
        setDetail(result.data);
      }
    });
  }, [search.appointmentId]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Appointments"
        sub="Customer meetings and visits. Separate from CRM tasks."
        crumbs={[{ label: "CRM" }, { label: "Appointments", to: ROUTES.crmAppointments }]}
      />
      <div className="space-y-4 px-4 py-4 sm:px-6">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <input
            className="h-9 min-w-[200px] rounded-md border border-border px-3 text-sm"
            placeholder="Search subject, customer, location"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          <select
            className="h-9 rounded-md border border-border px-3 text-sm"
            value={range}
            onChange={(event) => setRange(event.target.value)}
            aria-label="Range filter"
          >
            <option value="TODAY">Today</option>
            <option value="UPCOMING">Upcoming</option>
            <option value="PAST">Past</option>
            <option value="ALL">All</option>
          </select>
          <select
            className="h-9 rounded-md border border-border px-3 text-sm"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            aria-label="Type filter"
          >
            <option value="ALL">All types</option>
            {APPOINTMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="h-9 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground"
            onClick={() => setScheduleOpen(true)}
          >
            Schedule appointment
          </button>
        </div>

        {!data ? (
          <p className="text-sm text-steel">Loading…</p>
        ) : data.total === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-steel">
            No appointments match these filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-steel">
                  <th className="py-2 pr-3">Appointment</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Owner</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Outlook</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      <button
                        type="button"
                        className="text-left font-medium text-primary hover:underline"
                        onClick={() => void navigate({ search: { appointmentId: row.id, range } })}
                      >
                        {row.title}
                      </button>
                      {row.location ? <div className="text-[11px] text-steel">{row.location}</div> : null}
                    </td>
                    <td className="py-2 pr-3">
                      {row.companyId && row.companyName ? (
                        <Link
                          to="/sales/customers/$id"
                          params={{ id: row.companyId }}
                          className="hover:underline"
                        >
                          {row.companyName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3">{formatDateTime(row.startAt, { timeZoneName: true }) ?? "—"}</td>
                    <td className="py-2 pr-3">{row.ownerName ?? "—"}</td>
                    <td className="py-2 pr-3">{row.type.replaceAll("_", " ")}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge tone={row.status === "CANCELLED" ? "bad" : "neutral"}>
                        {row.status}
                      </StatusBadge>
                    </td>
                    <td className="py-2">
                      {row.syncToOutlook
                        ? row.calendarSync?.syncStatus ?? "Pending"
                        : "CRM only"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Drawer
        open={Boolean(detail)}
        onClose={() => void navigate({ search: { range } })}
        title={detail?.title ?? "Appointment"}
      >
        {detail ? (
          <div className="space-y-4 p-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-steel">When</dt>
                <dd>
                  {formatDateTime(detail.startAt, { timeZoneName: true })} –{" "}
                  {formatDateTime(detail.endAt, { timeZoneName: true })}
                </dd>
              </div>
              <div>
                <dt className="text-steel">Owner</dt>
                <dd>{detail.ownerName ?? detail.ownerEmail ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-steel">Customer</dt>
                <dd>{detail.companyName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-steel">Location</dt>
                <dd>{detail.location ?? "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-steel">Notes</dt>
                <dd className="whitespace-pre-wrap">{detail.description || "—"}</dd>
              </div>
              <div>
                <dt className="text-steel">Outlook</dt>
                <dd>
                  {detail.syncToOutlook
                    ? detail.calendarSync?.syncStatus ?? "Opted in"
                    : "CRM only"}
                </dd>
              </div>
              {detail.calendarSync?.outlookWebLink ? (
                <div>
                  <dt className="text-steel">Open in Outlook</dt>
                  <dd>
                    <a
                      href={detail.calendarSync.outlookWebLink}
                      target="_blank"
                      rel="noreferrer"
                      className="font-bold text-primary hover:underline"
                    >
                      Outlook web
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="flex flex-wrap gap-2">
              {detail.status === "SCHEDULED" ? (
                <>
                  <button
                    type="button"
                    className="h-9 rounded-md border border-border px-3 text-[12px] font-bold uppercase"
                    onClick={() => {
                      void updateCrmAppointmentFn({
                        data: { appointmentId: detail.id, status: "COMPLETED" },
                      }).then(() => {
                        void navigate({ search: { appointmentId: detail.id, range } });
                        reloadList();
                      });
                    }}
                  >
                    Mark completed
                  </button>
                  <button
                    type="button"
                    className="h-9 rounded-md border border-border px-3 text-[12px] font-bold uppercase"
                    onClick={() => {
                      void cancelCrmAppointmentFn({ data: { appointmentId: detail.id } }).then(() => {
                        void navigate({ search: { appointmentId: detail.id, range } });
                        reloadList();
                      });
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : null}
              {detail.syncToOutlook &&
              detail.calendarSync &&
              (detail.calendarSync.syncStatus === "FAILED" ||
                detail.calendarSync.syncStatus === "CONFLICT" ||
                detail.calendarSync.syncStatus === "PENDING") ? (
                <button
                  type="button"
                  className="h-9 rounded-md border border-border px-3 text-[12px] font-bold uppercase"
                  onClick={() => {
                    void retryCrmAppointmentCalendarSyncFn({
                      data: { appointmentId: detail.id },
                    }).then((result) => {
                      if (!result.ok) setError(result.error);
                      reloadList();
                    });
                  }}
                >
                  Retry Outlook sync
                </button>
              ) : null}
            </div>
            {detail.calendarSync?.lastError ? (
              <p className="text-[12px] text-steel">{detail.calendarSync.lastError}</p>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <ScheduleAppointmentDrawer
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onCreated={(id) => {
          void navigate({ search: { appointmentId: id, range } });
          reloadList();
        }}
      />
    </div>
  );
}
