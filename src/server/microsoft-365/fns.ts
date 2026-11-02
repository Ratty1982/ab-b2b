import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";

import { sanitizeMicrosoftMessage } from "@/domain/microsoft-365-crm";
import { auth } from "@/infra/auth";
import { AuthError } from "@/server/rbac/guards";
import {
  microsoft365ApproveUncertainOutboundCreate,
  microsoft365BeginConnect,
  microsoft365Disconnect,
  microsoft365RecheckUncertainOutbound,
  microsoft365RecreateInboundMapping,
  microsoft365RequestInboundCheck,
  microsoft365RetryCalendarOutbound,
  microsoft365RetryOutbound,
  microsoft365StatusFor,
  microsoft365UnlinkInboundMapping,
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

export const retryMicrosoftTodoOutboundFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await microsoft365RetryOutbound(userId) };
  } catch (error) {
    return toError(error);
  }
});

export const retryMicrosoftCalendarOutboundFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await microsoft365RetryCalendarOutbound(userId) };
  } catch (error) {
    return toError(error);
  }
});

export const recheckMicrosoftTodoUncertainFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ jobId: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await microsoft365RecheckUncertainOutbound(userId, data.jobId) };
    } catch (error) {
      return toError(error);
    }
  });

export const approveMicrosoftTodoUncertainCreateFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        jobId: z.string().min(1),
        acknowledgedDuplicateRisk: z.literal(true),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return {
        ok: true as const,
        data: await microsoft365ApproveUncertainOutboundCreate(userId, data.jobId, data.acknowledgedDuplicateRisk),
      };
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

export const requestMicrosoftTodoInboundCheckFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await microsoft365RequestInboundCheck(userId) };
  } catch (error) {
    return toError(error);
  }
});

export const unlinkMicrosoftTodoInboundMappingFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ mappingId: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await microsoft365UnlinkInboundMapping(userId, data.mappingId) };
    } catch (error) {
      return toError(error);
    }
  });

export const recreateMicrosoftTodoInboundMappingFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ mappingId: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await microsoft365RecreateInboundMapping(userId, data.mappingId) };
    } catch (error) {
      return toError(error);
    }
  });
