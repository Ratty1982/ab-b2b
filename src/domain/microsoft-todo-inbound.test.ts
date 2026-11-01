import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertTodoDeltaGraphUrl,
  inboundCursorResource,
  inboundDueAtFromMicrosoft,
  inboundGraphAllowed,
  isMicrosoftTodoInboundEnabled,
  mapMicrosoftStatusToCrm,
  microsoftInboundSyncIndicator,
  planInboundFieldUpdates,
  snapshotFromCrmTask,
} from "@/domain/microsoft-todo-inbound";

describe("Microsoft To Do inbound flags", () => {
  it("stays off unless both flags are explicitly enabled and never implies outbound", () => {
    expect(isMicrosoftTodoInboundEnabled(undefined)).toBe(false);
    expect(isMicrosoftTodoInboundEnabled("false")).toBe(false);
    expect(inboundGraphAllowed({ crmFlag: "true", inboundFlag: "false" })).toBe(false);
    expect(inboundGraphAllowed({ crmFlag: "false", inboundFlag: "true" })).toBe(false);
    expect(inboundGraphAllowed({ crmFlag: "true", inboundFlag: "on" })).toBe(true);
  });
});

describe("Microsoft To Do inbound mapping policy", () => {
  it("keeps CRM cancellation ahead of Microsoft reopen or completion", () => {
    expect(
      mapMicrosoftStatusToCrm({
        microsoftStatus: "completed",
        crmStatus: "CANCELLED",
      }),
    ).toMatchObject({ skip: true });
    expect(
      mapMicrosoftStatusToCrm({
        microsoftStatus: "notStarted",
        crmStatus: "CANCELLED",
      }),
    ).toMatchObject({ skip: true });
  });

  it("restores IN_PROGRESS when a reliable prior status exists", () => {
    expect(
      mapMicrosoftStatusToCrm({
        microsoftStatus: "notStarted",
        crmStatus: "DONE",
        priorCrmStatus: "IN_PROGRESS",
      }),
    ).toEqual({ status: "IN_PROGRESS" });
    expect(
      mapMicrosoftStatusToCrm({
        microsoftStatus: "notStarted",
        crmStatus: "DONE",
      }),
    ).toEqual({ status: "OPEN" });
  });

  it("merges field changes without last-write-wins", () => {
    const crm = snapshotFromCrmTask({
      title: "CRM title",
      description: "CRM notes",
      status: "OPEN",
      priority: "NORMAL",
      dueAt: new Date("2026-11-02T12:00:00.000Z"),
      completedAt: null,
    });
    const lastSynced = { ...crm };
    const microsoft = {
      ...crm,
      status: "DONE" as const,
      completedAt: "2026-11-01T15:00:00.000Z",
      dueAt: "2026-11-05T12:00:00.000Z",
      title: "CRM title",
    };
    const plan = planInboundFieldUpdates({
      crm: { ...crm, dueAt: "2026-11-03T12:00:00.000Z" },
      microsoft,
      lastSynced,
      crmRevisionChanged: true,
    });
    expect(plan.apply.status).toBe("DONE");
    expect(plan.apply.dueAt).toBeUndefined();
    expect(plan.conflicts.some((item) => item.includes("Due date"))).toBe(true);
  });

  it("parses UTC date-only dues as CRM noon and Europe/London timed dues across DST", () => {
    const dateOnly = inboundDueAtFromMicrosoft({ dateTime: "2026-11-02T00:00:00", timeZone: "UTC" });
    expect(dateOnly?.toISOString()).toBe("2026-11-02T12:00:00.000Z");
    const bst = inboundDueAtFromMicrosoft({ dateTime: "2026-06-01T17:30:00", timeZone: "Europe/London" });
    expect(bst?.toISOString()).toBe("2026-06-01T16:30:00.000Z");
    const gmt = inboundDueAtFromMicrosoft({ dateTime: "2026-01-05T17:30:00", timeZone: "Europe/London" });
    expect(gmt?.toISOString()).toBe("2026-01-05T17:30:00.000Z");
  });

  it("rejects forged delta URLs and foreign list ids", () => {
    const listId = "list-ab-crm";
    expect(() => assertTodoDeltaGraphUrl(`/me/todo/lists/${listId}/tasks/delta`, listId)).not.toThrow();
    expect(() =>
      assertTodoDeltaGraphUrl(`https://evil.example/me/todo/lists/${listId}/tasks/delta`, listId),
    ).toThrow();
    expect(() =>
      assertTodoDeltaGraphUrl(`/me/todo/lists/other-list/tasks/delta`, listId),
    ).toThrow();
    expect(() =>
      assertTodoDeltaGraphUrl(`/me/mailFolders`, listId),
    ).toThrow();
    expect(inboundCursorResource(listId)).toBe("todo-inbound:list-ab-crm");
  });

  it("exposes removed sync indicator without leaking unrelated statuses", () => {
    expect(
      microsoftInboundSyncIndicator({
        viewerId: "u1",
        assigneeId: "u1",
        canSeeOthers: false,
        syncStatus: "REMOVED",
      }),
    ).toBe("Removed");
  });

  it("keeps the inbound migration additive", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/20261101200000_microsoft_todo_inbound/migration.sql"),
      "utf8",
    );
    expect(sql).toContain('ADD VALUE IF NOT EXISTS \'REMOVED\'');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "taskInboundEnabledAt"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "syncedSnapshot"');
    expect(sql.toLowerCase()).not.toContain("drop table");
    expect(sql.toLowerCase()).not.toContain("delete from \"task\"");
  });
});
