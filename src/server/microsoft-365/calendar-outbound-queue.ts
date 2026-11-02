/**
 * Enqueue outbound Calendar work after a CRM appointment change.
 * When either feature flag is off this returns before any database or Graph call.
 * Never hooked into notifyCrmTaskOutbound.
 */
import { calendarGraphAllowed, hasCalendarsReadWrite } from "@/domain/microsoft-calendar";
import { sanitizeMicrosoftMessage } from "@/domain/microsoft-365-crm";
import {
  createPrismaCalendarOutboundStore,
  enqueueCalendarOutboundJob,
} from "@/server/microsoft-365/calendar-outbound-prisma";
import type { CalendarOutboundConnection } from "@/server/microsoft-365/calendar-outbound-sync";
import { readCalendarFlags } from "@/server/microsoft-365/calendar-outbound-runtime";

export type CalendarOutboundNotice = {
  appointmentId: string;
  ownerId: string | null;
  previousOwnerId?: string | null;
  createdAt: Date;
  updatedAt?: Date;
  syncToOutlook?: boolean;
  attendeesConfirmed?: boolean;
  reason: "created" | "updated" | "assigned" | "explicit";
};

type QueueDeps = {
  graphAllowed: () => boolean;
  findConnection: (userId: string) => Promise<CalendarOutboundConnection | null>;
  hasActiveMapping: (userId: string, appointmentId: string) => Promise<boolean>;
  enqueue: (input: {
    connection: CalendarOutboundConnection;
    appointmentId: string;
    release: boolean;
    explicit: boolean;
    appointmentRevision?: string;
    attendeesConfirmed?: boolean;
  }) => Promise<unknown>;
  record: (message: string) => Promise<void>;
};

function ready(connection: CalendarOutboundConnection | null): connection is CalendarOutboundConnection {
  return Boolean(
    connection &&
      connection.status === "CONNECTED" &&
      connection.calendarSyncEnabled &&
      hasCalendarsReadWrite(connection.scopes),
  );
}

export async function notifyCrmAppointmentOutbound(
  input: CalendarOutboundNotice,
  deps: QueueDeps = defaultQueueDeps(),
): Promise<void> {
  if (!deps.graphAllowed()) return;
  try {
    const appointmentRevision = input.updatedAt?.toISOString();
    if (input.previousOwnerId && input.previousOwnerId !== input.ownerId) {
      const previous = await deps.findConnection(input.previousOwnerId);
      if (ready(previous) && (await deps.hasActiveMapping(previous.userId, input.appointmentId))) {
        await deps.enqueue({
          connection: previous,
          appointmentId: input.appointmentId,
          release: true,
          explicit: false,
          ...(appointmentRevision ? { appointmentRevision } : {}),
        });
      }
    }
    if (!input.ownerId) return;
    const connection = await deps.findConnection(input.ownerId);
    if (!ready(connection)) return;
    const mapped = await deps.hasActiveMapping(connection.userId, input.appointmentId);
    const explicit = input.reason === "explicit" || input.reason === "assigned";
    // Opt-in only. calendarOutboundEnabledAt never auto-exports CRM-only appointments.
    const eligible = explicit || mapped || input.syncToOutlook === true;
    if (!eligible) return;
    await deps.enqueue({
      connection,
      appointmentId: input.appointmentId,
      release: false,
      explicit,
      ...(appointmentRevision ? { appointmentRevision } : {}),
      ...(input.attendeesConfirmed ? { attendeesConfirmed: true } : {}),
    });
  } catch (error) {
    await deps.record(
      sanitizeMicrosoftMessage(error instanceof Error ? error.message : "Microsoft Calendar queue failed"),
    );
  }
}

export async function notifyCrmAppointmentOutboundSafely(input: CalendarOutboundNotice): Promise<void> {
  try {
    await notifyCrmAppointmentOutbound(input);
  } catch (error) {
    console.error(
      "[ab:microsoft-calendar]",
      sanitizeMicrosoftMessage(error instanceof Error ? error.message : "queue failed"),
    );
  }
}

function defaultQueueDeps(): QueueDeps {
  const store = createPrismaCalendarOutboundStore();
  return {
    graphAllowed: readCalendarFlags,
    findConnection: (userId) => store.findConnection(userId),
    hasActiveMapping: async (userId, appointmentId) => {
      const mapping = await store.findMapping(userId, appointmentId);
      return Boolean(mapping && mapping.deletedAt == null && mapping.syncStatus !== "TOMBSTONED");
    },
    enqueue: (input) => enqueueCalendarOutboundJob(input),
    record: async (message) => {
      console.error("[ab:microsoft-calendar]", message);
    },
  };
}

export function calendarOutboundFlagsFromEnv(): boolean {
  return readCalendarFlags();
}

/** Documented so callers never wire appointment enqueue into the To Do path. */
export function calendarGraphAllowedFromEnv(): boolean {
  return calendarGraphAllowed({
    crmFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
    calendarFlag: process.env["MICROSOFT_365_CALENDAR_SYNC_ENABLED"],
  });
}
