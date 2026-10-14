import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { moneyFromUnknown, moneyToString } from "@/domain/money";
import {
  buildCustomerPriceImportPreview,
  customerPriceFileIssue,
  customerPriceImportTemplateCsv,
  exportNegotiatedPricesCsv,
  parseCustomerPriceCsv,
  parseCustomerPriceXlsx,
  type CustomerPriceFileIssue,
  type CustomerPriceImportLineDraft,
} from "@/domain/customer-price-import";
import { recordAuditEvent, recordAuditEventInTransaction } from "@/server/audit/record";
import type { AuditEventInput } from "@/server/audit/types";
import { listCustomerPrices } from "@/server/pricing/service";
import { grants, hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { AuthError, requireAuthenticatedUser, requireSystemPermission } from "@/server/rbac/guards";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";

const MAX_BASE64_CHARS = 2_800_000;

// Decision audits are written with the approval/rejection transaction.
// The injection point is used only by integration tests to verify rollback.
type ImportDecisionAuditWriter = (tx: Prisma.TransactionClient, input: AuditEventInput) => Promise<void>;
let importDecisionAuditWriter: ImportDecisionAuditWriter = recordAuditEventInTransaction;

export function setCustomerPriceImportDecisionAuditWriterForTests(writer: ImportDecisionAuditWriter | null): void {
  importDecisionAuditWriter = writer ?? recordAuditEventInTransaction;
}

type CompanyRow = {
  id: string;
  name: string;
  accountNumber: string | null;
  autopartCustomerCode: string | null;
  autopartCustomerCodeVerifiedAt: Date | null;
  priceListId: string | null;
};

function accountCode(company: CompanyRow): string | null {
  if (company.autopartCustomerCode && company.autopartCustomerCodeVerifiedAt) {
    return company.autopartCustomerCode;
  }
  return company.accountNumber;
}

function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() || "upload";
  return base.slice(0, 200);
}

function moneyText(value: unknown): string | null {
  const money = moneyFromUnknown(value);
  return money ? moneyToString(money) : null;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function messageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function person(user: { id: string; name: string | null; email: string } | null) {
  if (!user) return null;
  return { id: user.id, name: user.name?.trim() || user.email };
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return left.getTime() === right.getTime();
}

function sameMoney(left: unknown, right: unknown): boolean {
  const a = moneyFromUnknown(left);
  const b = moneyFromUnknown(right);
  if (!a || !b) return false;
  return a.minor === b.minor;
}

async function loadActor(actorUserId: string): Promise<LoadedAccessProfile> {
  const profile = await requireAuthenticatedUser(actorUserId);
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot access customer pricing", "FORBIDDEN", 403);
  }
  return profile;
}

function canApprove(profile: LoadedAccessProfile): boolean {
  return hasPermission(profile, "pricing.approve");
}

async function assertCompanyAccess(profile: LoadedAccessProfile, companyId: string): Promise<CompanyRow> {
  if (!hasPermission(profile, "pricing.view") && !hasPermission(profile, "pricing.approve")) {
    throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
  }
  const privileged =
    grants(profile, "admin.access", "sales.view_all_accounts", "pricing.approve");
  const salesScoped =
    hasPermission(profile, "sales.view_own_accounts") || hasPermission(profile, "sales.view_team_accounts");
  if (!privileged) {
    if (!salesScoped) {
      throw new AuthError("Insufficient permissions", "FORBIDDEN", 403);
    }
    const allowed = await canAccessCompanyAsSales(profile, companyId);
    if (!allowed) throw new AuthError("No access to this company", "COMPANY_FORBIDDEN", 403);
  }
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      accountNumber: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      priceListId: true,
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);
  return company;
}

function serializeLine(row: {
  id: string;
  rowNumber: number;
  sku: string;
  variantId: string | null;
  productName: string | null;
  action: "NEW" | "UPDATE" | "UNCHANGED" | "INVALID";
  proposedPrice: unknown;
  existingPrice: unknown;
  normalPrice: unknown;
  percentChange: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  messages: unknown;
}): CustomerPriceImportLineDraft & { id: string } {
  return {
    id: row.id,
    rowNumber: row.rowNumber,
    sku: row.sku,
    action: row.action,
    variantId: row.variantId,
    productName: row.productName,
    proposedPrice: moneyText(row.proposedPrice),
    existingPrice: moneyText(row.existingPrice),
    normalPrice: moneyText(row.normalPrice),
    percentChange: row.percentChange,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    existingStartsAt: null,
    existingEndsAt: null,
    existingUpdatedAt: null,
    messages: messageList(row.messages),
  };
}

