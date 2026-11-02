/**
 * CRM appointments. Distinct from Task. Outlook sync is opt-in per appointment and
 * never implied by creating a task or logging a meeting activity.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";

import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  attendeesFingerprint,
  defaultSyncToOutlook,
  hasValidInviteConsent,
  mustConfirmOutlookInvites,
  normalizeAttendees,
  outlookInvitesAuthorised,
  type AppointmentAttendee,
} from "@/domain/crm-appointments";
import { BUSINESS_TIME_ZONE, londonWallTimeToUtc } from "@/lib/datetime";
import {
  appointmentRevisionOf,
  validateAppointmentRange,
  wallTimeInZoneToUtc,
} from "@/domain/microsoft-calendar";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError } from "@/server/rbac/guards";
import { grants, hasPermission } from "@/server/rbac/access";
import {
  assertCrmCompanyAccess,
  requireCrmViewer,
  resolveCrmCompanyScope,
} from "@/server/crm/scope";

const attendeeSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().max(200).optional().nullable(),
  type: z.enum(["required", "optional"]).optional(),
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).optional().nullable(),
  type: z.enum(APPOINTMENT_TYPES).optional(),
  /** YYYY-MM-DD in the appointment timezone */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** HH:mm local wall clock */
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  timeZone: z.string().min(1).max(64).optional(),
  location: z.string().max(500).optional().nullable(),
  companyId: z.string().min(1).optional().nullable(),
  contactId: z.string().min(1).optional().nullable(),
  opportunityId: z.string().min(1).optional().nullable(),
  relatedTaskId: z.string().min(1).optional().nullable(),
  reminderMinutes: z.number().int().min(0).max(10080).optional().nullable(),
  attendees: z.array(attendeeSchema).max(20).optional().nullable(),
  /** Must stay false unless the user explicitly opts in. */
  syncToOutlook: z.boolean().optional(),
  /** Required when attendees would receive Outlook invitations. */
  confirmExternalInvites: z.boolean().optional(),
});

