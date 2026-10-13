import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { ZodError } from "zod";
import { auth } from "@/infra/auth";
import { AuthError } from "@/server/rbac/guards";
import {
  deleteCustomerSurveyResponse,
  exportCustomerSurveysCsv,
  exportPrizeDrawEntriesCsv,
  getCustomerSurveyDashboard,
  getCustomerSurveyResponse,
  importWordpressSurveyCsv,
  submitCustomerSurvey,
} from "@/server/surveys/service";

async function requireUserId(): Promise<string> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) throw new AuthError("Authentication required", "UNAUTHENTICATED", 401);
  return session.user.id;
}

function toError(error: unknown): { ok: false; error: string; code?: string } {
  if (error instanceof AuthError) return { ok: false, error: error.message, code: error.code };
  if (error instanceof ZodError)
    return { ok: false, error: "Check the filters and try again.", code: "VALIDATION" };
  console.error("[ab:survey]", error instanceof Error ? error.message : "unknown");
  return { ok: false, error: "Something went wrong. Please try again.", code: "SERVER" };
}

function clientIp(): string | null {
  const headers = getRequestHeaders();
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

export const submitCustomerSurveyFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      return await submitCustomerSurvey(data, { ip: clientIp() });
    } catch (error) {
      console.error(
        "[ab:survey] submit failed",
        error instanceof Error ? error.message : "unknown",
      );
      return {
        ok: false as const,
        error: "We were unable to save your response. Please try again.",
        code: "SERVER",
      };
    }
  });

export const getCustomerSurveyDashboardFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await getCustomerSurveyDashboard(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });

export const getCustomerSurveyResponseFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await getCustomerSurveyResponse(userId, data.id) };
    } catch (error) {
      return toError(error);
    }
  });

export const deleteCustomerSurveyFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await deleteCustomerSurveyResponse(userId, data.id) };
    } catch (error) {
      return toError(error);
    }
  });

export const exportCustomerSurveysFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await exportCustomerSurveysCsv(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });

export const exportPrizeDrawEntriesFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await exportPrizeDrawEntriesCsv(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });

export const importWordpressSurveysFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { csv: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await importWordpressSurveyCsv(userId, data.csv) };
    } catch (error) {
      return toError(error);
    }
  });
