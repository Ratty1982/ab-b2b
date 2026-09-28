/**
 * Bulk 407P100 customer credit import (manual).
 *
 * Uses the same parseAutopart407p100 parser and AutopartCreditPosition model as
 * the per-customer importer. Future mailbox/scheduler ingestion should call
 * previewBulkAutopartCreditImport / confirmBulkAutopartCreditImport — do not
 * add a second parser or credit updater.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { parseAutopart407p100 } from "@/domain/autopart-407p100";
import { normaliseAccountToken } from "@/domain/autopart-report-money";
import { moneyToString, parseMoney } from "@/domain/money";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import {
  evaluateHeldOrderCreditNow,
  type HeldOrderCreditHint,
} from "@/server/orders/credit-control";
import { hasPermission } from "@/server/rbac/access";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";

const MAX_FILE_CHARS = 12_000_000; // ~12 MB text

export type BulkCreditMatchStatus =
  | "MATCHED"
  | "MATCHED_ALIAS"
  | "NOT_IN_AB"
  | "DUPLICATE"
  | "INVALID";

export type BulkCreditChangeKind = "UPDATE" | "UNCHANGED" | "NEW" | "NONE";

export type BulkCreditPreviewRow = {
  lineNumberInFile: number;
  autopartAccount: string | null;
  customerName: string | null;
  companyId: string | null;
  companyName: string | null;
  invoices: string | null;
  picking: string | null;
  otherExposure: string | null;
  usedCredit: string | null;
  creditLimit: string | null;
  availableCredit: string | null;
  matchStatus: BulkCreditMatchStatus;
  changeKind: BulkCreditChangeKind;
  financiallyUnchanged: boolean;
  /** Freshness would still refresh on confirm even when financially unchanged. */
  wouldRefreshSourceTimestamp: boolean;
  wouldUpdate: boolean;
  invalidReason: string | null;
  before: {
    creditLimit: string | null;
    usedCredit: string | null;
    availableCredit: string | null;
  } | null;
  after: {
    creditLimit: string | null;
    usedCredit: string | null;
    availableCredit: string | null;
  } | null;
  deltas: {
    usedCredit: string | null;
    availableCredit: string | null;
    creditLimit: string | null;
  } | null;
};

export type BulkCreditPreviewSummary = {
  accountsInFile: number;
  matched: number;
  matchedAlias: number;
  notInAb: number;
  duplicates: number;
  invalid: number;
  wouldUpdate: number;
  wouldRemainUnchanged: number;
  wouldCreateNew: number;
};

export type BulkCreditImportResultStatus =
  | "SUCCESS"
  | "SUCCESS_WITH_WARNINGS"
  | "BLOCKED"
  | "ALREADY_IMPORTED";

async function assertCanBulkImportCredit(actorUserId: string) {
  const profile = await requireSystemPermission(actorUserId, "credit.edit").catch(async () => {
    try {
      return await requireSystemPermission(actorUserId, "settings.edit");
    } catch {
      return requireSystemPermission(actorUserId, "admin.access");
    }
  });
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade customers cannot import Autopart credit", "FORBIDDEN", 403);
  }
  if (
    !hasPermission(profile, "credit.edit") &&
    !hasPermission(profile, "settings.edit") &&
    !hasPermission(profile, "admin.access")
  ) {
    throw new AuthError("Missing credit.edit permission", "FORBIDDEN", 403);
  }
  return profile;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function moneyDelta(before: string | null, after: string | null): string | null {
  if (before == null || after == null) return null;
  const b = parseMoney(before);
  const a = parseMoney(after);
  if (!b || !a) return null;
  const d = a.minor - b.minor;
  const sign = d > 0n ? "+" : d < 0n ? "-" : "";
  const abs = d < 0n ? -d : d;
  return `${sign}${moneyToString({ minor: abs }, 2)}`;
}

function otherExposureFromRow(p: {
  dropShip: string;
  crossDock: string;
  suspends: string;
  unConsol: string;
}): string {
  const parts = [p.dropShip, p.crossDock, p.suspends, p.unConsol]
    .map((v) => parseMoney(v)?.minor ?? 0n)
    .reduce((acc, n) => acc + n, 0n);
  return moneyToString({ minor: parts }, 2);
}

