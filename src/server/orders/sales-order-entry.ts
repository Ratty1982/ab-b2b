/**
 * Sales order entry on behalf of a customer.
 *
 * Drafts are owned by the staff user and never touch the customer's basket
 * or the admin trade-test basket. Stock is reserved only when the order is placed.
 * Prices are re-resolved from the customer company. Browser prices are not trusted.
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import {
  contactSnapshotSchema,
  deliveryAddressSnapshotSchema,
  type ContactSnapshot,
  type DeliveryAddressSnapshot,
} from "@/domain/checkout";
import { assessSalesOrderEditEligibility } from "@/domain/order-edit";
import { moneyToString, parseMoney } from "@/domain/money";
import {
  openSalesOrderDraftSchema,
  placeSalesOrderSchema,
  salesOrderDraftHeaderSchema,
  salesOrderCustomerSearchSchema,
  salesOrderDraftIdSchema,
  salesOrderProductSearchSchema,
  salesOrderAllocationChanged,
  type OrderFulfilmentChoice,
  type PlaceSalesOrderInput,
  type SalesOrderEntrySource,
  type SalesOrderExpectedReview,
} from "@/domain/sales-order-entry";
import { trustedSellableForOrdering } from "@/server/ordering/policy";
import {
  buildCheckoutReview,
  commitSubmittedOrder,
  resolveDeliverySnapshot,
  resolveOrderLinesFromItems,
  toConfirmation,
  type CheckoutReview,
  type PublicOrderConfirmation,
} from "@/server/orders/service";
import type { OrderAmendmentEmailFeedback } from "@/domain/order-updated-email";
import { recordAuditEvent } from "@/server/audit/record";
import { loadOrderUpdatedEmailOutcome, sendOrderEmailsAfterCommit } from "@/server/email/transactional";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";
import { acceptQuoteOnBehalf } from "@/server/quotes/service";
import { loadStockByVariantIds } from "@/server/stock/service";

const editOrderSchema = z.object({ orderId: z.string().cuid() });

const SOURCE_LABEL: Record<SalesOrderEntrySource, string> = {
  TELEPHONE: "Telephone",
  EMAIL: "Email",
  CUSTOMER_VISIT: "Customer visit",
};

type OrderableCompany = {
  id: string;
  name: string;
  status: string;
  paymentTerms: string | null;
  taxStatus: string;
  autopartCustomerCode: string | null;
  autopartCustomerCodeVerifiedAt: Date | null;
};

export type SalesOrderDraftDto = {
  id: string;
  companyId: string;
  companyName: string;
  companyStatus: string;
  paymentTerms: string | null;
  status: "OPEN" | "ABANDONED" | "PLACED";
  source: SalesOrderEntrySource | null;
  contactId: string | null;
  addressId: string | null;
  oneOffAddress: DeliveryAddressSnapshot | null;
  poNumber: string | null;
  deliveryInstructions: string | null;
  internalNote: string | null;
  placedOrderId: string | null;
  fulfilmentChoice: OrderFulfilmentChoice;
  editingOrderId: string | null;
  editingOrderNumber: string | null;
  updatedAt: string;
  lines: Array<{
    id: string;
    variantId: string;
    qty: number | null;
    sku: string;
    name: string;
    unitPriceOverride: string | null;
  }>;
};

export type SalesOrderWorkspace = {
  draft: SalesOrderDraftDto;
  review: CheckoutReview | null;
  contactReady: boolean;
  addressReady: boolean;
  contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
  }>;
  addresses: Array<{
    id: string;
    label: string | null;
    line1: string;
    line2: string | null;
    town: string;
    county: string | null;
    postcode: string;
    country: string;
    isDefaultDelivery: boolean;
  }>;
  quotes: Array<{
    id: string;
    quoteNumber: string;
    status: string;
    grandTotal: string;
    poNumber: string | null;
  }>;
  /** Customer's assigned representative. Null when the account has none. */
  assignedSalesRep: { name: string; code: string } | null;
};

export type SalesOrderPriceChange = {
  variantId: string;
  sku: string;
  name: string;
  previousUnitPrice: string | null;
  newUnitPrice: string | null;
  previousLineNet: string | null;
  newLineNet: string | null;
};

export type SalesOrderReviewedTotals = {
  subtotal: string;
  vatTotal: string;
  deliveryTotal: string;
  grandTotal: string;
};

export type SalesPlaceResult =
  | {
      ok: true;
      order: PublicOrderConfirmation;
      alreadyPlaced: boolean;
      email?: OrderAmendmentEmailFeedback;
    }
  | {
      ok: false;
      code: "REVIEW_REQUIRED";
      review: CheckoutReview;
      changes: SalesOrderPriceChange[];
      totalsChanged: boolean;
      previousTotals: SalesOrderReviewedTotals | null;
      acknowledgementRequired: boolean;
    };

export type SalesOrderAttribution = {
  entrySource: SalesOrderEntrySource;
  placedByStaffUserId: string;
  placedByStaffName: string;
  salesOrderDraftId: string;
  internalNote: string | null;
};

async function requireSalesOrderStaff(userId: string): Promise<LoadedAccessProfile> {
  const profile = await requireSystemPermission(userId, "orders.place_for_customer");
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Only internal staff can enter orders for customers", "FORBIDDEN", 403);
  }
  return profile;
}

/**
 * Order entry is not CRM account ownership.
 * Any internal user with orders.place_for_customer may order for any ACTIVE customer.
 * The caller's profile is accepted only after requireSalesOrderStaff.
 */
async function requireOrderableCompany(
  _profile: LoadedAccessProfile,
  companyId: string,
): Promise<OrderableCompany> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      status: true,
      paymentTerms: true,
      taxStatus: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
    },
  });
  if (!company || company.status !== "ACTIVE") {
    throw new AuthError(
      "Customer is not approved for ordering",
      "COMPANY_NOT_ACTIVE",
      403,
    );
  }
  return company;
}

async function loadAssignedSalesRep(companyId: string): Promise<{ name: string; code: string } | null> {
  const primary = await prisma.companyAssignment.findFirst({
    where: { companyId, isPrimary: true, salesRep: { active: true } },
    select: { salesRep: { select: { code: true, user: { select: { name: true } } } } },
  });
  const chosen =
    primary ??
    (await prisma.companyAssignment.findFirst({
      where: { companyId, salesRep: { active: true } },
      orderBy: { createdAt: "asc" },
      select: { salesRep: { select: { code: true, user: { select: { name: true } } } } },
    }));
  if (!chosen) return null;
  return {
    name: chosen.salesRep.user.name?.trim() || "Assigned representative",
    code: chosen.salesRep.code ?? "",
  };
}

