/**
 * Autopart historic purchase import (561L + SLRB).
 *
 * AB is NOT the accounting system and does not manage customer credit control.
 * Autopart/MAM remains authoritative for ledger, credit limits, and available credit.
 * Historic lines are NOT AB Orders.
 */
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type AutopartHistoricDocumentType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";
import { normalizeAutopartCustomerCode } from "@/server/companies/autopart-account";
import { parseAutopart561l } from "@/domain/autopart-561l";
import { parseAutopartSlrb } from "@/domain/autopart-slrb";
import {
  autopartAccountsEqual,
  normaliseAccountToken,
} from "@/domain/autopart-report-money";
import { moneyToString, moneyZero, parseMoney } from "@/domain/money";
import {
  loadCompanyGlobalAutopartHistory,
  purchaseDataStatus,
} from "@/server/companies/autopart-internal-history";
import {
  SAFE_HISTORIC_DOCUMENT_UPSERT_CHUNK,
  SAFE_HISTORIC_LINE_UPSERT_CHUNK,
  SAFE_IN_LIST_CHUNK,
  SAFE_SKU_EQUALS_CHUNK,
  findManyByInChunks,
} from "@/server/db/prisma-in-chunks";

export type ImportIssue = {
  severity: "BLOCKING" | "WARNING" | "INFO";
  code: string;
  message: string;
};

export type HistoricImportProgress = {
  phase: string;
  message: string;
  current: number;
  total: number;
  documentsWritten: number;
  linesWritten: number;
  updatedAt: string;
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function dateOnlyToUtcNoon(dateOnly: string | null | undefined): Date | null {
  if (!dateOnly || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  return new Date(`${dateOnly}T12:00:00.000Z`);
}

/** Active PROCESSING younger than this is treated as genuinely in-flight. */
const HISTORIC_PROCESSING_STALE_MS = 15 * 60 * 1000;

function formatUkDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sqlDecimalOrNull(value: string | null | undefined): Prisma.Sql {
  if (value == null) return Prisma.sql`NULL`;
  const cleaned = value.trim();
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return Prisma.sql`NULL`;
  return Prisma.sql`${cleaned}::decimal`;
}

/**
 * Authoritative success for a historic file pair.
 * COMMITTED alone is insufficient — older builds created COMMITTED before writes.
 */
export async function hasSuccessfulHistoricImport(input: {
  companyId: string;
  fileHash561l: string;
  fileHashSlrb: string;
}): Promise<{
  id: string;
  completedAt: Date;
  rowsImported: number;
  rowsUpdated: number;
} | null> {
  const candidates = await prisma.autopartCustomerImportRun.findMany({
    where: {
      companyId: input.companyId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      fileHash: input.fileHash561l,
      fileHashSlrb: input.fileHashSlrb,
      completedAt: { not: null },
      dryRun: false,
    },
    orderBy: { completedAt: "desc" },
    select: {
      id: true,
      completedAt: true,
      rowsImported: true,
      rowsUpdated: true,
      diagnostics: true,
    },
  });

  for (const run of candidates) {
    if (!run.completedAt) continue;
    const counters = (run.rowsImported ?? 0) + (run.rowsUpdated ?? 0);
    if (counters > 0) {
      return {
        id: run.id,
        completedAt: run.completedAt,
        rowsImported: run.rowsImported,
        rowsUpdated: run.rowsUpdated,
      };
    }
    const [docs, lines] = await Promise.all([
      prisma.autopartSalesDocument.count({
        where: { companyId: input.companyId, importRunId: run.id },
      }),
      prisma.autopartSalesLine.count({
        where: { companyId: input.companyId, importRunId: run.id },
      }),
    ]);
    if (docs + lines > 0) {
      return {
        id: run.id,
        completedAt: run.completedAt,
        rowsImported: run.rowsImported,
        rowsUpdated: run.rowsUpdated,
      };
    }
    // Phantom COMMITTED (pre-fix create-before-write) — reclassify so retry is safe.
    try {
      await prisma.autopartCustomerImportRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          diagnostics: {
            phantomCommitted: true,
            failure: {
              name: "PhantomCommittedRun",
              message:
                "Import run was marked COMMITTED without persisted historic rows; reclassified as FAILED for safe retry.",
            },
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      console.error("[ab:autopart-history-import] failed to repair phantom COMMITTED", {
        runId: run.id,
        err,
      });
    }
  }
  return null;
}

async function recoverStaleHistoricProcessing(companyId: string): Promise<number> {
  const cutoff = new Date(Date.now() - HISTORIC_PROCESSING_STALE_MS);
  const result = await prisma.autopartCustomerImportRun.updateMany({
    where: {
      companyId,
      type: "HISTORY_561L_SLRB",
      status: "PROCESSING",
      createdAt: { lt: cutoff },
    },
    data: {
      status: "FAILED",
      completedAt: new Date(),
    },
  });
  return result.count;
}

async function findActiveHistoricProcessing(companyId: string) {
  const cutoff = new Date(Date.now() - HISTORIC_PROCESSING_STALE_MS);
  return prisma.autopartCustomerImportRun.findFirst({
    where: {
      companyId,
      type: "HISTORY_561L_SLRB",
      status: "PROCESSING",
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
}

async function findLatestFailedHistoricImport(input: {
  companyId: string;
  fileHash561l: string;
  fileHashSlrb: string;
}) {
  return prisma.autopartCustomerImportRun.findFirst({
    where: {
      companyId: input.companyId,
      type: "HISTORY_561L_SLRB",
      status: "FAILED",
      fileHash: input.fileHash561l,
      fileHashSlrb: input.fileHashSlrb,
      dryRun: false,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, completedAt: true, createdAt: true, diagnostics: true },
  });
}

async function assertStaffCompanyAccess(actorUserId: string, companyId: string, permission: "companies.view" | "companies.edit") {
  const profile = await requireSystemPermission(actorUserId, permission);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade customers cannot manage Autopart history imports", "FORBIDDEN", 403);
  }
  if (hasPermission(profile, "admin.access") || hasPermission(profile, "sales.view_all_accounts")) {
    return profile;
  }
  const ok = await canAccessCompanyAsSales(profile, companyId);
  if (!ok) throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
  return profile;
}

async function loadVerifiedCompany(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);
  return company;
}

async function loadAcceptedAccounts(companyId: string, verifiedCode: string): Promise<Set<string>> {
  const aliases = await prisma.autopartCustomerAccountAlias.findMany({
    where: { companyId },
    select: { alias: true },
  });
  const set = new Set<string>();
  const v = normaliseAccountToken(verifiedCode);
  if (v) set.add(v);
  for (const a of aliases) {
    const n = normaliseAccountToken(a.alias);
    if (n) set.add(n);
  }
  return set;
}

export type HistoricAccountMatchStatus =
  | "MATCHED"
  | "MATCHED_ALIAS"
  | "MATCHED_TRUNCATED"
  | "MATCHED_REPORT_CUSTOMER"
  | "ALIAS_REQUIRED"
  | "AMBIGUOUS_TRUNCATED"
  | "MULTIPLE_ACCOUNTS"
  | "MISMATCH"
  | "NO_ACCOUNT";

/**
 * Source-aware historic account identity.
 * Do NOT flatten these into one set of equivalent full customer codes —
 * 561L `.Acct.` is a legacy shortened representation of the same customer.
 */
export type HistoricAccountIdentity = {
  /** `[Start Customer XXX]` from 561L and/or SLRB selection parameters. */
  reportCustomer: string | null;
  /** Body-level 561L `.Acct.` values (often 7-char, e.g. YORKMOT). */
  rowAccounts561l: string[];
  /** SLRB A/C values (full codes, e.g. YORKMOTO). */
  accountsSlrb: string[];
  /** Confirmed 561L account field width when known (native layout = 7). */
  accountFieldWidth561l: number | null;
};

function uniqAccounts(codes: Array<string | null | undefined>): string[] {
  return [
    ...new Set(codes.map((a) => normaliseAccountToken(a)).filter(Boolean)),
  ] as string[];
}

/** True when `short` is the expected N-char printed form of `full`. */
function isShortAccountOf(short: string, full: string, width: number): boolean {
  return short.length === width && full.length >= width && full.slice(0, width) === short;
}

/**
 * Derive the expected 561L representation of a full account.
 * Prefer parser-confirmed width; else infer from consistent row accounts that
 * are a proper prefix of the full account (never blind global prefix matching).
 */
function expected561lForm(
  fullAccount: string,
  width: number | null,
  rowAccounts: string[],
): { width: number; expected: string } | null {
  if (width != null && width >= 4 && width <= 12 && fullAccount.length >= width) {
    return { width, expected: fullAccount.slice(0, width) };
  }
  if (rowAccounts.length === 0) return null;
  const lengths = new Set(rowAccounts.map((r) => r.length));
  if (lengths.size !== 1) return null;
  const w = rowAccounts[0]!.length;
  if (w < 4 || w > 12 || w >= fullAccount.length) return null;
  if (!rowAccounts.every((r) => isShortAccountOf(r, fullAccount, w))) return null;
  return { width: w, expected: fullAccount.slice(0, w) };
}

function rowAccountAcceptable(
  row: string,
  fullAccount: string,
  acceptedAccounts: Set<string>,
  width: number | null,
  allRows: string[],
): boolean {
  if (row === fullAccount || acceptedAccounts.has(row)) return true;
  const form = expected561lForm(fullAccount, width, allRows.length ? allRows : [row]);
  if (form && isShortAccountOf(row, fullAccount, form.width)) return true;
  // Also accept when parser width alone confirms the slice
  if (width != null && isShortAccountOf(row, fullAccount, width)) return true;
  return false;
}

async function truncatedFormAmbiguous(input: {
  companyId: string;
  truncated: string;
  width: number;
}): Promise<boolean> {
  const conflicts = await prisma.company.findMany({
    where: {
      id: { not: input.companyId },
      autopartCustomerCodeVerifiedAt: { not: null },
      autopartCustomerCode: { not: null },
    },
    select: { autopartCustomerCode: true },
  });
  return conflicts.some((c) => {
    const code = normaliseAccountToken(c.autopartCustomerCode);
    return Boolean(
      code && code.length >= input.width && code.slice(0, input.width) === input.truncated,
    );
  });
}

/**
 * Resolve 561L/SLRB account identity against a verified company.
 *
 * Source-aware rules (not a flat set of equivalent codes):
 * - Report `[Start Customer]` and SLRB A/C are full account identities.
 * - 561L `.Acct.` may be the legacy shortened form (e.g. YORKMOT for YORKMOTO)
 *   and is validated as that representation — never requires an alias.
 * - Truncation matching applies only to 561L (or legacy pairs with no full
 *   identity). SLRB conflicting full codes still block.
 */
export async function resolveHistoricReportAccountMatch(input: {
  companyId: string;
  verifiedCode: string | null;
  acceptedAccounts: Set<string>;
  /** @deprecated Prefer identity.* — kept for older call sites/tests. */
  detectedAccounts?: string[];
  /** @deprecated Prefer identity.accountFieldWidth561l */
  accountFieldWidth?: number | null;
  reportStartCustomer?: string | null;
  reportEndCustomer?: string | null;
  rowAccounts561l?: string[];
  accountsSlrb?: string[];
  identity?: Partial<HistoricAccountIdentity>;
}): Promise<{
  status: HistoricAccountMatchStatus;
  sourceAccount: string | null;
  reportCustomer: string | null;
  rowAccount: string | null;
  slrbAccount: string | null;
  verifiedAccount: string | null;
  accountFieldWidth: number | null;
  ok: boolean;
  message: string | null;
  suggestedAlias: string | null;
  multipleAccounts: string[];
}> {
  const verified = input.verifiedCode ? normaliseAccountToken(input.verifiedCode) : null;
  const reportCustomer =
    normaliseAccountToken(input.identity?.reportCustomer ?? input.reportStartCustomer) ?? null;
  const rowAccounts = uniqAccounts([
    ...(input.identity?.rowAccounts561l ?? input.rowAccounts561l ?? []),
  ]);
  const accountsSlrb = uniqAccounts([
    ...(input.identity?.accountsSlrb ?? input.accountsSlrb ?? []),
  ]);
  // Legacy flat detectedAccounts: only used when source arrays were not provided
  const legacyFlat = uniqAccounts(input.detectedAccounts ?? []);
  const usedLegacyFlat =
    rowAccounts.length === 0 &&
    accountsSlrb.length === 0 &&
    !reportCustomer &&
    legacyFlat.length > 0;
  const effectiveRows = usedLegacyFlat ? legacyFlat : rowAccounts;
  const effectiveSlrb = usedLegacyFlat ? [] : accountsSlrb;
  const width =
    input.identity?.accountFieldWidth561l ?? input.accountFieldWidth ?? null;

  const base = {
    reportCustomer,
    rowAccount: effectiveRows.length === 1 ? effectiveRows[0]! : effectiveRows[0] ?? null,
    slrbAccount: effectiveSlrb.length === 1 ? effectiveSlrb[0]! : effectiveSlrb[0] ?? null,
    verifiedAccount: verified,
    accountFieldWidth: width,
    suggestedAlias: null as string | null,
    multipleAccounts: [] as string[],
  };

  const hasAny =
    Boolean(reportCustomer) || effectiveRows.length > 0 || effectiveSlrb.length > 0;
  if (!hasAny) {
    return {
      status: "NO_ACCOUNT",
      sourceAccount: null,
      ...base,
      ok: false,
      message: "No Autopart account codes detected in the uploaded reports.",
    };
  }

  if (!verified) {
    return {
      status: "NO_ACCOUNT",
      sourceAccount: reportCustomer ?? effectiveSlrb[0] ?? effectiveRows[0] ?? null,
      ...base,
      ok: false,
      message: "Company Autopart account must be staff-verified before historic import.",
    };
  }

  // Multiple distinct 561L row accounts that are not all the same shortened form
  if (effectiveRows.length > 1) {
    const form = expected561lForm(verified, width, effectiveRows);
    const allOk = effectiveRows.every(
      (r) =>
        r === verified ||
        input.acceptedAccounts.has(r) ||
        (form != null && isShortAccountOf(r, verified, form.width)),
    );
    if (!allOk) {
      return {
        status: "MULTIPLE_ACCOUNTS",
        sourceAccount: null,
        ...base,
        ok: false,
        message: `Multiple 561L row accounts detected: ${effectiveRows.join(", ")}. Per-customer historic import expects a single customer.`,
        multipleAccounts: effectiveRows,
      };
    }
  }

  // Multiple distinct SLRB full accounts
  if (effectiveSlrb.length > 1) {
    const allAccepted = effectiveSlrb.every((a) => input.acceptedAccounts.has(a));
    if (!allAccepted) {
      return {
        status: "MULTIPLE_ACCOUNTS",
        sourceAccount: null,
        ...base,
        ok: false,
        message: `Multiple SLRB accounts detected: ${effectiveSlrb.join(", ")}. Per-customer historic import expects a single customer.`,
        multipleAccounts: effectiveSlrb,
      };
    }
  }

  // Report customer vs SLRB full-account conflict (both are full identities)
  if (
    reportCustomer &&
    effectiveSlrb.length > 0 &&
    effectiveSlrb.some((a) => a !== reportCustomer && !input.acceptedAccounts.has(a))
  ) {
    const foreign = effectiveSlrb.filter((a) => a !== reportCustomer);
    return {
      status: "MISMATCH",
      sourceAccount: reportCustomer,
      ...base,
      ok: false,
      message: `Report customer ${reportCustomer} conflicts with SLRB account(s) ${foreign.join(", ")}.`,
      multipleAccounts: uniqAccounts([reportCustomer, ...effectiveSlrb]),
    };
  }

  // ── Resolve against verified / aliases using FULL identity sources ─────────

  const fullExact =
    (reportCustomer && (reportCustomer === verified || input.acceptedAccounts.has(reportCustomer))) ||
    effectiveSlrb.some((a) => a === verified || input.acceptedAccounts.has(a));

  if (reportCustomer && reportCustomer !== verified && !input.acceptedAccounts.has(reportCustomer)) {
    return {
      status: "ALIAS_REQUIRED",
      sourceAccount: reportCustomer,
      ...base,
      ok: false,
      message: `Account alias required: report customer is ${reportCustomer}, verified account is ${verified}.`,
      suggestedAlias: reportCustomer,
    };
  }

  // SLRB full account differs from verified while no report-customer match
  if (!fullExact && effectiveSlrb.length === 1) {
    const slrb = effectiveSlrb[0]!;
    if (slrb !== verified && !input.acceptedAccounts.has(slrb)) {
      // Legacy pair: SLRB also printed the 561L shortened form only
      const form = expected561lForm(verified, width, effectiveRows.length ? effectiveRows : [slrb]);
      const slrbIsShort =
        form != null &&
        isShortAccountOf(slrb, verified, form.width) &&
        (effectiveRows.length === 0 ||
          effectiveRows.every((r) => isShortAccountOf(r, verified, form.width)));
      if (!slrbIsShort) {
        return {
          status: "ALIAS_REQUIRED",
          sourceAccount: slrb,
          ...base,
          ok: false,
          message: `Account alias required: SLRB account is ${slrb}, verified account is ${verified}.`,
          suggestedAlias: slrb,
        };
      }
      // fall through to truncated resolution below
    }
  }

  if (fullExact) {
    const viaAlias =
      (Boolean(reportCustomer) && reportCustomer !== verified && input.acceptedAccounts.has(reportCustomer!)) ||
      effectiveSlrb.some((a) => a !== verified && input.acceptedAccounts.has(a));
    const canonical =
      reportCustomer && (reportCustomer === verified || input.acceptedAccounts.has(reportCustomer))
        ? reportCustomer
        : effectiveSlrb.find((a) => a === verified || input.acceptedAccounts.has(a)) ?? verified;

    // 561L shortened rows must be the expected representation of canonical
    const badRows = effectiveRows.filter(
      (r) => !rowAccountAcceptable(r, canonical, input.acceptedAccounts, width, effectiveRows),
    );
    if (badRows.length) {
      return {
        status: "MISMATCH",
        sourceAccount: canonical,
        ...base,
        ok: false,
        message: `Full report account ${canonical} is valid, but 561L row account(s) ${badRows.join(", ")} are not the expected shortened representation.`,
        multipleAccounts: badRows,
      };
    }

    // SLRB must not introduce a foreign full account once canonical is known
    const badSlrb = effectiveSlrb.filter(
      (a) =>
        a !== canonical &&
        !input.acceptedAccounts.has(a) &&
        !rowAccountAcceptable(a, canonical, input.acceptedAccounts, width, effectiveRows),
    );
    if (badSlrb.length) {
      return {
        status: "MISMATCH",
        sourceAccount: canonical,
        ...base,
        ok: false,
        message: `SLRB account(s) ${badSlrb.join(", ")} conflict with report customer ${canonical}.`,
        multipleAccounts: badSlrb,
      };
    }

    const form = expected561lForm(canonical, width, effectiveRows);
    const shortened =
      form != null &&
      effectiveRows.length > 0 &&
      effectiveRows.every((r) => isShortAccountOf(r, canonical, form.width));

    if (viaAlias) {
      return {
        status: "MATCHED_ALIAS",
        sourceAccount: canonical,
        ...base,
        accountFieldWidth: form?.width ?? width,
        ok: true,
        message: `Matched via verified account alias (${canonical}).`,
      };
    }
    if (reportCustomer && reportCustomer === verified) {
      return {
        status: "MATCHED_REPORT_CUSTOMER",
        sourceAccount: verified,
        ...base,
        accountFieldWidth: form?.width ?? width,
        ok: true,
        message: shortened
          ? `Matched — report generated for ${verified}. 561L uses a ${form!.width}-character account field (${form!.expected}).`
          : `Matched — report generated for verified Autopart account ${verified}.`,
      };
    }
    return {
      status: "MATCHED",
      sourceAccount: verified,
      ...base,
      reportCustomer: reportCustomer ?? (effectiveSlrb.includes(verified) ? verified : null),
      accountFieldWidth: form?.width ?? width,
      ok: true,
      message: shortened
        ? `Matched verified Autopart account ${verified}. 561L uses a shortened ${form!.width}-character account field (${form!.expected}).`
        : `Matched verified Autopart account ${verified}.`,
    };
  }

  // ── No full identity matched verified: 561L-only (or legacy short SLRB) truncation ──
  const shortCandidates = uniqAccounts([
    ...effectiveRows,
    ...effectiveSlrb.filter((a) => {
      const form = expected561lForm(verified, width, [a]);
      return form != null && isShortAccountOf(a, verified, form.width);
    }),
  ]);

  if (shortCandidates.length === 1 && verified) {
    const reportAcct = shortCandidates[0]!;
    const form = expected561lForm(verified, width, [reportAcct]);
    if (form && isShortAccountOf(reportAcct, verified, form.width)) {
      // Foreign SLRB full codes already handled above; only short/legacy remains
      const ambiguous = await truncatedFormAmbiguous({
        companyId: input.companyId,
        truncated: reportAcct,
        width: form.width,
      });
      if (ambiguous) {
        return {
          status: "AMBIGUOUS_TRUNCATED",
          sourceAccount: reportAcct,
          ...base,
          accountFieldWidth: form.width,
          ok: false,
          message: `Ambiguous truncated account ${reportAcct} — multiple verified Autopart accounts share this ${form.width}-character report form. Resolve manually (alias or account correction).`,
        };
      }
      return {
        status: "MATCHED_TRUNCATED",
        sourceAccount: reportAcct,
        ...base,
        accountFieldWidth: form.width,
        ok: true,
        message: `Matched — Autopart report uses shortened account code (${reportAcct} → ${verified})`,
      };
    }
  }

  // Single foreign full-looking code (legacy flat / SLRB) → alias required
  const foreignFull = uniqAccounts([
    ...(reportCustomer ? [reportCustomer] : []),
    ...effectiveSlrb,
    ...(usedLegacyFlat ? legacyFlat : []),
  ]).filter((a) => a !== verified && !input.acceptedAccounts.has(a));

  if (foreignFull.length === 1 && effectiveRows.every((r) => r === foreignFull[0])) {
    return {
      status: "ALIAS_REQUIRED",
      sourceAccount: foreignFull[0]!,
      ...base,
      ok: false,
      message: `Account alias required: report shows ${foreignFull[0]}, verified account is ${verified}.`,
      suggestedAlias: foreignFull[0]!,
    };
  }

  if (usedLegacyFlat && legacyFlat.length === 1 && legacyFlat[0] !== verified) {
    const only = legacyFlat[0]!;
    const form = expected561lForm(verified, width, [only]);
    if (!(form && isShortAccountOf(only, verified, form.width))) {
      return {
        status: "ALIAS_REQUIRED",
        sourceAccount: only,
        ...base,
        ok: false,
        message: `Account alias required: report shows ${only}, verified account is ${verified}.`,
        suggestedAlias: only,
      };
    }
  }

  const shown = uniqAccounts([
    reportCustomer,
    ...effectiveSlrb,
    ...effectiveRows,
  ]);
  return {
    status: "MISMATCH",
    sourceAccount: shown[0] ?? null,
    ...base,
    ok: false,
    message: `Detected account(s) ${shown.join(", ") || "—"} do not match verified account ${verified}.`,
    suggestedAlias: shown.length === 1 ? shown[0]! : null,
    multipleAccounts: shown.length > 1 ? shown : [],
  };
}

async function resolveSkuMap(skus: string[]): Promise<Map<string, string>> {
  const cleaned = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!cleaned.length) return map;
  // Batch exact case-insensitive SKU match — no fuzzy / prefix matching.
  // Chunk OR-equals binds (SAFE_SKU_EQUALS_CHUNK) well below Postgres 32_767 ceiling.
  const byUpper = new Map<string, string>();
  for (let i = 0; i < cleaned.length; i += SAFE_SKU_EQUALS_CHUNK) {
    const chunk = cleaned.slice(i, i + SAFE_SKU_EQUALS_CHUNK);
    const variants = await prisma.productVariant.findMany({
      where: {
        OR: chunk.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })),
      },
      select: { id: true, sku: true },
    });
    for (const v of variants) byUpper.set(v.sku.trim().toUpperCase(), v.id);
  }
  for (const sku of cleaned) {
    const id = byUpper.get(sku.trim().toUpperCase());
    if (id) map.set(sku.trim().toUpperCase(), id);
  }
  return map;
}

