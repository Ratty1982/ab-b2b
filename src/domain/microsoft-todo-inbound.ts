/**
 * Microsoft To Do inbound policy.
 * CRM remains authoritative for ownership, relationships, and permissions.
 * This module does not call Microsoft or write the database.
 */
import { isMicrosoft365CrmEnabled, MICROSOFT_365_TASK_LIST_NAME } from "@/domain/microsoft-365-crm";
import { resolveMicrosoftGraphUrl } from "@/domain/microsoft-graph-security";
import { isSafeTodoResourceId } from "@/domain/microsoft-todo-outbound";

export { MICROSOFT_365_TASK_LIST_NAME };

const ON = new Set(["1", "true", "on", "yes"]);

export const MICROSOFT_TODO_INBOUND_CURSOR_PREFIX = "todo-inbound:";
export const MICROSOFT_TODO_INBOUND_JOB_KIND = "TODO_INBOUND";
export const MICROSOFT_TODO_INBOUND_MAX_ATTEMPTS = 5;
export const MICROSOFT_TODO_INBOUND_PAGE_SIZE = 50;

export function isMicrosoftTodoInboundEnabled(flag: string | undefined): boolean {
  if (flag == null) return false;
  return ON.has(flag.trim().toLowerCase());
}

/** Both flags are required. Outbound and inbound never imply each other. */
export function inboundGraphAllowed(env: {
  crmFlag?: string | undefined;
  inboundFlag?: string | undefined;
}): boolean {
  return isMicrosoft365CrmEnabled(env.crmFlag) && isMicrosoftTodoInboundEnabled(env.inboundFlag);
}

export function inboundCursorResource(listId: string): string {
  return `${MICROSOFT_TODO_INBOUND_CURSOR_PREFIX}${listId}`;
}

export type InboundSyncedSnapshot = {
  title: string;
  description: string | null;
  status: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority: "LOW" | "NORMAL" | "HIGH";
  dueAt: string | null;
  completedAt: string | null;
};

export type MicrosoftTodoInboundFields = {
  id: string;
  etag: string | null;
  title: string | null;
  bodyContent: string | null;
  status: "notStarted" | "inProgress" | "completed" | "waitingOnOthers" | "deferred" | null;
  importance: "low" | "normal" | "high" | null;
  dueDateTime: { dateTime: string; timeZone: string } | null;
  completedDateTime: { dateTime: string; timeZone: string } | null;
  removed: boolean;
};

export function mapMicrosoftImportance(importance: MicrosoftTodoInboundFields["importance"]): "LOW" | "NORMAL" | "HIGH" | null {
  if (importance === "low") return "LOW";
  if (importance === "high") return "HIGH";
  if (importance === "normal") return "NORMAL";
  return null;
}

export function mapMicrosoftStatusToCrm(input: {
  microsoftStatus: MicrosoftTodoInboundFields["status"];
  crmStatus: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priorCrmStatus?: string | null;
}): { status: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED"; conflict?: string } | { skip: true; conflict: string } {
  if (input.crmStatus === "CANCELLED") {
    if (input.microsoftStatus === "completed") {
      return { skip: true, conflict: "CRM task is cancelled; Microsoft completion was not applied" };
    }
    if (input.microsoftStatus && input.microsoftStatus !== "deferred") {
      return { skip: true, conflict: "CRM task is cancelled; Microsoft reopen was not applied" };
    }
    return { skip: true, conflict: "CRM task is cancelled" };
  }
  if (input.microsoftStatus === "completed") {
    return { status: "DONE" };
  }
  if (input.crmStatus === "DONE" && input.microsoftStatus) {
    if (input.priorCrmStatus === "IN_PROGRESS") return { status: "IN_PROGRESS" };
    return { status: "OPEN" };
  }
  if (input.microsoftStatus === "inProgress") return { status: "IN_PROGRESS" };
  if (input.microsoftStatus === "notStarted" || input.microsoftStatus === "waitingOnOthers") {
    if (input.crmStatus === "IN_PROGRESS") return { status: "IN_PROGRESS" };
    return { status: "OPEN" };
  }
  if (input.microsoftStatus === "deferred") {
    return { skip: true, conflict: "Microsoft deferred status is not mapped to CRM cancellation" };
  }
  return { status: input.crmStatus };
}

