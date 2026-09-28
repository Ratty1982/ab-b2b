/**
 * Central trade credit decision service.
 *
 * Used by basket checkout and quote → order conversion.
 * Never rejects order creation for credit — returns HOLD / REVIEW_REQUIRED instead.
 *
 * Pending AB exposure reconciliation:
 * 407P100 is aggregate and does not identify individual AB orders. Orders with
 * creditStatus APPROVED whose placedAt is AFTER AutopartCreditPosition.sourceImportedAt
 * count as pending AB exposure. Once a newer 407P100 snapshot is imported, older
 * APPROVED orders drop out of pending (the new Autopart total becomes authoritative).
 * HOLD / REVIEW_REQUIRED orders do NOT consume pending approved exposure until released.
 */

import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import {
  creditFreshnessFromImportedAt,
  type CreditFreshness,
} from "@/server/companies/autopart-credit-freshness";
import {
  decisionExceeds,
  decisionWithinAvailable,
  isCreditControlApplicable,
  money2,
  orderCreditRequirementFromGrandTotal,
  sumPendingExposure,
  type OrderCreditDecision,
  type OrderCreditStatus,
} from "@/domain/order-credit";
import {
  moneyToString,
  moneyZero,
  parseMoney,
  subMoney,
  type Money,
} from "@/domain/money";

type Tx = Prisma.TransactionClient;

export type EvaluateOrderCreditInput = {
  companyId: string;
  /** Gross total (goods + delivery + VAT). */
  grandTotal: unknown;
  paymentTerms: string | null | undefined;
  hasVerifiedAutopartAccount: boolean;
  /** Exclude this order id when recomputing (not used at create). */
  excludeOrderId?: string | null;
  now?: Date;
};

/**
 * Lock the company row for credit evaluation + order create serialization.
 * Call inside the same interactive transaction as order creation.
 */
export async function lockCompanyForCredit(tx: Tx, companyId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Company" WHERE id = ${companyId} FOR UPDATE`;
}

/**
 * Sum of grandTotal for APPROVED credit orders placed after the authoritative
 * 407P100 snapshot import time. HOLD/REVIEW do not count until released.
 */
export async function sumPendingApprovedAbExposure(
  tx: Tx | typeof prisma,
  companyId: string,
  snapshotImportedAt: Date | null,
  excludeOrderId?: string | null,
): Promise<Money> {
  if (!snapshotImportedAt) return moneyZero();

  const rows = await tx.order.findMany({
    where: {
      companyId,
      creditStatus: "APPROVED",
      status: { not: "CANCELLED" },
      placedAt: { gt: snapshotImportedAt },
      ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
    },
    select: { grandTotal: true },
  });

  return sumPendingExposure(rows.map((r) => r.grandTotal));
}