function financialEqual(
  a: { creditLimit: string; usedCredit: string; availableCredit: string },
  b: { creditLimit: string; usedCredit: string; availableCredit: string },
): boolean {
  return (
    a.creditLimit === b.creditLimit &&
    a.usedCredit === b.usedCredit &&
    a.availableCredit === b.availableCredit
  );
}

const previewSchema = z.object({
  file407: z.string().min(1).max(MAX_FILE_CHARS),
  filename: z.string().max(260).optional(),
});

type AccountMatch =
  | { kind: "MATCHED" | "MATCHED_ALIAS"; companyId: string; companyName: string }
  | { kind: "NONE" };

async function loadAccountMatchMap(accountCodes: string[]): Promise<Map<string, AccountMatch>> {
  const unique = [...new Set(accountCodes.filter(Boolean))];
  const map = new Map<string, AccountMatch>();
  if (!unique.length) return map;

  const companies = await prisma.company.findMany({
    where: {
      autopartCustomerCode: { in: unique, mode: "insensitive" },
      autopartCustomerCodeVerifiedAt: { not: null },
    },
    select: {
      id: true,
      name: true,
      autopartCustomerCode: true,
    },
  });

  for (const c of companies) {
    const code = normaliseAccountToken(c.autopartCustomerCode);
    if (!code) continue;
    map.set(code, { kind: "MATCHED", companyId: c.id, companyName: c.name });
  }

  const aliases = await prisma.autopartCustomerAccountAlias.findMany({
    where: { alias: { in: unique, mode: "insensitive" } },
    select: {
      alias: true,
      company: {
        select: {
          id: true,
          name: true,
          autopartCustomerCodeVerifiedAt: true,
        },
      },
    },
  });

  for (const a of aliases) {
    const aliasNorm = normaliseAccountToken(a.alias);
    if (!aliasNorm || map.has(aliasNorm)) continue;
    if (!a.company.autopartCustomerCodeVerifiedAt) continue;
    map.set(aliasNorm, {
      kind: "MATCHED_ALIAS",
      companyId: a.company.id,
      companyName: a.company.name,
    });
  }

  return map;
}

async function loadExistingPositions(companyIds: string[]) {
  if (!companyIds.length) {
    return new Map<
      string,
      { creditLimit: string; usedCredit: string; availableCredit: string }
    >();
  }
  const rows = await prisma.autopartCreditPosition.findMany({
    where: { companyId: { in: companyIds } },
  });
  const map = new Map<
    string,
    { creditLimit: string; usedCredit: string; availableCredit: string }
  >();
  for (const r of rows) {
    map.set(r.companyId, {
      creditLimit: moneyToString(parseMoney(String(r.creditLimit))!, 2),
      usedCredit: moneyToString(parseMoney(String(r.totalExposure))!, 2),
      availableCredit: moneyToString(parseMoney(String(r.availableCreditRaw))!, 2),
    });
  }
  return map;
}

