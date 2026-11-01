/**
 * Microsoft To Do outbound policy.
 * CRM tasks stay authoritative. This module does not call Microsoft or read the database.
 * Graph task creation has no supported idempotency header. Ambiguous creates are reconciled
 * by the stable `ab-crm-task:{taskId}` reference before another task is created.
 */
import { MICROSOFT_365_TASK_LIST_NAME, grantedScopeSet, isMicrosoft365CrmEnabled } from "@/domain/microsoft-365-crm";
import { resolveMicrosoftGraphUrl } from "@/domain/microsoft-graph-security";

export const MICROSOFT_TODO_REFERENCE_PREFIX = "ab-crm-task:";
export const MICROSOFT_TODO_MAX_ATTEMPTS = 5;
export const MICROSOFT_TODO_LOOKUP_PAGE_SIZE = 50;
export const MICROSOFT_TODO_LOOKUP_MAX_PAGES = 4;

const ON = new Set(["1", "true", "on", "yes"]);

export function isMicrosoftTodoOutboundEnabled(flag: string | undefined): boolean {
  if (flag == null) return false;
  return ON.has(flag.trim().toLowerCase());
}

/** Both flags are required. The main Microsoft flag does not turn outbound on. */
export function outboundGraphAllowed(env: {
  crmFlag?: string | undefined;
  outboundFlag?: string | undefined;
}): boolean {
  return isMicrosoft365CrmEnabled(env.crmFlag) && isMicrosoftTodoOutboundEnabled(env.outboundFlag);
}

export function crmTaskReference(taskId: string): string {
  return `${MICROSOFT_TODO_REFERENCE_PREFIX}${taskId}`;
}

/**
 * Graph task POST is not idempotent. After a timeout, interruption, or HTTP 5xx the remote
 * task may already exist even when a later lookup finds nothing. Those jobs keep
 * `createUncertain` until an operator explicitly authorises one create for that job.
 * Ordinary "Retry failed sync" must never set that authorisation. A known remote id is
 * never created again. Recheck-only runs look up and adopt, but never POST.
 */
export function mayPostMicrosoftTodoCreate(payload: {
  createUncertain?: boolean | undefined;
  reviewed?: boolean | undefined;
  authorizeCreateOnce?: boolean | undefined;
  recheckOnly?: boolean | undefined;
  knownMicrosoftTaskId?: string | undefined;
}): boolean {
  if (payload.knownMicrosoftTaskId) return false;
  if (payload.recheckOnly) return false;
  if (payload.createUncertain) return payload.authorizeCreateOnce === true;
  return true;
}

export function isUncertainCreatePayload(payload: {
  createUncertain?: boolean | undefined;
}): boolean {
  return payload.createUncertain === true;
}

/**
 * Ordinary "Retry failed sync" may requeue FAILED rows and non-uncertain NEEDS_REVIEW rows.
 * Jobs marked createUncertain stay on the review workflow only.
 */
export function ordinaryRetryIncludesJob(input: {
  status: string;
  createUncertain?: boolean | undefined;
}): boolean {
  if (input.createUncertain) return false;
  return input.status === "FAILED" || input.status === "NEEDS_REVIEW";
}

export function taskRevisionOf(task: Pick<{ updatedAt: Date }, "updatedAt">): string {
  return task.updatedAt.toISOString();
}

export function isSameTaskRevision(task: Pick<{ updatedAt: Date }, "updatedAt">, revision: string | undefined): boolean {
  if (!revision) return false;
  return taskRevisionOf(task) === revision;
}

