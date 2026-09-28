/**
 * Autopart historic purchase (561L/SLRB) + current credit (407P100) import.
 *
 * AB is NOT the accounting system. Autopart/MAM remains authoritative for ledger.
 * Historic lines are NOT AB Orders. Credit position is a snapshot, not a ledger.
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission, requireCompanyPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";
import { normalizeAutopartCustomerCode } from "@/server/companies/autopart-account";
import { parseAutopart561l } from "@/domain/autopart-561l";
import { parseAutopartSlrb } from "@/domain/autopart-slrb";
import { parseAutopart407p100 } from "@/domain/autopart-407p100";
import {
  autopartAccountsEqual,
  normaliseAccountToken,
  parseAutopartMoney,
} from "@/domain/autopart-report-money";
import { moneyToString, moneyZero, parseMoney } from "@/domain/money";
import { creditFreshnessFromImportedAt } from "@/server/companies/autopart-credit-freshness";
import { requireTradePortalCompany } from "@/server/portal/dashboard";

export type ImportIssue = {
  severity: "BLOCKING" | "WARNING" | "INFO";
  code: string;
  message: string;
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function dateOnlyToUtcNoon(dateOnly: string | null | undefined): Date | null {
  if (!dateOnly || !/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  return new Date(`${dateOnly}T12:00:00.000Z`);
}

async function assertStaffCompanyAccess(actorUserId: string, companyId: string, permission: "companies.view" | "companies.edit" | "credit.view" | "credit.edit") {
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
      creditLimit: true,
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

function accountAllowed(detected: string[], accepted: Set<string>): {
  ok: boolean;
  unmatched: string[];
} {
  const unmatched = detected.filter((d) => !accepted.has(d));
  return { ok: unmatched.length === 0 && detected.length > 0, unmatched };
}

async function resolveSkuMap(skus: string[]): Promise<Map<string, string>> {
  const cleaned = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!cleaned.length) return map;
  // Batch exact case-insensitive SKU match — no fuzzy / prefix matching.
  const byUpper = new Map<string, string>();
  const chunkSize = 80;
  for (let i = 0; i < cleaned.length; i += chunkSize) {
    const chunk = cleaned.slice(i, i + chunkSize);
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

  const [lineCount, docCount, credit, lastHistory, lastCredit, aliases, topSkus, skuGroups] =
    await Promise.all([
      prisma.autopartSalesLine.count({ where: { companyId } }),
      prisma.autopartSalesDocument.count({ where: { companyId } }),
      prisma.autopartCreditPosition.findUnique({ where: { companyId } }),
      prisma.autopartCustomerImportRun.findFirst({
        where: { companyId, type: "HISTORY_561L_SLRB", status: "COMMITTED" },
        orderBy: { completedAt: "desc" },
      }),
      prisma.autopartCustomerImportRun.findFirst({
        where: { companyId, type: "CREDIT_407P100", status: "COMMITTED" },
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

  const freshness = creditFreshnessFromImportedAt(credit?.sourceImportedAt ?? null);

  return {
    company: {
      id: company.id,
      name: company.name,
      autopartCustomerCode: company.autopartCustomerCode,
      verified,
      companyCreditLimit:
        company.creditLimit != null ? moneyToString(parseMoney(String(company.creditLimit))!, 2) : null,
    },
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
    credit: credit
      ? {
          imported: true,
          freshness,
          autopartCustomerCode: credit.autopartCustomerCode,
          invoices: moneyToString(parseMoney(String(credit.invoices))!, 2),
          picking: moneyToString(parseMoney(String(credit.picking))!, 2),
          dropShip: moneyToString(parseMoney(String(credit.dropShip))!, 2),
          crossDock: moneyToString(parseMoney(String(credit.crossDock))!, 2),
          suspends: moneyToString(parseMoney(String(credit.suspends))!, 2),
          unConsol: moneyToString(parseMoney(String(credit.unConsol))!, 2),
          usedCredit: moneyToString(parseMoney(String(credit.totalExposure))!, 2),
          creditLimit: moneyToString(parseMoney(String(credit.creditLimit))!, 2),
          availableCreditRaw: moneyToString(parseMoney(String(credit.availableCreditRaw))!, 2),
          availableCreditDisplay:
            (parseMoney(String(credit.availableCreditRaw))?.minor ?? 0n) < 0n
              ? "0.00"
              : moneyToString(parseMoney(String(credit.availableCreditRaw))!, 2),
          overLimitBy:
            (parseMoney(String(credit.availableCreditRaw))?.minor ?? 0n) < 0n
              ? moneyToString(
                  { minor: -(parseMoney(String(credit.availableCreditRaw))!.minor) },
                  2,
                )
              : null,
          sourceImportedAt: credit.sourceImportedAt.toISOString(),
          lastImportedAt: lastCredit?.completedAt?.toISOString() ?? credit.sourceImportedAt.toISOString(),
        }
      : {
          imported: false,
          freshness: "NOT_AVAILABLE" as const,
          lastImportedAt: null,
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
      message: "561L report format not recognised.",
    });
  }
  if (!parsedSlrb.headerFound) {
    issues.push({
      severity: "BLOCKING",
      code: "UNRECOGNISED_SLRB",
      message: "SLRB report format not recognised.",
    });
  }

  const verifiedCode = company.autopartCustomerCode
    ? normaliseAccountToken(company.autopartCustomerCode)
    : null;
  const accepted = verifiedCode
    ? await loadAcceptedAccounts(input.companyId, verifiedCode)
    : new Set<string>();

  const detected = [...new Set([...parsed561.detectedAccounts, ...parsedSlrb.detectedAccounts])];
  const accountCheck = accountAllowed(detected, accepted);
  if (detected.length === 0) {
    issues.push({
      severity: "BLOCKING",
      code: "NO_ACCOUNT",
      message: "No Autopart account codes detected in the uploaded reports.",
    });
  } else if (!accountCheck.ok) {
    issues.push({
      severity: "BLOCKING",
      code: "ACCOUNT_MISMATCH",
      message: `Detected account(s) ${accountCheck.unmatched.join(", ")} do not match verified account ${verifiedCode ?? "—"}. Add an explicit verified alias if this is a known report alias.`,
    });
  }

  const hash561 = sha256(input.file561l);
  const hashSlrb = sha256(input.fileSlrb);
  const prior = await prisma.autopartCustomerImportRun.findFirst({
    where: {
      companyId: input.companyId,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      fileHash: hash561,
      fileHashSlrb: hashSlrb,
    },
  });
  if (prior) {
    issues.push({
      severity: "INFO",
      code: "ALREADY_IMPORTED",
      message: "This exact file pair has already been imported. Re-confirm is idempotent.",
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
    detectedAccounts: detected,
    fileHash561l: hash561,
    fileHashSlrb: hashSlrb,
    alreadyImported: Boolean(prior),
    report561l: {
      filename: input.filename561l ?? null,
      linesRead: parsed561.rows.length,
      validLines: parsed561.lines.length,
      invoiceLines: parsed561.invoiceLines,
      creditLines: parsed561.creditLines,
      malformed: parsed561.malformedRows,
      detectedAccounts: parsed561.detectedAccounts,
    },
    reportSlrb: {
      filename: input.filenameSlrb ?? null,
      documentsRead: parsedSlrb.rows.length,
      invoiceDocuments: parsedSlrb.invoiceDocuments,
      creditDocuments: parsedSlrb.creditDocuments,
      ledgerRecords: parsedSlrb.ledgerRecords,
      malformed: parsedSlrb.malformedRows,
      detectedAccounts: parsedSlrb.detectedAccounts,
    },
    matching: {
      matchedDocuments: matchedDocs,
      unmatched561Documents: unmatched561Docs,
      slrbDocumentsWithoutLines: slrbWithoutLines,
      linesWithDates,
      linesWithoutDates,
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
        detectedAccount: detected.join(",") || null,
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

export async function confirmAutopartHistoryImport(actorUserId: string, raw: unknown) {
  await assertStaffCompanyAccess(actorUserId, (raw as { companyId: string }).companyId, "companies.edit");
  const input = historyConfirmSchema.parse(raw);
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
  const skuMap = await resolveSkuMap(parsed561.lines.map((l) => l.partNumber!).filter(Boolean));

  const run = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId: company.id,
      type: "HISTORY_561L_SLRB",
      status: "COMMITTED",
      filename: input.filename561l ?? null,
      filenameSlrb: input.filenameSlrb ?? null,
      fileHash: preview.fileHash561l,
      fileHashSlrb: preview.fileHashSlrb,
      detectedAccount: verifiedCode,
      rowsRead: parsed561.rows.length + parsedSlrb.rows.length,
      rowsValid: parsed561.lines.length,
      dryRun: false,
      createdById: actorUserId,
      completedAt: new Date(),
      issues: preview.issues as unknown as Prisma.InputJsonValue,
      diagnostics: { preview } as unknown as Prisma.InputJsonValue,
    },
  });

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  await prisma.$transaction(async (tx) => {
    // Upsert SLRB documents first
    for (const doc of parsedSlrb.documents) {
      if (!doc.documentReference) continue;
      const data = {
        companyId: company.id,
        autopartCustomerCode: verifiedCode,
        documentType: doc.documentType,
        documentReference: doc.documentReference,
        documentDate: dateOnlyToUtcNoon(doc.documentDate),
        goodsNet: doc.goodsNet,
        vat: doc.vat,
        grossTotal: doc.grossTotal,
        source: "SLRB",
        importRunId: run.id,
      };
      const existing = await tx.autopartSalesDocument.findUnique({
        where: {
          companyId_documentType_documentReference: {
            companyId: company.id,
            documentType: doc.documentType,
            documentReference: doc.documentReference,
          },
        },
      });
      if (existing) {
        await tx.autopartSalesDocument.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await tx.autopartSalesDocument.create({ data });
        imported += 1;
      }
    }

    // Ensure documents exist for 561L refs even when SLRB missing
    for (const line of parsed561.lines) {
      if (!line.documentReference || !line.sourceLineNumber || !line.partNumber) {
        skipped += 1;
        continue;
      }
      const slrb = slrbByRef.get(line.documentReference);
      const documentType = (
        line.documentType === "CREDIT" ? "CREDIT" : "INVOICE"
      ) as "INVOICE" | "CREDIT";
      let document = await tx.autopartSalesDocument.findUnique({
        where: {
          companyId_documentType_documentReference: {
            companyId: company.id,
            documentType,
            documentReference: line.documentReference,
          },
        },
      });
      if (!document) {
        document = await tx.autopartSalesDocument.create({
          data: {
            companyId: company.id,
            autopartCustomerCode: verifiedCode,
            documentType,
            documentReference: line.documentReference,
            documentDate: dateOnlyToUtcNoon(slrb?.documentDate ?? null),
            goodsNet: slrb?.goodsNet ?? null,
            vat: slrb?.vat ?? null,
            grossTotal: slrb?.grossTotal ?? null,
            source: slrb ? "SLRB" : "561L",
            importRunId: run.id,
          },
        });
        imported += 1;
      } else if (slrb?.documentDate && !document.documentDate) {
        await tx.autopartSalesDocument.update({
          where: { id: document.id },
          data: {
            documentDate: dateOnlyToUtcNoon(slrb.documentDate),
            goodsNet: slrb.goodsNet,
            vat: slrb.vat,
            grossTotal: slrb.grossTotal,
            source: "SLRB",
            importRunId: run.id,
          },
        });
        updated += 1;
      }

      const skuKey = line.partNumber.trim().toUpperCase();
      const matchedVariantId = skuMap.get(skuKey) ?? null;
      const lineData = {
        companyId: company.id,
        documentId: document.id,
        autopartCustomerCode: verifiedCode,
        documentType,
        documentReference: line.documentReference,
        lineNumber: line.sourceLineNumber,
        sku: line.partNumber.trim(),
        descriptionSnapshot: line.description,
        units: line.units ?? 0,
        salesNet: line.salesNet ?? "0.00",
        matchedVariantId,
        matchStatus: matchedVariantId
          ? ("MATCHED" as const)
          : ("NOT_IN_AB_CATALOGUE" as const),
        rawInvAndLn: line.rawInvAndLn,
        source: "561L",
        importRunId: run.id,
      };

      const existingLine = await tx.autopartSalesLine.findUnique({
        where: {
          companyId_documentType_documentReference_lineNumber: {
            companyId: company.id,
            documentType,
            documentReference: line.documentReference,
            lineNumber: line.sourceLineNumber,
          },
        },
      });
      if (existingLine) {
        await tx.autopartSalesLine.update({ where: { id: existingLine.id }, data: lineData });
        updated += 1;
      } else {
        await tx.autopartSalesLine.create({ data: lineData });
        imported += 1;
      }
    }
  });

  await prisma.autopartCustomerImportRun.update({
    where: { id: run.id },
    data: {
      rowsImported: imported,
      rowsUpdated: updated,
      rowsSkipped: skipped,
      rowsUnmatched: preview.matching.unmatched561Documents,
      completedAt: new Date(),
    },
  });

  await recordAuditEvent({
    action: preview.alreadyImported
      ? "autopart.history_reimported"
      : "autopart.history_imported",
    entityType: "Company",
    entityId: company.id,
    actorUserId,
    companyId: company.id,
    after: {
      runId: run.id,
      filename561l: input.filename561l ?? null,
      filenameSlrb: input.filenameSlrb ?? null,
      imported,
      updated,
      skipped,
    },
  });

  return {
    runId: run.id,
    imported,
    updated,
    skipped,
    workspace: await getCompanyAutopartHistoryWorkspace(actorUserId, company.id),
  };
}

// ─── Credit 407P100 ──────────────────────────────────────────────────────────

const creditPreviewSchema = z.object({
  companyId: z.string().cuid(),
  file407: z.string().min(1),
  filename: z.string().max(260).optional(),
});

async function assertCanImportCredit(actorUserId: string, companyId: string) {
  try {
    return await assertStaffCompanyAccess(actorUserId, companyId, "credit.edit");
  } catch {
    return assertStaffCompanyAccess(actorUserId, companyId, "companies.edit");
  }
}

export async function previewAutopartCreditImport(actorUserId: string, raw: unknown) {
  await assertCanImportCredit(actorUserId, (raw as { companyId: string }).companyId);
  const input = creditPreviewSchema.parse(raw);
  return buildCreditPreview(actorUserId, input, true);
}

async function buildCreditPreview(
  actorUserId: string,
  input: z.infer<typeof creditPreviewSchema>,
  persistRun: boolean,
) {
  const company = await loadVerifiedCompany(input.companyId);
  const issues: ImportIssue[] = [];
  if (!company.autopartCustomerCode || !company.autopartCustomerCodeVerifiedAt) {
    issues.push({
      severity: "BLOCKING",
      code: "AUTOPART_NOT_VERIFIED",
      message: "Company Autopart account must be staff-verified before credit import.",
    });
  }

  const parsed = parseAutopart407p100(input.file407);
  if (!parsed.headerFound || parsed.positions.length === 0) {
    issues.push({
      severity: "BLOCKING",
      code: "UNRECOGNISED_407P100",
      message: "407P100 report format not recognised or empty.",
    });
  }

  const verifiedCode = company.autopartCustomerCode
    ? normaliseAccountToken(company.autopartCustomerCode)
    : null;
  const accepted = verifiedCode
    ? await loadAcceptedAccounts(input.companyId, verifiedCode)
    : new Set<string>();
  const accountCheck = accountAllowed(parsed.detectedAccounts, accepted);
  if (parsed.detectedAccounts.length && !accountCheck.ok) {
    issues.push({
      severity: "BLOCKING",
      code: "ACCOUNT_MISMATCH",
      message: `Detected account(s) ${accountCheck.unmatched.join(", ")} do not match verified account ${verifiedCode ?? "—"}.`,
    });
  }

  // Prefer the position matching verified account; else sole position.
  const position =
    parsed.positions.find((p) => p.accountCode && accepted.has(p.accountCode)) ??
    (parsed.positions.length === 1 ? parsed.positions[0]! : null);

  if (!position) {
    issues.push({
      severity: "BLOCKING",
      code: "NO_POSITION",
      message: "Could not select a credit position row for this company.",
    });
  }

  const hash = sha256(input.file407);
  const prior = await prisma.autopartCustomerImportRun.findFirst({
    where: {
      companyId: input.companyId,
      type: "CREDIT_407P100",
      status: "COMMITTED",
      fileHash: hash,
    },
  });
  if (prior) {
    issues.push({
      severity: "INFO",
      code: "ALREADY_IMPORTED",
      message: "This exact 407P100 file has already been imported.",
    });
  }

  const blocking = issues.some((i) => i.severity === "BLOCKING");
  const preview = {
    companyId: company.id,
    companyName: company.name,
    verifiedAccount: verifiedCode,
    detectedAccounts: parsed.detectedAccounts,
    fileHash: hash,
    filename: input.filename ?? null,
    alreadyImported: Boolean(prior),
    position: position
      ? {
          accountCode: position.accountCode,
          invoices: position.invoices,
          picking: position.picking,
          dropShip: position.dropShip,
          crossDock: position.crossDock,
          suspends: position.suspends,
          unConsol: position.unConsol,
          usedCredit: position.totalExposure,
          creditLimit: position.creditLimit,
          availableCreditRaw: position.availableCreditRaw,
          availableCreditDisplay: position.availableCreditDisplay,
          overLimitBy: position.overLimitBy,
        }
      : null,
    issues,
    canCommit: !blocking && Boolean(position),
    /** Company.creditLimit is retained for legacy fields; displayed CURRENT Autopart credit uses 407P100. */
    companyCreditLimitNote:
      company.creditLimit != null
        ? `Company.creditLimit is £${moneyToString(parseMoney(String(company.creditLimit))!, 2)}; imported Autopart credit limit takes precedence for current credit display.`
        : null,
  };

  let runId: string | null = null;
  if (persistRun) {
    const run = await prisma.autopartCustomerImportRun.create({
      data: {
        companyId: company.id,
        type: "CREDIT_407P100",
        status: blocking ? "BLOCKED" : "PREVIEWED",
        filename: input.filename ?? null,
        fileHash: hash,
        detectedAccount: position?.accountCode ?? detectedAccountJoin(parsed.detectedAccounts),
        rowsRead: parsed.positions.length,
        rowsValid: position ? 1 : 0,
        issues: issues as unknown as Prisma.InputJsonValue,
        diagnostics: preview as unknown as Prisma.InputJsonValue,
        dryRun: true,
        createdById: actorUserId,
      },
    });
    runId = run.id;
  }

  return { ...preview, runId };
}