export async function buildBulkCreditPreview(input: {
  file407: string;
  filename?: string | null;
}): Promise<{
  filename: string | null;
  fileHash: string;
  alreadyImported: boolean;
  priorImportAt: string | null;
  priorImportRunId: string | null;
  parseErrors: string[];
  canCommit: boolean;
  resultStatus: BulkCreditImportResultStatus;
  summary: BulkCreditPreviewSummary;
  rows: BulkCreditPreviewRow[];
}> {
  const parsed = parseAutopart407p100(input.file407);
  const fileHash = sha256(input.file407);

  const prior = await prisma.autopartCustomerImportRun.findFirst({
    where: {
      type: "CREDIT_407P100_BULK",
      status: "COMMITTED",
      fileHash,
    },
    orderBy: { completedAt: "desc" },
  });

  const accountCounts = new Map<string, number>();
  for (const p of parsed.positions) {
    if (!p.accountCode) continue;
    accountCounts.set(p.accountCode, (accountCounts.get(p.accountCode) ?? 0) + 1);
  }
  const duplicateAccounts = new Set(
    [...accountCounts.entries()].filter(([, n]) => n > 1).map(([a]) => a),
  );

  const matchMap = await loadAccountMatchMap(parsed.detectedAccounts);
  const matchedCompanyIds = [
    ...new Set(
      [...matchMap.values()]
        .filter(
          (m): m is Extract<AccountMatch, { kind: "MATCHED" | "MATCHED_ALIAS" }> =>
            m.kind === "MATCHED" || m.kind === "MATCHED_ALIAS",
        )
        .map((m) => m.companyId),
    ),
  ];
  const existing = await loadExistingPositions(matchedCompanyIds);
  const rows: BulkCreditPreviewRow[] = [];

  for (const inv of parsed.invalidRows) {
    rows.push({
      lineNumberInFile: inv.lineNumberInFile,
      autopartAccount: inv.accountCode,
      customerName: inv.customerName,
      companyId: null,
      companyName: null,
      invoices: null,
      picking: null,
      otherExposure: null,
      usedCredit: null,
      creditLimit: null,
      availableCredit: null,
      matchStatus: "INVALID",
      changeKind: "NONE",
      financiallyUnchanged: false,
      wouldRefreshSourceTimestamp: false,
      wouldUpdate: false,
      invalidReason: inv.reason,
      before: null,
      after: null,
      deltas: null,
    });
  }

  for (const p of parsed.positions) {
    const account = p.accountCode;
    if (!account) continue;

    if (duplicateAccounts.has(account)) {
      rows.push({
        lineNumberInFile: p.lineNumberInFile,
        autopartAccount: account,
        customerName: p.customerName,
        companyId: null,
        companyName: null,
        invoices: p.invoices,
        picking: p.picking,
        otherExposure: otherExposureFromRow(p),
        usedCredit: p.totalExposure,
        creditLimit: p.creditLimit,
        availableCredit: p.availableCreditRaw,
        matchStatus: "DUPLICATE",
        changeKind: "NONE",
        financiallyUnchanged: false,
        wouldRefreshSourceTimestamp: false,
        wouldUpdate: false,
        invalidReason: "Duplicate account in file — blocked from update",
        before: null,
        after: null,
        deltas: null,
      });
      continue;
    }

    const match = matchMap.get(account) ?? { kind: "NONE" as const };
    if (match.kind === "NONE") {
      rows.push({
        lineNumberInFile: p.lineNumberInFile,
        autopartAccount: account,
        customerName: p.customerName,
        companyId: null,
        companyName: null,
        invoices: p.invoices,
        picking: p.picking,
        otherExposure: otherExposureFromRow(p),
        usedCredit: p.totalExposure,
        creditLimit: p.creditLimit,
        availableCredit: p.availableCreditRaw,
        matchStatus: "NOT_IN_AB",
        changeKind: "NONE",
        financiallyUnchanged: false,
        wouldRefreshSourceTimestamp: false,
        wouldUpdate: false,
        invalidReason: null,
        before: null,
        after: {
          creditLimit: p.creditLimit,
          usedCredit: p.totalExposure,
          availableCredit: p.availableCreditRaw,
        },
        deltas: null,
      });
      continue;
    }

    const before = existing.get(match.companyId) ?? null;
    const after = {
      creditLimit: p.creditLimit,
      usedCredit: p.totalExposure,
      availableCredit: p.availableCreditRaw,
    };
    const unchanged = before
      ? financialEqual(
          {
            creditLimit: before.creditLimit,
            usedCredit: before.usedCredit,
            availableCredit: before.availableCredit,
          },
          after,
        )
      : false;
    const changeKind: BulkCreditChangeKind = !before
      ? "NEW"
      : unchanged
        ? "UNCHANGED"
        : "UPDATE";

    rows.push({
      lineNumberInFile: p.lineNumberInFile,
      autopartAccount: account,
      customerName: p.customerName,
      companyId: match.companyId,
      companyName: match.companyName,
      invoices: p.invoices,
      picking: p.picking,
      otherExposure: otherExposureFromRow(p),
      usedCredit: p.totalExposure,
      creditLimit: p.creditLimit,
      availableCredit: p.availableCreditRaw,
      matchStatus: match.kind,
      changeKind,
      financiallyUnchanged: unchanged,
      wouldRefreshSourceTimestamp: true,
      wouldUpdate: true,
      invalidReason: null,
      before: before
        ? {
            creditLimit: before.creditLimit,
            usedCredit: before.usedCredit,
            availableCredit: before.availableCredit,
          }
        : null,
      after,
      deltas: before
        ? {
            usedCredit: moneyDelta(before.usedCredit, after.usedCredit),
            availableCredit: moneyDelta(before.availableCredit, after.availableCredit),
            creditLimit: moneyDelta(before.creditLimit, after.creditLimit),
          }
        : null,
    });
  }

  const rank = (s: BulkCreditMatchStatus) =>
    s === "MATCHED" || s === "MATCHED_ALIAS"
      ? 0
      : s === "DUPLICATE"
        ? 1
        : s === "INVALID"
          ? 2
          : 3;
  rows.sort(
    (a, b) => rank(a.matchStatus) - rank(b.matchStatus) || a.lineNumberInFile - b.lineNumberInFile,
  );

  const summary: BulkCreditPreviewSummary = {
    accountsInFile: parsed.positions.length + parsed.invalidRows.length,
    matched: rows.filter((r) => r.matchStatus === "MATCHED").length,
    matchedAlias: rows.filter((r) => r.matchStatus === "MATCHED_ALIAS").length,
    notInAb: rows.filter((r) => r.matchStatus === "NOT_IN_AB").length,
    duplicates: rows.filter((r) => r.matchStatus === "DUPLICATE").length,
    invalid: rows.filter((r) => r.matchStatus === "INVALID").length,
    wouldUpdate: rows.filter((r) => r.wouldUpdate && r.changeKind !== "UNCHANGED").length,
    wouldRemainUnchanged: rows.filter((r) => r.wouldUpdate && r.changeKind === "UNCHANGED")
      .length,
    wouldCreateNew: rows.filter((r) => r.wouldUpdate && r.changeKind === "NEW").length,
  };

  const parseBlocked = !parsed.headerFound || Boolean(parsed.errors.length);
  const canCommit =
    !parseBlocked &&
    !prior &&
    summary.matched + summary.matchedAlias > 0 &&
    rows.some((r) => r.wouldUpdate);

  let resultStatus: BulkCreditImportResultStatus = "SUCCESS";
  if (prior) resultStatus = "ALREADY_IMPORTED";
  else if (parseBlocked) resultStatus = "BLOCKED";
  else if (summary.invalid > 0 || summary.duplicates > 0) resultStatus = "SUCCESS_WITH_WARNINGS";

  return {
    filename: input.filename ?? null,
    fileHash,
    alreadyImported: Boolean(prior),
    priorImportAt: prior?.completedAt?.toISOString() ?? prior?.createdAt.toISOString() ?? null,
    priorImportRunId: prior?.id ?? null,
    parseErrors: parsed.errors,
    canCommit,
    resultStatus,
    summary,
    rows,
  };
}

