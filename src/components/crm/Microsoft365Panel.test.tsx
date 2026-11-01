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
    outbound: { engineEnabled: false, pending: 2, failed: 1, needsReview: 1 },
    ...partial,
  };
}

describe("Microsoft 365 outbound panel", () => {
  it("shows engine status and retry without tokens or personal tasks", () => {
    const html = renderToStaticMarkup(
      <Microsoft365Panel
        status={status()}
        includeCalendar={false}
        busy={false}
        error={null}
        onIncludeCalendar={() => undefined}
        onConnect={() => undefined}
        onDisconnect={() => undefined}
        onTaskSync={() => undefined}
        onCalendarSync={() => undefined}
        onAllowCalendar={() => undefined}
        onRetryOutbound={() => undefined}
      />,
    );
    expect(html).toContain("Alex Sales");
    expect(html).toContain("Outbound engine");
    expect(html).toContain("Off");
    expect(html).toContain("Waiting");
    expect(html).toContain("Needs review");
    expect(html).toContain("Retry failed sync");
    expect(html).toContain("does not create appointments");
    expect(html).not.toContain("access_token");
    expect(html).not.toContain("refresh_token");
    expect(html).not.toContain("eyJ");
  });
});