function detectedAccountJoin(accounts: string[]): string | null {
  return accounts.length ? accounts.join(",") : null;
}

export async function confirmAutopartCreditImport(actorUserId: string, raw: unknown) {
  await assertCanImportCredit(actorUserId, (raw as { companyId: string }).companyId);
  const input = creditPreviewSchema.parse(raw);
  const preview = await buildCreditPreview(actorUserId, input, false);
  if (!preview.canCommit || !preview.position) {
    throw new AuthError(
      preview.issues.find((i) => i.severity === "BLOCKING")?.message ?? "Import blocked",
      "IMPORT_BLOCKED",
      400,
    );
  }

  const company = await loadVerifiedCompany(input.companyId);
  const verifiedCode = normaliseAccountToken(company.autopartCustomerCode)!;
  const p = preview.position;
  const now = new Date();

  const run = await prisma.autopartCustomerImportRun.create({
    data: {
      companyId: company.id,
      type: "CREDIT_407P100",
      status: "COMMITTED",
      filename: input.filename ?? null,
      fileHash: preview.fileHash,
      detectedAccount: p.accountCode ?? verifiedCode,
      rowsRead: 1,
      rowsValid: 1,
      rowsImported: 1,
      dryRun: false,
      createdById: actorUserId,
      completedAt: now,
      issues: preview.issues as unknown as Prisma.InputJsonValue,
      diagnostics: { preview } as unknown as Prisma.InputJsonValue,
    },
  });

  const existing = await prisma.autopartCreditPosition.findUnique({
    where: { companyId: company.id },
  });

  await prisma.autopartCreditPosition.upsert({
    where: { companyId: company.id },
    create: {
      companyId: company.id,
      autopartCustomerCode: verifiedCode,
      invoices: p.invoices,
      picking: p.picking,
      dropShip: p.dropShip,
      crossDock: p.crossDock,
      suspends: p.suspends,
      unConsol: p.unConsol,
      totalExposure: p.usedCredit,
      creditLimit: p.creditLimit,
      availableCreditRaw: p.availableCreditRaw,
      sourceReport: "407P100",
      sourceImportedAt: now,
      sourceImportRunId: run.id,
    },
    update: {
      autopartCustomerCode: verifiedCode,
      invoices: p.invoices,
      picking: p.picking,
      dropShip: p.dropShip,
      crossDock: p.crossDock,
      suspends: p.suspends,
      unConsol: p.unConsol,
      totalExposure: p.usedCredit,
      creditLimit: p.creditLimit,
      availableCreditRaw: p.availableCreditRaw,
      sourceReport: "407P100",
      sourceImportedAt: now,
      sourceImportRunId: run.id,
    },
  });

  await recordAuditEvent({
    action: existing ? "autopart.credit_updated" : "autopart.credit_imported",
    entityType: "Company",
    entityId: company.id,
    actorUserId,
    companyId: company.id,
    after: {
      runId: run.id,
      filename: input.filename ?? null,
      usedCredit: p.usedCredit,
      creditLimit: p.creditLimit,
      availableCreditRaw: p.availableCreditRaw,
    },
  });

  return {
    runId: run.id,
    workspace: await getCompanyAutopartHistoryWorkspace(actorUserId, company.id),
  };
}