/** Strip the CRM reference footer Microsoft To Do bodies carry from outbound sync. */
export function inboundDescriptionFromMicrosoftBody(content: string | null | undefined): string | null {
  if (!content) return null;
  const withoutRef = content
    .replace(/\n*\s*CRM reference:\s*ab-crm-task:[^\n]+/gi, "")
    .replace(/\n*This CRM task was reassigned\.[\s\S]*$/i, "")
    .replace(/\n*Cancelled in Automotive Brands CRM\.[\s\S]*$/i, "")
    .trim();
  return withoutRef || null;
}

/**
 * Parse Microsoft dueDateTime into a CRM dueAt.
 * UTC midnight date-only values become CRM noon UTC date-only.
 * Europe/London timed values keep the London wall clock.
 */
export function inboundDueAtFromMicrosoft(
  due: { dateTime: string; timeZone: string } | null | undefined,
): Date | null {
  if (!due?.dateTime) return null;
  const raw = due.dateTime.trim();
  const dateOnly = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?$/.exec(raw);
  if (dateOnly && (due.timeZone === "UTC" || due.timeZone === "Etc/UTC")) {
    return new Date(`${dateOnly[1]}T12:00:00.000Z`);
  }
  if (due.timeZone === "Europe/London" || due.timeZone === "GMT Standard Time") {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(raw);
    if (!match) return null;
    const isoGuess = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
    const asUtc = new Date(isoGuess);
    if (Number.isNaN(asUtc.getTime())) return null;
    // Interpret the wall clock in Europe/London by finding the UTC instant whose London parts match.
    const formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const target = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
    for (const offsetHours of [0, 1, -1]) {
      const candidate = new Date(asUtc.getTime() - offsetHours * 3_600_000);
      const parts = formatter.formatToParts(candidate);
      const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
      const wall = `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}`;
      if (wall === target) return candidate;
    }
    return asUtc;
  }
  const parsed = Date.parse(raw.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

export function snapshotFromCrmTask(task: {
  title: string;
  description: string | null;
  status: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority: "LOW" | "NORMAL" | "HIGH";
  dueAt: Date | null;
  completedAt: Date | null;
}): InboundSyncedSnapshot {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
  };
}

export function snapshotsEqual(a: InboundSyncedSnapshot | null | undefined, b: InboundSyncedSnapshot | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.status === b.status &&
    a.priority === b.priority &&
    a.dueAt === b.dueAt &&
    a.completedAt === b.completedAt
  );
}

export function microsoftFieldsToSnapshot(fields: MicrosoftTodoInboundFields, crmFallback: InboundSyncedSnapshot): InboundSyncedSnapshot {
  const statusMap = mapMicrosoftStatusToCrm({
    microsoftStatus: fields.status,
    crmStatus: crmFallback.status,
  });
  const status = "status" in statusMap ? statusMap.status : crmFallback.status;
  const priority = mapMicrosoftImportance(fields.importance) ?? crmFallback.priority;
  const dueAt = inboundDueAtFromMicrosoft(fields.dueDateTime);
  const completedAt =
    status === "DONE"
      ? fields.completedDateTime
        ? inboundDueAtFromMicrosoft(fields.completedDateTime) ?? new Date()
        : crmFallback.completedAt
          ? new Date(crmFallback.completedAt)
          : new Date()
      : null;
  return {
    title: (fields.title ?? crmFallback.title).replace(/[\r\n]+/g, " ").trim().slice(0, 200) || crmFallback.title,
    description: inboundDescriptionFromMicrosoftBody(fields.bodyContent),
    status,
    priority,
    dueAt: dueAt?.toISOString() ?? null,
    completedAt: completedAt?.toISOString() ?? null,
  };
}

/**
 * Field-level merge. CRM cancellation and ownership always win.
 * When both sides changed different fields, keep CRM values for contested fields
 * and apply safe Microsoft-only fields.
 */
