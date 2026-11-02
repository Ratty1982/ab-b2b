/**
 * Production wiring for inbound To Do sync. Graph calls stay behind the inbound flag.
 */
import { randomBytes } from "node:crypto";

import { sanitizeMicrosoftMessage, Microsoft365Error } from "@/domain/microsoft-365-crm";
import { inboundGraphAllowed } from "@/domain/microsoft-todo-inbound";
import type { MicrosoftFetch } from "@/server/microsoft-365/http";
import { createPrismaInboundStore, enqueueInboundForEligibleConnections } from "@/server/microsoft-365/inbound-prisma";
import {
  runInboundBatch,
  type InboundConnection,
  type InboundGraph,
  type InboundRuntime,
  type InboundToken,
} from "@/server/microsoft-365/inbound-sync";
import { decryptMicrosoftToken } from "@/server/microsoft-365/token-cipher";
import { refreshMicrosoftConnection } from "@/server/microsoft-365/flow";
import { createPrismaMicrosoft365Store } from "@/server/microsoft-365/prisma-store";
import { currentMicrosoft365Gate } from "@/server/microsoft-365/service";

const ACCESS_SKEW_MS = 120_000;

export function readInboundFlags(): boolean {
  return inboundGraphAllowed({
    crmFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
    inboundFlag: process.env["MICROSOFT_365_TASK_INBOUND_ENABLED"],
  });
}

export function createFetchInboundGraph(fetchImpl: MicrosoftFetch): InboundGraph {
  return {
    async request({ method, path, token }) {
      const { assertTodoDeltaGraphUrl } = await import("@/domain/microsoft-todo-inbound");
      // path is already validated by the worker against the dedicated list id when it is a next/delta link.
      // Relative first-page paths still need the list id extracted for assertTodoDeltaGraphUrl.
      let url: string;
      try {
        if (path.startsWith("http")) {
          const listMatch = /\/todo\/lists\/([^/]+)\/tasks\/delta/.exec(path);
          const listId = listMatch ? decodeURIComponent(listMatch[1] ?? "") : "";
          url = assertTodoDeltaGraphUrl(path, listId);
        } else {
          const listMatch = /\/todo\/lists\/([^/]+)\/tasks\/delta/.exec(path);
          const listId = listMatch ? decodeURIComponent(listMatch[1] ?? "") : "";
          url = assertTodoDeltaGraphUrl(path, listId);
        }
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

export async function tokenForInboundConnection(connection: InboundConnection): Promise<InboundToken> {
  const gate = currentMicrosoft365Gate();
  if (gate.state !== "ready") {
    return { ok: false, code: "TOKEN", retryAfter: null, message: "Microsoft 365 is not configured" };
  }
  const freshEnough =
    connection.accessTokenExpiresAt != null && connection.accessTokenExpiresAt.getTime() - Date.now() > ACCESS_SKEW_MS;
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
      return { ok: false, code: "RATE_LIMITED", retryAfter: null, message: sanitizeMicrosoftMessage(error.message) };
    }
    if (error instanceof Microsoft365Error && error.code === "REVOKED") {
      return { ok: false, code: "REVOKED", retryAfter: null, message: "Microsoft 365 needs to be connected again" };
    }
    return { ok: false, code: "TOKEN", retryAfter: null, message: "Microsoft 365 could not be reached" };
  }
  const store = createPrismaInboundStore();
  const refreshed = await store.findConnection(connection.userId);
  const token = decryptMicrosoftToken(refreshed?.accessTokenEncrypted ?? null);
  if (!token) return { ok: false, code: "TOKEN", retryAfter: null, message: "Microsoft 365 could not be reached" };
  return { ok: true, accessToken: token };
}

export function productionInboundRuntime(fetchImpl: MicrosoftFetch = fetch): InboundRuntime {
  return {
    now: () => new Date(),
    graphAllowed: readInboundFlags,
    store: createPrismaInboundStore(),
    graph: createFetchInboundGraph(fetchImpl),
    tokenFor: tokenForInboundConnection,
  };
}

export async function runProductionInboundBatch(): Promise<{ processed: number; graphCalls: boolean }> {
  if (!readInboundFlags()) return { processed: 0, graphCalls: false };
  await enqueueInboundForEligibleConnections();
  return runInboundBatch(productionInboundRuntime(), {
    limit: 5,
    owner: `inbound-${randomBytes(4).toString("hex")}`,
  });
}
