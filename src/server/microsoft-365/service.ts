/**
 * Staff-facing Microsoft 365 connection service.
 * Reads the feature flag on each call. Does not start a scheduler or export tasks.
 */
import {
  Microsoft365Error,
  readMicrosoft365Gate,
  type Microsoft365Actor,
  type Microsoft365Gate,
} from "@/domain/microsoft-365-crm";
import { prisma } from "@/infra/database/client";
import { grants, hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import {
  beginMicrosoftConnect,
  completeMicrosoftCallback,
  disconnectMicrosoftAccount,
  getMicrosoft365Status,
  refreshMicrosoftConnection,
  updateMicrosoft365Preferences,
} from "@/server/microsoft-365/flow";
import { recordAuditEvent } from "@/server/audit/record";
import {
  approveUncertainOutboundCreate,
  cancelQueuedOutboundJobs,
  listUncertainOutboundJobs,
  outboundCounts,
  prepareUncertainRecheckJob,
  retryOutboundJobs,
} from "@/server/microsoft-365/outbound-prisma";
import {
  createPrismaInboundStore,
  ensureInboundJobForConnection,
  inboundCounts,
  listInboundConflicts,
  prepareRecreateRemovedMicrosoftMapping,
  unlinkRemovedMicrosoftMapping,
} from "@/server/microsoft-365/inbound-prisma";
import { processOutboundJob } from "@/server/microsoft-365/outbound-sync";
import { productionOutboundRuntime } from "@/server/microsoft-365/outbound-runtime";
import { readInboundFlags } from "@/server/microsoft-365/inbound-runtime";
import { createPrismaMicrosoft365Store } from "@/server/microsoft-365/prisma-store";
import { outboundGraphAllowed } from "@/domain/microsoft-todo-outbound";
import { inboundGraphAllowed } from "@/domain/microsoft-todo-inbound";
import { notifyCrmTaskOutboundSafely } from "@/server/microsoft-365/outbound-queue";

const store = createPrismaMicrosoft365Store();

export function currentMicrosoft365Gate(): Microsoft365Gate {
  return readMicrosoft365Gate({
    enabledFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
    tenantId: process.env["MICROSOFT_365_TENANT_ID"],
    clientId: process.env["MICROSOFT_365_CLIENT_ID"],
    clientSecret: process.env["MICROSOFT_365_CLIENT_SECRET"],
    redirectUri: process.env["MICROSOFT_365_REDIRECT_URI"],
    appUrl: process.env["APP_URL"],
    encryptionKey: process.env["MICROSOFT_365_ENCRYPTION_KEY"],
  });
}

async function actorFromProfile(userId: string): Promise<Microsoft365Actor> {
  const profile: LoadedAccessProfile = await requireSystemPermission(userId, "tasks.view");
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Microsoft 365 is available to staff only", "FORBIDDEN", 403);
  }
  return {
    userId,
    actorType: "INTERNAL",
    canConnect:
      hasPermission(profile, "tasks.manage") ||
      grants(profile, "crm.activities.create", "crm.manage", "admin.access"),
    canViewAdminHealth: grants(profile, "admin.access", "crm.manage"),
  };
}

function asAuth(error: unknown): never {
  if (error instanceof Microsoft365Error) {
    const status = error.code === "FORBIDDEN" ? 403 : 400;
    throw new AuthError(error.message, error.code, status);
  }
  throw error;
}

function canApproveUncertainCreate(profile: LoadedAccessProfile): boolean {
  return grants(profile, "crm.manage", "admin.access");
}

