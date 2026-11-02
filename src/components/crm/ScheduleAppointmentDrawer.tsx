import { useMemo, useState } from "react";

import { Drawer } from "@/components/ab/Drawer";
import { APPOINTMENT_TYPES, type AppointmentType } from "@/domain/crm-appointments";
import { BUSINESS_TIME_ZONE } from "@/lib/datetime";
import { createCrmAppointmentFn } from "@/server/phase2/fns";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
  companyId?: string | null;
  companyName?: string | null;
  opportunityId?: string | null;
  relatedTaskId?: string | null;
  defaultTitle?: string | undefined;
};

function todayLondonDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function ScheduleAppointmentDrawer({
  open,
  onClose,
  onCreated,
  companyId,
  companyName,
  opportunityId,
  relatedTaskId,
  defaultTitle,
}: Props) {
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [type, setType] = useState<AppointmentType>("MEETING");
  const [date, setDate] = useState(todayLondonDate());
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("10:30");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [reminderMinutes, setReminderMinutes] = useState("15");
  const [syncToOutlook, setSyncToOutlook] = useState(false);
  const [attendeeEmail, setAttendeeEmail] = useState("");
  const [confirmExternalInvites, setConfirmExternalInvites] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const attendees = useMemo(() => {
    const email = attendeeEmail.trim().toLowerCase();
    if (!email) return [];
    return [{ email, type: "required" as const }];
  }, [attendeeEmail]);

  const needsInviteConfirm = syncToOutlook && attendees.length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    const reminder = Number(reminderMinutes);
    const result = await createCrmAppointmentFn({
      data: {
        title: title.trim() || (companyName ? `Meeting — ${companyName}` : "Customer meeting"),
        description: notes.trim() || null,
        type,
        date,
        startTime,
        endTime,
        timeZone: BUSINESS_TIME_ZONE,
        location: location.trim() || null,
        companyId: companyId ?? null,
        opportunityId: opportunityId ?? null,
        relatedTaskId: relatedTaskId ?? null,
        reminderMinutes: Number.isFinite(reminder) ? reminder : null,
        attendees,
        syncToOutlook,
        confirmExternalInvites: needsInviteConfirm ? confirmExternalInvites : false,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated?.(result.data.id);
    onClose();
  }

  return (
    <Drawer open={open} onClose={onClose} title="Schedule appointment">
      <div className="space-y-4 p-4">
        <p className="text-[12px] text-steel">
          Appointments are separate from CRM tasks. Outlook Calendar stays off unless you tick Add to Outlook
          Calendar.
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <label className="block text-sm">
          <span className="text-steel">Subject</span>
          <input
            className="mt-1 h-10 w-full rounded-md border border-border px-3"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={companyName ? `Meeting — ${companyName}` : "Meeting subject"}
          />
        </label>
        <label className="block text-sm">
          <span className="text-steel">Type</span>
          <select
            className="mt-1 h-10 w-full rounded-md border border-border px-3"
            value={type}
            onChange={(event) => setType(event.target.value as AppointmentType)}
          >
            {APPOINTMENT_TYPES.map((value) => (
              <option key={value} value={value}>
                {value.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="text-steel">Date</span>
            <input
              type="date"
              className="mt-1 h-10 w-full rounded-md border border-border px-3"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-steel">Start</span>
            <input
              type="time"
              className="mt-1 h-10 w-full rounded-md border border-border px-3"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-steel">End</span>
            <input
              type="time"
              className="mt-1 h-10 w-full rounded-md border border-border px-3"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </label>
        </div>
        <p className="text-[12px] text-steel">Times use Europe/London (GMT/BST).</p>
        <label className="block text-sm">
          <span className="text-steel">Location</span>
          <input
            className="mt-1 h-10 w-full rounded-md border border-border px-3"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-steel">Notes</span>
          <textarea
            className="mt-1 min-h-24 w-full rounded-md border border-border px-3 py-2"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-steel">Reminder (minutes before)</span>
          <input
            className="mt-1 h-10 w-full rounded-md border border-border px-3"
            value={reminderMinutes}
            onChange={(event) => setReminderMinutes(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-steel">Optional attendee email</span>
          <input
            type="email"
            className="mt-1 h-10 w-full rounded-md border border-border px-3"
            value={attendeeEmail}
            onChange={(event) => {
              setAttendeeEmail(event.target.value);
              setConfirmExternalInvites(false);
            }}
            placeholder="Leave blank for the pilot"
          />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={syncToOutlook}
            onChange={(event) => {
              setSyncToOutlook(event.target.checked);
              setConfirmExternalInvites(false);
            }}
          />
          <span>
            Add to Outlook Calendar
            <span className="mt-1 block text-[12px] text-steel">
              Off by default. Requires Microsoft 365 calendar consent and calendar sync enabled. CRM-only
              appointments do not need Microsoft.
            </span>
          </span>
        </label>
        {needsInviteConfirm ? (
          <label className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmExternalInvites}
              onChange={(event) => setConfirmExternalInvites(event.target.checked)}
            />
            <span>
              Send Outlook invitation to {attendees.map((item) => item.email).join(", ")}
              <span className="mt-1 block text-[12px] text-steel">
                Microsoft may email these addresses when the calendar event is created or updated. Do not use
                real customers during testing.
              </span>
            </span>
          </label>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            className="h-10 rounded-md border border-border px-4 text-[13px] font-bold"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-4 text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => void submit()}
            disabled={busy || (needsInviteConfirm && !confirmExternalInvites)}
          >
            Save appointment
          </button>
        </div>
      </div>
    </Drawer>
  );
}