export type OutboundTaskSnapshot = {
  id: string;
  assigneeId: string | null;
  title: string;
  description: string | null;
  status: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  priority: "LOW" | "NORMAL" | "HIGH";
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type OutboundEligibility = "sync" | "skip" | "release";

export function classifyOutboundTask(input: {
  task: Pick<OutboundTaskSnapshot, "assigneeId" | "createdAt">;
  connectionUserId: string;
  taskOutboundEnabledAt: Date | null;
  explicit: boolean;
  release: boolean;
  hasActiveMapping: boolean;
}): OutboundEligibility {
  if (input.release) return input.task.assigneeId === input.connectionUserId ? "skip" : "release";
  if (input.task.assigneeId !== input.connectionUserId) return "skip";
  if (input.explicit || input.hasActiveMapping) return "sync";
  if (!input.taskOutboundEnabledAt) return "skip";
  if (input.task.createdAt.getTime() >= input.taskOutboundEnabledAt.getTime()) return "sync";
  return "skip";
}

export function hasTasksReadWrite(scopes: string | undefined): boolean {
  return grantedScopeSet(scopes).has("Tasks.ReadWrite");
}

const PRIVATE_LINE =
  /(account\s*(code|number)|autopart|credit\s*limit|sort\s*code|\bvat\b|bank\b|password|secret|net\s*spend|revenue|margin|gross\b)/i;

/** Body sent to the assignee's own list. Financial and account-code lines are left in the CRM. */
export function microsoftTaskBody(task: Pick<OutboundTaskSnapshot, "id" | "description">, mode: "sync" | "release" | "cancel"): string {
  const reference = `CRM reference: ${crmTaskReference(task.id)}`;
  if (mode === "release") {
    return `This CRM task was reassigned. It is no longer managed in this Microsoft account.\n${reference}`;
  }
  if (mode === "cancel") {
    return `Cancelled in Automotive Brands CRM.\n${reference}`;
  }
  const kept: string[] = [];
  for (const line of (task.description ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (PRIVATE_LINE.test(trimmed)) continue;
    if (/^(source|reason|customer|period|comparison):/i.test(trimmed)) continue;
    if (/^[A-Za-z][A-Za-z0-9 ._-]*:\s*\d+(\.\d+)?$/.test(trimmed)) continue;
    kept.push(trimmed);
  }
  const notes = kept.join("\n").slice(0, 3500);
  return notes ? `${notes}\n\n${reference}` : reference;
}

export function microsoftTaskTitle(title: string, mode: "sync" | "release" | "cancel"): string {
  if (mode === "release") return "CRM task reassigned";
  if (mode === "cancel") return "Cancelled CRM task";
  const trimmed = title.replace(/[\r\n]+/g, " ").trim();
  return (trimmed || "CRM task").slice(0, 255);
}

export function microsoftImportance(priority: OutboundTaskSnapshot["priority"]): "low" | "normal" | "high" {
  if (priority === "LOW") return "low";
  if (priority === "HIGH") return "high";
  return "normal";
}

export function microsoftTaskStatus(
  status: OutboundTaskSnapshot["status"],
  mode: "sync" | "release" | "cancel",
): "notStarted" | "inProgress" | "completed" | "deferred" {
  if (mode === "release" || mode === "cancel") return "deferred";
  if (status === "DONE") return "completed";
  if (status === "IN_PROGRESS") return "inProgress";
  if (status === "CANCELLED") return "deferred";
  return "notStarted";
}

/**
 * Date-only CRM tasks are stored at 12:00:00.000Z. Microsoft receives a UTC midnight
 * due date so To Do shows a date, not a timed midnight appointment.
 * Any other instant is the Europe/London wall clock, including daylight saving.
 */
export function microsoftDueDateTime(dueAt: Date | null): { dateTime: string; timeZone: "UTC" | "Europe/London" } | null {
  if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
  const dateOnly =
    dueAt.getUTCHours() === 12 &&
    dueAt.getUTCMinutes() === 0 &&
    dueAt.getUTCSeconds() === 0 &&
    dueAt.getUTCMilliseconds() === 0;
  if (dateOnly) {
    return { dateTime: `${dueAt.toISOString().slice(0, 10)}T00:00:00`, timeZone: "UTC" };
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(dueAt);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    dateTime: `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}`,
    timeZone: "Europe/London",
  };
}

export type TodoGraphBody = {
  title: string;
  body: { contentType: "text"; content: string };
  importance: "low" | "normal" | "high";
  status: "notStarted" | "inProgress" | "completed" | "deferred";
  dueDateTime: { dateTime: string; timeZone: string } | null;
  completedDateTime?: { dateTime: string; timeZone: "UTC" };
};

export function buildTodoTaskBody(task: OutboundTaskSnapshot, mode: "sync" | "release" | "cancel"): TodoGraphBody {
  const contentMode = mode === "sync" && task.status === "CANCELLED" ? "cancel" : mode;
  const status = microsoftTaskStatus(task.status, contentMode);
  const body: TodoGraphBody = {
    title: microsoftTaskTitle(task.title, contentMode),
    body: { contentType: "text", content: microsoftTaskBody(task, contentMode) },
    importance: contentMode === "sync" ? microsoftImportance(task.priority) : "normal",
    status,
    dueDateTime: contentMode === "sync" ? microsoftDueDateTime(task.dueAt) : null,
  };
  if (status === "completed" && task.completedAt) {
    body.completedDateTime = {
      dateTime: task.completedAt.toISOString().replace(/\.\d{3}Z$/, ""),
      timeZone: "UTC",
    };
  }
  return body;
}

export type TodoListChoice = {
  id: string;
  displayName?: string | undefined;
  wellknownListName?: string | null | undefined;
  createdDateTime?: string | undefined;
};

/** Reuse the dedicated list. Never select a well-known personal list, and never create a second one when one exists. */
export function chooseCrmTodoList(
  lists: readonly TodoListChoice[],
  storedId: string | null,
): { action: "use"; id: string; duplicates: boolean } | { action: "create" } {
  const matches = lists.filter(
    (list) => list.displayName === MICROSOFT_365_TASK_LIST_NAME && !list.wellknownListName && isSafeTodoResourceId(list.id),
  );
  if (storedId && matches.some((list) => list.id === storedId)) {
    return { action: "use", id: storedId, duplicates: matches.length > 1 };
  }
  if (matches.length === 0) return { action: "create" };
  const sorted = [...matches].sort((a, b) => (a.createdDateTime ?? "").localeCompare(b.createdDateTime ?? ""));
  const chosen = sorted[0];
  if (!chosen) return { action: "create" };
  return { action: "use", id: chosen.id, duplicates: matches.length > 1 };
}

export function outboundRetryDelayMs(attempt: number, retryAfter: string | null, now: Date): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 24 * 60 * 60 * 1000);
    const parsed = Date.parse(retryAfter);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(parsed - now.getTime(), 24 * 60 * 60 * 1000));
  }
  const steps = [30_000, 120_000, 480_000, 1_800_000];
  return steps[Math.min(Math.max(attempt, 0), steps.length - 1)] ?? 1_800_000;
}