export async function microsoft365StatusFor(userId: string) {
  try {
    const profile: LoadedAccessProfile = await requireSystemPermission(userId, "tasks.view");
    if (profile.actorType !== "INTERNAL") {
      throw new AuthError("Microsoft 365 is available to staff only", "FORBIDDEN", 403);
    }
    const actor = await actorFromProfile(userId);
    const status = await getMicrosoft365Status(actor, currentMicrosoft365Gate(), { store });
    const counts = await outboundCounts(userId);
    const uncertainJobs = await listUncertainOutboundJobs(userId);
    const inbound = await inboundCounts(userId);
    const conflictsList = await listInboundConflicts(userId);
    return {
      ...status,
      outbound: {
        engineEnabled: outboundGraphAllowed({
          crmFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
          outboundFlag: process.env["MICROSOFT_365_TASK_OUTBOUND_ENABLED"],
        }),
        pending: counts.pending,
        failed: counts.failed,
        needsReview: counts.needsReview,
        canApproveUncertainCreate: canApproveUncertainCreate(profile),
        uncertainJobs,
      },
      inbound: {
        engineEnabled: inboundGraphAllowed({
          crmFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
          inboundFlag: process.env["MICROSOFT_365_TASK_INBOUND_ENABLED"],
        }),
        pending: inbound.pending,
        failed: inbound.failed,
        conflicts: inbound.conflicts,
        removed: inbound.removed,
        lastInboundSyncAt: inbound.lastInboundSyncAt,
        inboundBaselineAt: inbound.inboundBaselineAt,
        canReconcile: grants(profile, "crm.manage", "admin.access") || hasPermission(profile, "tasks.manage"),
        conflictsList,
        syncedFields: ["status (complete/reopen)", "due date", "priority", "title", "description"],
      },
    };
  } catch (error) {
    asAuth(error);
  }
}

export async function microsoft365BeginConnect(userId: string, includeCalendar: boolean) {
  try {
    const actor = await actorFromProfile(userId);
    return await beginMicrosoftConnect(actor, includeCalendar, currentMicrosoft365Gate(), { store });
  } catch (error) {
    asAuth(error);
  }
}

export async function microsoft365Disconnect(userId: string) {
  try {
    const actor = await actorFromProfile(userId);
    const status = await disconnectMicrosoftAccount(actor, currentMicrosoft365Gate(), { store });
    await cancelQueuedOutboundJobs(userId);
    return status;
  } catch (error) {
    asAuth(error);
  }
}

export async function microsoft365RetryOutbound(userId: string) {
  try {
    const actor = await actorFromProfile(userId);
    if (!actor.canConnect) {
      throw new AuthError("Not permitted to retry Microsoft To Do sync", "FORBIDDEN", 403);
    }
    const retried = await retryOutboundJobs(userId);
    const status = await microsoft365StatusFor(userId);
    return { retried, status };
  } catch (error) {
    asAuth(error);
  }
}

export async function microsoft365RecheckUncertainOutbound(userId: string, jobId: string) {
  try {
    const actor = await actorFromProfile(userId);
    if (!actor.canConnect) {
      throw new AuthError("Not permitted to review Microsoft To Do sync", "FORBIDDEN", 403);
    }
    if (!outboundGraphAllowed({
      crmFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
      outboundFlag: process.env["MICROSOFT_365_TASK_OUTBOUND_ENABLED"],
    })) {
      throw new AuthError("Microsoft To Do outbound synchronisation is turned off", "FORBIDDEN", 403);
    }
    const job = await prepareUncertainRecheckJob(userId, jobId);
    await processOutboundJob(job, productionOutboundRuntime());
    await recordAuditEvent({
      action: "microsoft_todo.uncertain_recheck",
      entityType: "MicrosoftSyncJob",
      entityId: job.id,
      actorUserId: userId,
      metadata: {
        taskId: job.payload.taskId,
        connectionId: job.connectionId,
        knownMicrosoftTaskId: job.payload.knownMicrosoftTaskId ?? null,
      },
    });
    const status = await microsoft365StatusFor(userId);
    return { status };
  } catch (error) {
    if (error instanceof Error && !(error instanceof AuthError) && !(error instanceof Microsoft365Error)) {
      throw new AuthError(error.message, "VALIDATION", 400);
    }
    asAuth(error);
  }
}