const listSchema = z.object({
  q: z.string().max(200).optional().nullable(),
  ownerId: z.string().optional().nullable(),
  companyId: z.string().optional().nullable(),
  type: z.enum([...APPOINTMENT_TYPES, "ALL"] as const).optional().nullable(),
  status: z.enum([...APPOINTMENT_STATUSES, "ALL"] as const).optional().nullable(),
  range: z.enum(["TODAY", "UPCOMING", "PAST", "ALL"]).optional().nullable(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

function parseLocalRange(input: {
  date: string;
  startTime: string;
  endTime: string;
  timeZone: string;
}): { startAt: Date; endAt: Date } {
  const [y, m, d] = input.date.split("-").map(Number);
  const [sh, sm] = input.startTime.split(":").map(Number);
  const [eh, em] = input.endTime.split(":").map(Number);
  if (!y || !m || !d || sh == null || sm == null || eh == null || em == null) {
    throw new AuthError("Invalid appointment date or time", "VALIDATION", 400);
  }
  let startAt: Date;
  let endAt: Date;
  if (input.timeZone === BUSINESS_TIME_ZONE || input.timeZone === "Europe/London") {
    startAt = londonWallTimeToUtc(y, m, d, sh, sm, 0);
    endAt = londonWallTimeToUtc(y, m, d, eh, em, 0);
    // Meetings that cross midnight: end earlier than start on the same civil day.
    if (endAt.getTime() <= startAt.getTime()) {
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      endAt = londonWallTimeToUtc(
        next.getUTCFullYear(),
        next.getUTCMonth() + 1,
        next.getUTCDate(),
        eh,
        em,
        0,
      );
    }
  } else {
    startAt = wallTimeInZoneToUtc(input.timeZone, y, m, d, sh, sm, 0);
    endAt = wallTimeInZoneToUtc(input.timeZone, y, m, d, eh, em, 0);
    if (endAt.getTime() <= startAt.getTime()) {
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      endAt = wallTimeInZoneToUtc(
        input.timeZone,
        next.getUTCFullYear(),
        next.getUTCMonth() + 1,
        next.getUTCDate(),
        eh,
        em,
        0,
      );
    }
  }
  const range = validateAppointmentRange(startAt, endAt);
  if (!range.ok) throw new AuthError(range.reason, "VALIDATION", 400);
  return { startAt, endAt };
}

function canManageAllAppointments(profile: Awaited<ReturnType<typeof requireCrmViewer>>): boolean {
  return grants(profile, "crm.manage", "admin.access", "sales.view_all_accounts");
}

async function assertAppointmentAccess(
  profile: Awaited<ReturnType<typeof requireCrmViewer>>,
  appointment: { ownerId: string; companyId: string | null },
): Promise<void> {
  if (canManageAllAppointments(profile)) return;
  if (appointment.ownerId === profile.userId) return;
  if (appointment.companyId) {
    await assertCrmCompanyAccess(profile, appointment.companyId);
    return;
  }
  throw new AuthError("Not permitted to open this appointment", "FORBIDDEN", 403);
}

function mapAttendees(value: Prisma.JsonValue | null | undefined): AppointmentAttendee[] {
  return normalizeAttendees(value ?? []);
}

function clearInviteConsentData() {
  return {
    inviteConsentFingerprint: null as string | null,
    inviteConsentRevision: null as string | null,
    inviteConsentedAt: null as Date | null,
    inviteConsentedById: null as string | null,
  };
}

async function recordInviteConsent(input: {
  appointmentId: string;
  actorUserId: string;
  attendees: readonly AppointmentAttendee[];
}) {
  const fingerprint = attendeesFingerprint(input.attendees);
  if (!fingerprint) {
    return prisma.crmAppointment.update({
      where: { id: input.appointmentId },
      data: clearInviteConsentData(),
    });
  }
  // Capture revision after the confirming write so consent is bound to this attendee list revision.
  const stamped = await prisma.crmAppointment.update({
    where: { id: input.appointmentId },
    data: {
      inviteConsentFingerprint: fingerprint,
      inviteConsentedAt: new Date(),
      inviteConsentedById: input.actorUserId,
    },
  });
  const revision = appointmentRevisionOf(stamped);
  return prisma.crmAppointment.update({
    where: { id: input.appointmentId },
    data: { inviteConsentRevision: revision },
  });
}

function enqueueAttendeeConsent(input: {
  attendees: readonly AppointmentAttendee[];
  confirmed: boolean;
  appointmentRevision: string;
}): {
  attendeesConfirmed: boolean;
  attendeesConsentFingerprint?: string;
  attendeesConsentRevision?: string;
} {
  if (!input.attendees.length) {
    return { attendeesConfirmed: true };
  }
  if (!input.confirmed) {
    return { attendeesConfirmed: false };
  }
  const fingerprint = attendeesFingerprint(input.attendees);
  return {
    attendeesConfirmed: true,
    attendeesConsentFingerprint: fingerprint,
    attendeesConsentRevision: input.appointmentRevision,
  };
}

function serializeAppointment(row: {
  id: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  startAt: Date;
  endAt: Date;
  timeZone: string;
  location: string | null;
  ownerId: string;
  companyId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  relatedTaskId: string | null;
  reminderMinutes: number | null;
  attendees: Prisma.JsonValue | null;
  syncToOutlook: boolean;
  teamsMeetingEnabled: boolean;
  inviteConsentFingerprint?: string | null;
  inviteConsentRevision?: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  owner?: { id: string; name: string | null; email: string } | null;
  company?: { id: string; name: string } | null;
  contact?: { id: string; firstName: string; lastName: string; email: string | null } | null;
  microsoftCalendarMappings?: Array<{
    id: string;
    microsoftEventId: string;
    syncStatus: string;
    lastError: string | null;
    outlookWebLink: string | null;
    lastSyncedAt: Date | null;
    externalAttendees: boolean;
  }>;
}) {
  const mapping = row.microsoftCalendarMappings?.[0] ?? null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    status: row.status,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    timeZone: row.timeZone,
    location: row.location,
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? null,
    ownerEmail: row.owner?.email ?? null,
    companyId: row.companyId,
    companyName: row.company?.name ?? null,
    contactId: row.contactId,
    contactName: row.contact
      ? `${row.contact.firstName} ${row.contact.lastName}`.trim()
      : null,
    contactEmail: row.contact?.email ?? null,
    opportunityId: row.opportunityId,
    relatedTaskId: row.relatedTaskId,
    reminderMinutes: row.reminderMinutes,
    attendees: mapAttendees(row.attendees),
    syncToOutlook: row.syncToOutlook,
    teamsMeetingEnabled: row.teamsMeetingEnabled,
    inviteConsentFingerprint: row.inviteConsentFingerprint ?? null,
    inviteConsentRevision: row.inviteConsentRevision ?? null,
    inviteConsentValid: outlookInvitesAuthorised({
      attendees: mapAttendees(row.attendees),
      ownerEmail: row.owner?.email,
      consentFingerprint: row.inviteConsentFingerprint,
    }),
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    calendarSync: mapping
      ? {
          mappingId: mapping.id,
          microsoftEventId: mapping.microsoftEventId,
          syncStatus: mapping.syncStatus,
          lastError: mapping.lastError,
          outlookWebLink: mapping.outlookWebLink,
          lastSyncedAt: mapping.lastSyncedAt?.toISOString() ?? null,
          externalAttendees: mapping.externalAttendees,
        }
      : null,
  };
}

export async function listCrmAppointments(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId, "crm.activities.view");
  const input = listSchema.parse(raw ?? {});
  const scope = await resolveCrmCompanyScope(profile);
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const now = new Date();

  const where: Prisma.CrmAppointmentWhereInput = {};
  if (!canManageAllAppointments(profile)) {
    where.OR = [
      { ownerId: actorUserId },
      ...(scope === "all"
        ? []
        : [{ companyId: { in: scope.length ? scope : ["__none__"] } }]),
    ];
  }
  if (input.ownerId) where.ownerId = input.ownerId;
  if (input.companyId) {
    await assertCrmCompanyAccess(profile, input.companyId);
    where.companyId = input.companyId;
  }
  if (input.type && input.type !== "ALL") where.type = input.type;
  if (input.status && input.status !== "ALL") where.status = input.status;

  const range = input.range ?? "UPCOMING";
  if (range === "TODAY") {
    const { londonCalendarDayBounds } = await import("@/lib/datetime");
    const bounds = londonCalendarDayBounds(now);
    where.startAt = { gte: bounds.start, lt: bounds.end };
  } else if (range === "UPCOMING") {
    where.startAt = { gte: now };
    where.status = where.status ?? "SCHEDULED";
  } else if (range === "PAST") {
    where.startAt = { lt: now };
  }
  if (input.from || input.to) {
    where.startAt = {
      ...(typeof where.startAt === "object" && where.startAt ? where.startAt : {}),
      ...(input.from ? { gte: new Date(`${input.from}T00:00:00.000Z`) } : {}),
      ...(input.to ? { lte: new Date(`${input.to}T23:59:59.999Z`) } : {}),
    };
  }
  if (input.q?.trim()) {
    const qq = input.q.trim();
    where.AND = [
      {
        OR: [
          { title: { contains: qq, mode: "insensitive" } },
          { description: { contains: qq, mode: "insensitive" } },
          { location: { contains: qq, mode: "insensitive" } },
          { company: { name: { contains: qq, mode: "insensitive" } } },
        ],
      },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.crmAppointment.count({ where }),
    prisma.crmAppointment.findMany({
      where,
      orderBy: { startAt: range === "PAST" ? "desc" : "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        company: { select: { id: true, name: true } },
        contact: { select: { id: true, firstName: true, lastName: true, email: true } },
        microsoftCalendarMappings: {
          where: { deletedAt: null },
          take: 1,
          orderBy: { updatedAt: "desc" },
        },
      },
    }),
  ]);

  return {
    page,
    pageSize,
    total,
    items: rows.map(serializeAppointment),
  };
}

export async function getCrmAppointment(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId, "crm.activities.view");
  const { appointmentId } = z.object({ appointmentId: z.string().min(1) }).parse(raw ?? {});
  const row = await prisma.crmAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      company: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true, email: true } },
      microsoftCalendarMappings: {
        where: { deletedAt: null },
        take: 1,
        orderBy: { updatedAt: "desc" },
      },
    },
  });
  if (!row) throw new AuthError("Appointment not found", "NOT_FOUND", 404);
  await assertAppointmentAccess(profile, row);
  return serializeAppointment(row);
}

