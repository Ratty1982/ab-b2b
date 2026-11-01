import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";

import { sanitizeMicrosoftMessage } from "@/domain/microsoft-365-crm";
import { auth } from "@/infra/auth";
import { AuthError } from "@/server/rbac/guards";
import {
  microsoft365BeginConnect,
  microsoft365Disconnect,
  microsoft365StatusFor,
  microsoft365UpdatePreferences,
} from "@/server/microsoft-365/service";

async function requireUserId(): Promise<string> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) throw new AuthError("Authentication required", "UNAUTHENTICATED", 401);
  return session.user.id;
}

function toError(error: unknown): { ok: false; error: string; code?: string } {
  if (error instanceof AuthError) return { ok: false, error: error.message, code: error.code };
  const validation = error instanceof z.ZodError ? "Check the Microsoft 365 settings and try again." : null;
  if (validation) return { ok: false, error: validation, code: "VALIDATION" };
  console.error("[ab:microsoft-365]", sanitizeMicrosoftMessage(error instanceof Error ? error.message : "failed"));
  return { ok: false, error: "Microsoft 365 request failed", code: "SERVER" };
}

export const getMicrosoft365StatusFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await microsoft365StatusFor(userId) };
  } catch (error) {
    return toError(error);
  }
});

export const beginMicrosoft365ConnectFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ includeCalendar: z.boolean() }).parse(data))
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await microsoft365BeginConnect(userId, data.includeCalendar);
      return { ok: true as const, data: result };
    } catch (error) {
      return toError(error);
    }
  });

export const disconnectMicrosoft365Fn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await microsoft365Disconnect(userId) };
  } catch (error) {
    return toError(error);
  }
});

export const updateMicrosoft365PreferencesFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        taskSyncEnabled: z.boolean(),
        calendarSyncEnabled: z.boolean(),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await microsoft365UpdatePreferences(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });
