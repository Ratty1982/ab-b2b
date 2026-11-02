/**
 * Prisma adapter for inbound Calendar delta jobs and cursors.
 */
import { Prisma } from "@prisma/client";

import {
  MICROSOFT_CALENDAR_INBOUND_JOB_KIND,
  inboundCursorResource,
  type CalendarSyncedSnapshot,
  type MicrosoftCalendarInboundFields,
} from "@/domain/microsoft-calendar";
import { parseAppointmentAttendees } from "@/server/microsoft-365/calendar-outbound-sync";
import { prisma } from "@/infra/database/client";
import { decryptMicrosoftToken, encryptMicrosoftToken } from "@/server/microsoft-365/token-cipher";
import {
  calendarInboundDedupeKey,
  type CalendarInboundConnection,
  type CalendarInboundCrmAppointment,
  type CalendarInboundJob,
  type CalendarInboundJobPayload,
  type CalendarInboundMapping,
  type CalendarInboundStore,
} from "@/server/microsoft-365/calendar-inbound-sync";

function asPayload(value: Prisma.JsonValue | null): CalendarInboundJobPayload {
  const row = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const stagedRaw = Array.isArray(row["staged"]) ? row["staged"] : [];
  const staged = stagedRaw.filter((item) => item && typeof item === "object") as MicrosoftCalendarInboundFields[];
  const appliedRaw = Array.isArray(row["appliedIds"]) ? row["appliedIds"] : [];
  const appliedIds = appliedRaw.filter((item): item is string => typeof item === "string");
  const outsideRaw = Array.isArray(row["pendingOutsideIds"]) ? row["pendingOutsideIds"] : [];
  const pendingOutsideIds = outsideRaw.filter((item): item is string => typeof item === "string");
  const payload: CalendarInboundJobPayload = {};
  if (typeof row["nextLink"] === "string" || row["nextLink"] === null) payload.nextLink = row["nextLink"] as string | null;
  if (typeof row["pendingDeltaLink"] === "string" || row["pendingDeltaLink"] === null) {
    payload.pendingDeltaLink = row["pendingDeltaLink"] as string | null;
  }
  if (row["baseline"] === true) payload.baseline = true;
  if (row["forceCheck"] === true) payload.forceCheck = true;
  if (staged.length) payload.staged = staged;
  if (appliedIds.length) payload.appliedIds = appliedIds;
  if (pendingOutsideIds.length) payload.pendingOutsideIds = pendingOutsideIds;
  return payload;
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
  status: CalendarInboundConnection["status"];
  tenantId: string;
  microsoftUserId: string;
  scopes: string;
  calendarSyncEnabled: boolean;
  calendarInboundEnabledAt: Date | null;
  calendarInboundBaselineAt: Date | null;
  lastCalendarInboundSyncAt: Date | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  lastError: string | null;
}): CalendarInboundConnection {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    tenantId: row.tenantId,
    microsoftUserId: row.microsoftUserId,
    scopes: row.scopes,
    calendarSyncEnabled: row.calendarSyncEnabled,
    calendarInboundEnabledAt: row.calendarInboundEnabledAt,
    calendarInboundBaselineAt: row.calendarInboundBaselineAt,
    lastCalendarInboundSyncAt: row.lastCalendarInboundSyncAt,
    accessTokenEncrypted: row.accessTokenEncrypted,
    refreshTokenEncrypted: row.refreshTokenEncrypted,
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    lastError: row.lastError,
  };
}