// ─── Portal credit + purchases ───────────────────────────────────────────────

export async function getPortalCreditSummary(userId: string) {
  const { company } = await requireTradePortalCompany(userId);
  const credit = await prisma.autopartCreditPosition.findUnique({
    where: { companyId: company.id },
  });
  if (!credit) {
    return {
      available: false as const,
      freshness: "NOT_AVAILABLE" as const,
      message: "Credit information not currently available.",
    };
  }
  const raw = parseMoney(String(credit.availableCreditRaw)) ?? moneyZero();
  const freshness = creditFreshnessFromImportedAt(credit.sourceImportedAt);
  return {
    available: true as const,
    freshness,
    creditLimit: moneyToString(parseMoney(String(credit.creditLimit))!, 2),
    usedCredit: moneyToString(parseMoney(String(credit.totalExposure))!, 2),
    availableCreditRaw: moneyToString(raw, 2),
    availableCreditDisplay: raw.minor < 0n ? "0.00" : moneyToString(raw, 2),
    overLimitBy: raw.minor < 0n ? moneyToString({ minor: -raw.minor }, 2) : null,
    sourceImportedAt: credit.sourceImportedAt.toISOString(),
    message:
      freshness === "STALE"
        ? `Last updated ${credit.sourceImportedAt.toISOString()} — not a live balance.`
        : null,
  };
}

