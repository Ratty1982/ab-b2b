import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Microsoft365Panel } from "@/components/crm/Microsoft365Panel";
import type { Microsoft365Status } from "@/domain/microsoft-365-crm";

function status(partial: Partial<Microsoft365Status> = {}): Microsoft365Status {
  return {
    platformEnabled: true,
    configured: true,
    canConnect: true,
    connection: {
      status: "CONNECTED",
      displayName: "Alex Sales",
      email: "alex@automotivebrands.co.uk",
      taskSyncEnabled: true,
      calendarSyncEnabled: false,
      calendarConsented: false,
      lastTaskSyncAt: "2026-11-01T12:04:00.000Z",
      lastCalendarSyncAt: null,
      lastError: "Microsoft To Do permission is missing",
      connectedAt: "2026-11-01T09:00:00.000Z",
    },
    health: null,
    outbound: {
      engineEnabled: true,
      pending: 2,
      failed: 1,
      needsReview: 1,
      canApproveUncertainCreate: true,
      uncertainJobs: [
        {
          jobId: "job-uncertain",
          taskId: "task-1",
          taskTitle: "Call the workshop",
          assigneeName: "Alex Sales",
          assigneeEmail: "alex@automotivebrands.co.uk",
          lastError: "Microsoft To Do create outcome is uncertain and needs review before retrying",
          knownMicrosoftTaskId: null,
          connectionId: "conn-a",
          updatedAt: "2026-11-01T12:10:00.000Z",
        },
      ],
    },
    ...partial,
  };
}

const handlers = {
  onIncludeCalendar: () => undefined,
  onConnect: () => undefined,
  onDisconnect: () => undefined,
  onTaskSync: () => undefined,
  onCalendarSync: () => undefined,
  onAllowCalendar: () => undefined,
  onRetryOutbound: () => undefined,
  onRecheckUncertain: () => undefined,
  onApproveUncertainCreate: () => undefined,
};

describe("Microsoft 365 outbound panel", () => {
  it("shows ordinary retry separately from uncertain create review", () => {
    const html = renderToStaticMarkup(
      <Microsoft365Panel
        status={status()}
        includeCalendar={false}
        busy={false}
        error={null}
        {...handlers}
      />,
    );
    expect(html).toContain("Alex Sales");
    expect(html).toContain("Outbound engine");
    expect(html).toContain("Retry failed sync");
    expect(html).toContain("does not authorise another Microsoft create");
    expect(html).toContain("Review uncertain creation");
    expect(html).toContain("Call the workshop");
    expect(html).toContain("Recheck Microsoft To Do");
    expect(html).toContain("Authorise another create");
    expect(html).toContain("Not known");
    expect(html).not.toContain("access_token");
    expect(html).not.toContain("refresh_token");
    expect(html).not.toContain("eyJ");
  });

  it("hides ordinary retry when there are only uncertain review jobs", () => {
    const html = renderToStaticMarkup(
      <Microsoft365Panel
        status={status({
          outbound: {
            engineEnabled: true,
            pending: 0,
            failed: 0,
            needsReview: 1,
            canApproveUncertainCreate: false,
            uncertainJobs: status().outbound!.uncertainJobs,
          },
        })}
        includeCalendar={false}
        busy={false}
        error={null}
        {...handlers}
      />,
    );
    expect(html).not.toContain(">Retry failed sync</button>");
    expect(html).toContain("Review uncertain creation");
    expect(html).not.toContain("Authorise another create");
  });

  it("keeps ordinary retry for non-uncertain needs-review rows", () => {
    const html = renderToStaticMarkup(
      <Microsoft365Panel
        status={status({
          outbound: {
            engineEnabled: true,
            pending: 0,
            failed: 0,
            needsReview: 1,
            canApproveUncertainCreate: true,
            uncertainJobs: [],
          },
        })}
        includeCalendar={false}
        busy={false}
        error={null}
        {...handlers}
      />,
    );
    expect(html).toContain(">Retry failed sync</button>");
    expect(html).not.toContain("Review uncertain creation");
  });
});