export async function previewBulkAutopartCreditImport(actorUserId: string, raw: unknown) {
  await assertCanBulkImportCredit(actorUserId);
  const input = previewSchema.parse(raw);
  const preview = await buildBulkCreditPreview(input);

  const run = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId: null,
      type: "CREDIT_407P100_BULK",
      status: preview.canCommit ? "PREVIEWED" : "BLOCKED",
      filename: preview.filename,
      fileHash: preview.fileHash,
      rowsRead: preview.summary.accountsInFile,
      rowsValid: preview.summary.matched + preview.summary.matchedAlias,
      rowsUnmatched: preview.summary.notInAb,
      rowsSkipped: preview.summary.duplicates + preview.summary.invalid,
      dryRun: true,
      createdById: actorUserId,
      issues: [
        ...(preview.alreadyImported
          ? [
              {
                severity: "INFO",
                code: "ALREADY_IMPORTED",
                message: "This exact 407P100 file has already been imported.",
              },
            ]
          : []),
        ...preview.parseErrors.map((m) => ({
          severity: "BLOCKING" as const,
          code: "PARSE",
          message: m,
        })),
      ] as unknown as Prisma.InputJsonValue,
      diagnostics: {
        summary: preview.summary,
        resultStatus: preview.resultStatus,
        rowCount: preview.rows.length,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return { ...preview, runId: run.id };
}

export async function confirmBulkAutopartCreditImport(actorUserId: string, raw: unknown) {
  await assertCanBulkImportCredit(actorUserId);
  const input = previewSchema.parse(raw);
  const preview = await buildBulkCreditPreview(input);

  if (preview.alreadyImported) {
    throw new AuthError(
      "This exact 407P100 file has already been imported.",
      "ALREADY_IMPORTED",
      400,
    );
  }
  if (!preview.canCommit) {
    throw new AuthError(
      preview.parseErrors[0] ?? "Bulk credit import blocked — no matched customers to update.",
      "IMPORT_BLOCKED",
      400,
    );
  }

  const parsed = parseAutopart407p100(input.file407);
  const posByAccount = new Map(
    parsed.positions.filter((p) => p.accountCode).map((p) => [p.accountCode!, p]),
  );
  const updatable = preview.rows.filter(
    (r) => r.wouldUpdate && r.companyId && r.autopartAccount && posByAccount.has(r.autopartAccount),
  );
  const now = new Date();

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.autopartCustomerImportRun.create({
      data: {
        companyId: null,
        type: "CREDIT_407P100_BULK",
        status: "COMMITTED",
        filename: preview.filename,
        fileHash: preview.fileHash,
        rowsRead: preview.summary.accountsInFile,
        rowsValid: preview.summary.matched + preview.summary.matchedAlias,
        rowsImported: updatable.filter((r) => r.changeKind !== "UNCHANGED").length,
        rowsUpdated: updatable.filter((r) => r.changeKind === "UPDATE").length,
        rowsSkipped:
          preview.summary.duplicates +
          preview.summary.invalid +
          preview.summary.wouldRemainUnchanged,
        rowsUnmatched: preview.summary.notInAb,
        dryRun: false,
        createdById: actorUserId,
        completedAt: now,
        issues: [
          ...(preview.summary.duplicates
            ? [
                {
                  severity: "WARNING",
                  code: "DUPLICATE",
                  message: `${preview.summary.duplicates} duplicate account row(s) blocked`,
                },
              ]
            : []),
          ...(preview.summary.invalid
            ? [
                {
                  severity: "WARNING",
                  code: "INVALID",
                  message: `${preview.summary.invalid} invalid row(s) skipped`,
                },
              ]
            : []),
        ] as unknown as Prisma.InputJsonValue,
        diagnostics: {
          summary: preview.summary,
          resultStatus:
            preview.summary.invalid > 0 || preview.summary.duplicates > 0
              ? "SUCCESS_WITH_WARNINGS"
              : "SUCCESS",
          updatedCompanyIds: updatable.map((r) => r.companyId),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    const chunkSize = 40;
    for (let i = 0; i < updatable.length; i += chunkSize) {
      const chunk = updatable.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map((row) => {
          const pos = posByAccount.get(row.autopartAccount!)!;
          return tx.autopartCreditPosition.upsert({
            where: { companyId: row.companyId! },
            create: {
              companyId: row.companyId!,
              autopartCustomerCode: pos.accountCode!,
              invoices: pos.invoices,
              picking: pos.picking,
              dropShip: pos.dropShip,
              crossDock: pos.crossDock,
              suspends: pos.suspends,
              unConsol: pos.unConsol,
              totalExposure: pos.totalExposure,
              creditLimit: pos.creditLimit,
              availableCreditRaw: pos.availableCreditRaw,
              sourceReport: "407P100",
              sourceImportedAt: now,
              sourceImportRunId: created.id,
            },
            update: {
              autopartCustomerCode: pos.accountCode!,
              invoices: pos.invoices,
              picking: pos.picking,
              dropShip: pos.dropShip,
              crossDock: pos.crossDock,
              suspends: pos.suspends,
              unConsol: pos.unConsol,
              totalExposure: pos.totalExposure,
              creditLimit: pos.creditLimit,
              availableCreditRaw: pos.availableCreditRaw,
              sourceReport: "407P100",
              sourceImportedAt: now,
              sourceImportRunId: created.id,
            },
          });
        }),
      );
    }

    return created;
  });

  const updatedCompanyIds = [...new Set(updatable.map((r) => r.companyId!))];
  const heldHints = await evaluateHeldOrdersAfterCreditImport(updatedCompanyIds);

  await recordAuditEvent({
    action: "autopart.credit_bulk_imported",
    entityType: "AutopartCustomerImportRun",
    entityId: run.id,
    actorUserId,
    after: {
      importRunId: run.id,
      filename: preview.filename,
      hash: preview.fileHash,
      accountsRead: preview.summary.accountsInFile,
      matched: preview.summary.matched + preview.summary.matchedAlias,
      updated: updatable.filter((r) => r.changeKind !== "UNCHANGED").length,
      unchanged: preview.summary.wouldRemainUnchanged,
      notInAb: preview.summary.notInAb,
      invalid: preview.summary.invalid,
      duplicate: preview.summary.duplicates,
      creditNowAvailableOrders: heldHints.filter((h) => h.creditNowAvailable).length,
    },
  });

  return {
    runId: run.id,
    filename: preview.filename,
    fileHash: preview.fileHash,
    completedAt: now.toISOString(),
    resultStatus:
      preview.summary.invalid > 0 || preview.summary.duplicates > 0
        ? ("SUCCESS_WITH_WARNINGS" as const)
        : ("SUCCESS" as const),
    summary: {
      accountsRead: preview.summary.accountsInFile,
      matched: preview.summary.matched + preview.summary.matchedAlias,
      updated: updatable.filter((r) => r.changeKind !== "UNCHANGED").length,
      unchanged: preview.summary.wouldRemainUnchanged,
      notInAb: preview.summary.notInAb,
      invalid: preview.summary.invalid,
      duplicate: preview.summary.duplicates,
      freshnessRefreshed: updatable.length,
    },
    heldOrderHints: heldHints,
  };
}

export async function evaluateHeldOrdersAfterCreditImport(
  companyIds: string[],
): Promise<HeldOrderCreditHint[]> {
  if (!companyIds.length) return [];
  const orders = await prisma.order.findMany({
    where: {
      companyId: { in: companyIds },
      creditStatus: { in: ["HOLD", "REVIEW_REQUIRED"] },
      status: { not: "CANCELLED" },
    },
    select: {
      id: true,
      orderNumber: true,
      companyId: true,
      grandTotal: true,
      paymentTermsSnapshot: true,
      creditStatus: true,
      company: {
        select: {
          autopartCustomerCode: true,
          autopartCustomerCodeVerifiedAt: true,
          paymentTerms: true,
        },
      },
    },
    take: 500,
  });

  const hints: HeldOrderCreditHint[] = [];
  for (const order of orders) {
    hints.push(
      await evaluateHeldOrderCreditNow({
        orderId: order.id,
        orderNumber: order.orderNumber,
        companyId: order.companyId,
        grandTotal: order.grandTotal,
        paymentTerms: order.paymentTermsSnapshot ?? order.company.paymentTerms,
        hasVerifiedAutopartAccount: Boolean(
          order.company.autopartCustomerCode && order.company.autopartCustomerCodeVerifiedAt,
        ),
        currentCreditStatus: order.creditStatus as "HOLD" | "REVIEW_REQUIRED",
      }),
    );
  }
  return hints;
}

export async function getBulkCreditImportStatus(actorUserId: string) {
  await assertCanBulkImportCredit(actorUserId);
  const last = await prisma.autopartCustomerImportRun.findFirst({
    where: { type: "CREDIT_407P100_BULK", status: "COMMITTED", dryRun: false },
    orderBy: { completedAt: "desc" },
    select: {
      id: true,
      filename: true,
      fileHash: true,
      completedAt: true,
      createdAt: true,
      rowsRead: true,
      rowsImported: true,
      rowsUpdated: true,
      rowsUnmatched: true,
      rowsValid: true,
      diagnostics: true,
      createdBy: { select: { name: true, email: true } },
    },
  });

  if (!last) {
    return {
      hasImport: false as const,
      source: "Autopart 407P100",
      mode: "Manual CSV Import",
    };
  }

  const diag = (last.diagnostics ?? {}) as { resultStatus?: string };

  return {
    hasImport: true as const,
    source: "Autopart 407P100",
    mode: "Manual CSV Import",
    lastImportAt: (last.completedAt ?? last.createdAt).toISOString(),
    lastImportRunId: last.id,
    filename: last.filename,
    fileHash: last.fileHash,
    customersUpdated: last.rowsImported,
    accountsRead: last.rowsRead,
    matched: last.rowsValid,
    notInAb: last.rowsUnmatched,
    resultStatus: diag.resultStatus ?? "SUCCESS",
    actorName: last.createdBy?.name ?? last.createdBy?.email ?? null,
  };
}
