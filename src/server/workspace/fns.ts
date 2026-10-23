import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/infra/auth";
import { formatZodError } from "@/domain/cms";
import { AuthError } from "@/server/rbac/guards";
import { updateCompanyMembership } from "@/server/companies/service";
import {
  listCompanyDocuments,
  listCompanyInvoices,
  listCompanyOrders,
  listCompanyQuotes,
  listPortalInvoices,
} from "@/server/companies/customer-workspace-records";
import { closeOrderAdministratively, fulfilOrderManually } from "@/server/orders/manual-resolution";

async function requireUserId(): Promise<string> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) {
    throw new AuthError("Authentication required", "UNAUTHENTICATED", 401);
  }
  return session.user.id;
}

function toError(error: unknown): { ok: false; error: string; code?: string } {
  if (error instanceof AuthError) return { ok: false, error: error.message, code: error.code };
  const validation = formatZodError(error);
  if (validation) return { ok: false, error: validation, code: "VALIDATION" };
  if (error instanceof Error && error.message) return { ok: false, error: error.message, code: "INTERNAL" };
  return { ok: false, error: "Request failed", code: "INTERNAL" };
}

export const updateCompanyMembershipFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await updateCompanyMembership(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });

export const listCompanyOrdersFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await listCompanyOrders(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });

export const listCompanyQuotesFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await listCompanyQuotes(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });

export const listCompanyInvoicesFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await listCompanyInvoices(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });

export const listCompanyDocumentsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await listCompanyDocuments(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });

export const listPortalInvoicesFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await listPortalInvoices(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });

export const fulfilOrderManuallyFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await fulfilOrderManually(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });

export const closeOrderAdministrativelyFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await closeOrderAdministratively(userId, data) };
    } catch (error) {
      return toError(error);
    }
  });