// ─── Workspace summary ───────────────────────────────────────────────────────

export async function getCompanyAutopartHistoryWorkspace(actorUserId: string, companyId: string) {
  await assertStaffCompanyAccess(actorUserId, companyId, "companies.view");
  const company = await loadVerifiedCompany(companyId);
  const verified = Boolean(company.autopartCustomerCode && company.autopartCustomerCodeVerifiedAt);

  const [lineCount, docCount, lastHistory, aliases, topSkus, skuGroups] =
    await Promise.all([
      prisma.autopartSalesLine.count({ where: { companyId } }),
      prisma.autopartSalesDocument.count({ where: { companyId } }),
      prisma.autopartCustomerImportRun.findFirst({
        where: {
          companyId,
          type: "HISTORY_561L_SLRB",
          status: "COMMITTED",
          completedAt: { not: null },
          dryRun: false,
          OR: [{ rowsImported: { gt: 0 } }, { rowsUpdated: { gt: 0 } }],
        },
        orderBy: { completedAt: "desc" },
      }),
      prisma.autopartCustomerAccountAlias.findMany({
        where: { companyId },
        orderBy: { alias: "asc" },
        select: {
          id: true,
          alias: true,
          verifiedAt: true,
          note: true,
          verifiedBy: { select: { name: true, email: true } },
        },
      }),
      prisma.autopartSalesLine.groupBy({
        by: ["sku"],
        where: { companyId },
        _sum: { units: true, salesNet: true },
        orderBy: { _sum: { salesNet: "desc" } },
        take: 10,
      }),
      prisma.autopartSalesLine.groupBy({
        by: ["sku"],
        where: { companyId },
      }),
    ]);

  const aggregates = await prisma.autopartSalesLine.aggregate({
    where: { companyId },
    _sum: { units: true, salesNet: true },
    _count: { _all: true },
  });

  const lastDated = await prisma.autopartSalesDocument.findFirst({
    where: { companyId, documentDate: { not: null } },
    orderBy: { documentDate: "desc" },
    select: { documentDate: true },
  });

  const globalHistory = await loadCompanyGlobalAutopartHistory(actorUserId, companyId);

  return {
    company: {
      id: company.id,
      name: company.name,
      autopartCustomerCode: company.autopartCustomerCode,
      verified,
    },
    purchaseDataStatus: purchaseDataStatus({
      restricted: globalHistory.restricted,
      globalLines: globalHistory.lineCount,
      legacyLines: lineCount,
    }),
    globalHistory,
    historic: {
      imported: lineCount > 0,
      lineCount,
      documentCount: docCount,
      netSpend: moneyToString(
        parseMoney(String(aggregates._sum.salesNet ?? 0)) ?? moneyZero(),
        2,
      ),
      netUnits: Number(aggregates._sum.units ?? 0),
      productsPurchased: skuGroups.length,
      lastImportedAt: lastHistory?.completedAt?.toISOString() ?? null,
      lastHistoricPurchaseDate: lastDated?.documentDate
        ? lastDated.documentDate.toISOString().slice(0, 10)
        : null,
    },
    aliases: aliases.map((a) => ({
      id: a.id,
      alias: a.alias,
      verifiedAt: a.verifiedAt.toISOString(),
      note: a.note,
      verifiedByName: a.verifiedBy.name ?? a.verifiedBy.email,
    })),
    topProducts: topSkus.map((row) => ({
      sku: row.sku,
      netUnits: Number(row._sum.units ?? 0),
      netSpend: moneyToString(parseMoney(String(row._sum.salesNet ?? 0)) ?? moneyZero(), 2),
    })),
  };
}

// ─── Account alias ───────────────────────────────────────────────────────────