export async function microsoft365ApproveUncertainOutboundCreate(
  userId: string,
  jobId: string,
  acknowledgedDuplicateRisk: boolean,
) {
  try {
    const profile: LoadedAccessProfile = await requireSystemPermission(userId, "tasks.view");
    if (profile.actorType !== "INTERNAL") {
      throw new AuthError("Microsoft 365 is available to staff only", "FORBIDDEN", 403);
    }
    if (!canApproveUncertainCreate(profile)) {
      throw new AuthError("Only CRM managers or administrators can approve a potentially duplicate Microsoft To Do create", "FORBIDDEN", 403);
    }
    if (acknowledgedDuplicateRisk !== true) {
      throw new AuthError("Confirm that Microsoft may already have created this task before approving another create", "VALIDATION", 400);
    }
    if (!outboundGraphAllowed({
      crmFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
      outboundFlag: process.env["MICROSOFT_365_TASK_OUTBOUND_ENABLED"],
    })) {
      throw new AuthError("Microsoft To Do outbound synchronisation is turned off", "FORBIDDEN", 403);
    }
    const job = await approveUncertainOutboundCreate({
      userId,
      jobId,
      acknowledgedDuplicateRisk: true,
    });
    await recordAuditEvent({
      action: "microsoft_todo.uncertain_create_approved",
      entityType: "MicrosoftSyncJob",
      entityId: job.id,
      actorUserId: userId,
      metadata: {
        taskId: job.payload.taskId,
        connectionId: job.connectionId,
        knownMicrosoftTaskId: job.payload.knownMicrosoftTaskId ?? null,
        approvedAt: job.payload.createApproval?.approvedAt ?? null,
        acknowledgedDuplicateRisk: true,
      },
    });
    const status = await microsoft365StatusFor(userId);
    return { queued: true as const, jobId: job.id, status };
  } catch (error) {
    if (error instanceof Error && !(error instanceof AuthError) && !(error instanceof Microsoft365Error)) {
      throw new AuthError(error.message, "VALIDATION", 400);
    }
    asAuth(error);
  }
}

export async function microsoft365UpdatePreferences(
  userId: string,
  prefs: { taskSyncEnabled: boolean; calendarSyncEnabled: boolean },
) {
  try {
    const actor = await actorFromProfile(userId);
    return await updateMicrosoft365Preferences(actor, prefs, currentMicrosoft365Gate(), { store });
  } catch (error) {
    asAuth(error);
  }
}

export async function microsoft365RequestInboundCheck(userId: string) {
  try {
    const actor = await actorFromProfile(userId);
    if (!actor.canConnect) {
      throw new AuthError("Not permitted to request Microsoft To Do inbound sync", "FORBIDDEN", 403);
    }
    if (!readInboundFlags()) {
      throw new AuthError("Microsoft To Do inbound synchronisation is turned off", "FORBIDDEN", 403);
    }
    const inboundStore = createPrismaInboundStore();
    const connection = await inboundStore.findConnection(userId);
    if (!connection || connection.status !== "CONNECTED" || !connection.taskSyncEnabled || !connection.todoListId) {
      throw new AuthError("Connect Microsoft 365 and enable task synchronisation first", "VALIDATION", 400);
    }
    const row = await ensureInboundJobForConnection(connection, { forceCheck: true });
    if (!row) throw new AuthError("Microsoft To Do list is not ready", "VALIDATION", 400);
    await recordAuditEvent({
      action: "microsoft_todo.inbound_check_requested",
      entityType: "MicrosoftSyncJob",
      entityId: row.id,
      actorUserId: userId,
      metadata: { connectionId: connection.id, listId: connection.todoListId },
    });
    const status = await microsoft365StatusFor(userId);
    return { queued: true as const, status };
  } catch (error) {
    if (error instanceof Error && !(error instanceof AuthError) && !(error instanceof Microsoft365Error)) {
      throw new AuthError(error.message, "VALIDATION", 400);
    }
    asAuth(error);
  }
}