function mapJob(row: {
  id: string;
  connectionId: string;
  userId: string;
  status: CalendarInboundJob["status"];
  attempt: number;
  runAfter: Date;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  lastError: string | null;
  dedupeKey: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
}): CalendarInboundJob {
  return {
    id: row.id,
    connectionId: row.connectionId,
    userId: row.userId,
    kind: MICROSOFT_CALENDAR_INBOUND_JOB_KIND,
    status: row.status,
    attempt: row.attempt,
    runAfter: row.runAfter,
    leaseOwner: row.leaseOwner,
    leaseUntil: row.leaseUntil,
    lastError: row.lastError,
    dedupeKey: row.dedupeKey ?? calendarInboundDedupeKey(row.connectionId),
    payload: asPayload(row.payload),
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
  syncStatus: CalendarInboundMapping["syncStatus"];
  externalAttendees: boolean;
  lastError: string | null;
  lastSyncedAt: Date | null;
  deletedAt: Date | null;
}): CalendarInboundMapping {
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

function mapAppointment(row: {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date;
  location: string | null;
  status: CalendarInboundCrmAppointment["status"];
  timeZone: string;
  attendees: Prisma.JsonValue | null;
  syncToOutlook: boolean;
  cancelledAt: Date | null;
  updatedAt: Date;
}): CalendarInboundCrmAppointment {
  return {
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
    syncToOutlook: row.syncToOutlook,
    cancelledAt: row.cancelledAt,
    updatedAt: row.updatedAt,
  };
}

export function createPrismaCalendarInboundStore(): CalendarInboundStore {
  return {
    async findConnection(userId) {
      const row = await prisma.microsoftAccountConnection.findUnique({ where: { userId } });
      return row ? mapConnection(row) : null;
    },
    async saveConnection(row) {
      await prisma.microsoftAccountConnection.update({
        where: { id: row.id },
        data: {
          calendarInboundEnabledAt: row.calendarInboundEnabledAt,
          calendarInboundBaselineAt: row.calendarInboundBaselineAt,
          lastCalendarInboundSyncAt: row.lastCalendarInboundSyncAt,
          lastError: row.lastError,
          accessTokenEncrypted: row.accessTokenEncrypted,
          refreshTokenEncrypted: row.refreshTokenEncrypted,
          accessTokenExpiresAt: row.accessTokenExpiresAt,
        },
      });
    },
    async claimInboundJobs(limit, owner, now) {
      const due = await prisma.microsoftSyncJob.findMany({
        where: {
          kind: MICROSOFT_CALENDAR_INBOUND_JOB_KIND,
          status: { in: ["QUEUED", "RUNNING"] },
          runAfter: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }, { status: "QUEUED" }],
        },
        orderBy: { runAfter: "asc" },
        take: limit * 3,
      });
      const claimed: CalendarInboundJob[] = [];
      for (const row of due) {
        if (claimed.length >= limit) break;
        const result = await prisma.microsoftSyncJob.updateMany({
          where: {
            id: row.id,
            kind: MICROSOFT_CALENDAR_INBOUND_JOB_KIND,
            status: { in: ["QUEUED", "RUNNING"] },
            runAfter: { lte: now },
            OR: [{ leaseOwner: null }, { leaseUntil: null }, { leaseUntil: { lt: now } }, { status: "QUEUED" }],
          },
          data: {
            status: "RUNNING",
            leaseOwner: owner,
            leaseUntil: new Date(now.getTime() + 120_000),
            attempt: { increment: row.status === "QUEUED" ? 1 : 0 },
          },
        });
        if (result.count !== 1) continue;
        const fresh = await prisma.microsoftSyncJob.findUniqueOrThrow({ where: { id: row.id } });
        claimed.push(mapJob(fresh));
      }
      return claimed;
    },
    async saveJob(job, opts) {
      if (opts?.requireLeaseOwner) {
        const result = await prisma.microsoftSyncJob.updateMany({
          where: { id: job.id, leaseOwner: opts.requireLeaseOwner, status: "RUNNING" },
          data: {
            status: job.status,
            attempt: job.attempt,
            runAfter: job.runAfter,
            leaseOwner: job.leaseOwner,
            leaseUntil: job.leaseUntil,
            lastError: job.lastError,
            payload: job.payload as Prisma.InputJsonValue,
          },
        });
        return result.count === 1;
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
          payload: job.payload as Prisma.InputJsonValue,
        },
      });
      return true;
    },
    async findMappingByMicrosoftEventId(connectionId, microsoftEventId) {
      const row = await prisma.microsoftCalendarMapping.findFirst({
        where: { connectionId, microsoftEventId },
      });
      return row ? mapMapping(row) : null;
    },
    async findActiveMappings(connectionId) {
      const rows = await prisma.microsoftCalendarMapping.findMany({
        where: {
          connectionId,
          deletedAt: null,
          syncStatus: { notIn: ["TOMBSTONED"] },
          appointmentId: { not: null },
        },
      });
      return rows.map(mapMapping);
    },
    async saveMapping(row) {
      await prisma.microsoftCalendarMapping.update({
        where: { id: row.id },
        data: {
          remoteEtag: row.remoteEtag,
          changeKey: row.changeKey,
          immutableEventId: row.immutableEventId,
          iCalUId: row.iCalUId,
          lastCrmRevision: row.lastCrmRevision,
          syncedSnapshot: row.syncedSnapshot === null ? Prisma.JsonNull : (row.syncedSnapshot as Prisma.InputJsonValue),
          transactionId: row.transactionId,
          outlookWebLink: row.outlookWebLink,
          syncStatus: row.syncStatus,
          externalAttendees: row.externalAttendees,
          lastError: row.lastError,
          lastSyncedAt: row.lastSyncedAt,
          deletedAt: row.deletedAt,
        },
      });
    },
    async findAppointment(appointmentId) {
      const row = await prisma.crmAppointment.findUnique({ where: { id: appointmentId } });
      return row ? mapAppointment(row) : null;
    },
    async updateAppointmentFields(appointmentId, data) {
      try {
        const updated = await prisma.crmAppointment.updateMany({
          where: { id: appointmentId, updatedAt: data.expectedUpdatedAt },
          data: {
            ...(data.title !== undefined ? { title: data.title } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.startAt !== undefined ? { startAt: data.startAt } : {}),
            ...(data.endAt !== undefined ? { endAt: data.endAt } : {}),
            ...(data.location !== undefined ? { location: data.location } : {}),
            ...(data.status !== undefined ? { status: data.status } : {}),
            ...(data.cancelledAt !== undefined ? { cancelledAt: data.cancelledAt } : {}),
          },
        });
        if (updated.count !== 1) {
          const exists = await prisma.crmAppointment.findUnique({
            where: { id: appointmentId },
            select: { id: true },
          });
          return { ok: false as const, reason: exists ? ("revision" as const) : ("missing" as const) };
        }
        const appointment = await prisma.crmAppointment.findUniqueOrThrow({ where: { id: appointmentId } });
        return { ok: true as const, appointment: mapAppointment(appointment) };
      } catch {
        return { ok: false as const, reason: "missing" as const };
      }
    },
    async getCursor(connectionId, resource) {
      const row = await prisma.microsoftSyncCursor.findUnique({
        where: { connectionId_resource: { connectionId, resource } },
      });
      if (!row?.deltaLinkEncrypted) return null;
      return decryptMicrosoftToken(row.deltaLinkEncrypted);
    },
    async saveCursor(connectionId, resource, deltaLink) {
      const encrypted = deltaLink ? encryptMicrosoftToken(deltaLink) : null;
      await prisma.microsoftSyncCursor.upsert({
        where: { connectionId_resource: { connectionId, resource } },
        create: { connectionId, resource, deltaLinkEncrypted: encrypted },
        update: { deltaLinkEncrypted: encrypted },
      });
    },
    async clearCursor(connectionId, resource) {
      await prisma.microsoftSyncCursor.deleteMany({ where: { connectionId, resource } });
    },
    async finalizeInboundRound(input) {
      const encrypted = encryptMicrosoftToken(input.deltaLink);
      return prisma.$transaction(async (tx) => {
        const leased = await tx.microsoftSyncJob.updateMany({
          where: {
            id: input.job.id,
            leaseOwner: input.requireLeaseOwner,
            status: "RUNNING",
          },
          data: {
            status: "SUCCEEDED",
            attempt: input.job.attempt,
            runAfter: input.job.runAfter,
            leaseOwner: null,
            leaseUntil: null,
            lastError: null,
            payload: input.job.payload as Prisma.InputJsonValue,
          },
        });
        if (leased.count !== 1) return false;
        await tx.microsoftSyncCursor.upsert({
          where: {
            connectionId_resource: { connectionId: input.connection.id, resource: input.resource },
          },
          create: {
            connectionId: input.connection.id,
            resource: input.resource,
            deltaLinkEncrypted: encrypted,
          },
          update: { deltaLinkEncrypted: encrypted },
        });
        await tx.microsoftAccountConnection.update({
          where: { id: input.connection.id },
          data: {
            lastCalendarInboundSyncAt: input.connection.lastCalendarInboundSyncAt,
            calendarInboundBaselineAt: input.connection.calendarInboundBaselineAt,
            calendarInboundEnabledAt: input.connection.calendarInboundEnabledAt,
            lastError: null,
          },
        });
        return true;
      });
    },
    async appendEvent(input) {
      await prisma.microsoftSyncEvent.create({
        data: {
          userId: input.userId,
          connectionId: input.connectionId,
          kind: input.kind,
          message: input.message,
          ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
          createdAt: input.createdAt,
        },
      });
    },
    async hasRunningOutboundForAppointment(userId, appointmentId) {
      const rows = await prisma.microsoftSyncJob.findMany({
        where: { userId, kind: "CALENDAR_OUTBOUND", status: "RUNNING" },
        select: { payload: true },
        take: 20,
      });
      return rows.some((row) => {
        const payload =
          row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
            ? (row.payload as Record<string, unknown>)
            : {};
        return payload["appointmentId"] === appointmentId;
      });
    },
    async withAppointmentLock(appointmentId, fn) {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`calendar-sync:${appointmentId}`}))`;
        return fn();
      });
    },
  };
}

export async function ensureCalendarInboundJobForConnection(
  connection: CalendarInboundConnection,
  options?: { forceCheck?: boolean; baseline?: boolean },
) {
  const dedupeKey = calendarInboundDedupeKey(connection.id);
  const existing = await prisma.microsoftSyncJob.findUnique({ where: { dedupeKey } });
  const payload: CalendarInboundJobPayload = {
    ...(options?.forceCheck ? { forceCheck: true } : {}),
    ...(options?.baseline || !connection.calendarInboundBaselineAt ? { baseline: true } : {}),
  };
  if (!existing) {
    return prisma.microsoftSyncJob.create({
      data: {
        connectionId: connection.id,
        userId: connection.userId,
        kind: MICROSOFT_CALENDAR_INBOUND_JOB_KIND,
        status: "QUEUED",
        runAfter: new Date(),
        dedupeKey,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }
  if (existing.status === "RUNNING") return existing;
  return prisma.microsoftSyncJob.update({
    where: { id: existing.id },
    data: {
      status: "QUEUED",
      runAfter: new Date(),
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
      payload: payload as Prisma.InputJsonValue,
      ...(existing.status === "FAILED" ||
      existing.status === "CANCELLED" ||
      existing.status === "SUCCEEDED"
        ? { attempt: 0 }
        : {}),
    },
  });
}

export async function enqueueCalendarInboundForEligibleConnections(): Promise<number> {
  const rows = await prisma.microsoftAccountConnection.findMany({
    where: {
      status: "CONNECTED",
      calendarSyncEnabled: true,
    },
    take: 50,
  });
  let queued = 0;
  for (const row of rows) {
    await ensureCalendarInboundJobForConnection(mapConnection(row));
    queued += 1;
  }
  return queued;
}

export async function calendarInboundCounts(userId: string): Promise<{
  pending: number;
  failed: number;
  conflicts: number;
  removed: number;
  lastCalendarInboundSyncAt: string | null;
  calendarInboundBaselineAt: string | null;
}> {
  const connection = await prisma.microsoftAccountConnection.findUnique({ where: { userId } });
  const [pending, failed, conflicts, removed] = await Promise.all([
    prisma.microsoftSyncJob.count({
      where: { userId, kind: MICROSOFT_CALENDAR_INBOUND_JOB_KIND, status: { in: ["QUEUED", "RUNNING"] } },
    }),
    prisma.microsoftSyncJob.count({
      where: { userId, kind: MICROSOFT_CALENDAR_INBOUND_JOB_KIND, status: "FAILED" },
    }),
    prisma.microsoftCalendarMapping.count({
      where: { userId, syncStatus: "CONFLICT", deletedAt: null },
    }),
    prisma.microsoftCalendarMapping.count({
      where: { userId, syncStatus: "REMOVED" },
    }),
  ]);
  return {
    pending,
    failed,
    conflicts,
    removed,
    lastCalendarInboundSyncAt: connection?.lastCalendarInboundSyncAt?.toISOString() ?? null,
    calendarInboundBaselineAt: connection?.calendarInboundBaselineAt?.toISOString() ?? null,
  };
}

export { inboundCursorResource };