export async function evaluateOrderCredit(
  tx: Tx,
  input: EvaluateOrderCreditInput,
): Promise<OrderCreditDecision> {
  const now = input.now ?? new Date();
  const requirement = orderCreditRequirementFromGrandTotal(input.grandTotal);
  const requirementStr = moneyToString(requirement, 2);

  const position = await tx.autopartCreditPosition.findUnique({
    where: { companyId: input.companyId },
  });

  const applicable = isCreditControlApplicable({
    paymentTerms: input.paymentTerms,
    hasVerifiedAutopartAccount: input.hasVerifiedAutopartAccount,
    hasCreditPosition: Boolean(position),
  });

  if (!applicable) {
    return {
      creditStatus: "NOT_REQUIRED",
      reason: "CREDIT_CONTROL_NOT_APPLICABLE",
      creditApplicable: false,
      creditLimit: null,
      autopartExposure: null,
      importedAvailableCredit: null,
      pendingAbExposure: "0.00",
      effectiveAvailableCredit: null,
      orderCreditRequirement: requirementStr,
      overBy: null,
      creditSnapshotUpdatedAt: null,
      creditSnapshotStatus: "NOT_AVAILABLE",
      remainingEffectiveCapacity: null,
    };
  }

  if (!position) {
    return {
      creditStatus: "REVIEW_REQUIRED",
      reason: "CREDIT_INFORMATION_NOT_AVAILABLE",
      creditApplicable: true,
      creditLimit: null,
      autopartExposure: null,
      importedAvailableCredit: null,
      pendingAbExposure: "0.00",
      effectiveAvailableCredit: null,
      orderCreditRequirement: requirementStr,
      overBy: null,
      creditSnapshotUpdatedAt: null,
      creditSnapshotStatus: "NOT_AVAILABLE",
      remainingEffectiveCapacity: null,
    };
  }

  const freshness = creditFreshnessFromImportedAt(position.sourceImportedAt, now);
  const creditLimit = parseMoney(String(position.creditLimit)) ?? moneyZero();
  const autopartExposure = parseMoney(String(position.totalExposure)) ?? moneyZero();
  const importedAvailable =
    parseMoney(String(position.availableCreditRaw)) ??
    subMoney(creditLimit, autopartExposure);

  if (freshness === "STALE") {
    const pending = await sumPendingApprovedAbExposure(
      tx,
      input.companyId,
      position.sourceImportedAt,
      input.excludeOrderId,
    );
    const effective = subMoney(importedAvailable, pending);
    return {
      creditStatus: "REVIEW_REQUIRED",
      reason: "CREDIT_INFORMATION_STALE",
      creditApplicable: true,
      creditLimit: money2(creditLimit),
      autopartExposure: money2(autopartExposure),
      importedAvailableCredit: money2(importedAvailable),
      pendingAbExposure: money2(pending)!,
      effectiveAvailableCredit: money2(effective),
      orderCreditRequirement: requirementStr,
      overBy: null,
      creditSnapshotUpdatedAt: position.sourceImportedAt.toISOString(),
      creditSnapshotStatus: freshness,
      remainingEffectiveCapacity: null,
    };
  }

  const pending = await sumPendingApprovedAbExposure(
    tx,
    input.companyId,
    position.sourceImportedAt,
    input.excludeOrderId,
  );
  const effective = subMoney(importedAvailable, pending);
  const alreadyOverLimit = importedAvailable.minor < 0n;

  // Exact limit: effectiveAvailable == requirement → approve (no 1p mismatch).
  if (!alreadyOverLimit && effective.minor >= requirement.minor) {
    return decisionWithinAvailable({
      requirement,
      creditLimit,
      autopartExposure,
      importedAvailable,
      pendingAbExposure: pending,
      effectiveAvailable: effective,
      snapshotUpdatedAt: position.sourceImportedAt,
      freshness,
    });
  }

  return decisionExceeds({
    requirement,
    creditLimit,
    autopartExposure,
    importedAvailable,
    pendingAbExposure: pending,
    effectiveAvailable: effective,
    snapshotUpdatedAt: position.sourceImportedAt,
    freshness,
    alreadyOverLimit,
  });
}

/** Prisma create data fragment from a credit decision. */
export function creditFieldsForCreate(decision: OrderCreditDecision, checkedAt = new Date()) {
  return {
    creditStatus: decision.creditStatus as OrderCreditStatus,
    creditDecisionReason: decision.reason,
    creditLimitAtOrder: decision.creditLimit,
    autopartExposureAtOrder: decision.autopartExposure,
    importedAvailableCreditAtOrder: decision.importedAvailableCredit,
    pendingAbExposureAtOrder: decision.pendingAbExposure,
    effectiveAvailableCreditAtOrder: decision.effectiveAvailableCredit,
    orderCreditRequirement: decision.orderCreditRequirement,
    creditOverBy: decision.overBy,
    creditCheckedAt: checkedAt,
    creditSourceImportedAt: decision.creditSnapshotUpdatedAt
      ? new Date(decision.creditSnapshotUpdatedAt)
      : null,
  };
}

export async function auditCreditDecision(input: {
  actorUserId: string;
  companyId: string;
  orderId: string;
  orderNumber: string;
  decision: OrderCreditDecision;
}) {
  const action =
    input.decision.creditStatus === "APPROVED"
      ? "order.credit_approved_automatically"
      : input.decision.creditStatus === "HOLD"
        ? "order.credit_hold"
        : input.decision.creditStatus === "REVIEW_REQUIRED"
          ? "order.credit_review_required"
          : "order.credit_not_required";

  await recordAuditEvent({
    action,
    entityType: "Order",
    entityId: input.orderId,
    actorUserId: input.actorUserId,
    companyId: input.companyId,
    after: {
      orderNumber: input.orderNumber,
      creditStatus: input.decision.creditStatus,
      reason: input.decision.reason,
      creditLimit: input.decision.creditLimit,
      autopartExposure: input.decision.autopartExposure,
      pendingAbExposure: input.decision.pendingAbExposure,
      effectiveAvailable: input.decision.effectiveAvailableCredit,
      orderRequirement: input.decision.orderCreditRequirement,
      overBy: input.decision.overBy,
      snapshotStatus: input.decision.creditSnapshotStatus,
      snapshotUpdatedAt: input.decision.creditSnapshotUpdatedAt,
    },
  });
}