export async function microsoft365UnlinkInboundMapping(userId: string, mappingId: string) {
  try {
    const profile: LoadedAccessProfile = await requireSystemPermission(userId, "tasks.view");
    if (!grants(profile, "crm.manage", "admin.access") && !hasPermission(profile, "tasks.manage")) {
      throw new AuthError("Not permitted to unlink Microsoft To Do mappings", "FORBIDDEN", 403);
    }
    await unlinkRemovedMicrosoftMapping({ userId, mappingId });
    await recordAuditEvent({
      action: "microsoft_todo.inbound_unlinked",
      entityType: "MicrosoftTaskMapping",
      entityId: mappingId,
      actorUserId: userId,
      metadata: {},
    });
    return { status: await microsoft365StatusFor(userId) };
  } catch (error) {
    if (error instanceof Error && !(error instanceof AuthError) && !(error instanceof Microsoft365Error)) {
      throw new AuthError(error.message, "VALIDATION", 400);
    }
    asAuth(error);
  }
}

export async function microsoft365RecreateInboundMapping(userId: string, mappingId: string) {
  try {
    const profile: LoadedAccessProfile = await requireSystemPermission(userId, "tasks.view");
    if (!grants(profile, "crm.manage", "admin.access") && !hasPermission(profile, "tasks.manage")) {
      throw new AuthError("Not permitted to recreate Microsoft To Do tasks", "FORBIDDEN", 403);
    }
    if (!outboundGraphAllowed({
      crmFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
      outboundFlag: process.env["MICROSOFT_365_TASK_OUTBOUND_ENABLED"],
    })) {
      throw new AuthError("Microsoft To Do outbound synchronisation is turned off", "FORBIDDEN", 403);
    }
    const prepared = await prepareRecreateRemovedMicrosoftMapping({ userId, mappingId });
    if ("error" in prepared) throw new AuthError(prepared.error, "VALIDATION", 400);
    const task = await prisma.task.findUnique({
      where: { id: prepared.taskId },
      select: { id: true, assigneeId: true, createdAt: true, updatedAt: true },
    });
    if (!task || task.assigneeId !== userId) {
      throw new AuthError("Only the assignee can recreate this Microsoft To Do task", "FORBIDDEN", 403);
    }
    await notifyCrmTaskOutboundSafely({
      taskId: task.id,
      assigneeId: task.assigneeId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      reason: "explicit",
    });
    await recordAuditEvent({
      action: "microsoft_todo.inbound_recreate_queued",
      entityType: "Task",
      entityId: task.id,
      actorUserId: userId,
      metadata: { mappingId },
    });
    return { queued: true as const, status: await microsoft365StatusFor(userId) };
  } catch (error) {
    if (error instanceof Error && !(error instanceof AuthError) && !(error instanceof Microsoft365Error)) {
      throw new AuthError(error.message, "VALIDATION", 400);
    }
    asAuth(error);
  }
}

export async function microsoft365RefreshOwnConnection(userId: string) {
  try {
    const actor = await actorFromProfile(userId);
    return await refreshMicrosoftConnection(actor, currentMicrosoft365Gate(), { store });
  } catch (error) {
    asAuth(error);
  }
}

export async function microsoft365CompleteCallback(input: {
  userId: string | null;
  code: string | null;
  state: string | null;
  error: string | null;
}): Promise<string> {
  const result = await completeMicrosoftCallback(
    input.userId ? { userId: input.userId } : null,
    { code: input.code, state: input.state, error: input.error },
    currentMicrosoft365Gate(),
    { store },
  );
  return result.location;
}

/** Confirms the signed-in user still exists before the OAuth callback stores a connection. */
export async function microsoft365CallbackUser(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, actorType: true } });
  if (!user || user.actorType !== "INTERNAL") return null;
  return user.id;
}
