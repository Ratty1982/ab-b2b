/**
 * Enqueue outbound To Do work after a CRM task change.
 * When either feature flag is off this returns before any database or Graph call.
 */
import { hasTasksReadWrite, outboundGraphAllowed } from "@/domain/microsoft-todo-outbound";
import { sanitizeMicrosoftMessage } from "@/domain/microsoft-365-crm";
import { prisma } from "@/infra/database/client";
import { createPrismaOutboundStore, enqueueOutboundJob, prepareReleaseJob } from "@/server/microsoft-365/outbound-prisma";
import { processOutboundJob, type OutboundRuntime } from "@/server/microsoft-365/outbound-sync";
import { productionOutboundRuntime, readOutboundFlags } from "@/server/microsoft-365/outbound-runtime";
import type { OutboundConnection } from "@/server/microsoft-365/outbound-sync";

export type OutboundNotice = {
  taskId: string;
  assigneeId: string | null;
  previousAssigneeId?: string | null;
  createdAt: Date;
  reason: "created" | "updated" | "assigned" | "explicit";
};

type QueueDeps = {
  graphAllowed: () => boolean;
  findConnection: (userId: string) => Promise<OutboundConnection | null>;
  hasActiveMapping: (userId: string, taskId: string) => Promise<boolean>;
  enqueue: (input: { connection: OutboundConnection; taskId: string; release: boolean; explicit: boolean }) => Promise<unknown>;
  record: (message: string) => Promise<void>;
};

function ready(connection: OutboundConnection | null): connection is OutboundConnection {
  return Boolean(connection && connection.status === "CONNECTED" && connection.taskSyncEnabled && hasTasksReadWrite(connection.scopes));
}

export async function notifyCrmTaskOutbound(input: OutboundNotice, deps: QueueDeps = defaultQueueDeps()): Promise<void> {
  if (!deps.graphAllowed()) return;
  try {
    if (input.previousAssigneeId && input.previousAssigneeId !== input.assigneeId) {
      const previous = await deps.findConnection(input.previousAssigneeId);
      if (ready(previous) && (await deps.hasActiveMapping(previous.userId, input.taskId))) {
        await deps.enqueue({ connection: previous, taskId: input.taskId, release: true, explicit: false });
      }
    }
    if (!input.assigneeId) return;
    const connection = await deps.findConnection(input.assigneeId);
    if (!ready(connection)) return;
    const mapped = await deps.hasActiveMapping(connection.userId, input.taskId);
    const explicit = input.reason === "explicit" || input.reason === "assigned";
    const eligible =
      explicit ||
      mapped ||
      (connection.taskOutboundEnabledAt != null && input.createdAt.getTime() >= connection.taskOutboundEnabledAt.getTime());
    if (!eligible) return;
    await deps.enqueue({ connection, taskId: input.taskId, release: false, explicit });
  } catch (error) {
    await deps.record(sanitizeMicrosoftMessage(error instanceof Error ? error.message : "Microsoft To Do queue failed"));
  }
}

export async function notifyCrmTaskOutboundSafely(input: OutboundNotice): Promise<void> {
  try {
    await notifyCrmTaskOutbound(input);
  } catch (error) {
    console.error("[ab:microsoft-todo]", sanitizeMicrosoftMessage(error instanceof Error ? error.message : "queue failed"));
  }
}

function defaultQueueDeps(): QueueDeps {
  const store = createPrismaOutboundStore();
  return {
    graphAllowed: readOutboundFlags,
    findConnection: (userId) => store.findConnection(userId),
    hasActiveMapping: async (userId, taskId) => {
      const mapping = await store.findMapping(userId, taskId);
      return Boolean(mapping && mapping.deletedAt == null && mapping.syncStatus !== "TOMBSTONED");
    },
    enqueue: (input) => enqueueOutboundJob(input),
    record: async (message) => {
      console.error("[ab:microsoft-todo]", message);
    },
  };
}

/** Best-effort scrub before a staff user row, and its tokens, are deleted. Never throws. */
export async function releaseMappedTasksBeforeUserRemoval(userId: string): Promise<void> {
  if (!outboundGraphAllowed({
    crmFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
    outboundFlag: process.env["MICROSOFT_365_TASK_OUTBOUND_ENABLED"],
  })) {
    return;
  }
  try {
    const mappings = await prisma.microsoftTaskMapping.findMany({
      where: { userId, deletedAt: null, syncStatus: { not: "TOMBSTONED" }, taskId: { not: null } },
      select: { taskId: true },
    });
    const runtime: OutboundRuntime = productionOutboundRuntime();
    const connection = await runtime.store.findConnection(userId);
    if (!connection) return;
    for (const mapping of mappings) {
      if (!mapping.taskId) continue;
      const job = await prepareReleaseJob(connection, mapping.taskId);
      await processOutboundJob(job, runtime);
    }
  } catch (error) {
    console.error("[ab:microsoft-todo]", sanitizeMicrosoftMessage(error instanceof Error ? error.message : "release failed"));
  }
}

export function outboundFlagsFromEnv(): boolean {
  return readOutboundFlags();
}
