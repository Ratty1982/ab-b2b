import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/infra/auth";
import { formatZodError } from "@/domain/cms";
import { AuthError, requireAuthenticatedUser } from "@/server/rbac/guards";
import * as wizard from "@/server/companies/customer-creation-wizard";

async function requireUserId(): Promise<string> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) throw new AuthError("Authentication required", "UNAUTHENTICATED", 401);
  await requireAuthenticatedUser(session.user.id);
  return session.user.id;
}

function toError(error: unknown): { ok: false; error: string; code?: string } {
  if (error instanceof AuthError) return { ok: false, error: error.message, code: error.code };
  const validation = formatZodError(error);
  if (validation) return { ok: false, error: validation, code: "VALIDATION" };
  if (error instanceof Error && error.message)
    return { ok: false, error: error.message, code: "INTERNAL" };
  return { ok: false, error: "Request failed", code: "INTERNAL" };
}

export const searchCustomerCreationDuplicatesFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return {
        ok: true as const,
        data: await wizard.searchCustomerCreationDuplicates(userId, data),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const saveCustomerCreationDetailsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await wizard.saveCustomerCreationDetails(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });

export const getCustomerCreationWizardFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { companyId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return {
        ok: true as const,
        data: await wizard.getCustomerCreationWizard(userId, data.companyId),
      };
    } catch (error) {
      return toError(error);
    }
  });
