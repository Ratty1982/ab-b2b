import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { formatZodError } from "@/domain/cms";
import { auth } from "@/infra/auth";
import { approveHistoricAccountMatches, historicAccountMatchReport } from "@/server/companies/historic-account-match";
import { AuthError } from "@/server/rbac/guards";

async function requireUserId(): Promise<string> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) throw new AuthError("Authentication required", "UNAUTHENTICATED", 401);
  return session.user.id;
}

function toError(error: unknown): { ok: false; error: string; code?: string } {
  if (error instanceof AuthError) return { ok: false, error: error.message, code: error.code };
  const validation = formatZodError(error);
  if (validation) return { ok: false, error: validation, code: "VALIDATION" };
  if (error instanceof Error && error.message) return { ok: false, error: error.message, code: "INTERNAL" };
  return { ok: false, error: "Request failed", code: "INTERNAL" };
}

export const historicAccountMatchReportFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data ?? {})
  .handler(async ({ data }) => {
    try {
      return { ok: true as const, data: await historicAccountMatchReport(await requireUserId(), data) };
    } catch (error) {
      return toError(error);
    }
  });

export const approveHistoricAccountMatchesFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      return { ok: true as const, data: await approveHistoricAccountMatches(await requireUserId(), data) };
    } catch (error) {
      return toError(error);
    }
  });
