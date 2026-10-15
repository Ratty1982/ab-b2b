/**
 * Imports one 561L-ALL file and one SLRB-ALL file.
 * Verified accounts update the customer sales dataset.
 * Other accounts are staged for review and are not certified sales.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { parseAutopart561l } from "@/domain/autopart-561l";
import { parseAutopartSlrb } from "@/domain/autopart-slrb";
import {
  classifyHistoricAccount,
  indexShortVerifiedAccounts,
  planAllHistoricFile,
  type AccountPlan,
  type HistoricAccountDirectory,
  type HistoricAccountTarget,
} from "@/domain/historic-all-file";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { commitHistoricCompanySlice } from "@/server/companies/autopart-history";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";

const confirmSchema = z.object({
  file561l: z.string().min(1),
  fileSlrb: z.string().min(1),
  filename561l: z.string().max(260).optional(),
  filenameSlrb: z.string().max(260).optional(),
});

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function dateOnly(value: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

async function loadDirectory(accountFieldWidth: number | null): Promise<HistoricAccountDirectory> {
  const [companies, aliases, masters] = await Promise.all([
    prisma.company.findMany({
      where: { autopartCustomerCodeVerifiedAt: { not: null }, autopartCustomerCode: { not: null } },
      select: { id: true, autopartCustomerCode: true },
    }),
    prisma.autopartCustomerAccountAlias.findMany({
      select: { companyId: true, alias: true, company: { select: { autopartCustomerCode: true } } },
    }),
    prisma.autopartAccount.findMany({ select: { accountCode: true, companyId: true } }),
  ]);
  const verifiedByCode = new Map<string, HistoricAccountTarget | null>();
  const addVerified = (code: string | null | undefined, companyId: string, canonicalCode: string) => {
    const key = code?.trim().toUpperCase() ?? "";
    if (!key) return;
    const target = { companyId, canonicalCode };
    const current = verifiedByCode.get(key);
    if (current === undefined) verifiedByCode.set(key, target);
    else if (current?.companyId !== companyId) verifiedByCode.set(key, null);
  };
  for (const company of companies) {
    addVerified(company.autopartCustomerCode, company.id, company.autopartCustomerCode!.trim().toUpperCase());
  }
  for (const alias of aliases) {
    const canonical = alias.company.autopartCustomerCode?.trim().toUpperCase() || alias.alias.trim().toUpperCase();
    addVerified(alias.alias, alias.companyId, canonical);
  }
  const masterCompanyByCode = new Map<string, string | null>();
  for (const account of masters) {
    const key = account.accountCode.trim().toUpperCase();
    masterCompanyByCode.set(key, account.companyId);
  }
  return {
    verifiedByCode,
    shortVerifiedByCode: indexShortVerifiedAccounts(verifiedByCode, accountFieldWidth),
    masterCompanyByCode,
    accountFieldWidth,
  };
}

function toPublicAccount(account: AccountPlan) {
  return {
    accountCode: account.accountCode,
    outcome: account.classification.outcome,
    companyId: account.classification.outcome === "import" ? account.classification.companyId : null,
    reason: account.classification.outcome === "review" ? account.classification.reason : null,
    invoiceDocuments: account.invoiceDocuments,
    creditDocuments: account.creditDocuments,
    ledgerRows: account.ledgerRows,
    lineCount: account.lineCount,
    lineNet: account.lineNet,
    goodsNet: account.goodsNet,
    warnings: account.warnings,
  };
}

export async function previewAllHistoricImport(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "autopart.import.view");
  const input = confirmSchema.parse(raw);
  const parsed561 = parseAutopart561l(input.file561l);
  const parsedSlrb = parseAutopartSlrb(input.fileSlrb);
  const directory = await loadDirectory(parsed561.accountFieldWidth);
  const plan = planAllHistoricFile({
    directory,
    lines: parsed561.lines.map((line) => ({
      accountCode: line.accountCode,
      documentType: line.documentType,
      documentReference: line.documentReference,
      sourceLineNumber: line.sourceLineNumber,
      partNumber: line.partNumber,
      description: line.description,
      units: String(line.units ?? 0),
      salesNet: line.salesNet ?? "0.00",
      rawInvAndLn: line.rawInvAndLn,
    })),
    documents: parsedSlrb.documents
      .concat(parsedSlrb.rows.filter((row) => row.documentType === "PAYMENT" || row.documentType === "JOURNAL"))
      .map((document) => ({
        accountCode: document.accountCode,
        documentType: document.documentType,
        documentReference: document.documentReference,
        documentDate: document.documentDate,
        goodsNet: document.goodsNet,
        vat: document.vat,
        grossTotal: document.grossTotal,
      })),
  });
  return {
    fileHash561l: sha256(input.file561l),
    fileHashSlrb: sha256(input.fileSlrb),
    importedAccounts: plan.importedAccounts,
    reviewAccounts: plan.reviewAccounts,
    accounts: plan.accounts.map(toPublicAccount),
    canCommit: plan.accounts.some((account) => account.lineCount > 0 || account.invoiceDocuments + account.creditDocuments > 0),
  };
}

async function buildPlan(file561l: string, fileSlrb: string) {
  const parsed561 = parseAutopart561l(file561l);
  const parsedSlrb = parseAutopartSlrb(fileSlrb);
  const directory = await loadDirectory(parsed561.accountFieldWidth);
  const ledgerRows = parsedSlrb.rows.filter(
    (row) => row.documentType === "PAYMENT" || row.documentType === "JOURNAL",
  );
  const plan = planAllHistoricFile({
    directory,
    lines: parsed561.lines.map((line) => ({
      accountCode: line.accountCode,
      documentType: line.documentType,
      documentReference: line.documentReference,
      sourceLineNumber: line.sourceLineNumber,
      partNumber: line.partNumber,
      description: line.description,
      units: String(line.units ?? 0),
      salesNet: line.salesNet ?? "0.00",
      rawInvAndLn: line.rawInvAndLn,
    })),
    documents: [...parsedSlrb.documents, ...ledgerRows].map((document) => ({
      accountCode: document.accountCode,
      documentType: document.documentType,
      documentReference: document.documentReference,
      documentDate: document.documentDate,
      goodsNet: document.goodsNet,
      vat: document.vat,
      grossTotal: document.grossTotal,
    })),
  });
  return plan;
}

export async function confirmAllHistoricImport(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "autopart.import.manage");
  const input = confirmSchema.parse(raw);
  const plan = await buildPlan(input.file561l, input.fileSlrb);
  if (!plan.accounts.length) {
    throw new AuthError("The reports have no customer accounts.", "IMPORT_BLOCKED", 400);
  }
  const hash561 = sha256(input.file561l);
  const hashSlrb = sha256(input.fileSlrb);
  const created = await prisma.autopartHistoryAllImport.create({
    data: {
      status: "PROCESSING",
      filename561l: input.filename561l ?? null,
      filenameSlrb: input.filenameSlrb ?? null,
      fileHash561l: hash561,
      fileHashSlrb: hashSlrb,
      fileBody561l: Buffer.from(input.file561l, "utf8"),
      fileBodySlrb: Buffer.from(input.fileSlrb, "utf8"),
      accountsRead: plan.accounts.length,
      createdById: actorUserId,
      summary: { accounts: plan.accounts.map(toPublicAccount) } as Prisma.InputJsonValue,
    },
  });

  const reviewCodes = plan.accounts
    .filter((account) => account.classification.outcome === "review")
    .map((account) => account.accountCode);
  if (reviewCodes.length) {
    await prisma.autopartHistoryReviewAccount.updateMany({
      where: { status: "OPEN", accountCode: { in: reviewCodes }, importId: { not: created.id } },
      data: { status: "SUPERSEDED" },
    });
  }

  let documentsWritten = 0;
  let linesWritten = 0;
  let accountsCommitted = 0;
  try {
    for (const account of plan.accounts) {
      if (account.classification.outcome !== "import") continue;
      const written = await commitHistoricCompanySlice({
        actorUserId,
        companyId: account.classification.companyId,
        accountCode: account.classification.canonicalCode,
        filename561l: input.filename561l ?? null,
        filenameSlrb: input.filenameSlrb ?? null,
        fileHash561l: hash561,
        fileHashSlrb: hashSlrb,
        parentImportId: created.id,
        documents: account.documents,
        lines: account.lines,
      });
      documentsWritten += account.documents.length;
      linesWritten += account.lines.length;
      accountsCommitted += 1;
      void written;
    }

    const reviews = plan.accounts.filter((account) => account.classification.outcome === "review");
    if (reviews.length) {
      await prisma.autopartHistoryReviewAccount.createMany({
        data: reviews.map((account) => ({
          importId: created.id,
          accountCode: account.accountCode,
          reason: account.classification.outcome === "review" ? account.classification.reason : "UNKNOWN",
          invoiceDocuments: account.invoiceDocuments,
          creditDocuments: account.creditDocuments,
          ledgerRows: account.ledgerRows,
          lineCount: account.lineCount,
          lineNet: account.lineNet,
          goodsNet: account.goodsNet,
          warnings: account.warnings as unknown as Prisma.InputJsonValue,
        })),
      });
      await stageReviewAccounts(created.id, reviews);
    }
  } catch (error) {
    await prisma.autopartHistoryAllImport.update({
      where: { id: created.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        accountsCommitted,
        documentsWritten,
        linesWritten,
      },
    });
    throw error;
  }

  await prisma.autopartHistoryAllImport.update({
    where: { id: created.id },
    data: {
      status: "COMMITTED",
      completedAt: new Date(),
      accountsCommitted,
      accountsReviewed: reviewCodes.length,
      documentsWritten,
      linesWritten,
    },
  });
  await recordAuditEvent({
    action: "autopart.history_all_imported",
    entityType: "AutopartHistoryAllImport",
    entityId: created.id,
    actorUserId,
    after: {
      importId: created.id,
      fileHash561l: hash561,
      fileHashSlrb: hashSlrb,
      accountsCommitted,
      accountsReviewed: reviewCodes.length,
      documentsWritten,
      linesWritten,
    },
  });
  return {
    importId: created.id,
    status: "COMMITTED" as const,
    accountsCommitted,
    accountsReviewed: reviewCodes.length,
    documentsWritten,
    linesWritten,
    accounts: plan.accounts.map(toPublicAccount),
  };
}

async function stageReviewAccounts(importId: string, accounts: AccountPlan[]) {
  const documents = accounts.flatMap((account) =>
    account.documents.map((document) => ({
      importId,
      accountCode: account.accountCode,
      documentType: document.documentType,
      documentReference: document.documentReference,
      documentDate: dateOnly(document.documentDate),
      goodsNet: document.goodsNet,
      vat: document.vat,
      grossTotal: document.grossTotal,
      source: document.source,
    })),
  );
  const lines = accounts.flatMap((account) =>
    account.lines.map((line) => ({
      importId,
      accountCode: account.accountCode,
      documentType: line.documentType,
      documentReference: line.documentReference,
      lineNumber: line.lineNumber,
      sku: line.sku,
      descriptionSnapshot: line.description,
      units: line.units,
      salesNet: line.salesNet,
      rawInvAndLn: line.rawInvAndLn,
    })),
  );
  for (let i = 0; i < documents.length; i += 300) {
    await prisma.autopartHistoryStagedDocument.createMany({ data: documents.slice(i, i + 300) });
  }
  for (let i = 0; i < lines.length; i += 300) {
    await prisma.autopartHistoryStagedLine.createMany({ data: lines.slice(i, i + 300) });
  }
}

export async function listOpenHistoricReviews(actorUserId: string) {
  await requireSystemPermission(actorUserId, "autopart.import.view");
  const latest = await prisma.autopartHistoryAllImport.findFirst({
    where: { status: "COMMITTED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, filename561l: true, filenameSlrb: true, fileHash561l: true, fileHashSlrb: true },
  });
  if (!latest) return { import: null, reviews: [] };
  const reviews = await prisma.autopartHistoryReviewAccount.findMany({
    where: { importId: latest.id, status: "OPEN" },
    orderBy: { accountCode: "asc" },
    take: 200,
  });
  return {
    import: {
      id: latest.id,
      createdAt: latest.createdAt.toISOString(),
      filename561l: latest.filename561l,
      filenameSlrb: latest.filenameSlrb,
      fileHash561l: latest.fileHash561l,
      fileHashSlrb: latest.fileHashSlrb,
    },
    reviews: reviews.map((review) => ({
      id: review.id,
      accountCode: review.accountCode,
      reason: review.reason,
      invoiceDocuments: review.invoiceDocuments,
      creditDocuments: review.creditDocuments,
      lineCount: review.lineCount,
      lineNet: review.lineNet.toString(),
      goodsNet: review.goodsNet.toString(),
    })),
  };
}

export async function promoteStagedAutopartHistory(actorUserId: string, companyId: string, code: string) {
  const verified = code.trim().toUpperCase();
  if (!verified) return { applied: false as const, documents: 0, lines: 0 };
  const latest = await prisma.autopartHistoryAllImport.findFirst({
    where: { status: "COMMITTED" },
    orderBy: { createdAt: "desc" },
  });
  if (!latest?.fileBody561l || !latest.fileBodySlrb) return { applied: false as const, documents: 0, lines: 0 };
  const parsed561 = parseAutopart561l(Buffer.from(latest.fileBody561l).toString("utf8"));
  const directory = await loadDirectory(parsed561.accountFieldWidth);
  const candidates = [verified];
  if (directory.accountFieldWidth && verified.length > directory.accountFieldWidth) {
    candidates.push(verified.slice(0, directory.accountFieldWidth));
  }
  const reviews = await prisma.autopartHistoryReviewAccount.findMany({
    where: { importId: latest.id, status: "OPEN", accountCode: { in: candidates } },
  });
  let documents = 0;
  let lines = 0;
  for (const review of reviews) {
    if (review.reason === "AMBIGUOUS") continue;
    const classified = classifyHistoricAccount(review.accountCode, directory);
    if (classified.outcome !== "import" || classified.companyId !== companyId) continue;
    const [stagedDocs, stagedLines] = await Promise.all([
      prisma.autopartHistoryStagedDocument.findMany({ where: { importId: latest.id, accountCode: review.accountCode } }),
      prisma.autopartHistoryStagedLine.findMany({ where: { importId: latest.id, accountCode: review.accountCode } }),
    ]);
    if (!stagedDocs.length && !stagedLines.length) continue;
    await commitHistoricCompanySlice({
      actorUserId,
      companyId,
      accountCode: classified.canonicalCode,
      filename561l: latest.filename561l,
      filenameSlrb: latest.filenameSlrb,
      fileHash561l: latest.fileHash561l,
      fileHashSlrb: latest.fileHashSlrb ?? "",
      parentImportId: latest.id,
      documents: stagedDocs.map((document) => ({
        documentType: document.documentType === "CREDIT" ? "CREDIT" : "INVOICE",
        documentReference: document.documentReference,
        documentDate: document.documentDate ? document.documentDate.toISOString().slice(0, 10) : null,
        goodsNet: document.goodsNet?.toString() ?? null,
        vat: document.vat?.toString() ?? null,
        grossTotal: document.grossTotal?.toString() ?? null,
        source: document.source === "561L" ? "561L" : "SLRB",
      })),
      lines: stagedLines.map((line) => ({
        documentType: line.documentType === "CREDIT" ? "CREDIT" : "INVOICE",
        documentReference: line.documentReference,
        lineNumber: line.lineNumber,
        sku: line.sku,
        description: line.descriptionSnapshot,
        units: line.units.toString(),
        salesNet: line.salesNet.toString(),
        rawInvAndLn: line.rawInvAndLn ?? "",
      })),
    });
    await prisma.autopartHistoryReviewAccount.update({
      where: { id: review.id },
      data: { status: "APPLIED", companyId, appliedAt: new Date() },
    });
    documents += stagedDocs.length;
    lines += stagedLines.length;
  }
  return { applied: documents + lines > 0, documents, lines };
}