export function planInboundFieldUpdates(input: {
  crm: InboundSyncedSnapshot;
  microsoft: InboundSyncedSnapshot;
  lastSynced: InboundSyncedSnapshot | null;
  crmRevisionChanged: boolean;
}): {
  apply: Partial<InboundSyncedSnapshot>;
  conflicts: string[];
  skipAll?: boolean;
} {
  const conflicts: string[] = [];
  if (input.crm.status === "CANCELLED") {
    if (input.microsoft.status !== "CANCELLED") {
      conflicts.push("CRM cancellation takes precedence over Microsoft reopen or completion");
    }
    return { apply: {}, conflicts, skipAll: true };
  }

  const apply: Partial<InboundSyncedSnapshot> = {};
  const last = input.lastSynced;

  const consider = <K extends keyof InboundSyncedSnapshot>(field: K, label: string) => {
    const ms = input.microsoft[field];
    const crm = input.crm[field];
    const prev = last?.[field];
    if (ms === crm) return;
    const microsoftChanged = prev === undefined || ms !== prev;
    const crmChanged = prev === undefined ? input.crmRevisionChanged : crm !== prev;
    if (microsoftChanged && crmChanged && ms !== crm) {
      conflicts.push(`${label} changed in both CRM and Microsoft; CRM value kept`);
      return;
    }
    if (microsoftChanged && !crmChanged) {
      apply[field] = ms as InboundSyncedSnapshot[K];
    }
  };

  consider("status", "Status");
  consider("dueAt", "Due date");
  consider("priority", "Priority");
  consider("title", "Title");
  consider("description", "Description");
  if (apply.status === "DONE" && input.microsoft.completedAt) {
    apply.completedAt = input.microsoft.completedAt;
  }
  if (apply.status && apply.status !== "DONE") {
    apply.completedAt = null;
  }
  return { apply, conflicts };
}

const DELTA_PATH = /^\/v1\.0\/me\/todo\/lists\/[^/]+\/tasks\/delta$/;
const ALLOWED_DELTA_QUERY = new Set([
  "$select",
  "$top",
  "$skiptoken",
  "$deltatoken",
  "$filter",
  "$orderby",
]);

/**
 * Only Graph HTTPS delta URLs for the caller's dedicated list are accepted.
 * nextLink and deltaLink must never be passed to a generic fetch unchecked.
 */
export function assertTodoDeltaGraphUrl(pathOrUrl: string, expectedListId: string): string {
  if (!isSafeTodoResourceId(expectedListId)) {
    throw new Error("Microsoft To Do list id is not allowed");
  }
  const url = new URL(resolveMicrosoftGraphUrl(pathOrUrl));
  if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com") {
    throw new Error("Microsoft To Do delta URL host is not allowed");
  }
  if (!DELTA_PATH.test(url.pathname)) {
    throw new Error("Microsoft To Do delta path is not allowed");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const listIdx = parts.indexOf("lists");
  const listId = listIdx >= 0 ? decodeURIComponent(parts[listIdx + 1] ?? "") : "";
  if (listId !== expectedListId || !isSafeTodoResourceId(listId)) {
    throw new Error("Microsoft To Do delta list id does not match the dedicated list");
  }
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_DELTA_QUERY.has(key.toLowerCase())) {
      throw new Error("Microsoft To Do delta query parameter is not allowed");
    }
  }
  return url.toString();
}

export function inboundRetryDelayMs(attempt: number, retryAfter: string | null, now: Date): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
    const parsed = Date.parse(retryAfter);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(parsed - now.getTime(), 24 * 60 * 60 * 1000));
  }
  const steps = [30_000, 120_000, 480_000, 1_800_000];
  return steps[Math.min(Math.max(attempt, 0), steps.length - 1)] ?? 1_800_000;
}

export function microsoftInboundSyncIndicator(input: {
  viewerId: string;
  assigneeId: string | null;
  canSeeOthers: boolean;
  syncStatus: "PENDING" | "SYNCED" | "FAILED" | "CONFLICT" | "SKIPPED" | "TOMBSTONED" | "REMOVED" | null;
}): "Pending" | "Synced" | "Failed" | "Review" | "Removed" | null {
  const allowed = input.assigneeId === input.viewerId || input.canSeeOthers;
  if (!allowed || !input.syncStatus || input.syncStatus === "TOMBSTONED" || input.syncStatus === "SKIPPED") return null;
  if (input.syncStatus === "SYNCED") return "Synced";
  if (input.syncStatus === "CONFLICT") return "Review";
  if (input.syncStatus === "REMOVED") return "Removed";
  if (input.syncStatus === "FAILED") return "Failed";
  return "Pending";
}