export async function createCrmAppointment(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId, "crm.activities.view");
  if (!hasPermission(profile, "tasks.manage") && !hasPermission(profile, "crm.activities.create") && !grants(profile, "crm.manage", "admin.access")) {
    throw new AuthError("Not permitted to schedule appointments", "FORBIDDEN", 403);
  }
  const input = createSchema.parse(raw ?? {});
  if (input.companyId) await assertCrmCompanyAccess(profile, input.companyId);

  const timeZone = input.timeZone?.trim() || BUSINESS_TIME_ZONE;
  const { startAt, endAt } = parseLocalRange({
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    timeZone,
  });

  const attendees = normalizeAttendees(input.attendees ?? []);
  const owner = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { email: true },
  });
  const syncToOutlook = input.syncToOutlook === true ? true : defaultSyncToOutlook();
  const inviteGate = mustConfirmOutlookInvites({
    syncToOutlook,
    attendeesChanged: attendees.length > 0,
    attendees,
    ownerEmail: owner?.email,
    confirmExternalInvites: input.confirmExternalInvites,
  });
  if (inviteGate.blocked) {
    throw new AuthError(
      `Confirm Outlook invitations before inviting: ${inviteGate.emails.join(", ")}`,
      "VALIDATION",
      400,
    );
  }

  if (input.relatedTaskId) {
    const task = await prisma.task.findUnique({ where: { id: input.relatedTaskId }, select: { id: true } });
    if (!task) throw new AuthError("Related task not found", "NOT_FOUND", 404);
  }
  if (input.contactId) {
    const contact = await prisma.contact.findUnique({
      where: { id: input.contactId },
      select: { id: true, companyId: true },
    });
    if (!contact) throw new AuthError("Contact not found", "NOT_FOUND", 404);
    if (input.companyId && contact.companyId !== input.companyId) {
      throw new AuthError("Contact does not belong to this customer", "VALIDATION", 400);
    }
  }
  if (input.opportunityId) {
    const opportunity = await prisma.opportunity.findUnique({
      where: { id: input.opportunityId },
      select: { id: true, companyId: true },
    });
    if (!opportunity) throw new AuthError("Opportunity not found", "NOT_FOUND", 404);
    if (input.companyId && opportunity.companyId !== input.companyId) {
      throw new AuthError("Opportunity does not belong to this customer", "VALIDATION", 400);
    }
  }

  let appointment = await prisma.crmAppointment.create({
    data: {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      type: input.type ?? "MEETING",
      status: "SCHEDULED",
      startAt,
      endAt,
      timeZone,
      location: input.location?.trim() || null,
      ownerId: actorUserId,
      companyId: input.companyId ?? null,
      contactId: input.contactId ?? null,
      opportunityId: input.opportunityId ?? null,
      relatedTaskId: input.relatedTaskId ?? null,
      reminderMinutes: input.reminderMinutes ?? null,
      attendees: attendees.length ? (attendees as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      syncToOutlook,
      teamsMeetingEnabled: false,
      ...clearInviteConsentData(),
    },
  });

  if (inviteGate.required && input.confirmExternalInvites === true) {
    appointment = await recordInviteConsent({
      appointmentId: appointment.id,
      actorUserId,
      attendees,
    });
  }

  if (input.companyId) {
    await prisma.activity.create({
      data: {
        companyId: input.companyId,
        userId: actorUserId,
        opportunityId: input.opportunityId ?? null,
        type: "MEETING",
        subject: appointment.title,
        body: appointment.description,
        occurredAt: appointment.startAt,
        metadata: {
          appointmentId: appointment.id,
          syncToOutlook: appointment.syncToOutlook,
        },
      },
    });
  }

  await recordAuditEvent({
    action: "crm.appointment.created",
    entityType: "CrmAppointment",
    entityId: appointment.id,
    actorUserId,
    companyId: appointment.companyId,
    metadata: {
      syncToOutlook: appointment.syncToOutlook,
      attendeeCount: attendees.length,
      confirmExternalInvites: input.confirmExternalInvites === true,
      inviteConsentFingerprint: appointment.inviteConsentFingerprint,
    },
  });

  if (appointment.syncToOutlook) {
    const { notifyCrmAppointmentOutboundSafely } = await import(
      "@/server/microsoft-365/calendar-outbound-queue"
    );
    const consent = enqueueAttendeeConsent({
      attendees,
      confirmed: outlookInvitesAuthorised({
        attendees,
        ownerEmail: owner?.email,
        consentFingerprint: appointment.inviteConsentFingerprint,
      }),
      appointmentRevision: appointmentRevisionOf(appointment),
    });
    await notifyCrmAppointmentOutboundSafely({
      appointmentId: appointment.id,
      ownerId: appointment.ownerId,
      createdAt: appointment.createdAt,
      syncToOutlook: true,
      ...consent,
      updatedAt: appointment.updatedAt,
      reason: "created",
    });
  }

  return { id: appointment.id, syncToOutlook: appointment.syncToOutlook };
}