const TODO_ID_RE = /^[A-Za-z0-9!@._\-{}()+=]+$/;

/** To Do ids are opaque and often end with `=`. Slash and traversal stay refused. SDS id checks are unchanged. */
export function isSafeTodoResourceId(value: string | null | undefined): boolean {
  if (value == null) return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) return false;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("\0") || trimmed.includes("%")) {
    return false;
  }
  return TODO_ID_RE.test(trimmed);
}

const TODO_PATHS = [
  /^\/v1\.0\/me\/todo\/lists$/,
  /^\/v1\.0\/me\/todo\/lists\/[^/]+\/tasks$/,
  /^\/v1\.0\/me\/todo\/lists\/[^/]+\/tasks\/[^/]+$/,
  /^\/v1\.0\/me\/todo\/lists\/[^/]+\/tasks\/[^/]+\/linkedResources$/,
];

/** Only the dedicated To Do list endpoints. Other Graph areas, including mail and calendar, are refused. */
export function assertTodoGraphUrl(pathOrUrl: string): string {
  const url = new URL(resolveMicrosoftGraphUrl(pathOrUrl));
  if (!TODO_PATHS.some((pattern) => pattern.test(url.pathname))) {
    throw new Error("Microsoft To Do path is not allowed");
  }
  const ids = url.pathname.split("/").filter((part) => part && part !== "v1.0" && part !== "me" && part !== "todo" && part !== "lists" && part !== "tasks" && part !== "linkedResources");
  for (const id of ids) {
    if (!isSafeTodoResourceId(decodeURIComponent(id))) throw new Error("Microsoft To Do path is not allowed");
  }
  return url.toString();
}

export function taskBodyContainsReference(body: unknown, taskId: string): boolean {
  if (!body || typeof body !== "object") return false;
  const content = (body as { content?: unknown }).content;
  return typeof content === "string" && content.includes(crmTaskReference(taskId));
}

export function microsoftSyncIndicator(input: {
  viewerId: string;
  assigneeId: string | null;
  canSeeOthers: boolean;
  syncStatus: "PENDING" | "SYNCED" | "FAILED" | "CONFLICT" | "SKIPPED" | "TOMBSTONED" | null;
}): "Pending" | "Synced" | "Failed" | "Review" | null {
  const allowed = input.assigneeId === input.viewerId || input.canSeeOthers;
  if (!allowed || !input.syncStatus || input.syncStatus === "TOMBSTONED" || input.syncStatus === "SKIPPED") return null;
  if (input.syncStatus === "SYNCED") return "Synced";
  if (input.syncStatus === "CONFLICT") return "Review";
  if (input.syncStatus === "FAILED") return "Failed";
  return "Pending";
}
