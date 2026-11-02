/**
 * Prisma adapter for outbound Calendar jobs. Claim uses updateMany so two workers cannot take the same row.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/infra/database/client";
import {
  MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND,
  ordinaryRetryIncludesJob,
  type CalendarSyncedSnapshot,
} from "@/domain/microsoft-calendar";
import {
  calendarOutboundDedupeKey,
  mergeCalendarOutboundPayload,
  parseAppointmentAttendees,
  type CalendarOutboundAppointment,
  type CalendarOutboundConnection,
  type CalendarOutboundJob,
  type CalendarOutboundJobPayload,
  type CalendarOutboundMapping,
  type CalendarOutboundStore,
} from "@/server/microsoft-365/calendar-outbound-sync";

function asPayload(value: Prisma.JsonValue | null): CalendarOutboundJobPayload {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const appointmentId = typeof row["appointmentId"] === "string" ? row["appointmentId"] : "";
  const approvalRaw = row["createApproval"];
  const approval =
    approvalRaw && typeof approvalRaw === "object" && !Array.isArray(approvalRaw)
      ? (approvalRaw as Record<string, unknown>)
      : null;
  return {
    appointmentId,
    ...(row["explicit"] === true ? { explicit: true } : {}),
    ...(row["release"] === true ? { release: true } : {}),
    ...(row["reviewed"] === true ? { reviewed: true } : {}),
    ...(row["createUncertain"] === true ? { createUncertain: true } : {}),
    ...(row["authorizeCreateOnce"] === true ? { authorizeCreateOnce: true } : {}),
    ...(row["recheckOnly"] === true ? { recheckOnly: true } : {}),
    ...(typeof row["knownMicrosoftEventId"] === "string"
      ? { knownMicrosoftEventId: row["knownMicrosoftEventId"] }
      : {}),
    ...(typeof row["appointmentRevision"] === "string"
      ? { appointmentRevision: row["appointmentRevision"] }
      : {}),
    ...(row["revisionDirty"] === true ? { revisionDirty: true } : {}),
    ...(row["attendeesConfirmed"] === true ? { attendeesConfirmed: true } : {}),
    ...(approval &&
    typeof approval["approvedByUserId"] === "string" &&
    typeof approval["approvedAt"] === "string" &&
    typeof approval["jobId"] === "string" &&
    typeof approval["appointmentId"] === "string" &&
    typeof approval["connectionId"] === "string" &&
    typeof approval["appointmentRevision"] === "string" &&
    approval["acknowledgedDuplicateRisk"] === true
      ? {
          createApproval: {
            approvedByUserId: approval["approvedByUserId"],
            approvedAt: approval["approvedAt"],
            jobId: approval["jobId"],
            appointmentId: approval["appointmentId"],
            connectionId: approval["connectionId"],
            appointmentRevision: approval["appointmentRevision"],
            acknowledgedDuplicateRisk: true as const,
          },
        }
      : {}),
  };
}

function asSnapshot(value: Prisma.JsonValue | null): CalendarSyncedSnapshot | null {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  if (!row) return null;
  if (typeof row["title"] !== "string") return null;
  if (typeof row["startAt"] !== "string" || typeof row["endAt"] !== "string") return null;
  if (row["status"] !== "SCHEDULED" && row["status"] !== "COMPLETED" && row["status"] !== "CANCELLED") {
    return null;
  }
  return {
    title: row["title"],
    description: typeof row["description"] === "string" ? row["description"] : null,
    startAt: row["startAt"],
    endAt: row["endAt"],
    location: typeof row["location"] === "string" ? row["location"] : null,
    status: row["status"],
    attendeesFingerprint: typeof row["attendeesFingerprint"] === "string" ? row["attendeesFingerprint"] : "",
  };
}

function mapConnection(row: {
  id: string;
  userId: string;
  status: CalendarOutboundConnection["status"];
  tenantId: string;
  microsoftUserId: string;
  scopes: string;
  calendarSyncEnabled: boolean;
  calendarOutboundEnabledAt: Date | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  lastCalendarSyncAt: Date | null;
  lastError: string | null;
}): CalendarOutboundConnection {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    tenantId: row.tenantId,
    microsoftUserId: row.microsoftUserId,
    scopes: row.scopes,
    calendarSyncEnabled: row.calendarSyncEnabled,
    calendarOutboundEnabledAt: row.calendarOutboundEnabledAt,
    accessTokenEncrypted: row.accessTokenEncrypted,
    refreshTokenEncrypted: row.refreshTokenEncrypted,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    lastCalendarSyncAt: row.lastCalendarSyncAt,
    lastError: row.lastError,
  };
}

function mapJob(row: {
  id: string;
  connectionId: string;
  userId: string;
  kind: string;
  status: CalendarOutboundJob["status"];
  attempt: number;
  runAfter: Date;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  lastError: string | null;
  dedupeKey: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): CalendarOutboundJob {
  const payload = asPayload(row.payload);
  return {
    id: row.id,
    connectionId: row.connectionId,
    userId: row.userId,
    kind: MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND,
    status: row.status,
    attempt: row.attempt,
    runAfter: row.runAfter,
    leaseOwner: row.leaseOwner,
    leaseUntil: row.leaseUntil,
    lastError: row.lastError,
    dedupeKey: row.dedupeKey ?? calendarOutboundDedupeKey(row.userId, payload.appointmentId, false),
    payload,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapMapping(row: {
  id: string;
  appointmentId: string | null;
  userId: string;
  connectionId: string;
  microsoftEventId: string;
  immutableEventId: string | null;
  iCalUId: string | null;
  changeKey: string | null;
  remoteEtag: string | null;
  lastCrmRevision: string | null;
  syncedSnapshot: Prisma.JsonValue | null;
  transactionId: string | null;
  outlookWebLink: string | null;
  syncStatus: CalendarOutboundMapping["syncStatus"];
  externalAttendees: boolean;
  lastError: string | null;
  lastSyncedAt: Date | null;
  deletedAt: Date | null;
}): CalendarOutboundMapping | null {
  if (!row.appointmentId) return null;
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    userId: row.userId,
    connectionId: row.connectionId,
    microsoftEventId: row.microsoftEventId,
    immutableEventId: row.immutableEventId,
    iCalUId: row.iCalUId,
    changeKey: row.changeKey,
    remoteEtag: row.remoteEtag,
    lastCrmRevision: row.lastCrmRevision,
    syncedSnapshot: asSnapshot(row.syncedSnapshot),
    transactionId: row.transactionId,
    outlookWebLink: row.outlookWebLink,
    syncStatus: row.syncStatus,
    externalAttendees: row.externalAttendees,
    lastError: row.lastError,
    lastSyncedAt: row.lastSyncedAt,
    deletedAt: row.deletedAt,
  };
}

function eventId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

export function createPrismaCalendarOutboundStore(): CalendarOutboundStore {
  return {
    async findConnection(userId) {
      const row = await prisma.microsoftAccountConnection.findUnique({ where: { userId } });
      return row ? mapConnection(row) : null;
    },
    async saveConnection(row) {
      await prisma.microsoftAccountConnection.updateMany({
        where: { id: row.id, status: "CONNECTED" },
        data: {
          lastCalendarSyncAt: row.lastCalendarSyncAt,
          lastError: row.lastError,
        },
      });
    },
    async withConnectionLock(connectionId, fn) {
      return prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`calendar:${connectionId}`}))`;
          return fn();
        },
        { maxWait: 10_000, timeout: 60_000 },
      );
    },
    async findAppointment(appointmentId) {
      const row = await prisma.crmAppointment.findUnique({ where: { id: appointmentId } });
      if (!row) return null;
      const appointment: CalendarOutboundAppointment = {
        id: row.id,
        ownerId: row.ownerId,
        title: row.title,
        description: row.description,
        startAt: row.startAt,
        endAt: row.endAt,
        location: row.location,
        status: row.status,
        timeZone: row.timeZone,
        attendees: parseAppointmentAttendees(row.attendees),
        updatedAt: row.updatedAt,
        syncToOutlook: row.syncToOutlook,
      };
      return appointment;
    },
    async findMapping(userId, appointmentId) {
      const row = await prisma.microsoftCalendarMapping.findUnique({
        where: { userId_appointmentId: { userId, appointmentId } },
      });
      return row ? mapMapping(row) : null;
    },
    async saveMapping(row) {
      const data = {
        appointmentId: row.appointmentId,
        userId: row.userId,
        connectionId: row.connectionId,
        microsoftEventId: row.microsoftEventId,
        immutableEventId: row.immutableEventId,
        iCalUId: row.iCalUId,
        changeKey: row.changeKey,
        remoteEtag: row.remoteEtag,
        lastCrmRevision: row.lastCrmRevision,
        syncedSnapshot:
          row.syncedSnapshot === null ? Prisma.JsonNull : (row.syncedSnapshot as Prisma.InputJsonValue),
        transactionId: row.transactionId,
        outlookWebLink: row.outlookWebLink,
        syncStatus: row.syncStatus,
        externalAttendees: row.externalAttendees,
        lastError: row.lastError,
        lastSyncedAt: row.lastSyncedAt,
        deletedAt: row.deletedAt,
      };
      await prisma.microsoftCalendarMapping.upsert({
        where: { userId_appointmentId: { userId: row.userId, appointmentId: row.appointmentId } },
        create: { id: row.id, ...data },
        update: data,
      });
    },
    async findJob(jobId) {
      const row = await prisma.microsoftSyncJob.findUnique({ where: { id: jobId } });
      return row ? mapJob(row) : null;
    },
    async saveJob(job, opts) {
      if (opts?.requireLeaseOwner) {
        const updated = await prisma.microsoftSyncJob.updateMany({
          where: { id: job.id, status: "RUNNING", leaseOwner: opts.requireLeaseOwner },
          data: {
            status: job.status,
            attempt: job.attempt,
            runAfter: job.runAfter,
            leaseOwner: job.leaseOwner,
            leaseUntil: job.leaseUntil,
            lastError: job.lastError,
            payload: job.payload,
            dedupeKey: job.dedupeKey,
          },
        });
        return updated.count === 1;
      }
      await prisma.microsoftSyncJob.update({
        where: { id: job.id },
        data: {
          status: job.status,
          attempt: job.attempt,
          runAfter: job.runAfter,
          leaseOwner: job.leaseOwner,
          leaseUntil: job.leaseUntil,
          lastError: job.lastError,
          payload: job.payload,
          dedupeKey: job.dedupeKey,
        },
      });
      return true;
    },
    async holdsJobLease(jobId, owner) {
      const row = await prisma.microsoftSyncJob.findFirst({
        where: { id: jobId, status: "RUNNING", leaseOwner: owner },
        select: { id: true },
      });
      return Boolean(row);
    },
    async appendEvent(event) {
      await prisma.microsoftSyncEvent.create({
        data: {
          id: eventId(),
          userId: event.userId,
          connectionId: event.connectionId,
          kind: event.kind,
          message: event.message,
          createdAt: event.createdAt,
        },
      });
    },
    async claimJobs(now, owner, limit, leaseMs) {
      const candidates = await prisma.microsoftSyncJob.findMany({
        where: {
          kind: MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND,
          OR: [
            { status: "QUEUED", runAfter: { lte: now } },
            { status: "RUNNING", leaseUntil: { lt: now } },
          ],
        },
        orderBy: { runAfter: "asc" },
        take: Math.max(limit, 1) * 3,
      });
      const leaseUntil = new Date(now.getTime() + leaseMs);
      const claimed: CalendarOutboundJob[] = [];
      for (const row of candidates) {
        if (claimed.length >= limit) break;
        const updated = await prisma.microsoftSyncJob.updateMany({
          where: {
            id: row.id,
            kind: MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND,
            OR: [
              { status: "QUEUED", runAfter: { lte: now } },
              { status: "RUNNING", leaseUntil: { lt: now } },
            ],
          },
          data: { status: "RUNNING", leaseOwner: owner, leaseUntil, attempt: { increment: 1 } },
        });
        if (updated.count === 1) {
          claimed.push(
            mapJob({ ...row, status: "RUNNING", leaseOwner: owner, leaseUntil, attempt: row.attempt + 1 }),
          );
        }
      }
      return claimed;
    },
  };
}

export async function enqueueCalendarOutboundJob(input: {
  connection: CalendarOutboundConnection;
  appointmentId: string;
  release: boolean;
  explicit: boolean;
  appointmentRevision?: string;
  attendeesConfirmed?: boolean;
}): Promise<"created" | "exists" | "requeued" | "marked_dirty"> {
  const dedupeKey = calendarOutboundDedupeKey(input.connection.userId, input.appointmentId, input.release);
  const payload: CalendarOutboundJobPayload = {
    appointmentId: input.appointmentId,
    ...(input.release ? { release: true } : {}),
    ...(input.explicit ? { explicit: true } : {}),
    ...(input.appointmentRevision ? { appointmentRevision: input.appointmentRevision } : {}),
    ...(input.attendeesConfirmed ? { attendeesConfirmed: true } : {}),
  };
  const existing = await prisma.microsoftSyncJob.findUnique({ where: { dedupeKey } });
  if (!existing) {
    try {
      await prisma.microsoftSyncJob.create({
        data: {
          connectionId: input.connection.id,
          userId: input.connection.userId,
          kind: MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND,
          status: "QUEUED",
          dedupeKey,
          payload,
        },
      });
      return "created";
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }
  const current = existing ?? (await prisma.microsoftSyncJob.findUnique({ where: { dedupeKey } }));
  if (!current) throw new Error("Microsoft Calendar job could not be queued");
  if (current.status === "QUEUED" || current.status === "RUNNING") {
    const merged = mergeCalendarOutboundPayload(asPayload(current.payload), payload, {
      markDirty: current.status === "RUNNING",
    });
    await prisma.microsoftSyncJob.update({
      where: { id: current.id },
      data: { payload: merged },
    });
    return current.status === "RUNNING" ? "marked_dirty" : "exists";
  }
  if (current.status === "NEEDS_REVIEW") {
    const merged = mergeCalendarOutboundPayload(asPayload(current.payload), payload, { markDirty: true });
    await prisma.microsoftSyncJob.update({
      where: { id: current.id },
      data: { payload: merged },
    });
    return "exists";
  }
  await prisma.microsoftSyncJob.update({
    where: { id: current.id },
    data: {
      status: "QUEUED",
      runAfter: new Date(),
      attempt: 0,
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      payload: mergeCalendarOutboundPayload(asPayload(current.payload), payload),
    },
  });
  return "requeued";
}

export async function cancelQueuedCalendarOutboundJobs(userId: string): Promise<void> {
  await prisma.microsoftSyncJob.updateMany({
    where: {
      userId,
      kind: MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: {
      status: "CANCELLED",
      leaseOwner: null,
      leaseUntil: null,
      lastError: "Microsoft 365 account disconnected",
    },
  });
}

export async function calendarOutboundCounts(
  userId: string,
): Promise<{ pending: number; failed: number; needsReview: number }> {
  const [pending, failed, needsReview] = await Promise.all([
    prisma.microsoftSyncJob.count({
      where: { userId, kind: MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND, status: { in: ["QUEUED", "RUNNING"] } },
    }),
    prisma.microsoftSyncJob.count({
      where: { userId, kind: MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND, status: "FAILED" },
    }),
    prisma.microsoftSyncJob.count({
      where: { userId, kind: MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND, status: "NEEDS_REVIEW" },
    }),
  ]);
  return { pending, failed, needsReview };
}

export async function retryCalendarOutboundJobs(userId: string): Promise<number> {
  const rows = await prisma.microsoftSyncJob.findMany({
    where: {
      userId,
      kind: MICROSOFT_CALENDAR_OUTBOUND_JOB_KIND,
      status: { in: ["FAILED", "NEEDS_REVIEW"] },
    },
  });
  let retried = 0;
  for (const row of rows) {
    const payload = asPayload(row.payload);
    if (!ordinaryRetryIncludesJob({ status: row.status, createUncertain: payload.createUncertain })) continue;
    await prisma.microsoftSyncJob.update({
      where: { id: row.id },
      data: {
        status: "QUEUED",
        runAfter: new Date(),
        leaseOwner: null,
        leaseUntil: null,
        lastError: null,
        payload: { ...payload, reviewed: true, authorizeCreateOnce: false },
      },
    });
    retried += 1;
  }
  return retried;
}