function lineCreate(importId: string, line: CustomerPriceImportLineDraft): Prisma.CustomerPriceImportLineCreateManyInput {
  return {
    importId,
    rowNumber: line.rowNumber,
    sku: line.sku.slice(0, 120),
    variantId: line.variantId,
    productName: line.productName ? line.productName.slice(0, 300) : null,
    action: line.action,
    proposedPrice: line.proposedPrice,
    existingPrice: line.existingPrice,
    normalPrice: line.normalPrice,
    percentChange: line.percentChange,
    startsAt: line.startsAt ? new Date(line.startsAt) : null,
    endsAt: line.endsAt ? new Date(line.endsAt) : null,
    existingStartsAt: line.existingStartsAt ? new Date(line.existingStartsAt) : null,
    existingEndsAt: line.existingEndsAt ? new Date(line.existingEndsAt) : null,
    existingUpdatedAt: line.existingUpdatedAt ? new Date(line.existingUpdatedAt) : null,
    messages: line.messages.slice(0, 8).map((message) => message.slice(0, 300)),
  };
}

export async function getCustomerPriceImportWorkspace(actorUserId: string, companyId: string) {
  const profile = await loadActor(actorUserId);
  const company = await assertCompanyAccess(profile, companyId);
  const prices = await listCustomerPrices(actorUserId, companyId);
  const imports = await prisma.customerPriceImport.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: {
      submittedBy: { select: { id: true, name: true, email: true } },
      decidedBy: { select: { id: true, name: true, email: true } },
    },
  });
  return {
    company: { id: company.id, name: company.name, accountCode: accountCode(company) },
    assignedPriceList: prices.assignedPriceList,
    negotiatedCount: prices.count,
    prices: prices.items,
    canSubmit: true,
    canApprove: canApprove(profile),
    imports: imports.map((row) => ({
      id: row.id,
      filename: row.filename,
      status: row.status,
      submittedAt: iso(row.submittedAt),
      decidedAt: iso(row.decidedAt),
      rejectionReason: row.rejectionReason,
      productsFound: row.productsFound,
      newCount: row.newCount,
      updateCount: row.updateCount,
      unchangedCount: row.unchangedCount,
      invalidCount: row.invalidCount,
      createdAt: row.createdAt.toISOString(),
      submittedBy: person(row.submittedBy),
      decidedBy: person(row.decidedBy),
    })),
  };
}

export async function getCustomerPriceImport(actorUserId: string, companyId: string, importId: string) {
  const profile = await loadActor(actorUserId);
  const company = await assertCompanyAccess(profile, companyId);
  const row = await prisma.customerPriceImport.findFirst({
    where: { id: importId, companyId },
    include: {
      submittedBy: { select: { id: true, name: true, email: true } },
      decidedBy: { select: { id: true, name: true, email: true } },
      lines: { orderBy: { rowNumber: "asc" } },
    },
  });
  if (!row) throw new AuthError("Price upload not found", "NOT_FOUND", 404);
  return {
    id: row.id,
    company: { id: company.id, name: company.name, accountCode: accountCode(company) },
    filename: row.filename,
    status: row.status,
    submittedAt: iso(row.submittedAt),
    decidedAt: iso(row.decidedAt),
    rejectionReason: row.rejectionReason,
    productsFound: row.productsFound,
    newCount: row.newCount,
    updateCount: row.updateCount,
    unchangedCount: row.unchangedCount,
    invalidCount: row.invalidCount,
    createdAt: row.createdAt.toISOString(),
    submittedBy: person(row.submittedBy),
    decidedBy: person(row.decidedBy),
    lines: row.lines.map(serializeLine),
  };
}

export function getCustomerPriceImportTemplate(actorUserId: string) {
  return requireSystemPermission(actorUserId, "pricing.view").then((profile) => {
    if (profile.actorType === "TRADE") {
      throw new AuthError("Trade users cannot access customer pricing", "FORBIDDEN", 403);
    }
    return { filename: "customer-trade-prices-template.csv", csv: customerPriceImportTemplateCsv() };
  });
}

