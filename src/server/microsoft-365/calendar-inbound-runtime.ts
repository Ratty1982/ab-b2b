/**
 * Production wiring for inbound Calendar sync. Graph calls stay behind the calendar flag.
 */
import { randomBytes } from "node:crypto";

import { sanitizeMicrosoftMessage, Microsoft365Error } from "@/domain/microsoft-365-crm";
import { assertCalendarGraphUrl, calendarGraphAllowed } from "@/domain/microsoft-calendar";
import type { MicrosoftFetch } from "@/server/microsoft-365/http";
import {
  createPrismaCalendarInboundStore,
  enqueueCalendarInboundForEligibleConnections,
} from "@/server/microsoft-365/calendar-inbound-prisma";
import {
  runCalendarInboundBatch,
  type CalendarInboundConnection,
  type CalendarInboundGraph,
  type CalendarInboundRuntime,
  type CalendarInboundToken,
} from "@/server/microsoft-365/calendar-inbound-sync";
import { decryptMicrosoftToken } from "@/server/microsoft-365/token-cipher";
import { refreshMicrosoftConnection } from "@/server/microsoft-365/flow";
import { createPrismaMicrosoft365Store } from "@/server/microsoft-365/prisma-store";
import { currentMicrosoft365Gate } from "@/server/microsoft-365/service";

const ACCESS_SKEW_MS = 120_000;

export function readCalendarInboundFlags(): boolean {
  return calendarGraphAllowed({
    crmFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
    calendarFlag: process.env["MICROSOFT_365_CALENDAR_SYNC_ENABLED"],
  });
}

export function createFetchCalendarInboundGraph(fetchImpl: MicrosoftFetch): CalendarInboundGraph {
  return {
    async request({ method, path, token }) {
      let url: string;
      try {
        url = assertCalendarGraphUrl(path);
      } catch {
        return { status: 400, json: null, retryAfter: null };
      }
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          redirect: "manual",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            Prefer: `IdType="ImmutableId", outlook.timezone="Europe/London"`,
          },
        });
      } catch {
        return { status: 0, json: null, retryAfter: null, networkError: true };
      }
      if (response.status >= 300 && response.status < 400) {
        return { status: 502, json: null, retryAfter: null };
      }
      if (response.url) {
        try {
          const landed = new URL(response.url);
          if (landed.protocol !== "https:" || landed.hostname !== "graph.microsoft.com") {
            return { status: 502, json: null, retryAfter: null };
          }
        } catch {
          return { status: 502, json: null, retryAfter: null };
        }
      }
      const json = (await response.json().catch(() => null)) as unknown;
      return { status: response.status, json, retryAfter: response.headers.get("retry-after") };
    },
  };
}

export async function tokenForCalendarInboundConnection(
  connection: CalendarInboundConnection,
): Promise<CalendarInboundToken> {
  const gate = currentMicrosoft365Gate();
  if (gate.state !== "ready") {
    return { ok: false, code: "TOKEN", retryAfter: null, message: "Microsoft 365 is not configured" };
  }
  const freshEnough =
    connection.accessTokenExpiresAt != null &&
    connection.accessTokenExpiresAt.getTime() - Date.now() > ACCESS_SKEW_MS;
  if (freshEnough) {
    const current = decryptMicrosoftToken(connection.accessTokenEncrypted);
    if (current) return { ok: true, accessToken: current };
  }
  try {
    await refreshMicrosoftConnection(
      { userId: connection.userId, actorType: "INTERNAL", canConnect: true, canViewAdminHealth: false },
      gate,
      { store: createPrismaMicrosoft365Store() },
    );
  } catch (error) {
    if (error instanceof Microsoft365Error && error.code === "RATE_LIMITED") {
      return {
        ok: false,
        code: "RATE_LIMITED",
        retryAfter: null,
        message: sanitizeMicrosoftMessage(error.message),
      };
    }
    if (error instanceof Microsoft365Error && error.code === "REVOKED") {
      return {
        ok: false,
        code: "REVOKED",
        retryAfter: null,
        message: "Microsoft 365 needs to be connected again",
      };
    }
    return { ok: false, code: "TOKEN", retryAfter: null, message: "Microsoft 365 could not be reached" };
  }
  const store = createPrismaCalendarInboundStore();
  const refreshed = await store.findConnection(connection.userId);
  const token = decryptMicrosoftToken(refreshed?.accessTokenEncrypted ?? null);
  if (!token) return { ok: false, code: "TOKEN", retryAfter: null, message: "Microsoft 365 could not be reached" };
  return { ok: true, accessToken: token };
}

export function productionCalendarInboundRuntime(
  fetchImpl: MicrosoftFetch = fetch,
): CalendarInboundRuntime {
  return {
    now: () => new Date(),
    graphAllowed: readCalendarInboundFlags,
    store: createPrismaCalendarInboundStore(),
    graph: createFetchCalendarInboundGraph(fetchImpl),
    tokenFor: tokenForCalendarInboundConnection,
  };
}

export async function runProductionCalendarInboundBatch(): Promise<{
  processed: number;
  graphCalls: boolean;
}> {
  if (!readCalendarInboundFlags()) return { processed: 0, graphCalls: false };
  await enqueueCalendarInboundForEligibleConnections();
  return runCalendarInboundBatch(productionCalendarInboundRuntime(), {
    limit: 5,
    owner: `calendar-inbound-${randomBytes(4).toString("hex")}`,
  });
}
