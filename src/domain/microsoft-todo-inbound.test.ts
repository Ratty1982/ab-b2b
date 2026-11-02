import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  absorbDeltaPage,
  assertTodoDeltaGraphUrl,
  coalesceDeltaItems,
  inboundCursorResource,
  inboundDueAtFromMicrosoft,
  inboundGraphAllowed,
  isMicrosoftTodoInboundEnabled,
  mapMicrosoftStatusToCrm,
  mergeDeltaOccurrence,
  microsoftInboundSyncIndicator,
  planInboundFieldUpdates,
  snapshotFromCrmTask,
  type MicrosoftTodoInboundFields,
} from "@/domain/microsoft-todo-inbound";

function deltaItem(partial: Partial<MicrosoftTodoInboundFields> & Pick<MicrosoftTodoInboundFields, "id">): MicrosoftTodoInboundFields {
  return {
    etag: null,
    title: null,
    bodyContent: null,
    status: null,
    importance: null,
    dueDateTime: null,
    completedDateTime: null,
    lastModifiedDateTime: null,
    removed: false,
    ...partial,
  };
}

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

  it("coalesces repeated Microsoft task ids without dropping newer updates or removals", () => {
    const updatedTwice = coalesceDeltaItems([
      deltaItem({ id: "ms-1", title: "First", status: "notStarted", lastModifiedDateTime: "2026-11-01T10:00:00Z" }),
      deltaItem({ id: "ms-1", title: "Second", status: "inProgress", lastModifiedDateTime: "2026-11-01T11:00:00Z" }),
    ]);
    expect(updatedTwice).toHaveLength(1);
    expect(updatedTwice[0]).toMatchObject({ title: "Second", status: "inProgress" });

    const updatedThenDeleted = coalesceDeltaItems([
      deltaItem({ id: "ms-1", title: "Live", status: "notStarted" }),
      deltaItem({ id: "ms-1", removed: true }),
    ]);
    expect(updatedThenDeleted[0]?.removed).toBe(true);

    const deletedThenReturned = coalesceDeltaItems([
      deltaItem({ id: "ms-1", removed: true }),
      deltaItem({ id: "ms-1", title: "Restored", status: "notStarted" }),
    ]);
    expect(deletedThenReturned[0]).toMatchObject({ removed: false, title: "Restored" });

    const unchangedRepeat = coalesceDeltaItems([
      deltaItem({ id: "ms-1", title: "Same", status: "notStarted", etag: "e1" }),
      deltaItem({ id: "ms-1", title: "Same", status: "notStarted", etag: "e1" }),
    ]);
    expect(unchangedRepeat).toHaveLength(1);

    const acrossPages = absorbDeltaPage(
      [deltaItem({ id: "ms-1", title: "Page1", status: "notStarted" })],
      [deltaItem({ id: "ms-1", status: "completed" })],
    );
    expect(acrossPages[0]).toMatchObject({ title: "Page1", status: "completed" });

    const olderLastModifiedLater = mergeDeltaOccurrence(
      deltaItem({ id: "ms-1", title: "Newer", status: "completed", lastModifiedDateTime: "2026-11-01T12:00:00Z" }),
      deltaItem({ id: "ms-1", title: "Older", status: "notStarted", lastModifiedDateTime: "2026-11-01T11:00:00Z" }),
    );
    expect(olderLastModifiedLater).toMatchObject({ title: "Newer", status: "completed" });
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