export async function exportCustomerNegotiatedPricesCsv(actorUserId: string, companyId: string) {
  const profile = await loadActor(actorUserId);
  await assertCompanyAccess(profile, companyId);
  const rows = await prisma.customerPrice.findMany({
    where: { companyId },
    include: { variant: { select: { sku: true, product: { select: { name: true } } } } },
    orderBy: { variant: { sku: "asc" } },
  });
  const csv = exportNegotiatedPricesCsv(
    rows.map((row) => ({
      sku: row.variant.sku,
      productName: row.variant.product.name,
      unitPrice: moneyText(row.unitPrice) ?? "",
      startsAt: iso(row.startsAt),
      endsAt: iso(row.endsAt),
    })),
  );
  return { filename: "customer-trade-prices.csv", csv };
}

function decodeUpload(fileBase64: string): Buffer {
  const cleaned = fileBase64.replace(/\s/g, "");
  if (!cleaned || cleaned.length > MAX_BASE64_CHARS || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new AuthError("The uploaded file is malformed or too large", "BAD_FILE", 400);
  }
  return Buffer.from(cleaned, "base64");
}

export async function previewCustomerPriceImport(
  actorUserId: string,
  raw: { companyId: string; filename: string; fileBase64: string },
) {
  const profile = await loadActor(actorUserId);
  const company = await assertCompanyAccess(profile, raw.companyId);
  const filename = safeFilename(raw.filename);
  const bytes = decodeUpload(raw.fileBase64);
  const fileIssue = customerPriceFileIssue({ filename, byteLength: bytes.byteLength });
  const emptyPreview = (fileIssues: CustomerPriceFileIssue[]) => ({
    importId: null as string | null,
    filename,
    companyName: company.name,
    accountCode: accountCode(company),
    productsFound: 0,
    newCount: 0,
    updateCount: 0,
    unchangedCount: 0,
    invalidCount: 0,
    fileIssues,
    lines: [] as CustomerPriceImportLineDraft[],
    canSubmit: false,
  });
  if (fileIssue) return emptyPreview([{ rowNumber: null, message: fileIssue }]);

  const ext = filename.split(".").pop()?.toLowerCase();
  const parsed =
    ext === "xlsx" ? await parseCustomerPriceXlsx(bytes) : parseCustomerPriceCsv(bytes.toString("utf8"));
  if (parsed.fileIssues.length) return emptyPreview(parsed.fileIssues);

  const skus = [...new Set(parsed.rows.map((row) => row.sku.trim()).filter(Boolean))];
  const variants = skus.length
    ? await prisma.productVariant.findMany({
        where: { OR: skus.map((sku) => ({ sku: { equals: sku, mode: "insensitive" as const } })) },
        select: {
          id: true,
          sku: true,
          tradePrice: true,
          product: { select: { name: true } },
        },
      })
    : [];
  const variantIds = variants.map((row) => row.id);
  const existing = variantIds.length
    ? await prisma.customerPrice.findMany({
        where: { companyId: company.id, variantId: { in: variantIds } },
      })
    : [];
  const listPrices =
    company.priceListId && variantIds.length
      ? await prisma.priceListItem.findMany({
          where: { priceListId: company.priceListId, variantId: { in: variantIds } },
          select: { variantId: true, unitPrice: true },
        })
      : [];
  const preview = buildCustomerPriceImportPreview({
    companyId: company.id,
    rows: parsed.rows,
    variants: variants.map((row) => ({
      id: row.id,
      sku: row.sku,
      productName: row.product.name,
      tradePrice: moneyText(row.tradePrice),
    })),
    existingPrices: existing.flatMap((row) => {
      const unitPrice = moneyText(row.unitPrice);
      if (!unitPrice) return [];
      return [
        {
          variantId: row.variantId,
          unitPrice,
          startsAt: iso(row.startsAt),
          endsAt: iso(row.endsAt),
          updatedAt: row.updatedAt.toISOString(),
        },
      ];
    }),
    priceListPrices: listPrices.flatMap((row) => {
      const unitPrice = moneyText(row.unitPrice);
      return unitPrice ? [{ variantId: row.variantId, unitPrice }] : [];
    }),
  });

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.customerPriceImport.create({
      data: {
        companyId: company.id,
        filename,
        status: "DRAFT",
        submittedByUserId: actorUserId,
        productsFound: preview.productsFound,
        newCount: preview.newCount,
        updateCount: preview.updateCount,
        unchangedCount: preview.unchangedCount,
        invalidCount: preview.invalidCount,
        rowFingerprint: preview.fingerprint,
      },
    });
    if (preview.lines.length) {
      await tx.customerPriceImportLine.createMany({
        data: preview.lines.map((line) => lineCreate(row.id, line)),
      });
    }
    return row;
  });
  await recordAuditEvent({
    action: "pricing.customer_price_import.drafted",
    entityType: "CustomerPriceImport",
    entityId: created.id,
    actorUserId,
    companyId: company.id,
    metadata: {
      filename,
      productsFound: preview.productsFound,
      newCount: preview.newCount,
      updateCount: preview.updateCount,
      unchangedCount: preview.unchangedCount,
      invalidCount: preview.invalidCount,
    },
  });

  return {
    importId: created.id,
    filename,
    companyName: company.name,
    accountCode: accountCode(company),
    productsFound: preview.productsFound,
    newCount: preview.newCount,
    updateCount: preview.updateCount,
    unchangedCount: preview.unchangedCount,
    invalidCount: preview.invalidCount,
    fileIssues: [] as CustomerPriceFileIssue[],
    lines: preview.lines,
    canSubmit: preview.invalidCount === 0 && preview.newCount + preview.updateCount > 0,
  };
}