const releaseSchema = z.object({
  orderId: z.string().cuid(),
  note: z.string().trim().min(1).max(1000),
});

export async function releaseOrderCreditHold(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "orders.credit.approve");
  const input = releaseSchema.parse(raw);

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNumber: true,
      companyId: true,
      creditStatus: true,
      creditOverBy: true,
      orderCreditRequirement: true,
      autopartExportStatus: true,
    },
  });
  if (!order) throw new AuthError("Order not found", "ORDER_NOT_FOUND", 404);
  if (order.creditStatus !== "HOLD" && order.creditStatus !== "REVIEW_REQUIRED") {
    throw new AuthError(
      "Order is not awaiting credit approval",
      "CREDIT_NOT_HELD",
      400,
    );
  }

  const previous = order.creditStatus;
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: {
      previousCreditStatus: previous,
      creditStatus: "APPROVED",
      creditDecisionReason: "STAFF_RELEASED",
      creditApprovedByUserId: actorUserId,
      creditApprovedAt: new Date(),
      creditApprovalNote: input.note,
    },
  });

  await recordAuditEvent({
    action: "order.credit_released",
    entityType: "Order",
    entityId: order.id,
    actorUserId,
    companyId: order.companyId,
    before: { creditStatus: previous },
    after: {
      creditStatus: "APPROVED",
      orderNumber: order.orderNumber,
      note: input.note,
      overBy: order.creditOverBy != null ? String(order.creditOverBy) : null,
      orderRequirement:
        order.orderCreditRequirement != null ? String(order.orderCreditRequirement) : null,
    },
  });

  return {
    id: updated.id,
    orderNumber: updated.orderNumber,
    creditStatus: updated.creditStatus,
    creditApprovedAt: updated.creditApprovedAt?.toISOString() ?? null,
    creditApprovalNote: updated.creditApprovalNote,
    previousCreditStatus: previous,
  };
}

/** Preview helper for checkout UX (read-only, no locks). */
export async function previewOrderCreditDecision(input: EvaluateOrderCreditInput) {
  return prisma.$transaction(async (tx) => {
    await lockCompanyForCredit(tx, input.companyId);
    return evaluateOrderCredit(tx, input);
  });
}

/**
 * Derived admin indicator after a newer 407P100 import.
 * Does NOT mutate creditStatus or export — staff must still release.
 */
export type HeldOrderCreditHint = {
  orderId: string;
  orderNumber: string;
  companyId: string;
  currentCreditStatus: "HOLD" | "REVIEW_REQUIRED";
  creditNowAvailable: boolean;
  wouldApprove: boolean;
  liveDecisionStatus: OrderCreditStatus;
  liveDecisionReason: string;
  effectiveAvailableCredit: string | null;
  orderCreditRequirement: string | null;
  overBy: string | null;
  message: string | null;
};

export async function evaluateHeldOrderCreditNow(input: {
  orderId: string;
  orderNumber: string;
  companyId: string;
  grandTotal: unknown;
  paymentTerms: string | null | undefined;
  hasVerifiedAutopartAccount: boolean;
  currentCreditStatus: "HOLD" | "REVIEW_REQUIRED";
}): Promise<HeldOrderCreditHint> {
  const decision = await previewOrderCreditDecision({
    companyId: input.companyId,
    grandTotal: input.grandTotal,
    paymentTerms: input.paymentTerms,
    hasVerifiedAutopartAccount: input.hasVerifiedAutopartAccount,
    excludeOrderId: input.orderId,
  });

  const wouldApprove = decision.creditStatus === "APPROVED";
  const creditNowAvailable = wouldApprove;
  let message: string | null = null;
  if (creditNowAvailable) {
    message =
      input.currentCreditStatus === "REVIEW_REQUIRED"
        ? "Credit information now available — review and release"
        : "Credit now available — review and release";
  } else if (decision.overBy) {
    message = `Still exceeds available credit by £${decision.overBy}`;
  } else if (decision.creditStatus === "REVIEW_REQUIRED") {
    message = "Credit still requires review";
  }

  return {
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    companyId: input.companyId,
    currentCreditStatus: input.currentCreditStatus,
    creditNowAvailable,
    wouldApprove,
    liveDecisionStatus: decision.creditStatus,
    liveDecisionReason: decision.reason,
    effectiveAvailableCredit: decision.effectiveAvailableCredit,
    orderCreditRequirement: decision.orderCreditRequirement,
    overBy: decision.overBy,
    message,
  };
}

export type { OrderCreditDecision, CreditFreshness };