const aliasSchema = z.object({
  companyId: z.string().cuid(),
  alias: z.string().min(1).max(80),
  note: z.string().max(500).optional().nullable(),
});

export async function verifyAutopartAccountAlias(actorUserId: string, raw: unknown) {
  await assertStaffCompanyAccess(actorUserId, (raw as { companyId: string }).companyId, "companies.edit");
  const input = aliasSchema.parse(raw);
  const company = await loadVerifiedCompany(input.companyId);
  if (!company.autopartCustomerCode || !company.autopartCustomerCodeVerifiedAt) {
    throw new AuthError(
      "Verify the Autopart customer account before adding aliases",
      "AUTOPART_NOT_VERIFIED",
      400,
    );
  }
  const alias = normaliseAccountToken(input.alias);
  if (!alias) throw new AuthError("Invalid alias", "VALIDATION", 400);
  if (autopartAccountsEqual(alias, company.autopartCustomerCode)) {
    throw new AuthError("Alias matches the verified account code — not needed", "VALIDATION", 400);
  }

  const row = await prisma.autopartCustomerAccountAlias.upsert({
    where: { companyId_alias: { companyId: input.companyId, alias } },
    create: {
      companyId: input.companyId,
      alias,
      verifiedById: actorUserId,
      note: input.note ?? null,
    },
    update: {
      verifiedById: actorUserId,
      verifiedAt: new Date(),
      note: input.note ?? null,
    },
  });

  await recordAuditEvent({
    action: "autopart.account_alias_verified",
    entityType: "Company",
    entityId: input.companyId,
    actorUserId,
    companyId: input.companyId,
    after: { alias, aliasId: row.id },
  });

  return getCompanyAutopartHistoryWorkspace(actorUserId, input.companyId);
}

// ─── Historic import preview / confirm ───────────────────────────────────────

const historyPreviewSchema = z.object({
  companyId: z.string().cuid(),
  file561l: z.string().min(1),
  fileSlrb: z.string().min(1),
  filename561l: z.string().max(260).optional(),
  filenameSlrb: z.string().max(260).optional(),
});

export async function previewAutopartHistoryImport(actorUserId: string, raw: unknown) {
  await assertStaffCompanyAccess(actorUserId, (raw as { companyId: string }).companyId, "companies.edit");
  const input = historyPreviewSchema.parse(raw);
  return buildHistoryPreview(actorUserId, input, { persistRun: true });
}

async function buildHistoryPreview(
  actorUserId: string,
  input: z.infer<typeof historyPreviewSchema>,
  opts: { persistRun: boolean },
) {
  const company = await loadVerifiedCompany(input.companyId);
  const issues: ImportIssue[] = [];

  if (!company.autopartCustomerCode || !company.autopartCustomerCodeVerifiedAt) {
    issues.push({
      severity: "BLOCKING",
      code: "AUTOPART_NOT_VERIFIED",
      message: "Company Autopart account must be staff-verified before historic import.",
    });
  }

  const parsed561 = parseAutopart561l(input.file561l);
  const parsedSlrb = parseAutopartSlrb(input.fileSlrb);

  if (!parsed561.headerFound) {
    issues.push({
      severity: "BLOCKING",
      code: "UNRECOGNISED_561L",
      message:
        parsed561.errors[0] ??
        "561L report format not recognised. Expected an Autopart 561L report containing: Acct / Inv & Ln / Part Number / Description / Units / Sales.",
    });
  }
  if (!parsedSlrb.headerFound) {
    issues.push({
      severity: "BLOCKING",
      code: "UNRECOGNISED_SLRB",
      message:
        parsedSlrb.errors[0] ??
        "SLRB report format not recognised. Expected an Autopart SLRB report containing: A/C / Type / Ref / Date / Tot Goods / Tot VAT / Total / Run Bal.",
    });
  }

  const verifiedCode = company.autopartCustomerCode
    ? normaliseAccountToken(company.autopartCustomerCode)
    : null;
  const accepted = verifiedCode
    ? await loadAcceptedAccounts(input.companyId, verifiedCode)
    : new Set<string>();

  const reportStartCustomer =
    parsed561.reportStartCustomer ?? parsedSlrb.reportStartCustomer ?? null;
  const reportEndCustomer =
    parsed561.reportEndCustomer ?? parsedSlrb.reportEndCustomer ?? null;
  // Source-aware identity — do NOT flatten 561L short + SLRB full into one set.
  const identity: HistoricAccountIdentity = {
    reportCustomer: reportStartCustomer,
    rowAccounts561l: parsed561.detectedAccounts,
    accountsSlrb: parsedSlrb.detectedAccounts,
    accountFieldWidth561l: parsed561.accountFieldWidth,
  };
  const accountMatch = await resolveHistoricReportAccountMatch({
    companyId: input.companyId,
    verifiedCode,
    acceptedAccounts: accepted,
    identity,
    reportStartCustomer,
    reportEndCustomer,
    rowAccounts561l: identity.rowAccounts561l,
    accountsSlrb: identity.accountsSlrb,
    accountFieldWidth: identity.accountFieldWidth561l,
  });
  // Display set: full identities first, then 561L row form (informational).
  const detected = [
    ...new Set(
      [
        accountMatch.reportCustomer,
        accountMatch.slrbAccount,
        ...identity.accountsSlrb,
        ...identity.rowAccounts561l,
      ].filter(Boolean),
    ),
  ] as string[];
  if (!accountMatch.ok) {
    issues.push({
      severity: "BLOCKING",
      code:
        accountMatch.status === "ALIAS_REQUIRED"
          ? "ACCOUNT_ALIAS_REQUIRED"
          : accountMatch.status === "AMBIGUOUS_TRUNCATED"
            ? "ACCOUNT_AMBIGUOUS_TRUNCATED"
            : accountMatch.status === "MULTIPLE_ACCOUNTS"
              ? "MULTIPLE_ACCOUNTS"
              : accountMatch.status === "NO_ACCOUNT"
                ? "NO_ACCOUNT"
                : "ACCOUNT_MISMATCH",
      message: accountMatch.message ?? "Autopart account mismatch.",
    });
  } else if (
    accountMatch.status === "MATCHED_TRUNCATED" ||
    accountMatch.status === "MATCHED_REPORT_CUSTOMER" ||
    (accountMatch.status === "MATCHED" &&
      accountMatch.rowAccount &&
      accountMatch.verifiedAccount &&
      accountMatch.rowAccount !== accountMatch.verifiedAccount)
  ) {
    issues.push({
      severity: "INFO",
      code:
        accountMatch.status === "MATCHED_REPORT_CUSTOMER"
          ? "ACCOUNT_REPORT_CUSTOMER_MATCH"
          : accountMatch.status === "MATCHED_TRUNCATED"
            ? "ACCOUNT_TRUNCATED_MATCH"
            : "ACCOUNT_561L_SHORT_FIELD",
      message: accountMatch.message ?? "Matched report account.",
    });
  }

  const hash561 = sha256(input.file561l);
  const hashSlrb = sha256(input.fileSlrb);

  await recoverStaleHistoricProcessing(input.companyId);
  const activeProcessing = await findActiveHistoricProcessing(input.companyId);
  const prior = await hasSuccessfulHistoricImport({
    companyId: input.companyId,
    fileHash561l: hash561,
    fileHashSlrb: hashSlrb,
  });
  const priorFailed = prior
    ? null
    : await findLatestFailedHistoricImport({
        companyId: input.companyId,
        fileHash561l: hash561,
        fileHashSlrb: hashSlrb,
      });

  if (activeProcessing) {
    issues.push({
      severity: "BLOCKING",
      code: "IMPORT_IN_PROGRESS",
      message: "Import already in progress. Wait for it to finish, or retry if it was abandoned.",
    });
  } else if (prior) {
    issues.push({
      severity: "INFO",
      code: "ALREADY_IMPORTED",
      message: `This exact file pair was previously imported successfully on ${formatUkDateTime(prior.completedAt)}. Re-import is idempotent.`,
    });
  } else if (priorFailed) {
    issues.push({
      severity: "WARNING",
      code: "PREVIOUS_ATTEMPT_FAILED",
      message:
        "Previous import attempt failed. No successful import exists for this file pair. Confirm Import will retry safely.",
    });
  }

  // Document matching: company + exact document reference (and type where both known)
  const slrbByRef = new Map(
    parsedSlrb.documents.map((d) => [d.documentReference!, d]),
  );
  const lineRefs = new Set(
    parsed561.lines.map((l) => l.documentReference!).filter(Boolean),
  );
  let matchedDocs = 0;
  let unmatched561Docs = 0;
  for (const ref of lineRefs) {
    if (slrbByRef.has(ref)) matchedDocs += 1;
    else unmatched561Docs += 1;
  }
  let slrbWithoutLines = 0;
  for (const ref of slrbByRef.keys()) {
    if (!lineRefs.has(ref)) slrbWithoutLines += 1;
  }
  if (unmatched561Docs) {
    issues.push({
      severity: "WARNING",
      code: "UNMATCHED_561L_DOCS",
      message: `${unmatched561Docs} 561L document(s) have no matching SLRB header.`,
    });
  }
  if (slrbWithoutLines) {
    issues.push({
      severity: "INFO",
      code: "SLRB_WITHOUT_LINES",
      message: `${slrbWithoutLines} SLRB document(s) have no 561L product lines.`,
    });
  }

  const skus = parsed561.lines.map((l) => l.partNumber!).filter(Boolean);
  const skuMap = await resolveSkuMap(skus);
  const uniqueSkus = [...new Set(skus.map((s) => s.trim().toUpperCase()))];
  const matchedSkus = uniqueSkus.filter((s) => skuMap.has(s));
  const unmatchedSkus = uniqueSkus.filter((s) => !skuMap.has(s));
  if (unmatchedSkus.length) {
    issues.push({
      severity: "INFO",
      code: "SKU_NOT_IN_CATALOGUE",
      message: `${unmatchedSkus.length} historic SKU(s) are not in the AB catalogue (expected for discontinued products).`,
    });
  }

  let linesWithDates = 0;
  let linesWithoutDates = 0;
  for (const line of parsed561.lines) {
    const doc = line.documentReference ? slrbByRef.get(line.documentReference) : null;
    if (doc?.documentDate) linesWithDates += 1;
    else linesWithoutDates += 1;
  }

  const blocking = issues.some((i) => i.severity === "BLOCKING");
  const preview = {
    companyId: company.id,
    companyName: company.name,
    verifiedAccount: verifiedCode,
    /** Clean detected Autopart account codes only (never financial values). */
    detectedAccounts: detected,
    reportCustomer: accountMatch.reportCustomer ?? reportStartCustomer,
    rowAccount561l: accountMatch.rowAccount,
    slrbAccount: accountMatch.slrbAccount,
    sourceAccount: accountMatch.sourceAccount,
    accountMatch: {
      status: accountMatch.status,
      sourceAccount: accountMatch.sourceAccount,
      reportCustomer: accountMatch.reportCustomer,
      rowAccount: accountMatch.rowAccount,
      slrbAccount: accountMatch.slrbAccount,
      verifiedAccount: accountMatch.verifiedAccount,
      accountFieldWidth: accountMatch.accountFieldWidth,
      message: accountMatch.message,
      suggestedAlias: accountMatch.suggestedAlias,
      multipleAccounts: accountMatch.multipleAccounts,
      ok: accountMatch.ok,
    },
    fileHash561l: hash561,
    fileHashSlrb: hashSlrb,
    alreadyImported: Boolean(prior),
    priorImport: prior
      ? {
          status: "COMMITTED" as const,
          runId: prior.id,
          completedAt: prior.completedAt.toISOString(),
        }
      : priorFailed
        ? {
            status: "FAILED" as const,
            runId: priorFailed.id,
            completedAt: priorFailed.completedAt?.toISOString() ?? null,
          }
        : activeProcessing
          ? {
              status: "PROCESSING" as const,
              runId: activeProcessing.id,
              completedAt: null,
            }
          : null,
    report561l: {
      filename: input.filename561l ?? null,
      linesRead: parsed561.rows.length,
      validLines: parsed561.lines.length,
      invoiceLines: parsed561.invoiceLines,
      creditLines: parsed561.creditLines,
      malformed: parsed561.malformedRows,
      detectedAccounts: parsed561.detectedAccounts,
      reportStartCustomer: parsed561.reportStartCustomer,
      uniqueDocumentRefs: parsed561.diagnostics.uniqueDocumentRefs.length,
      uniqueInvoiceRefs: parsed561.diagnostics.uniqueInvoiceRefs.length,
      uniqueCreditRefs: parsed561.diagnostics.uniqueCreditRefs.length,
      layout: parsed561.layout,
      accountFieldWidth: parsed561.accountFieldWidth,
    },
    reportSlrb: {
      filename: input.filenameSlrb ?? null,
      documentsRead: parsedSlrb.rows.length,
      invoiceDocuments: parsedSlrb.invoiceDocuments,
      creditDocuments: parsedSlrb.creditDocuments,
      ledgerRecords: parsedSlrb.ledgerRecords,
      malformed: parsedSlrb.malformedRows,
      detectedAccounts: parsedSlrb.detectedAccounts,
      reportStartCustomer: parsedSlrb.reportStartCustomer,
      uniqueDocumentRefs: parsedSlrb.diagnostics.uniqueDocumentRefs.length,
      layout: parsedSlrb.layout,
      accountFieldWidth: parsedSlrb.accountFieldWidth,
    },
    matching: {
      matchedDocuments: matchedDocs,
      unmatched561Documents: unmatched561Docs,
      slrbDocumentsWithoutLines: slrbWithoutLines,
      linesWithDates,
      linesWithoutDates,
      // Sample only — full lists at retail scale (10k+) would bloat preview JSON.
      refs561lOnly: [...lineRefs]
        .filter((r) => !slrbByRef.has(r))
        .sort()
        .slice(0, 50),
      refsSlrbOnly: [...slrbByRef.keys()]
        .filter((r) => !lineRefs.has(r))
        .sort()
        .slice(0, 50),
    },
    products: {
      uniqueSkus: uniqueSkus.length,
      matchedAbSkus: matchedSkus.length,
      notInAbCatalogue: unmatchedSkus.length,
      sampleUnmatchedSkus: unmatchedSkus.slice(0, 20),
    },
    issues,
    canCommit: !blocking,
  };

  let runId: string | null = null;
  if (opts.persistRun) {
    const run = await prisma.autopartCustomerImportRun.create({
      data: {
        companyId: company.id,
        type: "HISTORY_561L_SLRB",
        status: blocking ? "BLOCKED" : "PREVIEWED",
        filename: input.filename561l ?? null,
        filenameSlrb: input.filenameSlrb ?? null,
        fileHash: hash561,
        fileHashSlrb: hashSlrb,
        detectedAccount: accountMatch.sourceAccount,
        rowsRead: parsed561.rows.length + parsedSlrb.rows.length,
        rowsValid: parsed561.lines.length + parsedSlrb.documents.length,
        rowsUnmatched: unmatched561Docs + unmatchedSkus.length,
        issues: issues as unknown as Prisma.InputJsonValue,
        diagnostics: preview as unknown as Prisma.InputJsonValue,
        dryRun: true,
        createdById: actorUserId,
      },
    });
    runId = run.id;
    await recordAuditEvent({
      action: "autopart.history_import_previewed",
      entityType: "Company",
      entityId: company.id,
      actorUserId,
      companyId: company.id,
      after: {
        runId,
        canCommit: preview.canCommit,
        lines: parsed561.lines.length,
        documents: parsedSlrb.documents.length,
      },
    });
  }

  return { ...preview, runId };
}