export async function listPortalHistoricPurchases(
  userId: string,
  raw?: { q?: string; filter?: "ALL" | "AVAILABLE" | "UNAVAILABLE" },
) {
  const { company } = await requireTradePortalCompany(userId);
  await requireCompanyPermission(userId, company.id, "orders.view");

  const q = raw?.q?.trim() ?? "";
  const filter = raw?.filter ?? "ALL";

  const groups = await prisma.autopartSalesLine.groupBy({
    by: ["sku"],
    where: {
      companyId: company.id,
      ...(q
        ? {
            OR: [
              { sku: { contains: q, mode: "insensitive" } },
              { descriptionSnapshot: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    _sum: { units: true, salesNet: true },
    _count: { _all: true },
  });

  const skus = groups.map((g) => g.sku);
  const variants = skus.length
    ? await prisma.productVariant.findMany({
        where: {
          OR: skus.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })),
        },
        select: {
          id: true,
          sku: true,
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              isActive: true,
              isTradeVisible: true,
              status: true,
            },
          },
        },
      })
    : [];
  const variantBySku = new Map(variants.map((v) => [v.sku.trim().toUpperCase(), v]));

  // Last purchased = latest SLRB-dated document among lines for that SKU
  const datedLines = skus.length
    ? await prisma.autopartSalesLine.findMany({
        where: {
          companyId: company.id,
          sku: { in: skus },
          document: { documentDate: { not: null } },
        },
        select: {
          sku: true,
          document: { select: { documentDate: true } },
        },
      })
    : [];
  const lastBySku = new Map<string, string>();
  for (const row of datedLines) {
    const d = row.document?.documentDate;
    if (!d) continue;
    const key = row.sku.trim().toUpperCase();
    const iso = d.toISOString().slice(0, 10);
    const prev = lastBySku.get(key);
    if (!prev || iso > prev) lastBySku.set(key, iso);
  }

  let items = groups.map((g) => {
    const v = variantBySku.get(g.sku.trim().toUpperCase());
    const buyAgain =
      Boolean(v) &&
      v!.product.isActive &&
      v!.product.isTradeVisible &&
      v!.product.status === "ACTIVE";
    return {
      sku: g.sku,
      name: v?.product.name ?? g.sku,
      productId: v?.product.id ?? null,
      productSlug: v?.product.slug ?? null,
      variantId: v?.id ?? null,
      netUnits: Number(g._sum.units ?? 0),
      netSpend: moneyToString(parseMoney(String(g._sum.salesNet ?? 0)) ?? moneyZero(), 2),
      lineCount: g._count._all,
      lastPurchasedDate: lastBySku.get(g.sku.trim().toUpperCase()) ?? null,
      currentlyAvailable: buyAgain,
      canBuyAgain: buyAgain,
    };
  });

  if (filter === "AVAILABLE") items = items.filter((i) => i.currentlyAvailable);
  if (filter === "UNAVAILABLE") items = items.filter((i) => !i.currentlyAvailable);

  items.sort((a, b) => {
    if (a.lastPurchasedDate && b.lastPurchasedDate) {
      return b.lastPurchasedDate.localeCompare(a.lastPurchasedDate);
    }
    if (a.lastPurchasedDate) return -1;
    if (b.lastPurchasedDate) return 1;
    return a.sku.localeCompare(b.sku);
  });

  return { items, total: items.length };
}
