import { describe, expect, it } from "vitest";

import {
  isUncertainCreatePayload,
  mayPostMicrosoftTodoCreate,
  ordinaryRetryIncludesJob,
} from "@/domain/microsoft-todo-outbound";
import { mergeOutboundPayload } from "@/server/microsoft-365/outbound-sync";

describe("uncertain create review gate", () => {
  it("keeps ordinary reviewed retry from authorising an uncertain create", () => {
    expect(
      mayPostMicrosoftTodoCreate({
        createUncertain: true,
        reviewed: true,
      }),
    ).toBe(false);
    expect(isUncertainCreatePayload({ createUncertain: true })).toBe(true);
    expect(ordinaryRetryIncludesJob({ status: "FAILED", createUncertain: true })).toBe(false);
    expect(ordinaryRetryIncludesJob({ status: "NEEDS_REVIEW", createUncertain: true })).toBe(false);
    expect(ordinaryRetryIncludesJob({ status: "FAILED" })).toBe(true);
    expect(ordinaryRetryIncludesJob({ status: "NEEDS_REVIEW", createUncertain: false })).toBe(true);
  });

  it("requires job-scoped one-time create authorisation after review", () => {
    expect(
      mayPostMicrosoftTodoCreate({
        createUncertain: true,
        authorizeCreateOnce: true,
      }),
    ).toBe(true);
    expect(
      mayPostMicrosoftTodoCreate({
        createUncertain: true,
        authorizeCreateOnce: true,
        recheckOnly: true,
      }),
    ).toBe(false);
  });

  it("drops create authorisation when a concurrent CRM revision dirties the job", () => {
    const merged = mergeOutboundPayload(
      {
        taskId: "task-1",
        createUncertain: true,
        authorizeCreateOnce: true,
        createApproval: {
          approvedByUserId: "admin",
          approvedAt: "2026-11-01T12:00:00.000Z",
          jobId: "job-1",
          taskId: "task-1",
          connectionId: "conn-a",
          taskRevision: "2026-11-01T12:00:00.000Z",
          acknowledgedDuplicateRisk: true,
        },
      },
      { taskId: "task-1", taskRevision: "2026-11-01T12:05:00.000Z" },
      { markDirty: true },
    );
    expect(merged.createUncertain).toBe(true);
    expect(merged.revisionDirty).toBe(true);
    expect(merged.authorizeCreateOnce).toBeUndefined();
    expect(merged.createApproval).toBeUndefined();
  });

  it("keeps create authorisation only when the approved revision is unchanged", () => {
    const merged = mergeOutboundPayload(
      {
        taskId: "task-1",
        createUncertain: true,
        authorizeCreateOnce: true,
        createApproval: {
          approvedByUserId: "admin",
          approvedAt: "2026-11-01T12:00:00.000Z",
          jobId: "job-1",
          taskId: "task-1",
          connectionId: "conn-a",
          taskRevision: "2026-11-01T12:00:00.000Z",
          acknowledgedDuplicateRisk: true,
        },
      },
      { taskId: "task-1", taskRevision: "2026-11-01T12:00:00.000Z" },
    );
    expect(merged.authorizeCreateOnce).toBe(true);
    expect(merged.createApproval?.jobId).toBe("job-1");
    expect(merged.createApproval?.taskRevision).toBe("2026-11-01T12:00:00.000Z");
  });
});