/** Quotations stay inside the existing sales-account scope. Order entry does not widen that. */
async function canUseCustomerQuotations(profile: LoadedAccessProfile, companyId: string): Promise<boolean> {
  if (!hasPermission(profile, "quotes.accept_on_behalf")) return false;
  return canAccessCompanyAsSales(profile, companyId);
}

const draftInclude = {
  company: { select: { id: true, name: true, status: true, paymentTerms: true } },
  editingOrder: { select: { id: true, orderNumber: true } },
  lines: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      variant: { select: { sku: true, product: { select: { name: true } } } },
    },
  },
} satisfies Prisma.SalesOrderDraftInclude;

type DraftRow = Prisma.SalesOrderDraftGetPayload<{ include: typeof draftInclude }>;

function toDraftDto(row: DraftRow): SalesOrderDraftDto {
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    companyStatus: row.company.status,
    paymentTerms: row.company.paymentTerms,
    status: row.status,
    source: row.source,
    contactId: row.contactId,
    addressId: row.addressId,
    oneOffAddress: (row.oneOffAddress as DeliveryAddressSnapshot | null) ?? null,
    poNumber: row.poNumber,
    deliveryInstructions: row.deliveryInstructions,
    internalNote: row.internalNote,
    placedOrderId: row.placedOrderId,
    fulfilmentChoice: row.fulfilmentChoice,
    editingOrderId: row.editingOrderId,
    editingOrderNumber: row.editingOrder?.orderNumber ?? null,
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.id,
      variantId: line.variantId,
      qty: line.qty,
      sku: line.variant.sku,
      name: line.variant.product.name,
      unitPriceOverride: money2(line.unitPriceOverride?.toString() ?? null),
    })),
  };
}

async function loadOwnedDraft(userId: string, draftId: string, openOnly: boolean) {
  const draft = await prisma.salesOrderDraft.findFirst({
    where: {
      id: draftId,
      createdByUserId: userId,
      ...(openOnly ? { status: "OPEN" } : {}),
    },
    include: draftInclude,
  });
  if (!draft) {
    throw new AuthError("Sales order draft not found", "DRAFT_NOT_FOUND", 404);
  }
  return draft;
}

function draftConflict(status: string): AuthError {
  if (status === "PLACED") {
    return new AuthError(
      "This draft has already been placed and can no longer be changed.",
      "DRAFT_CONFLICT",
      409,
    );
  }
  if (status === "ABANDONED") {
    return new AuthError(
      "This draft was abandoned and cannot be reopened or placed.",
      "DRAFT_CONFLICT",
      409,
    );
  }
  return new AuthError(
    "This draft changed while you were working. Refresh and try again.",
    "DRAFT_CONFLICT",
    409,
  );
}