const historyConfirmSchema = z.object({
  companyId: z.string().cuid(),
  file561l: z.string().min(1),
  fileSlrb: z.string().min(1),
  filename561l: z.string().max(260).optional(),
  filenameSlrb: z.string().max(260).optional(),
  previewRunId: z.string().cuid().optional(),
});

function newImportRowId(): string {
  return `c${randomBytes(16).toString("hex")}`;
}

async function patchHistoricImportProgress(
  runId: string,
  progress: HistoricImportProgress,
  extraDiagnostics?: Record<string, unknown>,
) {
  const existing = await prisma.autopartCustomerImportRun.findUnique({
    where: { id: runId },
    select: { diagnostics: true, rowsImported: true, rowsUpdated: true },
  });
  const prev =
    existing?.diagnostics && typeof existing.diagnostics === "object"
      ? (existing.diagnostics as Record<string, unknown>)
      : {};
  await prisma.autopartCustomerImportRun.update({
    where: { id: runId },
    data: {
      rowsImported: progress.documentsWritten + progress.linesWritten,
      diagnostics: {
        ...prev,
        ...(extraDiagnostics ?? {}),
        progress,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

type PreparedHistoricDocument = {
  companyId: string;
  autopartCustomerCode: string;
  documentType: AutopartHistoricDocumentType;
  documentReference: string;
  documentDate: Date | null;
  goodsNet: string | null;
  vat: string | null;
  grossTotal: string | null;
  source: string;
  importRunId: string;
};

type PreparedHistoricLine = {
  companyId: string;
  documentType: AutopartHistoricDocumentType;
  documentReference: string;
  lineNumber: number;
  sku: string;
  descriptionSnapshot: string | null;
  units: string;
  salesNet: string;
  matchedVariantId: string | null;
  matchStatus: "MATCHED" | "NOT_IN_AB_CATALOGUE";
  rawInvAndLn: string | null;
  source: string;
  importRunId: string;
  autopartCustomerCode: string;
};

function docKey(type: string, ref: string): string {
  return `${type}::${ref}`;
}

/**
 * Bulk upsert historic documents via Postgres ON CONFLICT.
 * Short chunked statements — never one interactive transaction of thousands of awaits.
 * Existence lookups use SAFE_IN_LIST_CHUNK so companyId + IN-list never approaches 32_767 binds.
 */
async function bulkUpsertHistoricDocuments(
  docs: PreparedHistoricDocument[],
  onChunk?: (done: number, total: number) => Promise<void>,
): Promise<{ inserted: number; updated: number; idByKey: Map<string, string> }> {
  const idByKey = new Map<string, string>();
  if (!docs.length) return { inserted: 0, updated: 0, idByKey };

  const companyId = docs[0]!.companyId;
  const refs = [...new Set(docs.map((d) => d.documentReference))];
  // Preload existing in chunks — the RETAIL failure was a single findMany with
  // companyId + 32_767 refs = 32_768 binds (Postgres ceiling + 1).
  const existing = await findManyByInChunks({
    ids: refs,
    chunkSize: SAFE_IN_LIST_CHUNK,
    findChunk: (chunk) =>
      prisma.autopartSalesDocument.findMany({
        where: { companyId, documentReference: { in: chunk } },
        select: { id: true, documentType: true, documentReference: true },
      }),
  });
  const existingKeys = new Set(existing.map((e) => docKey(e.documentType, e.documentReference)));
  for (const e of existing) idByKey.set(docKey(e.documentType, e.documentReference), e.id);

  let inserted = 0;
  let updated = 0;
  const now = new Date();
  const writeChunk = SAFE_HISTORIC_DOCUMENT_UPSERT_CHUNK;

  for (let i = 0; i < docs.length; i += writeChunk) {
    const chunk = docs.slice(i, i + writeChunk);
    const values = Prisma.join(
      chunk.map((d) => {
        const id = idByKey.get(docKey(d.documentType, d.documentReference)) ?? newImportRowId();
        if (!existingKeys.has(docKey(d.documentType, d.documentReference))) {
          idByKey.set(docKey(d.documentType, d.documentReference), id);
        }
        const documentDate = d.documentDate == null ? Prisma.sql`NULL` : Prisma.sql`${d.documentDate}`;
        return Prisma.sql`(
          ${id},
          ${d.companyId},
          ${d.autopartCustomerCode},
          ${d.documentType}::"AutopartHistoricDocumentType",
          ${d.documentReference},
          ${documentDate},
          ${sqlDecimalOrNull(d.goodsNet)},
          ${sqlDecimalOrNull(d.vat)},
          ${sqlDecimalOrNull(d.grossTotal)},
          ${d.source},
          ${d.importRunId},
          ${now},
          ${now}
        )`;
      }),
    );

    await prisma.$executeRaw`
      INSERT INTO "AutopartSalesDocument" (
        "id", "companyId", "autopartCustomerCode", "documentType", "documentReference",
        "documentDate", "goodsNet", "vat", "grossTotal", "source", "importRunId",
        "createdAt", "updatedAt"
      )
      VALUES ${values}
      ON CONFLICT ("companyId", "documentType", "documentReference") DO UPDATE SET
        "autopartCustomerCode" = EXCLUDED."autopartCustomerCode",
        "documentDate" = COALESCE(EXCLUDED."documentDate", "AutopartSalesDocument"."documentDate"),
        "goodsNet" = COALESCE(EXCLUDED."goodsNet", "AutopartSalesDocument"."goodsNet"),
        "vat" = COALESCE(EXCLUDED."vat", "AutopartSalesDocument"."vat"),
        "grossTotal" = COALESCE(EXCLUDED."grossTotal", "AutopartSalesDocument"."grossTotal"),
        "source" = CASE
          WHEN EXCLUDED."source" = 'SLRB' THEN 'SLRB'
          ELSE "AutopartSalesDocument"."source"
        END,
        "importRunId" = EXCLUDED."importRunId",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

    for (const d of chunk) {
      if (existingKeys.has(docKey(d.documentType, d.documentReference))) updated += 1;
      else {
        inserted += 1;
        existingKeys.add(docKey(d.documentType, d.documentReference));
      }
    }
    if (onChunk) await onChunk(Math.min(i + chunk.length, docs.length), docs.length);
  }

  // Refresh IDs (conflict path keeps existing ids) — also chunked
  const after = await findManyByInChunks({
    ids: refs,
    chunkSize: SAFE_IN_LIST_CHUNK,
    findChunk: (chunk) =>
      prisma.autopartSalesDocument.findMany({
        where: { companyId, documentReference: { in: chunk } },
        select: { id: true, documentType: true, documentReference: true },
      }),
  });
  for (const row of after) {
    idByKey.set(docKey(row.documentType, row.documentReference), row.id);
  }

  return { inserted, updated, idByKey };
}

/**
 * Bulk upsert historic sales lines via Postgres ON CONFLICT.
 */
function dedupePreparedHistoricLines(lines: PreparedHistoricLine[]): PreparedHistoricLine[] {
  // Last row wins — prevents Postgres "ON CONFLICT DO UPDATE cannot affect row a second time".
  const byKey = new Map<string, PreparedHistoricLine>();
  for (const line of lines) {
    byKey.set(`${line.documentType}::${line.documentReference}::${line.lineNumber}`, line);
  }
  return [...byKey.values()];
}

async function bulkUpsertHistoricLines(
  lines: PreparedHistoricLine[],
  idByDocKey: Map<string, string>,
  onChunk?: (done: number, total: number) => Promise<void>,
): Promise<{ inserted: number; updated: number }> {
  const uniqueLines = dedupePreparedHistoricLines(lines);
  if (!uniqueLines.length) return { inserted: 0, updated: 0 };

  const companyId = uniqueLines[0]!.companyId;
  const refs = [...new Set(uniqueLines.map((l) => l.documentReference))];
  const existing = await findManyByInChunks({
    ids: refs,
    chunkSize: SAFE_IN_LIST_CHUNK,
    findChunk: (chunk) =>
      prisma.autopartSalesLine.findMany({
        where: { companyId, documentReference: { in: chunk } },
        select: {
          id: true,
          documentType: true,
          documentReference: true,
          lineNumber: true,
        },
      }),
  });
  const existingKeys = new Set(
    existing.map((e) => `${e.documentType}::${e.documentReference}::${e.lineNumber}`),
  );

  let inserted = 0;
  let updated = 0;
  const now = new Date();
  const writeChunk = SAFE_HISTORIC_LINE_UPSERT_CHUNK;

  for (let i = 0; i < uniqueLines.length; i += writeChunk) {
    const chunk = uniqueLines.slice(i, i + writeChunk);
    const values = Prisma.join(
      chunk.map((l) => {
        const documentId = idByDocKey.get(docKey(l.documentType, l.documentReference)) ?? null;
        const id = newImportRowId();
        const documentIdSql =
          documentId == null ? Prisma.sql`NULL` : Prisma.sql`${documentId}`;
        const descriptionSql =
          l.descriptionSnapshot == null
            ? Prisma.sql`NULL`
            : Prisma.sql`${l.descriptionSnapshot}`;
        const matchedVariantSql =
          l.matchedVariantId == null ? Prisma.sql`NULL` : Prisma.sql`${l.matchedVariantId}`;
        const rawInvSql =
          l.rawInvAndLn == null ? Prisma.sql`NULL` : Prisma.sql`${l.rawInvAndLn}`;
        // units/salesNet are required — fall back to 0 when the source value is not numeric
        const unitsFinal =
          l.units && /^-?\d+(\.\d+)?$/.test(l.units.trim())
            ? Prisma.sql`${l.units.trim()}::decimal`
            : Prisma.sql`${"0"}::decimal`;
        const salesFinal =
          l.salesNet && /^-?\d+(\.\d+)?$/.test(l.salesNet.trim())
            ? Prisma.sql`${l.salesNet.trim()}::decimal`
            : Prisma.sql`${"0.00"}::decimal`;
        return Prisma.sql`(
          ${id},
          ${l.companyId},
          ${documentIdSql},
          ${l.autopartCustomerCode},
          ${l.documentType}::"AutopartHistoricDocumentType",
          ${l.documentReference},
          ${l.lineNumber},
          ${l.sku},
          ${descriptionSql},
          ${unitsFinal},
          ${salesFinal},
          ${matchedVariantSql},
          ${l.matchStatus}::"AutopartHistoricLineMatchStatus",
          ${rawInvSql},
          ${l.source},
          ${l.importRunId},
          ${now},
          ${now}
        )`;
      }),
    );

    await prisma.$executeRaw`
      INSERT INTO "AutopartSalesLine" (
        "id", "companyId", "documentId", "autopartCustomerCode", "documentType",
        "documentReference", "lineNumber", "sku", "descriptionSnapshot",
        "units", "salesNet", "matchedVariantId", "matchStatus", "rawInvAndLn",
        "source", "importRunId", "createdAt", "updatedAt"
      )
      VALUES ${values}
      ON CONFLICT ("companyId", "documentType", "documentReference", "lineNumber") DO UPDATE SET
        "documentId" = COALESCE(EXCLUDED."documentId", "AutopartSalesLine"."documentId"),
        "autopartCustomerCode" = EXCLUDED."autopartCustomerCode",
        "sku" = EXCLUDED."sku",
        "descriptionSnapshot" = EXCLUDED."descriptionSnapshot",
        "units" = EXCLUDED."units",
        "salesNet" = EXCLUDED."salesNet",
        "matchedVariantId" = EXCLUDED."matchedVariantId",
        "matchStatus" = EXCLUDED."matchStatus",
        "rawInvAndLn" = EXCLUDED."rawInvAndLn",
        "source" = EXCLUDED."source",
        "importRunId" = EXCLUDED."importRunId",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

    for (const l of chunk) {
      const key = `${l.documentType}::${l.documentReference}::${l.lineNumber}`;
      if (existingKeys.has(key)) updated += 1;
      else {
        inserted += 1;
        existingKeys.add(key);
      }
    }
    if (onChunk) await onChunk(Math.min(i + chunk.length, uniqueLines.length), uniqueLines.length);
  }

  return { inserted, updated };
}

/** Above this combined size, confirm returns immediately and finishes in-process asynchronously. */
const HISTORIC_ASYNC_THRESHOLD = 12_000;

export async function confirmAutopartHistoryImport(actorUserId: string, raw: unknown) {
  await assertStaffCompanyAccess(actorUserId, (raw as { companyId: string }).companyId, "companies.edit");
  const input = historyConfirmSchema.parse(raw);

  // ── Prepare outside any write transaction ──────────────────────────────────
  const preview = await buildHistoryPreview(actorUserId, input, { persistRun: false });
  if (!preview.canCommit) {
    throw new AuthError(
      preview.issues.find((i) => i.severity === "BLOCKING")?.message ?? "Import blocked",
      "IMPORT_BLOCKED",
      400,
    );
  }

  const company = await loadVerifiedCompany(input.companyId);
  const verifiedCode = normaliseAccountToken(company.autopartCustomerCode)!;
  const parsed561 = parseAutopart561l(input.file561l);
  const parsedSlrb = parseAutopartSlrb(input.fileSlrb);
  const slrbByRef = new Map(parsedSlrb.documents.map((d) => [d.documentReference!, d]));

  // Bulk SKU resolution once (never per-line)
  const skuMap = await resolveSkuMap(parsed561.lines.map((l) => l.partNumber!).filter(Boolean));

  const preparedDocs = new Map<string, PreparedHistoricDocument>();
  for (const doc of parsedSlrb.documents) {
    if (!doc.documentReference) continue;
    const type = doc.documentType as AutopartHistoricDocumentType;
    preparedDocs.set(docKey(type, doc.documentReference), {
      companyId: company.id,
      autopartCustomerCode: verifiedCode,
      documentType: type,
      documentReference: doc.documentReference,
      documentDate: dateOnlyToUtcNoon(doc.documentDate),
      goodsNet: doc.goodsNet,
      vat: doc.vat,
      grossTotal: doc.grossTotal,
      source: "SLRB",
      importRunId: "", // filled after run create
    });
  }

  const preparedLines: PreparedHistoricLine[] = [];
  let skipped = 0;
  /** Track used Autopart line numbers per document so OIN-style rows without /n get unique ids. */
  const usedLineNumbersByDoc = new Map<string, Set<number>>();
  type PendingLine = {
    documentType: AutopartHistoricDocumentType;
    documentReference: string;
    sku: string;
    descriptionSnapshot: string | null;
    units: string;
    salesNet: string;
    matchedVariantId: string | null;
    matchStatus: "MATCHED" | "NOT_IN_AB_CATALOGUE";
    rawInvAndLn: string;
  };
  const pendingLineNumbers: PendingLine[] = [];

  for (const line of parsed561.lines) {
    if (!line.documentReference || !line.partNumber) {
      skipped += 1;
      continue;
    }
    const documentType = (
      line.documentType === "CREDIT" ? "CREDIT" : "INVOICE"
    ) as AutopartHistoricDocumentType;
    const slrb = slrbByRef.get(line.documentReference);
    const key = docKey(documentType, line.documentReference);
    if (!preparedDocs.has(key)) {
      preparedDocs.set(key, {
        companyId: company.id,
        autopartCustomerCode: verifiedCode,
        documentType,
        documentReference: line.documentReference,
        documentDate: dateOnlyToUtcNoon(slrb?.documentDate ?? null),
        goodsNet: slrb?.goodsNet ?? null,
        vat: slrb?.vat ?? null,
        grossTotal: slrb?.grossTotal ?? null,
        source: slrb ? "SLRB" : "561L",
        importRunId: "",
      });
    } else if (slrb) {
      // Prefer SLRB header fields when both present
      const existing = preparedDocs.get(key)!;
      preparedDocs.set(key, {
        ...existing,
        documentDate: dateOnlyToUtcNoon(slrb.documentDate) ?? existing.documentDate,
        goodsNet: slrb.goodsNet ?? existing.goodsNet,
        vat: slrb.vat ?? existing.vat,
        grossTotal: slrb.grossTotal ?? existing.grossTotal,
        source: "SLRB",
      });
    }

    const skuKey = line.partNumber.trim().toUpperCase();
    const matchedVariantId = skuMap.get(skuKey) ?? null;
    const base = {
      companyId: company.id,
      documentType,
      documentReference: line.documentReference,
      sku: line.partNumber.trim(),
      descriptionSnapshot: line.description,
      units: String(line.units ?? 0),
      salesNet: line.salesNet ?? "0.00",
      matchedVariantId,
      matchStatus: (matchedVariantId ? "MATCHED" : "NOT_IN_AB_CATALOGUE") as
        | "MATCHED"
        | "NOT_IN_AB_CATALOGUE",
      rawInvAndLn: line.rawInvAndLn,
      source: "561L",
      importRunId: "",
      autopartCustomerCode: verifiedCode,
    };

    if (line.sourceLineNumber != null && line.sourceLineNumber >= 1) {
      const used = usedLineNumbersByDoc.get(key) ?? new Set<number>();
      if (used.has(line.sourceLineNumber)) {
        // Autopart RETAILA/Amazon often repeats "/1" across distinct product lines
        // on the same document. Last-wins upsert would drop earlier SKUs (e.g. SSAMZ).
        // Reassign colliding explicit line numbers like blank-line OIN rows.
        pendingLineNumbers.push({
          documentType,
          documentReference: line.documentReference,
          sku: base.sku,
          descriptionSnapshot: base.descriptionSnapshot,
          units: base.units,
          salesNet: base.salesNet,
          matchedVariantId: base.matchedVariantId,
          matchStatus: base.matchStatus,
          rawInvAndLn: base.rawInvAndLn,
        });
      } else {
        used.add(line.sourceLineNumber);
        usedLineNumbersByDoc.set(key, used);
        preparedLines.push({ ...base, lineNumber: line.sourceLineNumber });
      }
    } else {
      // I/OIN022047/ — Autopart omitted source line number; assign after explicit lines.
      pendingLineNumbers.push({
        documentType,
        documentReference: line.documentReference,
        sku: base.sku,
        descriptionSnapshot: base.descriptionSnapshot,
        units: base.units,
        salesNet: base.salesNet,
        matchedVariantId: base.matchedVariantId,
        matchStatus: base.matchStatus,
        rawInvAndLn: base.rawInvAndLn,
      });
    }
  }

  for (const pending of pendingLineNumbers) {
    const key = docKey(pending.documentType, pending.documentReference);
    const used = usedLineNumbersByDoc.get(key) ?? new Set<number>();
    let n = 1;
    while (used.has(n)) n += 1;
    used.add(n);
    usedLineNumbersByDoc.set(key, used);
    preparedLines.push({
      companyId: company.id,
      documentType: pending.documentType,
      documentReference: pending.documentReference,
      lineNumber: n,
      sku: pending.sku,
      descriptionSnapshot: pending.descriptionSnapshot,
      units: pending.units,
      salesNet: pending.salesNet,
      matchedVariantId: pending.matchedVariantId,
      matchStatus: pending.matchStatus,
      rawInvAndLn: pending.rawInvAndLn,
      source: "561L",
      importRunId: "",
      autopartCustomerCode: verifiedCode,
    });
  }

  const previewSummary = {
    fileHash561l: preview.fileHash561l,
    fileHashSlrb: preview.fileHashSlrb,
    canCommit: preview.canCommit,
    accountMatch: preview.accountMatch,
    report561l: preview.report561l,
    reportSlrb: preview.reportSlrb,
    matching: {
      matchedDocuments: preview.matching.matchedDocuments,
      unmatched561Documents: preview.matching.unmatched561Documents,
      slrbDocumentsWithoutLines: preview.matching.slrbDocumentsWithoutLines,
      linesWithDates: preview.matching.linesWithDates,
      linesWithoutDates: preview.matching.linesWithoutDates,
    },
    products: preview.products,
  };

  // ── Import run: PROCESSING (never COMMITTED before writes succeed) ─────────
  const run = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId: company.id,
      type: "HISTORY_561L_SLRB",
      status: "PROCESSING",
      filename: input.filename561l ?? null,
      filenameSlrb: input.filenameSlrb ?? null,
      fileHash: preview.fileHash561l,
      fileHashSlrb: preview.fileHashSlrb,
      detectedAccount: verifiedCode,
      rowsRead: parsed561.rows.length + parsedSlrb.rows.length,
      rowsValid: parsed561.lines.length,
      dryRun: false,
      createdById: actorUserId,
      completedAt: null,
      issues: preview.issues as unknown as Prisma.InputJsonValue,
      diagnostics: { previewSummary } as unknown as Prisma.InputJsonValue,
    },
  });

  for (const doc of preparedDocs.values()) doc.importRunId = run.id;
  for (const line of preparedLines) line.importRunId = run.id;

  const workSize = preparedDocs.size + preparedLines.length;
  const runAsync = workSize >= HISTORIC_ASYNC_THRESHOLD;

  await recordAuditEvent({
    action: "autopart.history_import_started",
    entityType: "Company",
    entityId: company.id,
    actorUserId,
    companyId: company.id,
    after: {
      runId: run.id,
      documentCount: preparedDocs.size,
      lineCount: preparedLines.length,
      async: runAsync,
    },
  });

  await patchHistoricImportProgress(run.id, {
    phase: "queued",
    message: runAsync
      ? "Large historic import started — processing server-side"
      : "Starting historic import",
    current: 0,
    total: workSize,
    documentsWritten: 0,
    linesWritten: 0,
    updatedAt: new Date().toISOString(),
  });

  const writeJob = async () =>
    executeHistoricImportWrites({
      runId: run.id,
      companyId: company.id,
      actorUserId,
      preparedDocs: [...preparedDocs.values()],
      preparedLines,
      skipped,
      unmatched561Documents: preview.matching.unmatched561Documents,
      previewSummary,
      alreadyImported: Boolean(preview.alreadyImported),
      filename561l: input.filename561l ?? null,
      filenameSlrb: input.filenameSlrb ?? null,
    });

  if (runAsync) {
    // Durable progress on the import run; work continues in-process (no Redis/cron).
    // Idempotent ON CONFLICT upserts make retry-after-failure safe.
    void writeJob().catch((err) => {
      console.error("[ab:autopart-history-import] async job failed", { runId: run.id, err });
    });
    return {
      runId: run.id,
      status: "PROCESSING" as const,
      async: true as const,
      imported: 0,
      updated: 0,
      skipped,
      documentCount: preparedDocs.size,
      lineCount: preparedLines.length,
      message:
        "Large historic import is processing server-side. You can leave this page — refresh to check progress.",
      workspace: await getCompanyAutopartHistoryWorkspace(actorUserId, company.id),
    };
  }

  const result = await writeJob();
  return {
    runId: run.id,
    status: "COMMITTED" as const,
    async: false as const,
    imported: result.imported,
    updated: result.updated,
    skipped,
    documentCount: preparedDocs.size,
    lineCount: preparedLines.length,
    workspace: await getCompanyAutopartHistoryWorkspace(actorUserId, company.id),
  };
}

async function executeHistoricImportWrites(args: {
  runId: string;
  companyId: string;
  actorUserId: string;
  preparedDocs: PreparedHistoricDocument[];
  preparedLines: PreparedHistoricLine[];
  skipped: number;
  unmatched561Documents: number;
  previewSummary: Record<string, unknown>;
  alreadyImported: boolean;
  filename561l: string | null;
  filenameSlrb: string | null;
}): Promise<{ imported: number; updated: number }> {
  let docsInserted = 0;
  let docsUpdated = 0;
  let linesInserted = 0;
  let linesUpdated = 0;
  let partialDocs = 0;
  let partialLines = 0;

  try {
    await patchHistoricImportProgress(args.runId, {
      phase: "documents",
      message: `Checking existing documents / importing documents 0 / ${args.preparedDocs.length}`,
      current: 0,
      total: args.preparedDocs.length,
      documentsWritten: 0,
      linesWritten: 0,
      updatedAt: new Date().toISOString(),
    });

    const docResult = await bulkUpsertHistoricDocuments(
      args.preparedDocs,
      async (done, total) => {
        partialDocs = done;
        await patchHistoricImportProgress(args.runId, {
          phase: "documents",
          message: `Importing documents ${done.toLocaleString()} / ${total.toLocaleString()}`,
          current: done,
          total,
          documentsWritten: done,
          linesWritten: 0,
          updatedAt: new Date().toISOString(),
        });
      },
    );
    docsInserted = docResult.inserted;
    docsUpdated = docResult.updated;

    await patchHistoricImportProgress(args.runId, {
      phase: "lines",
      message: `Importing product lines 0 / ${args.preparedLines.length}`,
      current: 0,
      total: args.preparedLines.length,
      documentsWritten: args.preparedDocs.length,
      linesWritten: 0,
      updatedAt: new Date().toISOString(),
    });

    const lineResult = await bulkUpsertHistoricLines(
      args.preparedLines,
      docResult.idByKey,
      async (done, total) => {
        partialLines = done;
        await patchHistoricImportProgress(args.runId, {
          phase: "lines",
          message: `Importing product lines ${done.toLocaleString()} / ${total.toLocaleString()}`,
          current: done,
          total,
          documentsWritten: args.preparedDocs.length,
          linesWritten: done,
          updatedAt: new Date().toISOString(),
        });
      },
    );
    linesInserted = lineResult.inserted;
    linesUpdated = lineResult.updated;
  } catch (error) {
    console.error("[ab:autopart-history-import] confirm failed", {
      runId: args.runId,
      companyId: args.companyId,
      error,
    });
    const failure =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: "Unknown import failure" };
    try {
      const existing = await prisma.autopartCustomerImportRun.findUnique({
        where: { id: args.runId },
        select: { diagnostics: true },
      });
      const prev =
        existing?.diagnostics && typeof existing.diagnostics === "object"
          ? (existing.diagnostics as Record<string, unknown>)
          : {};
      await prisma.autopartCustomerImportRun.update({
        where: { id: args.runId },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          rowsImported: docsInserted + linesInserted,
          rowsUpdated: docsUpdated + linesUpdated,
          diagnostics: {
            ...prev,
            previewSummary: args.previewSummary,
            failure,
            partialProgress: {
              documentsProcessed: partialDocs,
              linesProcessed: partialLines,
              documentsInserted: docsInserted,
              documentsUpdated: docsUpdated,
              linesInserted,
              linesUpdated,
            },
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (markErr) {
      console.error("[ab:autopart-history-import] failed to mark run FAILED", markErr);
    }
    await recordAuditEvent({
      action: "autopart.history_import_failed",
      entityType: "Company",
      entityId: args.companyId,
      actorUserId: args.actorUserId,
      companyId: args.companyId,
      after: {
        runId: args.runId,
        failure,
        partialDocuments: partialDocs,
        partialLines,
      },
    });
    const detail = failure.message.replace(/\s+/g, " ").slice(0, 280);
    const partialNote =
      partialDocs > 0 || partialLines > 0 || docsInserted + linesInserted > 0
        ? ` Some batches may already be persisted (${partialDocs} documents / ${partialLines} lines processed); retry is idempotent and will not duplicate financial rows.`
        : " No financial batches were confirmed written.";
    throw new AuthError(
      `Historic import failed.${partialNote} You can retry this file pair. Detail: ${detail}`,
      "IMPORT_FAILED",
      500,
    );
  }

  const imported = docsInserted + linesInserted;
  const updated = docsUpdated + linesUpdated;

  try {
    await prisma.autopartCustomerImportRun.update({
      where: { id: args.runId },
      data: {
        status: "COMMITTED",
        rowsImported: imported,
        rowsUpdated: updated,
        rowsSkipped: args.skipped,
        rowsUnmatched: args.unmatched561Documents,
        completedAt: new Date(),
        diagnostics: {
          previewSummary: args.previewSummary,
          progress: {
            phase: "complete",
            message: "Import complete",
            current: args.preparedDocs.length + args.preparedLines.length,
            total: args.preparedDocs.length + args.preparedLines.length,
            documentsWritten: args.preparedDocs.length,
            linesWritten: args.preparedLines.length,
            updatedAt: new Date().toISOString(),
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (finalErr) {
    console.error("[ab:autopart-history-import] writes succeeded but run finalisation failed", {
      runId: args.runId,
      companyId: args.companyId,
      finalErr,
    });
    const detail =
      finalErr instanceof Error
        ? finalErr.message.replace(/\s+/g, " ").slice(0, 280)
        : "Unknown finalisation failure";
    throw new AuthError(
      `Historic data was written but the import run could not be marked complete. Preview the same files — if they show as previously imported, retry is unnecessary. Detail: ${detail}`,
      "IMPORT_FINALISE_FAILED",
      500,
    );
  }

  await recordAuditEvent({
    action: args.alreadyImported ? "autopart.history_reimported" : "autopart.history_imported",
    entityType: "Company",
    entityId: args.companyId,
    actorUserId: args.actorUserId,
    companyId: args.companyId,
    after: {
      runId: args.runId,
      filename561l: args.filename561l,
      filenameSlrb: args.filenameSlrb,
      imported,
      updated,
      skipped: args.skipped,
      documentCount: args.preparedDocs.length,
      lineCount: args.preparedLines.length,
    },
  });

  return { imported, updated };
}

export async function getHistoricImportRunStatus(actorUserId: string, runId: string) {
  const profile = await requireSystemPermission(actorUserId, "companies.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Forbidden", "FORBIDDEN", 403);
  }
  const run = await prisma.autopartCustomerImportRun.findFirst({
    where: { id: runId, type: "HISTORY_561L_SLRB" },
    select: {
      id: true,
      companyId: true,
      status: true,
      rowsImported: true,
      rowsUpdated: true,
      rowsSkipped: true,
      rowsUnmatched: true,
      createdAt: true,
      completedAt: true,
      diagnostics: true,
      filename: true,
      filenameSlrb: true,
    },
  });
  if (!run) throw new AuthError("Import run not found", "NOT_FOUND", 404);
  if (run.companyId) {
    await assertStaffCompanyAccess(actorUserId, run.companyId, "companies.view");
  }
  const diag =
    run.diagnostics && typeof run.diagnostics === "object"
      ? (run.diagnostics as Record<string, unknown>)
      : {};
  return {
    runId: run.id,
    companyId: run.companyId,
    status: run.status,
    rowsImported: run.rowsImported,
    rowsUpdated: run.rowsUpdated,
    rowsSkipped: run.rowsSkipped,
    rowsUnmatched: run.rowsUnmatched,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    filename561l: run.filename,
    filenameSlrb: run.filenameSlrb,
    progress: (diag["progress"] as HistoricImportProgress | undefined) ?? null,
    failure: diag["failure"] ?? null,
    partialProgress: diag["partialProgress"] ?? null,
  };
}

// ─── Credit control (removed) ────────────────────────────────────────────────
// Automotive Brands does not manage customer credit control. 407P100 import,
// preview/confirm, and credit position snapshots are intentionally not supported.
// Credit limits and available credit remain authoritative in Autopart/MAM.

/** @deprecated Prefer listPortalPurchaseHistory — kept as a thin compat shim. */
export { listPortalHistoricPurchases, listPortalPurchaseHistory, getPortalPurchaseProductInsight } from "@/server/companies/purchase-history";

