import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { dueAtFromDateOnly } from "@/domain/sales-followup";
import { MICROSOFT_365_TASK_LIST_NAME } from "@/domain/microsoft-365-crm";
import {
  assertTodoGraphUrl,
  buildTodoTaskBody,
  chooseCrmTodoList,
  classifyOutboundTask,
  crmTaskReference,
  isMicrosoftTodoOutboundEnabled,
  microsoftDueDateTime,
  microsoftSyncIndicator,
  microsoftTaskBody,
  outboundGraphAllowed,
  outboundRetryDelayMs,
} from "@/domain/microsoft-todo-outbound";

const enabledAt = new Date("2026-10-01T00:00:00.000Z");

describe("Microsoft To Do outbound flags", () => {
  it("stays off unless both flags are explicitly enabled", () => {
    expect(isMicrosoftTodoOutboundEnabled(undefined)).toBe(false);
    expect(isMicrosoftTodoOutboundEnabled("false")).toBe(false);
    expect(isMicrosoftTodoOutboundEnabled("true")).toBe(true);
    expect(outboundGraphAllowed({ crmFlag: "true", outboundFlag: "false" })).toBe(false);
    expect(outboundGraphAllowed({ crmFlag: "false", outboundFlag: "true" })).toBe(false);
    expect(outboundGraphAllowed({ crmFlag: "true", outboundFlag: "on" })).toBe(true);
  });
});

describe("Microsoft To Do eligibility and content", () => {
  const task = {
    assigneeId: "user-a",
    createdAt: new Date("2026-10-15T00:00:00.000Z"),
  };

  it("syncs a task created after the user enabled outbound, and skips older tasks", () => {
    expect(classifyOutboundTask({
      task,
      connectionUserId: "user-a",
      taskOutboundEnabledAt: enabledAt,
      explicit: false,
      release: false,
      hasActiveMapping: false,
    })).toBe("sync");
    expect(classifyOutboundTask({
      task: { ...task, createdAt: new Date("2026-09-01T00:00:00.000Z") },
      connectionUserId: "user-a",
      taskOutboundEnabledAt: enabledAt,
      explicit: false,
      release: false,
      hasActiveMapping: false,
    })).toBe("skip");
    expect(classifyOutboundTask({
      task: { ...task, createdAt: new Date("2026-09-01T00:00:00.000Z") },
      connectionUserId: "user-a",
      taskOutboundEnabledAt: enabledAt,
      explicit: true,
      release: false,
      hasActiveMapping: false,
    })).toBe("sync");
  });

  it("does not put account or spend lines in the Microsoft body", () => {
    const body = microsoftTaskBody({
      id: "task-1",
      description: [
        "Customer: Acme",
        "Account code: ABC123",
        "netSpend: 5000",
        "Product: Brake fluid",
        "Notes:",
        "Call the buyer",
      ].join("\n"),
    }, "sync");
    expect(body).toContain("Brake fluid");
    expect(body).toContain("Call the buyer");
    expect(body).toContain(crmTaskReference("task-1"));
    expect(body).not.toContain("ABC123");
    expect(body).not.toContain("5000");
    expect(body).not.toContain("Acme");
  });

  it("scrubs a reassigned or cancelled task without the CRM description", () => {
    const released = buildTodoTaskBody(snapshot(), "release");
    expect(released.title).toBe("CRM task reassigned");
    expect(released.body.content).not.toContain("secret account");
    expect(released.status).toBe("deferred");
    expect(released.dueDateTime).toBeNull();
    const cancelled = buildTodoTaskBody({ ...snapshot(), status: "CANCELLED" }, "sync");
    expect(cancelled.title).toBe("Cancelled CRM task");
    expect(cancelled.status).toBe("deferred");
  });
});

describe("Microsoft To Do dates", () => {
  it("sends a date-only CRM due date as a UTC date, not a London midnight appointment", () => {
    const due = microsoftDueDateTime(dueAtFromDateOnly("2026-06-21"));
    expect(due).toEqual({ dateTime: "2026-06-21T00:00:00", timeZone: "UTC" });
    const winter = microsoftDueDateTime(dueAtFromDateOnly("2026-01-15"));
    expect(winter).toEqual({ dateTime: "2026-01-15T00:00:00", timeZone: "UTC" });
  });

  it("converts a timed instant to the Europe/London wall clock across daylight saving", () => {
    expect(microsoftDueDateTime(new Date("2026-06-21T11:30:00.000Z"))).toEqual({
      dateTime: "2026-06-21T12:30:00",
      timeZone: "Europe/London",
    });
    expect(microsoftDueDateTime(new Date("2026-01-21T12:30:00.000Z"))).toEqual({
      dateTime: "2026-01-21T12:30:00",
      timeZone: "Europe/London",
    });
    expect(microsoftDueDateTime(new Date("2026-03-29T01:30:00.000Z"))).toEqual({
      dateTime: "2026-03-29T02:30:00",
      timeZone: "Europe/London",
    });
  });
});