async function lockOpenDraft(
  tx: Prisma.TransactionClient,
  userId: string,
  draftId: string,
): Promise<DraftRow> {
  const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status
    FROM "SalesOrderDraft"
    WHERE id = ${draftId} AND "createdByUserId" = ${userId}
    FOR UPDATE
  `;
  if (locked.length !== 1) {
    throw new AuthError("Sales order draft not found", "DRAFT_NOT_FOUND", 404);
  }
  if (locked[0]!.status !== "OPEN") throw draftConflict(locked[0]!.status);
  return tx.salesOrderDraft.findFirstOrThrow({
    where: { id: draftId },
    include: draftInclude,
  });
}

function lineKey(
  lines: Array<{
    variantId: string;
    qty: number | null;
    unitPriceOverride?: { toString(): string } | string | null;
  }>,
): string {
  return [...lines]
    .map((line) => {
      const raw =
        line.unitPriceOverride == null
          ? null
          : typeof line.unitPriceOverride === "string"
            ? line.unitPriceOverride
            : line.unitPriceOverride.toString();
      return `${line.variantId}:${line.qty ?? "blank"}:${money2(raw) ?? ""}`;
    })
    .sort()
    .join("|");
}

function staffOverrides(
  lines: Array<{ variantId: string; unitPriceOverride?: { toString(): string } | string | null }>,
): Map<string, string | null> {
  return new Map(
    lines.map((line) => {
      const raw =
        line.unitPriceOverride == null
          ? null
          : typeof line.unitPriceOverride === "string"
            ? line.unitPriceOverride
            : line.unitPriceOverride.toString();
      return [line.variantId, money2(raw)] as const;
    }),
  );
}

function money2(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = parseMoney(value);
  return parsed ? moneyToString(parsed, 2) : null;
}

async function loadCustomerChoices(companyId: string, includeQuotes: boolean) {
  const [contacts, addresses, quotes] = await Promise.all([
    prisma.contact.findMany({
      where: { companyId },
      orderBy: [{ isPrimary: "desc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        mobile: true,
        isPrimary: true,
      },
    }),
    prisma.address.findMany({
      where: {
        companyId,
        OR: [{ type: "DELIVERY" }, { isDefaultDelivery: true }, { type: "TRADING" }],
      },
      orderBy: [{ isDefaultDelivery: "desc" }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        line1: true,
        line2: true,
        town: true,
        county: true,
        postcode: true,
        country: true,
        isDefaultDelivery: true,
      },
    }),
    includeQuotes
      ? prisma.quote.findMany({
          where: {
            companyId,
            status: { in: ["SENT", "VIEWED", "ACCEPTED"] },
            convertedOrderId: null,
          },
          orderBy: { updatedAt: "desc" },
          take: 25,
          select: {
            id: true,
            quoteNumber: true,
            status: true,
            grandTotal: true,
            poNumber: true,
          },
        })
      : Promise.resolve([]),
  ]);
  return {
    contacts: contacts.map((contact) => ({
      id: contact.id,
      name: `${contact.firstName} ${contact.lastName}`.trim(),
      email: contact.email,
      phone: contact.phone ?? contact.mobile,
      isPrimary: contact.isPrimary,
    })),
    addresses,
    quotes: quotes.map((quote) => ({
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      status: quote.status,
      grandTotal: quote.grandTotal.toString(),
      poNumber: quote.poNumber,
    })),
  };
}

async function contactSnapshotForCompany(
  companyId: string,
  contactId: string,
): Promise<ContactSnapshot> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, companyId },
  });
  if (!contact) {
    throw new AuthError("Contact not found for this customer", "CONTACT_NOT_FOUND", 404);
  }
  if (!contact.email?.trim()) {
    throw new AuthError("The order contact needs an email address", "CONTACT_EMAIL_REQUIRED", 400);
  }
  return contactSnapshotSchema.parse({
    name: `${contact.firstName} ${contact.lastName}`.trim() || contact.email,
    email: contact.email,
    phone: contact.phone ?? contact.mobile ?? null,
  });
}

async function reviewDraft(
  company: OrderableCompany,
  draft: DraftRow,
): Promise<{ review: CheckoutReview | null; contactReady: boolean; addressReady: boolean }> {
  let contact: ContactSnapshot | null = null;
  let contactReady = false;
  if (draft.contactId) {
    try {
      contact = await contactSnapshotForCompany(company.id, draft.contactId);
      contactReady = true;
    } catch {
      contact = null;
    }
  }

  const fulfilmentChoice = draft.fulfilmentChoice;
  let deliveryAddress = null;
  let addressReady = fulfilmentChoice === "COLLECTION";
  const oneOff =
    draft.oneOffAddress && typeof draft.oneOffAddress === "object"
      ? (draft.oneOffAddress as Record<string, unknown>)
      : null;
  if (fulfilmentChoice === "DELIVERY" && (draft.addressId || oneOff)) {
    try {
      deliveryAddress = await resolveDeliverySnapshot(company.id, {
        addressId: oneOff ? null : draft.addressId,
        oneOffAddress: oneOff as never,
      });
      addressReady = true;
    } catch {
      deliveryAddress = null;
    }
  }

  const billable = draft.lines.filter(
    (line): line is typeof line & { qty: number } => line.qty != null && line.qty >= 1,
  );
  if (billable.length === 0) {
    return { review: null, contactReady, addressReady };
  }

  const lines = await resolveOrderLinesFromItems(
    company.id,
    billable.map((line) => ({ variantId: line.variantId, qty: line.qty })),
    null,
    { staffUnitOrdering: true, unitPriceOverrides: staffOverrides(billable) },
  );
  const review = buildCheckoutReview({
    company,
    lines,
    deliveryAddress,
    contact: contact ?? {
      name: "Select a customer contact",
      email: "not-selected@example.invalid",
      phone: null,
    },
    poNumber: draft.poNumber,
    deliveryInstructions: draft.deliveryInstructions,
    fulfilmentChoice,
  });
  if (!contactReady) {
    review.contact = {
      name: "Select a customer contact",
      email: "",
      phone: null,
    } as ContactSnapshot;
  }
  return { review, contactReady, addressReady };
}

async function workspaceFor(profile: LoadedAccessProfile, draft: DraftRow): Promise<SalesOrderWorkspace> {
  const company = await requireOrderableCompany(profile, draft.companyId);
  const includeQuotes = await canUseCustomerQuotations(profile, company.id);
  const [choices, priced, assignedSalesRep] = await Promise.all([
    loadCustomerChoices(company.id, includeQuotes),
    reviewDraft(company, draft),
    loadAssignedSalesRep(company.id),
  ]);
  return {
    draft: toDraftDto(draft),
    review: priced.review,
    contactReady: priced.contactReady,
    addressReady: priced.addressReady,
    assignedSalesRep,
    ...choices,
  };
}

function compareReviewedPrices(
  expected: SalesOrderExpectedReview,
  lines: Awaited<ReturnType<typeof resolveOrderLinesFromItems>>,
  review: CheckoutReview,
): { requiresReview: boolean; totalsChanged: boolean; allocationChanged: boolean; changes: SalesOrderPriceChange[] } {
  const changes: SalesOrderPriceChange[] = [];
  const expectedById = new Map(expected.lines.map((line) => [line.variantId, line]));
  let allocationChanged = false;
  for (const line of lines) {
    const reviewed = expectedById.get(line.variantId);
    const previousUnitPrice = money2(reviewed?.customerUnitPrice);
    const previousLineNet = money2(reviewed?.lineNet);
    const newUnitPrice = line.issue === "PRICE_UNAVAILABLE" ? null : line.customerUnit2dp;
    const newLineNet = line.issue === "VALID" || line.issue === "PRICE_UPDATED" ? line.lineNet2dp : null;
    const qtyChanged = reviewed != null && reviewed.qty !== line.quantity;
    const unitChanged = previousUnitPrice !== newUnitPrice;
    const netChanged = previousLineNet !== newLineNet;
    if (salesOrderAllocationChanged(reviewed, line)) allocationChanged = true;
    if (!reviewed || qtyChanged || unitChanged || netChanged) {
      changes.push({
        variantId: line.variantId,
        sku: line.sku,
        name: line.name,
        previousUnitPrice,
        newUnitPrice,
        previousLineNet,
        newLineNet,
      });
    }
  }
  const totalsChanged =
    money2(expected.subtotal) !== review.totals.subtotal ||
    money2(expected.vatTotal) !== review.totals.vatTotal ||
    money2(expected.deliveryTotal) !== review.totals.deliveryTotal ||
    money2(expected.grandTotal) !== review.totals.grandTotal;
  return {
    requiresReview: changes.length > 0 || totalsChanged || allocationChanged,
    totalsChanged,
    allocationChanged,
    changes,
  };
}

export async function listSalesOrderDrafts(actorUserId: string) {
  await requireSalesOrderStaff(actorUserId);
  const rows = await prisma.salesOrderDraft.findMany({
    where: { createdByUserId: actorUserId, status: "OPEN", company: { status: "ACTIVE" } },
    include: draftInclude,
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return rows.map(toDraftDto);
}

export async function searchOrderEntryCustomers(actorUserId: string, raw: unknown) {
  await requireSalesOrderStaff(actorUserId);
  const input = salesOrderCustomerSearchSchema.parse(raw ?? {});
  const q = input.q?.trim() ?? "";
  const page = input.page;
  const pageSize = input.pageSize;
  const where = {
    status: "ACTIVE" as const,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { tradingName: { contains: q, mode: "insensitive" as const } },
            { accountNumber: { contains: q, mode: "insensitive" as const } },
            { primaryEmail: { contains: q, mode: "insensitive" as const } },
            { phone: { contains: q, mode: "insensitive" as const } },
            { autopartCustomerCode: { contains: q, mode: "insensitive" as const } },
            {
              autopartAccountAliases: {
                some: { alias: { contains: q, mode: "insensitive" as const } },
              },
            },
            {
              contacts: {
                some: {
                  OR: [
                    { firstName: { contains: q, mode: "insensitive" as const } },
                    { lastName: { contains: q, mode: "insensitive" as const } },
                    { email: { contains: q, mode: "insensitive" as const } },
                    { phone: { contains: q, mode: "insensitive" as const } },
                    { mobile: { contains: q, mode: "insensitive" as const } },
                  ],
                },
              },
            },
          ],
        }
      : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.company.count({ where }),
    prisma.company.findMany({
    where,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      name: true,
      tradingName: true,
      accountNumber: true,
      phone: true,
      primaryEmail: true,
      autopartCustomerCode: true,
      addresses: {
        where: { OR: [{ isDefaultDelivery: true }, { type: "TRADING" }] },
        orderBy: [{ isDefaultDelivery: "desc" }],
        take: 1,
        select: { town: true, postcode: true },
      },
      contacts: {
        where: { isPrimary: true },
        take: 1,
        select: { firstName: true, lastName: true },
      },
      assignments: {
        where: { isPrimary: true, salesRep: { active: true } },
        take: 1,
        select: { salesRep: { select: { code: true, user: { select: { name: true } } } } },
      },
    },
  }),
  ]);
  return {
    items: rows.map((row) => ({
    id: row.id,
    name: row.name,
    tradingName: row.tradingName,
    accountNumber: row.accountNumber,
    phone: row.phone,
    primaryEmail: row.primaryEmail,
    autopartCustomerCode: row.autopartCustomerCode,
    town: row.addresses[0]?.town ?? null,
    postcode: row.addresses[0]?.postcode ?? null,
    contactName: row.contacts[0] ? `${row.contacts[0].firstName} ${row.contacts[0].lastName}`.trim() : null,
    assignedSalesRep: row.assignments[0]
      ? {
          name: row.assignments[0].salesRep.user.name?.trim() || "Assigned representative",
          code: row.assignments[0].salesRep.code ?? "",
        }
      : null,
  })),
    total,
    page,
    pageSize,
  };
}

export async function openSalesOrderDraft(actorUserId: string, raw: unknown) {
  const profile = await requireSalesOrderStaff(actorUserId);
  const input = openSalesOrderDraftSchema.parse(raw);
  const company = await requireOrderableCompany(profile, input.companyId);

  if (!input.fresh) {
    const existing = await prisma.salesOrderDraft.findFirst({
      where: {
        createdByUserId: actorUserId,
        companyId: company.id,
        status: "OPEN",
        editingOrderId: null,
      },
      include: draftInclude,
      orderBy: { updatedAt: "desc" },
    });
    if (existing) return workspaceFor(profile, existing);
  }

  const created = await prisma.salesOrderDraft.create({
    data: { companyId: company.id, createdByUserId: actorUserId, status: "OPEN" },
    include: draftInclude,
  });
  return workspaceFor(profile, created);
}

export async function startSalesOrderEdit(actorUserId: string, raw: unknown) {
  const profile = await requireSalesOrderStaff(actorUserId);
  const orderId = editOrderSchema.parse(raw).orderId;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { id: "asc" } },
      fulfilmentEvents: { select: { kind: true } },
      invoices: { select: { id: true }, take: 1 },
      reservations: { where: { status: "CONSUMED" }, select: { id: true }, take: 1 },
      company: { select: { id: true, status: true } },
    },
  });
  if (!order) throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  await requireOrderableCompany(profile, order.companyId);
  const eligibility = assessSalesOrderEditEligibility({
    status: order.status,
    archivedAt: order.archivedAt,
    autopartExportStatus: order.autopartExportStatus,
    autopartExportCount: order.autopartExportCount,
    autopartExportedAt: order.autopartExportedAt,
    externalRef: order.externalRef,
    invoiceCount: order.invoices.length,
    fulfilmentKinds: order.fulfilmentEvents.map((event) => event.kind),
    consumedReservationCount: order.reservations.length,
  });
  if (!eligibility.allowed) {
    throw new AuthError(eligibility.reason ?? "This order can no longer be edited.", "ORDER_LOCKED", 409);
  }
  if (order.items.length === 0 || order.items.some((item) => !item.variantId)) {
    throw new AuthError(
      "This order cannot be edited because a product line is missing.",
      "ORDER_NOT_EDITABLE",
      409,
    );
  }

  const contactEmail =
    order.contactSnapshot && typeof order.contactSnapshot === "object" && "email" in order.contactSnapshot
      ? String((order.contactSnapshot as { email?: unknown }).email ?? "")
      : "";
  const contact = contactEmail
    ? await prisma.contact.findFirst({
        where: { companyId: order.companyId, email: { equals: contactEmail, mode: "insensitive" } },
        select: { id: true },
      })
    : null;
  const parsedAddress = deliveryAddressSnapshotSchema.safeParse(order.deliveryAddress);
  const matchedAddress = parsedAddress.success
    ? await prisma.address.findFirst({
        where: {
          companyId: order.companyId,
          line1: parsedAddress.data.line1,
          postcode: parsedAddress.data.postcode,
        },
        select: { id: true },
      })
    : null;

  const draftId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    const fresh = await tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: {
        fulfilmentEvents: { select: { kind: true } },
        invoices: { select: { id: true }, take: 1 },
        reservations: { where: { status: "CONSUMED" }, select: { id: true }, take: 1 },
      },
    });
    const again = assessSalesOrderEditEligibility({
      status: fresh.status,
      archivedAt: fresh.archivedAt,
      autopartExportStatus: fresh.autopartExportStatus,
      autopartExportCount: fresh.autopartExportCount,
      autopartExportedAt: fresh.autopartExportedAt,
      externalRef: fresh.externalRef,
      invoiceCount: fresh.invoices.length,
      fulfilmentKinds: fresh.fulfilmentEvents.map((event) => event.kind),
      consumedReservationCount: fresh.reservations.length,
    });
    if (!again.allowed) {
      throw new AuthError(again.reason ?? "This order can no longer be edited.", "ORDER_LOCKED", 409);
    }
    const open = await tx.salesOrderDraft.findFirst({
      where: { editingOrderId: order.id, status: "OPEN" },
      select: { id: true, createdByUserId: true },
    });
    if (open?.createdByUserId === actorUserId) return open.id;
    if (open) {
      throw new AuthError(
        "Another member of staff is already editing this order.",
        "ORDER_EDIT_IN_PROGRESS",
        409,
      );
    }
    const created = await tx.salesOrderDraft.create({
      data: {
        companyId: order.companyId,
        createdByUserId: actorUserId,
        status: "OPEN",
        source: order.entrySource ?? "TELEPHONE",
        contactId: contact?.id ?? null,
        addressId: order.fulfilmentChoice === "DELIVERY" ? (matchedAddress?.id ?? null) : null,
        oneOffAddress:
          order.fulfilmentChoice === "DELIVERY" && parsedAddress.success && !matchedAddress
            ? (parsedAddress.data as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        poNumber: order.poNumber,
        deliveryInstructions: order.deliveryInstructions,
        internalNote: order.notes,
        fulfilmentChoice: order.fulfilmentChoice,
        editingOrderId: order.id,
        lines: {
          create: order.items.flatMap((item, sortOrder) =>
            item.variantId
              ? [{
                  variantId: item.variantId,
                  qty: item.qty,
                  unitPriceOverride: item.priceSource === "STAFF_OVERRIDE" ? item.customerUnitPrice : null,
                  sortOrder,
                }]
              : [],
          ),
        },
      },
      select: { id: true },
    });
    return created.id;
  });

  const draft = await loadOwnedDraft(actorUserId, draftId, true);
  return workspaceFor(profile, draft);
}

export async function getSalesOrderDraft(actorUserId: string, raw: unknown) {
  const profile = await requireSalesOrderStaff(actorUserId);
  const input = salesOrderDraftIdSchema.parse(raw);
  const draft = await loadOwnedDraft(actorUserId, input.draftId, false);
  await requireOrderableCompany(profile, draft.companyId);
  if (draft.status !== "OPEN") {
    return {
      draft: toDraftDto(draft),
      review: null,
      contactReady: false,
      addressReady: false,
      contacts: [],
      addresses: [],
      quotes: [],
      assignedSalesRep: await loadAssignedSalesRep(draft.companyId),
    } satisfies SalesOrderWorkspace;
  }
  return workspaceFor(profile, draft);
}

export async function saveSalesOrderDraft(actorUserId: string, raw: unknown) {
  const profile = await requireSalesOrderStaff(actorUserId);
  const input = salesOrderDraftHeaderSchema.parse(raw);
  const draft = await loadOwnedDraft(actorUserId, input.draftId, false);
  if (draft.status !== "OPEN") throw draftConflict(draft.status);
  const company = await requireOrderableCompany(profile, draft.companyId);

  if (input.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: input.contactId, companyId: company.id },
      select: { id: true },
    });
    if (!contact) {
      throw new AuthError("Contact not found for this customer", "CONTACT_NOT_FOUND", 404);
    }
  }
  if (input.addressId) {
    await resolveDeliverySnapshot(company.id, { addressId: input.addressId, oneOffAddress: null });
  }
  if (input.oneOffAddress) {
    await resolveDeliverySnapshot(company.id, { addressId: null, oneOffAddress: input.oneOffAddress });
  }

  if (input.lines) {
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: input.lines.map((line) => line.variantId) }, isActive: true },
      select: { id: true },
    });
    if (variants.length !== new Set(input.lines.map((line) => line.variantId)).size) {
      throw new AuthError("One or more products are unavailable", "PRODUCT_UNAVAILABLE", 400);
    }
  }

  await prisma.$transaction(async (tx) => {
    const locked = await lockOpenDraft(tx, actorUserId, draft.id);
    if (input.lines) {
      const unique = new Map<string, { qty: number | null; unitPriceOverride: string | null }>();
      for (const line of input.lines) {
        unique.set(line.variantId, { qty: line.qty, unitPriceOverride: line.unitPriceOverride });
      }
      await tx.salesOrderDraftLine.deleteMany({ where: { draftId: locked.id } });
      if (unique.size > 0) {
        await tx.salesOrderDraftLine.createMany({
          data: [...unique.entries()].map(([variantId, line], sortOrder) => ({
            draftId: locked.id,
            variantId,
            qty: line.qty,
            unitPriceOverride: line.unitPriceOverride,
            sortOrder,
          })),
        });
      }
    }
    const updated = await tx.salesOrderDraft.updateMany({
      where: { id: locked.id, createdByUserId: actorUserId, status: "OPEN" },
      data: {
        updatedAt: new Date(),
        ...(input.source !== undefined ? { source: input.source } : {}),
        ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
        ...(input.addressId !== undefined ? { addressId: input.addressId } : {}),
        ...(input.oneOffAddress !== undefined
          ? { oneOffAddress: (input.oneOffAddress ?? Prisma.JsonNull) as Prisma.InputJsonValue }
          : {}),
        ...(input.poNumber !== undefined ? { poNumber: input.poNumber } : {}),
        ...(input.deliveryInstructions !== undefined
          ? { deliveryInstructions: input.deliveryInstructions }
          : {}),
        ...(input.internalNote !== undefined ? { internalNote: input.internalNote } : {}),
        ...(input.fulfilmentChoice !== undefined ? { fulfilmentChoice: input.fulfilmentChoice } : {}),
      },
    });
    if (updated.count !== 1) throw draftConflict("UNKNOWN");
  });

  const fresh = await loadOwnedDraft(actorUserId, draft.id, true);
  return workspaceFor(profile, fresh);
}

export async function abandonSalesOrderDraft(actorUserId: string, raw: unknown) {
  const profile = await requireSalesOrderStaff(actorUserId);
  const input = salesOrderDraftIdSchema.parse(raw);
  const draft = await loadOwnedDraft(actorUserId, input.draftId, false);
  if (draft.status !== "OPEN") throw draftConflict(draft.status);
  await requireOrderableCompany(profile, draft.companyId);
  await prisma.$transaction(async (tx) => {
    await lockOpenDraft(tx, actorUserId, draft.id);
    const updated = await tx.salesOrderDraft.updateMany({
      where: { id: draft.id, createdByUserId: actorUserId, status: "OPEN" },
      data: { status: "ABANDONED" },
    });
    if (updated.count !== 1) throw draftConflict("UNKNOWN");
  });
  return { id: draft.id, status: "ABANDONED" as const };
}

export async function searchSalesOrderProducts(actorUserId: string, raw: unknown) {
  const profile = await requireSalesOrderStaff(actorUserId);
  const input = salesOrderProductSearchSchema.parse(raw);
  await requireOrderableCompany(profile, input.companyId);

  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      product: { isActive: true, status: "ACTIVE", isTradeVisible: true },
      OR: [
        { sku: { contains: input.q, mode: "insensitive" } },
        { product: { name: { contains: input.q, mode: "insensitive" } } },
        { product: { brand: { name: { contains: input.q, mode: "insensitive" } } } },
      ],
    },
    take: 20,
    orderBy: { sku: "asc" },
    select: {
      id: true,
      sku: true,
      caseQty: true,
      minOrderQty: true,
      product: { select: { name: true, brand: { select: { name: true } } } },
    },
  });
  if (variants.length === 0) return [];

  const [lines, stock] = await Promise.all([
    resolveOrderLinesFromItems(
      input.companyId,
      variants.map((variant) => ({ variantId: variant.id, qty: 1 })),
      null,
      { staffUnitOrdering: true },
    ),
    loadStockByVariantIds(variants.map((variant) => variant.id)),
  ]);
  const lineById = new Map(lines.map((line) => [line.variantId, line]));

  return variants.map((variant) => {
    const line = lineById.get(variant.id);
    const stockRow = stock.get(variant.id);
    const sellableQty = trustedSellableForOrdering({
      sellableQty: stockRow?.sellableQty ?? 0,
      stale: stockRow?.stale ?? true,
    });
    return {
      variantId: variant.id,
      sku: variant.sku,
      name: variant.product.name,
      brand: variant.product.brand.name,
      caseQty: variant.caseQty,
      minOrderQty: variant.minOrderQty,
      sellableQty,
      backordersAllowed: line?.backordersAllowed ?? false,
      customerUnitPrice: line && line.issue !== "PRICE_UNAVAILABLE" ? line.customerUnit2dp : null,
      priceSource: line && line.priceSource !== "NONE" ? line.priceSource : null,
      promotionCode: line?.promotionCode ?? null,
      issue: line?.issue ?? "PRODUCT_UNAVAILABLE",
      issueMessage: line?.issueMessage ?? null,
    };
  });
}

type CrmActivityInput = {
  actorUserId: string;
  companyId: string;
  orderId: string;
  orderNumber: string;
  source: SalesOrderEntrySource;
  internalNote: string | null;
};

/** Test seam. Production uses the Prisma activity delegate. */
export const salesOrderCrmDependencies = {
  async createActivity(tx: Prisma.TransactionClient, input: CrmActivityInput) {
    await tx.activity.create({
      data: {
        companyId: input.companyId,
        userId: input.actorUserId,
        type: "NOTE",
        subject: `Order ${input.orderNumber} placed for the customer`,
        body: [
          `Source: ${SOURCE_LABEL[input.source]}.`,
          "Staff confirmed they are authorised to submit this order on the customer's behalf.",
          input.internalNote ? `Internal note: ${input.internalNote}` : null,
        ]
          .filter(Boolean)
          .join(" "),
        metadata: {
          kind: "sales_order_entry",
          salesOrderId: input.orderId,
          orderNumber: input.orderNumber,
          source: input.source,
        },
      },
    });
  },
};

export async function ensureSalesOrderCrmActivity(input: CrmActivityInput): Promise<"created" | "exists" | "failed"> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sales-order-crm:${input.orderId}`}))`;
      const existing = await tx.activity.findFirst({
        where: {
          companyId: input.companyId,
          metadata: { path: ["salesOrderId"], equals: input.orderId },
        },
        select: { id: true },
      });
      if (existing) return "exists" as const;
      await salesOrderCrmDependencies.createActivity(tx, input);
      return "created" as const;
    });
  } catch (error) {
    await recordAuditEvent({
      action: "order.crm_activity_failed",
      entityType: "Order",
      entityId: input.orderId,
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      metadata: {
        detail: error instanceof Error ? error.message : "unknown",
        orderNumber: input.orderNumber,
        repair: true,
      },
    });
    return "failed";
  }
}

async function repairCrmFromOrder(order: {
  id: string;
  orderNumber: string;
  companyId: string;
  notes: string | null;
  entrySource: SalesOrderEntrySource | null;
  placedByStaffUserId: string | null;
  orderedByUserId: string | null;
}) {
  if (!order.entrySource) return;
  await ensureSalesOrderCrmActivity({
    actorUserId: order.placedByStaffUserId ?? order.orderedByUserId ?? "",
    companyId: order.companyId,
    orderId: order.id,
    orderNumber: order.orderNumber,
    source: order.entrySource,
    internalNote: order.notes,
  });
}

async function sendCustomerConfirmation(input: {
  actorUserId: string;
  companyId: string;
  orderId: string;
}) {
  try {
    const emailResult = await sendOrderEmailsAfterCommit(input.orderId);
    if (!emailResult.customerOk) {
      await recordAuditEvent({
        action: "order.email_failed",
        entityType: "Order",
        entityId: input.orderId,
        actorUserId: input.actorUserId,
        companyId: input.companyId,
        metadata: { detail: emailResult.detail ?? "send failed", channel: "customer" },
      });
    }
  } catch (error) {
    await recordAuditEvent({
      action: "order.email_failed",
      entityType: "Order",
      entityId: input.orderId,
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      metadata: {
        detail: error instanceof Error ? error.message : "unknown",
        channel: "customer",
      },
    });
  }
}

async function placeFromQuote(
  actorUserId: string,
  profile: LoadedAccessProfile,
  draft: DraftRow,
  input: PlaceSalesOrderInput,
): Promise<SalesPlaceResult> {
  const quote = await prisma.quote.findFirst({
    where: { id: input.quoteId!, companyId: draft.companyId },
    select: { id: true, quoteNumber: true, status: true, convertedOrderId: true },
  });
  if (!quote) {
    throw new AuthError("Quotation not found for this customer", "QUOTE_NOT_FOUND", 404);
  }
  if (!hasPermission(profile, "quotes.accept_on_behalf")) {
    throw new AuthError("Not permitted to accept quotations for customers", "FORBIDDEN", 403);
  }

  const staffName = profile.name?.trim() || profile.email;
  const internalNote = input.internalNote ?? draft.internalNote ?? null;
  const result = await acceptQuoteOnBehalf(
    actorUserId,
    {
      id: quote.id,
      idempotencyKey: input.idempotencyKey,
      note: `Sales order entry (${SOURCE_LABEL[input.source]}). Staff confirmed customer authorisation.`,
    },
    {
      entrySource: input.source,
      placedByStaffUserId: actorUserId,
      placedByStaffName: staffName,
      salesOrderDraftId: draft.id,
      internalNote,
    },
  );

  if (!result.alreadyConverted) {
    await recordAuditEvent({
      action: "order.placed_for_customer",
      entityType: "Order",
      entityId: result.orderId,
      actorUserId,
      companyId: draft.companyId,
      after: {
        orderNumber: result.orderNumber,
        entrySource: input.source,
        placedByStaffUserId: actorUserId,
        customerAuthorised: true,
        sourceQuoteNumber: quote.quoteNumber,
        salesOrderDraftId: draft.id,
      },
    });
  }

  await ensureSalesOrderCrmActivity({
    actorUserId,
    companyId: draft.companyId,
    orderId: result.orderId,
    orderNumber: result.orderNumber,
    source: input.source,
    internalNote,
  });

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: result.orderId },
    include: { items: true, company: { select: { name: true } } },
  });
  const usesThisKey =
    order.idempotencyKey === input.idempotencyKey ||
    order.idempotencyKey === `quote-accept:${input.idempotencyKey}`;
  if (usesThisKey && !sameSalesOrderSubmission(order, draft, actorUserId)) {
    salesOrderIdempotencyConflict();
  }
  return {
    ok: true,
    alreadyPlaced: result.alreadyConverted,
    order: toConfirmation(order, order.company.name),
  };
}

async function confirmationForOrder(orderId: string): Promise<PublicOrderConfirmation> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true, company: { select: { name: true } } },
  });
  return toConfirmation(order, order.company.name);
}

function sameSalesOrderSubmission(
  order: { salesOrderDraftId: string | null; companyId: string; placedByStaffUserId: string | null },
  draft: { id: string; companyId: string },
  actorUserId: string,
) {
  return (
    order.salesOrderDraftId === draft.id &&
    order.companyId === draft.companyId &&
    order.placedByStaffUserId === actorUserId
  );
}

function salesOrderIdempotencyConflict(): never {
  throw new AuthError(
    "This order request was already used for a different order.",
    "IDEMPOTENCY_CONFLICT",
    409,
  );
}

export async function placeSalesOrder(actorUserId: string, raw: unknown): Promise<SalesPlaceResult> {
  const profile = await requireSalesOrderStaff(actorUserId);
  const input = placeSalesOrderSchema.parse(raw);
  const draft = await loadOwnedDraft(actorUserId, input.draftId, false);

  const existing = await prisma.order.findFirst({
    where: {
      OR: [
        { idempotencyKey: input.idempotencyKey },
        { idempotencyKey: `quote-accept:${input.idempotencyKey}` },
        { editIdempotencyKey: input.idempotencyKey },
      ],
    },
    include: { items: true, company: { select: { name: true } } },
  });
  if (existing) {
    if (
      draft.editingOrderId &&
      existing.id === draft.editingOrderId &&
      existing.editIdempotencyKey === input.idempotencyKey
    ) {
      return {
        ok: true,
        alreadyPlaced: true,
        order: toConfirmation(existing, existing.company.name),
        email: await loadOrderUpdatedEmailOutcome(existing.id, input.idempotencyKey),
      };
    }
    if (!sameSalesOrderSubmission(existing, draft, actorUserId)) salesOrderIdempotencyConflict();
    await repairCrmFromOrder(existing);
    return { ok: true, alreadyPlaced: true, order: toConfirmation(existing, existing.company.name) };
  }
  const company = await requireOrderableCompany(profile, draft.companyId);
  if (draft.status !== "OPEN") {
    if (input.quoteId && draft.placedOrderId) {
      const quote = await prisma.quote.findFirst({
        where: {
          id: input.quoteId,
          companyId: draft.companyId,
          convertedOrderId: draft.placedOrderId,
        },
        select: { id: true },
      });
      if (quote) {
        await repairCrmFromOrder(
          await prisma.order.findUniqueOrThrow({ where: { id: draft.placedOrderId } }),
        );
        return { ok: true, alreadyPlaced: true, order: await confirmationForOrder(draft.placedOrderId) };
      }
    }
    throw draftConflict(draft.status);
  }

  if (input.quoteId) {
    return placeFromQuote(actorUserId, profile, draft, input);
  }

  if (draft.lines.some((line) => line.qty == null || line.qty < 1)) {
    throw new AuthError(
      "Enter a quantity for every product before placing this order.",
      "QUANTITY_REQUIRED",
      400,
    );
  }
  const requestedLines =
    input.lines ??
    draft.lines.flatMap((line) => {
      if (line.qty == null) return [];
      return [
        {
          variantId: line.variantId,
          qty: line.qty,
          unitPriceOverride: line.unitPriceOverride?.toString() ?? null,
        },
      ];
    });
  if (requestedLines.length === 0) {
    throw new AuthError("Add at least one product", "DRAFT_EMPTY", 400);
  }
  if (lineKey(requestedLines) !== lineKey(draft.lines)) {
    throw new AuthError(
      "Save the products and quantities, then review the prices before placing this order.",
      "DRAFT_NOT_SAVED",
      409,
    );
  }

  const contact = await contactSnapshotForCompany(company.id, input.contactId!);
  const fulfilmentChoice = input.fulfilmentChoice;
  const deliveryAddress =
    fulfilmentChoice === "COLLECTION"
      ? null
      : await resolveDeliverySnapshot(company.id, {
          addressId: input.oneOffAddress ? null : (input.addressId ?? null),
          oneOffAddress: input.oneOffAddress ?? null,
        });

  const expected = input.expectedReview;
  if (!expected || expected.lines.length === 0) {
    throw new AuthError(
      "Review the prices, VAT, and delivery total before placing this order.",
      "EXPECTED_PRICES_REQUIRED",
      400,
    );
  }
  const expectedIds = new Set(expected.lines.map((line) => line.variantId));
  if (requestedLines.some((line) => !expectedIds.has(line.variantId)) || expected.lines.length !== requestedLines.length) {
    throw new AuthError(
      "Review every product price before placing this order.",
      "EXPECTED_PRICES_REQUIRED",
      400,
    );
  }

  const lines = await resolveOrderLinesFromItems(
    company.id,
    requestedLines,
    expected.lines.map((line) => ({ variantId: line.variantId, customerUnitPrice: line.customerUnitPrice })),
    { staffUnitOrdering: true, unitPriceOverrides: staffOverrides(draft.lines) },
  );
  const review = buildCheckoutReview({
    company,
    lines,
    deliveryAddress,
    contact,
    poNumber: input.poNumber ?? null,
    deliveryInstructions: input.deliveryInstructions ?? null,
    fulfilmentChoice,
  });
  const comparison = compareReviewedPrices(expected, lines, review);
  const acknowledgementRequired =
    lines.some((line) => line.issue === "VALID" && line.backorderQtyAtOrder > 0) &&
    input.backorderAcknowledged !== true;
  if (review.hasBlockingIssues || comparison.requiresReview || acknowledgementRequired) {
    return {
      ok: false,
      code: "REVIEW_REQUIRED",
      review,
      changes: comparison.changes,
      totalsChanged: comparison.totalsChanged,
      acknowledgementRequired,
      previousTotals: {
        subtotal: money2(expected.subtotal) ?? expected.subtotal,
        vatTotal: money2(expected.vatTotal) ?? expected.vatTotal,
        deliveryTotal: money2(expected.deliveryTotal) ?? expected.deliveryTotal,
        grandTotal: money2(expected.grandTotal) ?? expected.grandTotal,
      },
    };
  }

  const staffName = profile.name?.trim() || profile.email;
  const hasBackorder = lines.some((line) => line.issue === "VALID" && line.backorderQtyAtOrder > 0);
  if (draft.editingOrderId) {
    const { amendSubmittedSalesOrder } = await import("@/server/orders/sales-order-edit");
    return amendSubmittedSalesOrder({
      actorUserId,
      staffName,
      draft,
      company,
      input,
      lines,
      deliveryAddress,
      contact,
      requestedLines,
      hasBackorder,
    });
  }
  let created;
  try {
    created = await commitSubmittedOrder({
    company,
    lines,
    deliveryAddress,
    contact,
    fulfilmentChoice,
    backorderAcknowledgedByUserId: hasBackorder ? actorUserId : null,
    poNumber: input.poNumber ?? null,
    deliveryInstructions: input.deliveryInstructions ?? null,
    idempotencyKey: input.idempotencyKey,
    orderedByUserId: actorUserId,
    onBehalfOfUserId: actorUserId,
    entrySource: input.source,
    placedByStaffUserId: actorUserId,
    placedByStaffName: staffName,
    notes: input.internalNote ?? null,
    salesOrderDraftId: draft.id,
    beforeCreate: async (tx) => {
      const locked = await lockOpenDraft(tx, actorUserId, draft.id);
      if (lineKey(locked.lines) !== lineKey(requestedLines)) {
        throw new AuthError(
          "This draft changed while the order was being placed. Review it and try again.",
          "DRAFT_CONFLICT",
          409,
        );
      }
    },
    withinTransaction: async (tx, order) => {
      const marked = await tx.salesOrderDraft.updateMany({
        where: { id: draft.id, createdByUserId: actorUserId, status: "OPEN" },
        data: {
          status: "PLACED",
          placedOrderId: order.id,
          source: input.source,
          contactId: input.contactId ?? null,
          addressId: input.oneOffAddress ? null : (input.addressId ?? null),
          oneOffAddress: input.oneOffAddress
            ? (input.oneOffAddress as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          poNumber: input.poNumber ?? null,
          deliveryInstructions: input.deliveryInstructions ?? null,
          internalNote: input.internalNote ?? null,
          fulfilmentChoice,
        },
      });
      if (marked.count !== 1) throw draftConflict("UNKNOWN");
    },
  });
  } catch (error) {
    const raced = await prisma.order.findFirst({
      where: {
        OR: [
          { idempotencyKey: input.idempotencyKey },
          { idempotencyKey: `quote-accept:${input.idempotencyKey}` },
        ],
      },
      include: { items: true, company: { select: { name: true } } },
    });
    if (raced && sameSalesOrderSubmission(raced, draft, actorUserId)) {
      await repairCrmFromOrder(raced);
      return { ok: true, alreadyPlaced: true, order: toConfirmation(raced, raced.company.name) };
    }
    throw error;
  }

  if (created.kind === "existing") {
    if (!sameSalesOrderSubmission(created.order, draft, actorUserId)) salesOrderIdempotencyConflict();
    await repairCrmFromOrder(created.order);
    return {
      ok: true,
      alreadyPlaced: true,
      order: toConfirmation(created.order, created.order.company.name),
    };
  }

  const confirmation = toConfirmation(created.order, created.order.company.name);
  await recordAuditEvent({
    action: "order.placed_for_customer",
    entityType: "Order",
    entityId: created.order.id,
    actorUserId,
    companyId: company.id,
    after: {
      orderNumber: created.order.orderNumber,
      status: "SUBMITTED",
      grandTotal: confirmation.grandTotal,
      lineCount: confirmation.lineCount,
      entrySource: input.source,
      placedByStaffUserId: actorUserId,
      customerAuthorised: true,
      contactEmail: contact.email,
      salesOrderDraftId: draft.id,
      autopartSideEffects: false,
      abReservation: true,
      externalRef: null,
      priceOverrides: lines
        .filter((line) => line.priceOverridden)
        .map((line) => ({
          orderId: created.order.id,
          variantId: line.variantId,
          sku: line.sku,
          quantity: line.quantity,
          resolvedUnitPrice: line.resolvedCustomerUnit2dp,
          overriddenUnitPrice: line.customerUnit2dp,
          staffUserId: actorUserId,
        })),
    },
  });
  await ensureSalesOrderCrmActivity({
    actorUserId,
    companyId: company.id,
    orderId: created.order.id,
    orderNumber: created.order.orderNumber,
    source: input.source,
    internalNote: input.internalNote ?? null,
  });
  await sendCustomerConfirmation({
    actorUserId,
    companyId: company.id,
    orderId: created.order.id,
  });

  return { ok: true, alreadyPlaced: false, order: confirmation };
}