export async function updateCrmAppointment(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId, "crm.activities.view");
  if (!hasPermission(profile, "tasks.manage") && !grants(profile, "crm.manage", "admin.access", "crm.activities.create")) {
    throw new AuthError("Not permitted to update appointments", "FORBIDDEN", 403);
  }
  const input = createSchema
    .partial()
    .extend({
      appointmentId: z.string().min(1),
      status: z.enum(APPOINTMENT_STATUSES).optional(),
      clearAttendees: z.boolean().optional(),
    })
    .parse(raw ?? {});

  const existing = await prisma.crmAppointment.findUnique({ where: { id: input.appointmentId } });
  if (!existing) throw new AuthError("Appointment not found", "NOT_FOUND", 404);
  await assertAppointmentAccess(profile, existing);
  if (existing.ownerId !== actorUserId && !canManageAllAppointments(profile)) {
    throw new AuthError("Only the organiser can change this appointment", "FORBIDDEN", 403);
  }

  let startAt = existing.startAt;
  let endAt = existing.endAt;
  const timeZone = input.timeZone?.trim() || existing.timeZone;
  if (input.date && input.startTime && input.endTime) {
    const range = parseLocalRange({
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      timeZone,
    });
    startAt = range.startAt;
    endAt = range.endAt;
  }

  let attendees = mapAttendees(existing.attendees);
  let attendeesChanged = false;
  if (input.clearAttendees) {
    attendees = [];
    attendeesChanged = attendeesFingerprint(mapAttendees(existing.attendees)) !== "";
  } else if (input.attendees) {
    attendees = normalizeAttendees(input.attendees);
    attendeesChanged =
      attendeesFingerprint(mapAttendees(existing.attendees)) !== attendeesFingerprint(attendees);
  }

  const syncToOutlook =
    input.syncToOutlook === undefined ? existing.syncToOutlook : input.syncToOutlook === true;
  const enablingOutlook = !existing.syncToOutlook && syncToOutlook;

  const owner = await prisma.user.findUnique({
    where: { id: existing.ownerId },
    select: { email: true },
  });
  const inviteGate = mustConfirmOutlookInvites({
    syncToOutlook,
    enablingOutlook,
    attendeesChanged,
    attendees,
    ownerEmail: owner?.email,
    existingConsentFingerprint: existing.inviteConsentFingerprint,
    confirmExternalInvites: input.confirmExternalInvites,
  });
  if (inviteGate.blocked) {
    throw new AuthError(
      `Confirm Outlook invitations before syncing with attendees: ${inviteGate.emails.join(", ")}`,
      "VALIDATION",
      400,
    );
  }

  const status = input.status ?? existing.status;
  const consentStillValid =
    !attendeesChanged &&
    hasValidInviteConsent({
      attendees,
      consentFingerprint: existing.inviteConsentFingerprint,
    });
  let appointment = await prisma.crmAppointment.update({
    where: { id: existing.id },
    data: {
      title: input.title?.trim() ?? existing.title,
      description:
        input.description === undefined ? existing.description : input.description?.trim() || null,
      type: input.type ?? existing.type,
      status,
      startAt,
      endAt,
      timeZone,
      location: input.location === undefined ? existing.location : input.location?.trim() || null,
      reminderMinutes:
        input.reminderMinutes === undefined ? existing.reminderMinutes : input.reminderMinutes,
      attendees: attendees.length ? (attendees as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      syncToOutlook,
      completedAt: status === "COMPLETED" ? existing.completedAt ?? new Date() : null,
      cancelledAt: status === "CANCELLED" ? existing.cancelledAt ?? new Date() : null,
      ...(!attendees.length || (!consentStillValid && input.confirmExternalInvites !== true)
        ? clearInviteConsentData()
        : {}),
    },
  });

  if (inviteGate.required && input.confirmExternalInvites === true) {
    appointment = await recordInviteConsent({
      appointmentId: appointment.id,
      actorUserId,
      attendees,
    });
  }

  await recordAuditEvent({
    action: status === "CANCELLED" ? "crm.appointment.cancelled" : "crm.appointment.updated",
    entityType: "CrmAppointment",
    entityId: appointment.id,
    actorUserId,
    companyId: appointment.companyId,
    metadata: {
      syncToOutlook: appointment.syncToOutlook,
      attendeesChanged,
      enablingOutlook,
      confirmExternalInvites: input.confirmExternalInvites === true,
      inviteConsentFingerprint: appointment.inviteConsentFingerprint,
    },
  });

  if (appointment.syncToOutlook || existing.syncToOutlook) {
    const { notifyCrmAppointmentOutboundSafely } = await import(
      "@/server/microsoft-365/calendar-outbound-queue"
    );
    const consent = enqueueAttendeeConsent({
      attendees,
      confirmed: outlookInvitesAuthorised({
        attendees,
        ownerEmail: owner?.email,
        consentFingerprint: appointment.inviteConsentFingerprint,
      }),
      appointmentRevision: appointmentRevisionOf(appointment),
    });
    await notifyCrmAppointmentOutboundSafely({
      appointmentId: appointment.id,
      ownerId: appointment.ownerId,
      createdAt: appointment.createdAt,
      syncToOutlook: appointment.syncToOutlook,
      ...consent,
      updatedAt: appointment.updatedAt,
      reason: "updated",
    });
  }

  return { id: appointment.id };
}