describe("Microsoft To Do list choice", () => {
  it("reuses the dedicated list and ignores well-known personal lists", () => {
    const choice = chooseCrmTodoList(
      [
        { id: "default", displayName: MICROSOFT_365_TASK_LIST_NAME, wellknownListName: "defaultList" },
        { id: "ours", displayName: MICROSOFT_365_TASK_LIST_NAME, createdDateTime: "2026-10-02T00:00:00Z" },
        { id: "older", displayName: MICROSOFT_365_TASK_LIST_NAME, createdDateTime: "2026-10-01T00:00:00Z" },
        { id: "personal", displayName: "Tasks" },
      ],
      null,
    );
    expect(choice).toEqual({ action: "use", id: "older", duplicates: true });
    expect(chooseCrmTodoList([{ id: "personal", displayName: "Tasks" }], null)).toEqual({ action: "create" });
    const graphId = "AAkALgAAAAAAHYQDEapmEc2byACqAC-EWg0AkOC2v5r0Q0a1h7g8uF8KAAGQ2s4AAAA=";
    expect(chooseCrmTodoList([{ id: graphId, displayName: MICROSOFT_365_TASK_LIST_NAME }], null)).toEqual({
      action: "use",
      id: graphId,
      duplicates: false,
    });
    expect(assertTodoGraphUrl(`/me/todo/lists/${encodeURIComponent(graphId)}/tasks/${encodeURIComponent(graphId)}`)).toContain(encodeURIComponent(graphId));
    expect(() => assertTodoGraphUrl("/me/todo/lists/ab/cd/tasks")).toThrow(/not allowed/);
    expect(assertTodoGraphUrl("/me/todo/lists")).toContain("https://graph.microsoft.com/v1.0/me/todo/lists");
    expect(() => assertTodoGraphUrl("/me/messages")).toThrow(/not allowed/);
    expect(() => assertTodoGraphUrl("/me/events")).toThrow(/not allowed/);
  });

  it("honours Retry-After seconds", () => {
    expect(outboundRetryDelayMs(1, "12", new Date("2026-11-01T00:00:00.000Z"))).toBe(12_000);
  });

  it("hides another user's sync state from a colleague", () => {
    expect(microsoftSyncIndicator({
      viewerId: "user-b",
      assigneeId: "user-a",
      canSeeOthers: false,
      syncStatus: "FAILED",
    })).toBeNull();
    expect(microsoftSyncIndicator({
      viewerId: "user-a",
      assigneeId: "user-a",
      canSeeOthers: false,
      syncStatus: "SYNCED",
    })).toBe("Synced");
    expect(microsoftSyncIndicator({
      viewerId: "user-a",
      assigneeId: "user-a",
      canSeeOthers: false,
      syncStatus: "CONFLICT",
    })).toBe("Review");
  });
});

describe("Microsoft To Do migration", () => {
  it("only adds columns and an enum value", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/20261101120000_microsoft_todo_outbound/migration.sql"),
      "utf8",
    );
    const statements = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    expect(statements).toContain('ADD COLUMN "todoListId"');
    expect(statements).toContain('ADD COLUMN "taskOutboundEnabledAt"');
    expect(statements).toContain("NEEDS_REVIEW");
    expect(statements).not.toMatch(/^\s*(UPDATE|DELETE|DROP|TRUNCATE)\b/im);
    expect(statements).not.toMatch(/ALTER TABLE "(User|Task|Order|Company)"/);
  });
});

function snapshot() {
  return {
    id: "task-1",
    assigneeId: "user-a",
    title: "Call Acme",
    description: "secret account ABC",
    status: "OPEN" as const,
    priority: "HIGH" as const,
    dueAt: dueAtFromDateOnly("2026-11-02"),
    completedAt: null,
    createdAt: new Date("2026-10-15T00:00:00.000Z"),
    updatedAt: new Date("2026-10-15T00:00:00.000Z"),
  };
}