export async function submitCustomerPriceImport(actorUserId: string, companyId: string, importId: string) {
  const profile = await loadActor(actorUserId);
  await assertCompanyAccess(profile, companyId);
  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.customerPriceImport.findFirst({ where: { id: importId, companyId } });
      if (!current) throw new AuthError("Price upload not found", "NOT_FOUND", 404);
      if (current.status !== "DRAFT") {
        throw new AuthError("This upload has already been submitted", "CONFLICT", 409);
      }
      if (current.invalidCount > 0) {
        throw new AuthError("Correct the invalid rows before submitting", "INVALID", 400);
      }
      if (current.newCount + current.updateCount < 1) {
        throw new AuthError("No price changes to submit", "INVALID", 400);
      }
      const duplicate = await tx.customerPriceImport.findFirst({
        where: {
          companyId,
          status: "PENDING_APPROVAL",
          rowFingerprint: current.rowFingerprint,
          NOT: { id: current.id },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new AuthError("An identical price upload is already pending approval", "DUPLICATE", 409);
      }
      await tx.customerPriceImport.update({
        where: { id: current.id },
        data: { status: "PENDING_APPROVAL", submittedAt: new Date() },
      });
    });
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AuthError("An identical price upload is already pending approval", "DUPLICATE", 409);
    }
    throw error;
  }
  const saved = await prisma.customerPriceImport.findFirstOrThrow({ where: { id: importId, companyId } });
  await recordAuditEvent({
    action: "pricing.customer_price_import.submitted",
    entityType: "CustomerPriceImport",
    entityId: importId,
    actorUserId,
    companyId,
    metadata: {
      filename: saved.filename,
      newCount: saved.newCount,
      updateCount: saved.updateCount,
      unchangedCount: saved.unchangedCount,
    },
  });
  return { id: saved.id, status: saved.status, submittedAt: iso(saved.submittedAt) };
}

export async function rejectCustomerPriceImport(
  actorUserId: string,
  input: { companyId: string; importId: string; reason: string },
) {
  const profile = await requireSystemPermission(actorUserId, "pricing.approve");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot access customer pricing", "FORBIDDEN", 403);
  }
  await assertCompanyAccess(profile, input.companyId);
  const reason = input.reason.trim();
  if (!reason) throw new AuthError("A rejection reason is required", "INVALID", 400);
  if (reason.length > 500) throw new AuthError("Rejection reason is too long", "INVALID", 400);
  const decidedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.customerPriceImport.updateMany({
      where: { id: input.importId, companyId: input.companyId, status: "PENDING_APPROVAL" },
      data: {
        status: "REJECTED",
        rejectionReason: reason,
        decidedByUserId: actorUserId,
        decidedAt,
      },
    });
    if (claimed.count !== 1) {
      throw new AuthError("This upload is no longer pending approval", "CONFLICT", 409);
    }
    await importDecisionAuditWriter(tx, {
      action: "pricing.customer_price_import.rejected",
      entityType: "CustomerPriceImport",
      entityId: input.importId,
      actorUserId,
      companyId: input.companyId,
      metadata: { reason },
    });
  });
  return { id: input.importId, status: "REJECTED" as const, rejectionReason: reason };
}

