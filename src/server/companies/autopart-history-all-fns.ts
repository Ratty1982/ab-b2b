import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { formatZodError } from "@/domain/cms";
import { auth } from "@/infra/auth";
import { AuthError } from "@/server/rbac/guards";
import { listOpenHistoricReviews } from "@/server/companies/autopart-history-all";

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

export const listOpenHistoricReviewsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data ?? {})
  .handler(async () => {
    try {
      return { ok: true as const, data: await listOpenHistoricReviews(await requireUserId()) };
    } catch (error) {
      return toError(error);
    }
  });