export async function cancelCrmAppointment(actorUserId: string, raw: unknown) {
  return updateCrmAppointment(actorUserId, {
    ...(typeof raw === "object" && raw ? raw : {}),
    status: "CANCELLED",
  });
}

export async function retryCrmAppointmentCalendarSync(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId, "crm.activities.view");
  const input = z
    .object({
      appointmentId: z.string().min(1),
      /** Required when retry would send Outlook invitations and durable consent is missing/stale. */
      confirmExternalInvites: z.boolean().optional(),
    })
    .parse(raw ?? {});
  const existing = await prisma.crmAppointment.findUnique({ where: { id: input.appointmentId } });
  if (!existing) throw new AuthError("Appointment not found", "NOT_FOUND", 404);
  await assertAppointmentAccess(profile, existing);
  if (existing.ownerId !== actorUserId && !canManageAllAppointments(profile)) {
    throw new AuthError("Only the organiser can retry Outlook sync", "FORBIDDEN", 403);
  }
  if (!existing.syncToOutlook) {
    throw new AuthError("This appointment is not opted into Outlook", "VALIDATION", 400);
  }

  const attendees = mapAttendees(existing.attendees);
  const owner = await prisma.user.findUnique({
    where: { id: existing.ownerId },
    select: { email: true },
  });
  const inviteGate = mustConfirmOutlookInvites({
    syncToOutlook: true,
    attendees,
    ownerEmail: owner?.email,
    existingConsentFingerprint: existing.inviteConsentFingerprint,
    confirmExternalInvites: input.confirmExternalInvites,
  });
  if (inviteGate.blocked) {
    throw new AuthError(
      `Confirm Outlook invitations before retrying sync: ${inviteGate.emails.join(", ")}`,
      "VALIDATION",
      400,
    );
  }
  let row = existing;
  if (inviteGate.required && input.confirmExternalInvites === true) {
    row = await recordInviteConsent({
      appointmentId: row.id,
      actorUserId,
      attendees,
    });
  }

  const { notifyCrmAppointmentOutboundSafely } = await import(
    "@/server/microsoft-365/calendar-outbound-queue"
  );
  const consent = enqueueAttendeeConsent({
    attendees,
    confirmed: outlookInvitesAuthorised({
      attendees,
      ownerEmail: owner?.email,
      consentFingerprint: row.inviteConsentFingerprint,
    }),
    appointmentRevision: appointmentRevisionOf(row),
  });
  await notifyCrmAppointmentOutboundSafely({
    appointmentId: row.id,
    ownerId: row.ownerId,
    createdAt: row.createdAt,
    syncToOutlook: true,
    ...consent,
    updatedAt: row.updatedAt,
    reason: "explicit",
  });
  await recordAuditEvent({
    action: "crm.appointment.calendar_retry",
    entityType: "CrmAppointment",
    entityId: row.id,
    actorUserId,
    companyId: row.companyId,
    metadata: {
      attendeesConfirmed: consent.attendeesConfirmed,
      inviteConsentFingerprint: row.inviteConsentFingerprint,
      attendeeEmails: attendees.map((item) => item.email),
    },
  });
  return {
    ok: true as const,
    attendeesConfirmed: consent.attendeesConfirmed,
    attendeeEmails: attendees.map((item) => item.email),
  };
}