export async function approveCustomerPriceImport(actorUserId: string, companyId: string, importId: string) {
  const profile = await requireSystemPermission(actorUserId, "pricing.approve");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade users cannot access customer pricing", "FORBIDDEN", 403);
  }
  const company = await assertCompanyAccess(profile, companyId);
  const decidedAt = new Date();

  const applied = await (async () => {
    try {
      return await prisma.$transaction(async (tx) => {
    const claimed = await tx.customerPriceImport.updateMany({
      where: { id: importId, companyId, status: "PENDING_APPROVAL" },
      data: { status: "APPROVED", decidedByUserId: actorUserId, decidedAt },
    });
    if (claimed.count !== 1) {
      throw new AuthError("This upload is no longer pending approval", "CONFLICT", 409);
    }
    const batch = await tx.customerPriceImport.findFirst({
      where: { id: importId, companyId },
      include: { lines: true },
    });
    if (!batch) throw new AuthError("Price upload not found", "NOT_FOUND", 404);
    const changes: Array<{ sku: string; action: "NEW" | "UPDATE"; from: string | null; to: string }> = [];
    for (const line of batch.lines) {
      if (line.action === "UNCHANGED" || line.action === "INVALID") continue;
      if ((line.action !== "NEW" && line.action !== "UPDATE") || !line.variantId || line.proposedPrice == null) {
        throw new AuthError(`Row ${line.rowNumber}: the preview is incomplete`, "STALE", 409);
      }
      const variant = await tx.productVariant.findUnique({
        where: { id: line.variantId },
        select: { id: true, sku: true },
      });
      if (!variant || variant.sku.toUpperCase() !== line.sku.trim().toUpperCase()) {
        throw new AuthError(`Row ${line.rowNumber}: the product match changed since preview`, "STALE", 409);
      }
      // Lock existing rows before validating the preview snapshot. Concurrent manual
      // edits wait for the decision transaction or become visible to this check.
      // For NEW rows, the unique constraint plus create (not upsert) prevents
      // a concurrent insert from silently being overwritten.
      if (line.action === "UPDATE") {
        await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "CustomerPrice"
          WHERE "companyId" = ${companyId} AND "variantId" = ${line.variantId}
          FOR UPDATE
        `;
      }
      const current = await tx.customerPrice.findUnique({
        where: { companyId_variantId: { companyId, variantId: line.variantId } },
      });
      if (line.action === "NEW") {
        if (current) {
          throw new AuthError(`Row ${line.rowNumber}: a customer price was added since preview`, "STALE", 409);
        }
      } else if (
        !current ||
        !sameMoney(current.unitPrice, line.existingPrice) ||
        !sameInstant(current.startsAt, line.existingStartsAt) ||
        !sameInstant(current.endsAt, line.existingEndsAt) ||
        !sameInstant(current.updatedAt, line.existingUpdatedAt)
      ) {
        throw new AuthError(`Row ${line.rowNumber}: the customer price changed since preview`, "STALE", 409);
      }
      if (line.action === "NEW") {
        await tx.customerPrice.create({
          data: {
            companyId,
            variantId: line.variantId,
            unitPrice: line.proposedPrice,
            startsAt: line.startsAt,
            endsAt: line.endsAt,
          },
        });
      } else {
        const updated = await tx.customerPrice.updateMany({
          where: {
            companyId,
            variantId: line.variantId,
            updatedAt: line.existingUpdatedAt!,
          },
          data: {
            unitPrice: line.proposedPrice,
            startsAt: line.startsAt,
            endsAt: line.endsAt,
          },
        });
        if (updated.count !== 1) {
          throw new AuthError(`Row ${line.rowNumber}: the customer price changed since preview`, "STALE", 409);
        }
      }
      changes.push({
        sku: variant.sku,
        action: line.action,
        from: moneyText(line.existingPrice),
        to: moneyToString(moneyFromUnknown(line.proposedPrice) ?? { minor: 0n }),
      });
    }
    await importDecisionAuditWriter(tx, {
      action: "pricing.customer_price_import.approved",
      entityType: "CustomerPriceImport",
      entityId: importId,
      actorUserId,
      companyId: company.id,
      metadata: {
        filename: batch.filename,
        newCount: batch.newCount,
        updateCount: batch.updateCount,
        changes,
      },
    });
    return { filename: batch.filename, newCount: batch.newCount, updateCount: batch.updateCount, changes };
      }, { timeout: 30_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AuthError(
          "A customer price was added since preview. Refresh the upload and try again.",
          "STALE",
          409,
        );
      }
      throw error;
    }
  })();

  return { id: importId, status: "APPROVED" as const, applied: applied.changes.length };
}
