/**
 * Sales order entry on behalf of a customer.
 *
 * Drafts are owned by the staff user and never touch the customer's basket
 * or the admin trade-test basket. Stock is reserved only when the order is placed.
 * Prices are re-resolved from the customer company. Browser prices are not trusted.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import {
  contactSnapshotSchema,
  type ContactSnapshot,
  type DeliveryAddressSnapshot,
} from "@/domain/checkout";
import {
  openSalesOrderDraftSchema,
  placeSalesOrderSchema,
  salesOrderDraftHeaderSchema,
  salesOrderDraftIdSchema,
  salesOrderProductSearchSchema,
  type PlaceSalesOrderInput,
  type SalesOrderEntrySource,
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
import { recordAuditEvent } from "@/server/audit/record";
import { sendOrderEmailsAfterCommit } from "@/server/email/transactional";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { canAccessCompanyAsSales } from "@/server/rbac/sales-access";
import { acceptQuoteOnBehalf } from "@/server/quotes/service";
import { loadStockByVariantIds } from "@/server/stock/service";

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
  updatedAt: string;
  lines: Array<{ id: string; variantId: string; qty: number; sku: string; name: string }>;
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
};

export type SalesPlaceResult =
  | { ok: true; order: PublicOrderConfirmation; alreadyPlaced: boolean }
  | { ok: false; code: "REVIEW_REQUIRED"; review: CheckoutReview };

async function requireSalesOrderStaff(userId: string): Promise<LoadedAccessProfile> {
  const profile = await requireSystemPermission(userId, "orders.place_for_customer");
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Only internal staff can enter orders for customers", "FORBIDDEN", 403);
  }
  return profile;
}

async function requireOrderableCompany(
  profile: LoadedAccessProfile,
  companyId: string,
): Promise<OrderableCompany> {
  const allowed = await canAccessCompanyAsSales(profile, companyId);
  if (!allowed) {
    throw new AuthError("No access to this customer", "COMPANY_FORBIDDEN", 403);
  }
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

const draftInclude = {
  company: { select: { id: true, name: true, status: true, paymentTerms: true } },
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
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.id,
      variantId: line.variantId,
      qty: line.qty,
      sku: line.variant.sku,
      name: line.variant.product.name,
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

async function loadCustomerChoices(companyId: string) {
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
    prisma.quote.findMany({
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
    }),
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

  let deliveryAddress = null;
  let addressReady = false;
  const oneOff =
    draft.oneOffAddress && typeof draft.oneOffAddress === "object"
      ? (draft.oneOffAddress as Record<string, unknown>)
      : null;
  if (draft.addressId || oneOff) {
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

  if (draft.lines.length === 0) {
    return { review: null, contactReady, addressReady };
  }

  const lines = await resolveOrderLinesFromItems(
    company.id,
    draft.lines.map((line) => ({ variantId: line.variantId, qty: line.qty })),
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
  const [choices, priced] = await Promise.all([
    loadCustomerChoices(company.id),
    reviewDraft(company, draft),
  ]);
  return {
    draft: toDraftDto(draft),
    review: priced.review,
    contactReady: priced.contactReady,
    addressReady: priced.addressReady,
    ...choices,
  };
}

async function replaceLines(
  draftId: string,
  lines: Array<{ variantId: string; qty: number }>,
) {
  const unique = new Map<string, number>();
  lines.forEach((line, index) => {
    unique.set(line.variantId, line.qty);
    void index;
  });
  await prisma.$transaction(async (tx) => {
    await tx.salesOrderDraftLine.deleteMany({ where: { draftId } });
    if (unique.size === 0) return;
    await tx.salesOrderDraftLine.createMany({
      data: [...unique.entries()].map(([variantId, qty], sortOrder) => ({
        draftId,
        variantId,
        qty,
        sortOrder,
      })),
    });
  });
}

export async function listSalesOrderDrafts(actorUserId: string) {
  await requireSalesOrderStaff(actorUserId);
  const rows = await prisma.salesOrderDraft.findMany({
    where: { createdByUserId: actorUserId, status: "OPEN" },
    include: draftInclude,
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return rows.map(toDraftDto);
}

export async function openSalesOrderDraft(actorUserId: string, raw: unknown) {
  const profile = await requireSalesOrderStaff(actorUserId);
  const input = openSalesOrderDraftSchema.parse(raw);
  const company = await requireOrderableCompany(profile, input.companyId);

  if (!input.fresh) {
    const existing = await prisma.salesOrderDraft.findFirst({
      where: { createdByUserId: actorUserId, companyId: company.id, status: "OPEN" },
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

export async function getSalesOrderDraft(actorUserId: string, raw: unknown) {
  const profile = await requireSalesOrderStaff(actorUserId);
  const input = salesOrderDraftIdSchema.parse(raw);
  const draft = await loadOwnedDraft(actorUserId, input.draftId, false);
  if (draft.status !== "OPEN") {
    return {
      draft: toDraftDto(draft),
      review: null,
      contactReady: false,
      addressReady: false,
      contacts: [],
      addresses: [],
      quotes: [],
    } satisfies SalesOrderWorkspace;
  }
  return workspaceFor(profile, draft);
}

export async function saveSalesOrderDraft(actorUserId: string, raw: unknown) {
  const profile = await requireSalesOrderStaff(actorUserId);
  const input = salesOrderDraftHeaderSchema.parse(raw);
  const draft = await loadOwnedDraft(actorUserId, input.draftId, true);
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
    await replaceLines(draft.id, input.lines);
  }

  await prisma.salesOrderDraft.update({
    where: { id: draft.id },
    data: {
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
    },
  });

  const fresh = await loadOwnedDraft(actorUserId, draft.id, true);
  return workspaceFor(profile, fresh);
}

export async function abandonSalesOrderDraft(actorUserId: string, raw: unknown) {
  await requireSalesOrderStaff(actorUserId);
  const input = salesOrderDraftIdSchema.parse(raw);
  const draft = await loadOwnedDraft(actorUserId, input.draftId, true);
  await prisma.salesOrderDraft.update({
    where: { id: draft.id },
    data: { status: "ABANDONED" },
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

async function logPlacedActivity(input: {
  actorUserId: string;
  companyId: string;
  orderId: string;
  orderNumber: string;
  source: SalesOrderEntrySource;
  internalNote: string | null;
}) {
  const existing = await prisma.activity.findFirst({
    where: {
      companyId: input.companyId,
      metadata: { path: ["salesOrderId"], equals: input.orderId },
    },
    select: { id: true },
  });
  if (existing) return;

  await prisma.activity.create({
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

  const result = await acceptQuoteOnBehalf(actorUserId, {
    id: quote.id,
    idempotencyKey: input.idempotencyKey,
    note: `Sales order entry (${SOURCE_LABEL[input.source]}). Staff confirmed customer authorisation.`,
  });

  if (!result.alreadyConverted) {
    await prisma.order.update({
      where: { id: result.orderId },
      data: {
        entrySource: input.source,
        placedByStaffUserId: actorUserId,
        placedByStaffName: profile.name?.trim() || profile.email,
      },
    });
    await logPlacedActivity({
      actorUserId,
      companyId: draft.companyId,
      orderId: result.orderId,
      orderNumber: result.orderNumber,
      source: input.source,
      internalNote: input.internalNote ?? null,
    });
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

  await prisma.salesOrderDraft.updateMany({
    where: { id: draft.id, createdByUserId: actorUserId, status: "OPEN" },
    data: {
      status: "PLACED",
      placedOrderId: result.orderId,
      source: input.source,
    },
  });

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: result.orderId },
    include: { items: true, company: { select: { name: true } } },
  });
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

export async function placeSalesOrder(actorUserId: string, raw: unknown): Promise<SalesPlaceResult> {
  const profile = await requireSalesOrderStaff(actorUserId);
  const input = placeSalesOrderSchema.parse(raw);

  const existing = await prisma.order.findFirst({
    where: {
      OR: [
        { idempotencyKey: input.idempotencyKey },
        { idempotencyKey: `quote-accept:${input.idempotencyKey}` },
      ],
    },
    include: { items: true, company: { select: { name: true } } },
  });
  if (existing) {
    const allowed = await canAccessCompanyAsSales(profile, existing.companyId);
    if (!allowed) {
      throw new AuthError("No access to this customer", "COMPANY_FORBIDDEN", 403);
    }
    return { ok: true, alreadyPlaced: true, order: toConfirmation(existing, existing.company.name) };
  }

  const draft = await loadOwnedDraft(actorUserId, input.draftId, false);
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
        return { ok: true, alreadyPlaced: true, order: await confirmationForOrder(draft.placedOrderId) };
      }
    }
    throw new AuthError("Sales order draft not found", "DRAFT_NOT_FOUND", 404);
  }

  if (input.quoteId) {
    return placeFromQuote(actorUserId, profile, draft, input);
  }

  if (input.lines) {
    await replaceLines(draft.id, input.lines);
  }

  const contact = await contactSnapshotForCompany(company.id, input.contactId!);
  const deliveryAddress = await resolveDeliverySnapshot(company.id, {
    addressId: input.oneOffAddress ? null : (input.addressId ?? null),
    oneOffAddress: input.oneOffAddress ?? null,
  });

  await prisma.salesOrderDraft.update({
    where: { id: draft.id },
    data: {
      source: input.source,
      contactId: input.contactId ?? null,
      addressId: input.oneOffAddress ? null : (input.addressId ?? null),
      oneOffAddress: input.oneOffAddress
        ? (input.oneOffAddress as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      poNumber: input.poNumber ?? null,
      deliveryInstructions: input.deliveryInstructions ?? null,
      internalNote: input.internalNote ?? null,
    },
  });

  const current = await loadOwnedDraft(actorUserId, draft.id, true);
  if (current.lines.length === 0) {
    throw new AuthError("Add at least one product", "DRAFT_EMPTY", 400);
  }

  const lines = await resolveOrderLinesFromItems(
    company.id,
    current.lines.map((line) => ({ variantId: line.variantId, qty: line.qty })),
    input.expectedLinePrices,
  );
  const review = buildCheckoutReview({
    company,
    lines,
    deliveryAddress,
    contact,
    poNumber: input.poNumber ?? null,
    deliveryInstructions: input.deliveryInstructions ?? null,
  });
  if (review.hasBlockingIssues) {
    return { ok: false, code: "REVIEW_REQUIRED", review };
  }

  const staffName = profile.name?.trim() || profile.email;
  const created = await commitSubmittedOrder({
    company,
    lines,
    deliveryAddress,
    contact,
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
    withinTransaction: async (tx, order) => {
      const marked = await tx.salesOrderDraft.updateMany({
        where: { id: draft.id, createdByUserId: actorUserId, status: "OPEN" },
        data: { status: "PLACED", placedOrderId: order.id },
      });
      if (marked.count !== 1) {
        throw new AuthError("Draft is no longer open", "DRAFT_NOT_OPEN", 409);
      }
    },
  });

  if (created.kind === "existing") {
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
    },
  });
  await logPlacedActivity({
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
