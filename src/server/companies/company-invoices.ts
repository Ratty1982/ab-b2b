import { prisma } from "@/infra/database/client";
import { companyInvoiceKindLabel, companyInvoiceStatusLabel } from "@/domain/company-invoice";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { getAccessibleCompanyIdsForSales } from "@/server/rbac/sales-access";

const PAGE_SIZE = 50;

function moneyLabel(value: { toFixed: (digits: number) => string } | string | number): string {
  if (typeof value === "number") return value.toFixed(2);
  if (typeof value === "string") return value;
  return value.toFixed(2);
}

/**
 * Invoices already recorded for one company.
 * This is not a statement or a live account balance.
 */
export async function listCompanyInvoices(
  actorUserId: string,
  input: { companyId: string; q?: string },
) {
  const profile = await requireSystemPermission(actorUserId, "invoices.view");
  const accessible = await getAccessibleCompanyIdsForSales(profile);
  if (accessible !== "all" && !accessible.includes(input.companyId)) {
    throw new AuthError("Company is outside your access", "FORBIDDEN", 403);
  }

  const q = input.q?.trim();
  const where = {
    companyId: input.companyId,
    ...(q
      ? {
          OR: [
            { invoiceNumber: { contains: q, mode: "insensitive" as const } },
            { externalRef: { contains: q, mode: "insensitive" as const } },
            { order: { orderNumber: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      take: PAGE_SIZE,
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        issuedAt: true,
        dueAt: true,
        grandTotal: true,
        currency: true,
        externalRef: true,
        autopartDocumentKind: true,
        order: { select: { id: true, orderNumber: true } },
      },
    }),
  ]);

  return {
    total,
    shown: rows.length,
    items: rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      status: row.status,
      statusLabel: companyInvoiceStatusLabel(row.status),
      kindLabel: companyInvoiceKindLabel(row.autopartDocumentKind),
      issuedAt: row.issuedAt?.toISOString() ?? null,
      dueAt: row.dueAt?.toISOString() ?? null,
      grandTotal: moneyLabel(row.grandTotal),
      currency: row.currency,
      accountsReference: row.externalRef,
      orderId: row.order?.id ?? null,
      orderNumber: row.order?.orderNumber ?? null,
    })),
  };
}
