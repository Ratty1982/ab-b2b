import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/infra/auth";
import { formatZodError } from "@/domain/cms";
import type { AutopartAccountClassification } from "@prisma/client";
import { AuthError } from "@/server/rbac/guards";
import * as master from "@/server/companies/autopart-master-import";

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
  if (error instanceof Error && error.message)
    return { ok: false, error: error.message, code: "INTERNAL" };
  return { ok: false, error: "Request failed", code: "INTERNAL" };
}

export const listAutopartImportBatchesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => (data ?? {}) as { page?: number })
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.listAutopartImportBatches(await requireUserId(), data.page ?? 1),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const getAutopartImportBatchFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { batchId: string })
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.getAutopartImportBatch(await requireUserId(), data.batchId),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const previewAutopartImportFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) => data as { batchId: string; columnMap?: Record<string, string> },
  )
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.previewAutopartImport(await requireUserId(), data),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const confirmAutopartImportFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { batchId: string })
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.confirmAutopartImport(await requireUserId(), data.batchId),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const cancelAutopartImportFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { batchId: string })
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.cancelAutopartImport(await requireUserId(), data.batchId),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const listAutopartImportIssuesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { batchId: string; page?: number })
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.listAutopartImportIssues(
          await requireUserId(),
          data.batchId,
          data.page ?? 1,
        ),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const listAutopartMasterAccountsFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: unknown) =>
      (data ?? {}) as {
        q?: string;
        classification?: AutopartAccountClassification | "ALL";
        link?: "all" | "linked" | "unlinked";
        page?: number;
      },
  )
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.listAutopartAccounts(await requireUserId(), data),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const getAutopartHistoricalSummaryFn = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      return {
        ok: true as const,
        data: await master.getAutopartHistoricalSummary(await requireUserId()),
      };
    } catch (error) {
      return toError(error);
    }
  },
);

export const getCompanyAutopartMasterFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { companyId: string })
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.getCompanyAutopartMaster(await requireUserId(), data.companyId),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const linkAutopartMasterAccountFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) => data as { accountId: string; companyId: string; setPrimary?: boolean },
  )
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.linkAutopartAccountToCompany(await requireUserId(), data),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const createCompanyForAutopartAccountFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { accountId: string })
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.createCompanyForAutopartAccount(await requireUserId(), data.accountId),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const setAutopartHistoricalAccessFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { accountId: string; enabled: boolean })
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.setAutopartHistoricalAccess(await requireUserId(), data),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const listDuplicateAutopartNamesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => (data ?? {}) as { page?: number })
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.listDuplicateAutopartNames(await requireUserId(), data.page ?? 1),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const classifyAutopartAccountFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) =>
      data as { accountId: string; classification: AutopartAccountClassification; note?: string },
  )
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.classifyAutopartAccountManually(await requireUserId(), data),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const listAutopartInvoiceLinesFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: unknown) => (data ?? {}) as { accountCode?: string; q?: string; page?: number },
  )
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.listAutopartInvoiceLines(await requireUserId(), data),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const listAutopartLedgerFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => (data ?? {}) as { accountCode?: string; page?: number })
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.listAutopartLedger(await requireUserId(), data),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const listAutopartReconciliationFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: unknown) => (data ?? {}) as { accountCode?: string; status?: string; page?: number },
  )
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.listAutopartReconciliation(await requireUserId(), data),
      };
    } catch (error) {
      return toError(error);
    }
  });

export const getPortalAutopartHistoryFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => (data ?? {}) as { page?: number })
  .handler(async ({ data }) => {
    try {
      return {
        ok: true as const,
        data: await master.getPortalAutopartHistory(await requireUserId(), data.page ?? 1),
      };
    } catch (error) {
      return toError(error);
    }
  });
