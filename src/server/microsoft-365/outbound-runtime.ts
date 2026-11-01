/**
 * Production wiring for outbound To Do sync. Graph calls stay behind the feature flags.
 */
import { randomBytes } from "node:crypto";

import { sanitizeMicrosoftMessage } from "@/domain/microsoft-365-crm";
import { outboundGraphAllowed } from "@/domain/microsoft-todo-outbound";
import { Microsoft365Error } from "@/domain/microsoft-365-crm";
import type { MicrosoftFetch } from "@/server/microsoft-365/http";
import { createPrismaOutboundStore } from "@/server/microsoft-365/outbound-prisma";
import {
  runOutboundBatch,
  type OutboundConnection,
  type OutboundGraph,
  type OutboundRuntime,
  type OutboundToken,
} from "@/server/microsoft-365/outbound-sync";
import { decryptMicrosoftToken } from "@/server/microsoft-365/token-cipher";
import { refreshMicrosoftConnection } from "@/server/microsoft-365/flow";
import { createPrismaMicrosoft365Store } from "@/server/microsoft-365/prisma-store";
import { currentMicrosoft365Gate } from "@/server/microsoft-365/service";

const ACCESS_SKEW_MS = 120_000;

export function readOutboundFlags(): boolean {
  return outboundGraphAllowed({
    crmFlag: process.env["MICROSOFT_365_CRM_ENABLED"],
    outboundFlag: process.env["MICROSOFT_365_TASK_OUTBOUND_ENABLED"],
  });
}

export function createFetchOutboundGraph(fetchImpl: MicrosoftFetch): OutboundGraph {
  return {
    async request({ method, path, token, body }) {
      const { assertTodoGraphUrl } = await import("@/domain/microsoft-todo-outbound");
      const url = assertTodoGraphUrl(path);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          redirect: "manual",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        return errorShape(error);
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

function errorShape(_error: unknown): { status: number; json: null; retryAfter: null; networkError: true } {
  return { status: 0, json: null, retryAfter: null, networkError: true };
}

export async function tokenForOutboundConnection(connection: OutboundConnection): Promise<OutboundToken> {
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
  const store = createPrismaOutboundStore();
  const fresh = await store.findConnection(connection.userId);
  const access = decryptMicrosoftToken(fresh?.accessTokenEncrypted);
  if (!access) return { ok: false, code: "REVOKED", retryAfter: null, message: "Microsoft 365 needs to be connected again" };
  return { ok: true, accessToken: access };
}

export function productionOutboundRuntime(): OutboundRuntime {
  return {
    store: createPrismaOutboundStore(),
    graph: createFetchOutboundGraph((url, init) => fetch(url, init)),
    tokenFor: tokenForOutboundConnection,
    now: () => new Date(),
    graphAllowed: readOutboundFlags,
    newId: () => randomBytes(16).toString("base64url"),
  };
}

export async function runProductionOutboundBatch(): Promise<{ processed: number; graphCalls: boolean }> {
  if (!readOutboundFlags()) return { processed: 0, graphCalls: false };
  return runOutboundBatch(productionOutboundRuntime(), `outbound-${process.pid}`);
}
