/**
 * Autopart 504C reconciliation — parse → match AB orders → invoice → DESPATCHED.
 *
 * Automatic mailbox polling remains DISABLED until settings.enabled=true.
 * Dry-run never mutates orders or sends email.
 *
 * Stock reservation: on despatch we mark ACTIVE reservations CONSUMED without
 * changing Inventory.qtyOnHand / qtyReserved double-count risk documentation —
 * Autopart Avail (231PO3NEW) remains authoritative on-hand; consuming the AB
 * reservation releases the AB hold so effective sellable rises when Avail already
 * reflects warehouse pick. We decrement qtyReserved when consuming.
 */

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { recordAuditEvent } from "@/server/audit/record";
import { parseAutopart504cReport, type Autopart504cRow } from "@/domain/autopart-504c";
import {
  AUTOPART_504C_PLAN_RESULT_LABEL,
  compareAbOrderTo504cFinancials,
  money2OrNull,
  orderStatusLabel,
  type Autopart504cDryRunSummary,
  type Autopart504cPlanRow,
  type Autopart504cPlanResult,
  type Autopart504cRunDiagnostics,
} from "@/domain/autopart-504c-plan";
import { parseMoney, moneyToString } from "@/domain/money";
import { AUTOPART_504C_SCHEDULE_LABEL } from "@/domain/autopart-504c-schedule";
import { enqueueOrderDespatchedEmail } from "@/server/orders/despatch-email";
import { enqueueOrderPartDespatchedEmail } from "@/server/orders/part-despatch-email";
import {
  FULFILMENT_LINE_QTY_LIMITATION,
  recordFulfilmentEvent,
} from "@/server/orders/fulfilment";
import { shouldPartialDespatchFrom504c } from "@/domain/backorder";

export type Autopart504cFeedPublicSettings = {
  enabled: boolean;
  configured: boolean;
  scheduleLabel: string;
  scheduleHours: number[];
  workingDaysOnly: boolean;
  allowedSender: string | null;
  subjectContains: string | null;
  filenamePattern: string;
  automaticPolling: "OFF" | "ON";
  statusLabel: "DISABLED" | "NOT_CONFIGURED" | "ENABLED";
  lastPolledAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
};

/** @deprecated Prefer plan rows — kept for existing dry-run consumers. */
export type Autopart504cDryRunInvoiceMatch = {
  documentNumber: string;
  abOrderNumber: string;
  accountCode: string;
  goods: string | null;
  vat: string | null;
  value: string | null;
  match: "MATCHED" | "UNKNOWN_AB_ORDER" | "DUPLICATE" | "ORDER_NOT_PROCESSING";
  orderId: string | null;
  orderStatus: string | null;
};

export type Autopart504cDryRunPreview = {
  headerFound: boolean;
  errors: string[];
  rowsRead: number;
  abReferencesFound: number;
  /** Predictive dry-run counters (WHAT WOULD HAPPEN). */
  summary: Autopart504cDryRunSummary;
  plan: Autopart504cPlanRow[];
  /** Legacy match list derived from plan (compatibility). */
  abInvoices: Autopart504cDryRunInvoiceMatch[];
  abCredits: number;
  nonAbRows: number;
  malformedRows: number;
  unmatchedAbRefs: string[];
};

function fileHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function moneyOrZero(raw: string | null): string {
  if (!raw) return "0.00";
  const m = parseMoney(raw);
  return m ? moneyToString(m, 2) : "0.00";
}

async function require504cAdmin(userId: string) {
  const profile = await requireSystemPermission(userId, "orders.view");
  if (!hasPermission(profile, "admin.access") && !hasPermission(profile, "orders.edit")) {
    throw new AuthError("You do not have permission to manage the 504C feed", "FORBIDDEN", 403);
  }
  return profile;
}

export async function getAutopart504cFeedSettings(): Promise<Autopart504cFeedPublicSettings> {
  const row =
    (await prisma.autopart504cFeedSettings.findUnique({ where: { id: "default" } })) ??
    (await prisma.autopart504cFeedSettings.create({
      data: { id: "default", enabled: false, configured: false },
    }));

  let hours: number[] = [13, 16];
  try {
    const parsed = JSON.parse(row.scheduleHoursJson) as unknown;
    if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) {
      hours = parsed as number[];
    }
  } catch {
    /* keep default */
  }

  const statusLabel: Autopart504cFeedPublicSettings["statusLabel"] = row.enabled
    ? "ENABLED"
    : row.configured
      ? "DISABLED"
      : "NOT_CONFIGURED";

  return {
    enabled: row.enabled,
    configured: row.configured,
    scheduleLabel: AUTOPART_504C_SCHEDULE_LABEL,
    scheduleHours: hours,
    workingDaysOnly: row.workingDaysOnly,
    allowedSender: row.allowedSender,
    subjectContains: row.subjectContains,
    filenamePattern: row.filenamePattern,
    automaticPolling: row.enabled ? "ON" : "OFF",
    statusLabel,
    lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastError: row.lastError,
  };
}

export async function getAutopart504cFeedSettingsForActor(
  userId: string,
): Promise<Autopart504cFeedPublicSettings> {
  await require504cAdmin(userId);
  return getAutopart504cFeedSettings();
}

export async function updateAutopart504cFeedSettings(
  userId: string,
  patch: { configured?: boolean; enabled?: boolean; allowedSender?: string | null },
) {
  await require504cAdmin(userId);
  const existing = await getAutopart504cFeedSettings();
  const nextConfigured = patch.configured ?? existing.configured;
  const nextEnabled = patch.enabled === undefined ? existing.enabled : Boolean(patch.enabled);
  if (nextEnabled && !nextConfigured) {
    throw new AuthError(
      "Cannot enable 504C automatic import until the feed is marked configured (Autopart report email ready).",
      "504C_NOT_CONFIGURED",
      400,
    );
  }

  await prisma.autopart504cFeedSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      enabled: nextEnabled,
      configured: nextConfigured,
      allowedSender: patch.allowedSender ?? null,
      updatedByUserId: userId,
    },
    update: {
      enabled: nextEnabled,
      configured: nextConfigured,
      ...(patch.allowedSender !== undefined ? { allowedSender: patch.allowedSender } : {}),
      updatedByUserId: userId,
    },
  });
  return getAutopart504cFeedSettings();
}

/**
 * Live apply matching (unchanged policy). Used by applyAutopart504cFile only.
 */
async function assessInvoiceRow(
  row: Autopart504cRow,
): Promise<Autopart504cDryRunInvoiceMatch> {
  const abOrderNumber = row.abOrderNumber!;
  const existing = await prisma.invoice.findFirst({
    where: { externalRef: row.documentNumber },
  });
  if (existing) {
    return {
      documentNumber: row.documentNumber,
      abOrderNumber,
      accountCode: row.accountCode,
      goods: row.goods,
      vat: row.vat,
      value: row.value,
      match: "DUPLICATE",
      orderId: existing.orderId,
      orderStatus: null,
    };
  }
  const order = await prisma.order.findUnique({
    where: { orderNumber: abOrderNumber },
    select: { id: true, status: true },
  });
  if (!order) {
    return {
      documentNumber: row.documentNumber,
      abOrderNumber,
      accountCode: row.accountCode,
      goods: row.goods,
      vat: row.vat,
      value: row.value,
      match: "UNKNOWN_AB_ORDER",
      orderId: null,
      orderStatus: null,
    };
  }

  // RECEIVED (SUBMITTED) without Autopart export/processing must not despatch from 504C alone.
  const canReconcile =
    order.status === "CONFIRMED" ||
    order.status === "PICKING" ||
    order.status === "PARTIALLY_DESPATCHED" ||
    order.status === "DISPATCHED" ||
    order.status === "DELIVERED";

  return {
    documentNumber: row.documentNumber,
    abOrderNumber,
    accountCode: row.accountCode,
    goods: row.goods,
    vat: row.vat,
    value: row.value,
    match: canReconcile ? "MATCHED" : "ORDER_NOT_PROCESSING",
    orderId: order.id,
    orderStatus: order.status,
  };
}

function planBase(row: Autopart504cRow, kind: "INVOICE" | "CREDIT") {
  return {
    kind,
    documentNumber: row.documentNumber,
    abOrderNumber: row.abOrderNumber,
    accountCode: row.accountCode,
    goods: money2OrNull(row.goods),
    vat: money2OrNull(row.vat),
    value: money2OrNull(row.value),
  };
}

function withResult(
  base: ReturnType<typeof planBase>,
  partial: {
    result: Autopart504cPlanResult;
    abOrderNumber?: string | null;
    orderId: string | null;
    orderStatus: string | null;
    orderStatusLabel: string | null;
    wouldCreateInvoice: boolean;
    wouldDespatch: boolean;
    wouldSendEmail: boolean;
    fulfilmentFrom: string | null;
    fulfilmentTo: string | null;
    emailAction: string;
    action: string;
    livePolicyNote: string | null;
    financial: Autopart504cPlanRow["financial"];
  },
): Autopart504cPlanRow {
  return {
    ...base,
    ...partial,
    abOrderNumber: partial.abOrderNumber !== undefined ? partial.abOrderNumber : base.abOrderNumber,
    resultLabel: AUTOPART_504C_PLAN_RESULT_LABEL[partial.result],
  };
}

/**
 * Predictive plan for one AB invoice row — same decision inputs as live apply,
 * plus financial diagnostics. Never mutates.
 */
async function planInvoiceRow(row: Autopart504cRow): Promise<Autopart504cPlanRow> {
  const base = planBase(row, "INVOICE");
  const abOrderNumber = row.abOrderNumber!;

  const existing = await prisma.invoice.findFirst({
    where: { externalRef: row.documentNumber },
    select: { id: true, orderId: true, order: { select: { orderNumber: true, status: true } } },
  });
  if (existing) {
    return withResult(base, {
      result: "DUPLICATE",
      orderId: existing.orderId,
      orderStatus: existing.order?.status ?? null,
      orderStatusLabel: orderStatusLabel(existing.order?.status),
      wouldCreateInvoice: false,
      wouldDespatch: false,
      wouldSendEmail: false,
      fulfilmentFrom: orderStatusLabel(existing.order?.status),
      fulfilmentTo: null,
      emailAction: "No action",
      action: "No action",
      livePolicyNote: "Document already imported live — dry-run predicts no further action.",
      financial: null,
      abOrderNumber: existing.order?.orderNumber ?? abOrderNumber,
    });
  }

  const order = await prisma.order.findUnique({
    where: { orderNumber: abOrderNumber },
    select: {
      id: true,
      status: true,
      subtotal: true,
      deliveryTotal: true,
      vatTotal: true,
      grandTotal: true,
      items: { select: { backorderQtyAtOrder: true } },
    },
  });

  if (!order) {
    return withResult(base, {
      result: "UNKNOWN_AB_ORDER",
      orderId: null,
      orderStatus: null,
      orderStatusLabel: null,
      wouldCreateInvoice: false,
      wouldDespatch: false,
      wouldSendEmail: false,
      fulfilmentFrom: null,
      fulfilmentTo: null,
      emailAction: "No action",
      action: "No action",
      livePolicyNote: null,
      financial: null,
      abOrderNumber,
    });
  }

  const financial = compareAbOrderTo504cFinancials({
    abGoods: moneyOrZero(String(order.subtotal)),
    abDelivery: moneyOrZero(String(order.deliveryTotal)),
    abVat: moneyOrZero(String(order.vatTotal)),
    abTotal: moneyOrZero(String(order.grandTotal)),
    c504Goods: row.goods,
    c504Vat: row.vat,
    c504Value: row.value,
  });

  const statusLabel = orderStatusLabel(order.status);
  const alreadyDespatched = order.status === "DISPATCHED" || order.status === "DELIVERED";
  const processing =
    order.status === "CONFIRMED" ||
    order.status === "PICKING" ||
    order.status === "PARTIALLY_DESPATCHED";
  const canReconcile = processing || alreadyDespatched;

  if (!canReconcile) {
    return withResult(base, {
      result: "STATUS_NOT_ELIGIBLE",
      orderId: order.id,
      orderStatus: order.status,
      orderStatusLabel: statusLabel,
      wouldCreateInvoice: false,
      wouldDespatch: false,
      wouldSendEmail: false,
      fulfilmentFrom: statusLabel,
      fulfilmentTo: null,
      emailAction: "No action",
      action: "No action",
      livePolicyNote:
        "Live importer does not create invoices or despatch from 504C while the order is not Processing.",
      financial,
      abOrderNumber,
    });
  }

  const hasKnownBackorder = shouldPartialDespatchFrom504c({
    items: order.items,
    expectedGoodsNet: Number(moneyOrZero(String(order.subtotal))) + Number(moneyOrZero(String(order.deliveryTotal))),
    invoiceGoods: row.goods != null ? Number(row.goods) : null,
  });
  // Full despatch email only when we would move to DISPATCHED (not partial).
  const wouldFullDespatch = processing && !hasKnownBackorder;
  const wouldPartialDespatch = processing && hasKnownBackorder;
  const wouldDespatch = wouldFullDespatch; // plan field = full despatch for summary compatibility
  const wouldSendEmail = wouldFullDespatch;
  const financialIssue = financial.status === "MISMATCH";

  // Live apply currently does not block on financial mismatch — dry-run still predicts create/despatch
  // but surfaces FINANCIAL_MISMATCH as the primary classification when amounts disagree.
  const result: Autopart504cPlanResult = financialIssue
    ? "FINANCIAL_MISMATCH"
    : wouldFullDespatch
      ? "WOULD_DESPATCH"
      : wouldPartialDespatch
        ? "WOULD_CREATE"
        : alreadyDespatched
          ? "ALREADY_DESPATCHED"
          : "WOULD_CREATE";

  return withResult(base, {
    result,
    orderId: order.id,
    orderStatus: order.status,
    orderStatusLabel: statusLabel,
    wouldCreateInvoice: true,
    wouldDespatch: wouldFullDespatch,
    wouldSendEmail,
    fulfilmentFrom: statusLabel,
    fulfilmentTo: wouldFullDespatch
      ? "Despatched"
      : wouldPartialDespatch
        ? "Part Despatched"
        : statusLabel,
    emailAction: wouldSendEmail
      ? "Would send ORDER_DESPATCHED"
      : wouldPartialDespatch
        ? "No full despatch email (known backorder — Part Despatched)"
        : "No despatch email",
    action: wouldFullDespatch
      ? "Would create invoice and transition to Despatched"
      : wouldPartialDespatch
        ? "Would create invoice and transition to Part Despatched (known backorder)"
        : "Would create invoice",
    livePolicyNote: hasKnownBackorder
      ? "Order has known backordered quantity. 504C is order-level only — AB marks PARTIALLY_DESPATCHED, not full Despatched."
      : financialIssue
        ? "Live importer currently does not block on financial mismatch — amounts are flagged here for review."
        : null,
    financial,
    abOrderNumber,
  });
}

async function planCreditRow(row: Autopart504cRow): Promise<Autopart504cPlanRow> {
  const base = planBase(row, "CREDIT");
  const existing = await prisma.invoice.findFirst({
    where: { externalRef: row.documentNumber },
    select: { id: true, orderId: true, order: { select: { orderNumber: true, status: true } } },
  });
  if (existing) {
    return withResult(base, {
      result: "DUPLICATE",
      orderId: existing.orderId,
      orderStatus: existing.order?.status ?? null,
      orderStatusLabel: orderStatusLabel(existing.order?.status),
      wouldCreateInvoice: false,
      wouldDespatch: false,
      wouldSendEmail: false,
      fulfilmentFrom: orderStatusLabel(existing.order?.status),
      fulfilmentTo: null,
      emailAction: "No action",
      action: "No action",
      livePolicyNote: "Credit document already imported.",
      financial: null,
      abOrderNumber: existing.order?.orderNumber ?? row.abOrderNumber,
    });
  }

  const order = row.abOrderNumber
    ? await prisma.order.findUnique({
        where: { orderNumber: row.abOrderNumber },
        select: { id: true, status: true },
      })
    : null;

  if (row.abOrderNumber && !order) {
    return withResult(base, {
      result: "UNKNOWN_AB_ORDER",
      orderId: null,
      orderStatus: null,
      orderStatusLabel: null,
      wouldCreateInvoice: false,
      wouldDespatch: false,
      wouldSendEmail: false,
      fulfilmentFrom: null,
      fulfilmentTo: null,
      emailAction: "No action",
      action: "No action",
      livePolicyNote: "Credit references unknown AB order — live apply records unmatched.",
      financial: null,
      abOrderNumber: row.abOrderNumber,
    });
  }

  return withResult(base, {
    result: "CREDIT",
    orderId: order?.id ?? null,
    orderStatus: order?.status ?? null,
    orderStatusLabel: orderStatusLabel(order?.status),
    wouldCreateInvoice: Boolean(order),
    wouldDespatch: false,
    wouldSendEmail: false,
    fulfilmentFrom: orderStatusLabel(order?.status),
    fulfilmentTo: null,
    emailAction: "No despatch action",
    action: order ? "Would record credit invoice (no despatch)" : "No action",
    livePolicyNote: "Credits never trigger despatch or ORDER_DESPATCHED email.",
    financial: null,
    abOrderNumber: row.abOrderNumber,
  });
}

function summariseDryRunPlan(
  plan: Autopart504cPlanRow[],
  nonAbIgnored: number,
): Autopart504cDryRunSummary {
  const invoicePlans = plan.filter((p) => p.kind === "INVOICE");
  const creditPlans = plan.filter((p) => p.kind === "CREDIT");
  const abMatches = invoicePlans.filter(
    (p) =>
      p.result !== "UNKNOWN_AB_ORDER" &&
      p.result !== "INVALID" &&
      p.orderId != null,
  ).length;
  const wouldCreate = plan.filter((p) => p.wouldCreateInvoice).length;
  const duplicates = plan.filter((p) => p.result === "DUPLICATE").length;
  const wouldDespatch = plan.filter((p) => p.wouldDespatch).length;
  const wouldSendEmail = plan.filter((p) => p.wouldSendEmail).length;
  const issues = plan.filter(
    (p) =>
      p.result === "UNKNOWN_AB_ORDER" ||
      p.result === "FINANCIAL_MISMATCH" ||
      p.result === "STATUS_NOT_ELIGIBLE" ||
      p.result === "INVALID",
  ).length;

  return {
    abMatches,
    wouldCreate,
    duplicates,
    wouldDespatch,
    issues,
    credits: creditPlans.length,
    nonAbIgnored,
    wouldSendEmail,
  };
}

function planToLegacyMatch(row: Autopart504cPlanRow): Autopart504cDryRunInvoiceMatch | null {
  if (row.kind !== "INVOICE" || !row.abOrderNumber) return null;
  let match: Autopart504cDryRunInvoiceMatch["match"];
  if (row.result === "DUPLICATE") match = "DUPLICATE";
  else if (row.result === "UNKNOWN_AB_ORDER") match = "UNKNOWN_AB_ORDER";
  else if (row.result === "STATUS_NOT_ELIGIBLE") match = "ORDER_NOT_PROCESSING";
  else match = "MATCHED";
  return {
    documentNumber: row.documentNumber,
    abOrderNumber: row.abOrderNumber,
    accountCode: row.accountCode,
    goods: row.goods,
    vat: row.vat,
    value: row.value,
    match,
    orderId: row.orderId,
    orderStatus: row.orderStatus,
  };
}

/**
 * Dry-run: same validation/decision logic as live, predictive plan only.
 * Persists ImportRun + diagnostics. Never creates invoices, changes orders,
 * consumes reservations, or sends email.
 */
export async function dryRunAutopart504cFile(
  userId: string,
  input: { text: string; filename?: string },
): Promise<Autopart504cDryRunPreview & { runId: string }> {
  await require504cAdmin(userId);
  const parsed = parseAutopart504cReport(input.text);

  const plan: Autopart504cPlanRow[] = [];
  for (const row of parsed.abInvoiceRows) {
    plan.push(await planInvoiceRow(row));
  }
  for (const row of parsed.abCreditRows) {
    plan.push(await planCreditRow(row));
  }

  const summary = summariseDryRunPlan(plan, parsed.nonAbRows);
  const unmatchedAbRefs = [
    ...new Set(
      plan
        .filter((r) => r.result === "UNKNOWN_AB_ORDER" && r.abOrderNumber)
        .map((r) => r.abOrderNumber!),
    ),
  ];
  const abInvoices = plan
    .map(planToLegacyMatch)
    .filter((r): r is Autopart504cDryRunInvoiceMatch => r != null);

  const diagnostics: Autopart504cRunDiagnostics = {
    mode: "DRY_RUN_PREVIEW",
    headerFound: parsed.headerFound,
    errors: parsed.errors,
    unmatchedAbRefs,
    summary,
    plan,
  };

  const run = await prisma.autopart504cImportRun.create({
    data: {
      status: "DRY_RUN",
      isDryRun: true,
      finishedAt: new Date(),
      source: "UPLOAD_DRY_RUN",
      filename: input.filename ?? "upload.txt",
      fileHash: fileHash(input.text),
      rowsRead: parsed.rows.length,
      abReferencesFound: parsed.abInvoiceRows.length + parsed.abCreditRows.length,
      // Predictive counters for dry-run history (WHAT WOULD HAPPEN — not completed actions).
      ordersMatched: summary.abMatches,
      newInvoices: summary.wouldCreate,
      duplicates: summary.duplicates,
      credits: summary.credits,
      unmatchedAbRefs: unmatchedAbRefs.length,
      invalidRows: parsed.malformedRows,
      nonAbRows: parsed.nonAbRows,
      ordersDespatched: summary.wouldDespatch,
      emailsQueued: 0,
      emailsSent: 0,
      emailsFailed: 0,
      createdByUserId: userId,
      diagnostics: diagnostics as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    runId: run.id,
    headerFound: parsed.headerFound,
    errors: parsed.errors,
    rowsRead: parsed.rows.length,
    abReferencesFound: parsed.abInvoiceRows.length + parsed.abCreditRows.length,
    summary,
    plan,
    abInvoices,
    abCredits: parsed.abCreditRows.length,
    nonAbRows: parsed.nonAbRows,
    malformedRows: parsed.malformedRows,
    unmatchedAbRefs,
  };
}

/**
 * Apply a 504C file (commit mode). Used by future live poll and admin "apply test file".
 * Does not send despatch email for credits. Idempotent on Autopart document number.
 */
export async function applyAutopart504cFile(
  userId: string | null,
  input: { text: string; filename?: string; source?: string; allowApply?: boolean },
) {
  if (userId) await require504cAdmin(userId);

  const settings = await getAutopart504cFeedSettings();
  // Live apply from mailbox must be enabled; explicit admin allowApply bypasses for controlled tests.
  if (!input.allowApply && !settings.enabled) {
    throw new AuthError(
      "504C automatic import is DISABLED. Use dry-run upload for testing.",
      "504C_DISABLED",
      400,
    );
  }

  const parsed = parseAutopart504cReport(input.text);
  const hash = fileHash(input.text);
  const startedAt = new Date();

  let newInvoices = 0;
  let duplicates = 0;
  let ordersDespatched = 0;
  let ordersMatched = 0;
  let unmatchedAbRefs = 0;
  let emailsQueued = 0;
  const unmatched: string[] = [];

  const run = await prisma.autopart504cImportRun.create({
    data: {
      status: "SUCCESS",
      isDryRun: false,
      startedAt,
      source: input.source ?? "APPLY",
      filename: input.filename ?? null,
      fileHash: hash,
      createdByUserId: userId,
    },
  });

  try {
    for (const row of parsed.abCreditRows) {
      // Persist credit classification without despatch.
      const existing = await prisma.invoice.findFirst({ where: { externalRef: row.documentNumber } });
      if (existing) {
        duplicates += 1;
        continue;
      }
      if (!row.abOrderNumber) continue;
      const order = await prisma.order.findUnique({ where: { orderNumber: row.abOrderNumber } });
      if (!order) {
        unmatchedAbRefs += 1;
        unmatched.push(row.abOrderNumber);
        continue;
      }
      await prisma.invoice.create({
        data: {
          invoiceNumber: `AP-CR-${row.documentNumber}`,
          companyId: order.companyId,
          orderId: order.id,
          status: "ISSUED",
          subtotal: moneyOrZero(row.goods),
          vatTotal: moneyOrZero(row.vat),
          grandTotal: moneyOrZero(row.value),
          issuedAt: row.documentDate ? new Date(`${row.documentDate}T12:00:00.000Z`) : startedAt,
          externalRef: row.documentNumber,
          autopartDocumentKind: "CREDIT",
          autopartAccountCode: row.accountCode,
          autopartCustomerOrderNumber: row.abOrderNumber,
          autopartDocumentAt: row.documentDate
            ? new Date(`${row.documentDate}T${row.documentTime ?? "12:00"}:00.000Z`)
            : null,
          autopartInitials: row.initials,
          autopartImportRunId: run.id,
        },
      });
      newInvoices += 1;
    }

    for (const row of parsed.abInvoiceRows) {
      const assessment = await assessInvoiceRow(row);
      if (assessment.match === "DUPLICATE") {
        duplicates += 1;
        continue;
      }
      if (assessment.match === "UNKNOWN_AB_ORDER") {
        unmatchedAbRefs += 1;
        unmatched.push(assessment.abOrderNumber);
        continue;
      }
      if (assessment.match === "ORDER_NOT_PROCESSING") {
        // Safeguard: do not despatch RECEIVED/cancelled orders from 504C alone.
        unmatchedAbRefs += 1;
        unmatched.push(assessment.abOrderNumber);
        continue;
      }

      ordersMatched += 1;
      const order = await prisma.order.findUniqueOrThrow({ where: { id: assessment.orderId! } });

      const emailActions: Array<
        | { kind: "FULL"; orderId: string; remainingAfterBackorder: boolean }
        | { kind: "PART"; orderId: string; invoiceExternalRef: string }
      > = [];

      await prisma.$transaction(async (tx) => {
        const invoice = await tx.invoice.create({
          data: {
            invoiceNumber: `AP-INV-${row.documentNumber}`,
            companyId: order.companyId,
            orderId: order.id,
            status: "ISSUED",
            subtotal: moneyOrZero(row.goods),
            vatTotal: moneyOrZero(row.vat),
            grandTotal: moneyOrZero(row.value),
            issuedAt: row.documentDate ? new Date(`${row.documentDate}T12:00:00.000Z`) : startedAt,
            externalRef: row.documentNumber,
            autopartDocumentKind: "INVOICE",
            autopartAccountCode: row.accountCode,
            autopartCustomerOrderNumber: row.abOrderNumber,
            autopartDocumentAt: row.documentDate
              ? new Date(`${row.documentDate}T${row.documentTime ?? "12:00"}:00.000Z`)
              : null,
            autopartInitials: row.initials,
            autopartImportRunId: run.id,
          },
        });

        await recordFulfilmentEvent(tx, {
          orderId: order.id,
          kind: "INVOICE_LINKED",
          summary: `Invoice ${row.documentNumber} linked to your order`,
          source: "AUTOPART_504C",
          invoiceId: invoice.id,
          lineQuantitiesKnown: false,
          limitation: FULFILMENT_LINE_QTY_LIMITATION,
          metadata: {
            documentNumber: row.documentNumber,
            goods: row.goods,
            value: row.value,
          },
        });

        const eligible =
          order.status === "CONFIRMED" ||
          order.status === "PICKING" ||
          order.status === "PARTIALLY_DESPATCHED";

        if (!eligible) return;

        const items = await tx.orderItem.findMany({
          where: { orderId: order.id },
          select: { id: true, qty: true, backorderQtyAtOrder: true, despatchedQty: true },
        });
        const hasKnownBackorder = shouldPartialDespatchFrom504c({ items });

        // Consume AB reservations on first processing→despatch evidence.
        if (order.status === "CONFIRMED" || order.status === "PICKING") {
          const active = await tx.orderStockReservation.findMany({
            where: { orderId: order.id, status: "ACTIVE" },
          });
          for (const res of active) {
            await tx.orderStockReservation.update({
              where: { id: res.id },
              data: { status: "CONSUMED", consumedAt: new Date() },
            });
            await tx.inventory.update({
              where: { id: res.inventoryId },
              data: { qtyReserved: { decrement: res.quantity } },
            });
          }
        }

        // Multiple invoices: check cumulative financial completion (504C has no line qty).
        // Load invoices including the one just created.
        const allInvoices = await tx.invoice.findMany({
          where: { orderId: order.id, autopartDocumentKind: "INVOICE" },
          select: { subtotal: true, vatTotal: true, grandTotal: true },
        });
        const orderRow = await tx.order.findUniqueOrThrow({
          where: { id: order.id },
          select: { subtotal: true, deliveryTotal: true, vatTotal: true, grandTotal: true },
        });
        const { compareAbOrderTo504cFinancials, money2OrNull } = await import(
          "@/domain/autopart-504c-plan"
        );
        const { moneyToString, moneyZero, parseMoney, addMoney } = await import("@/domain/money");
        let goods = moneyZero();
        let vat = moneyZero();
        let value = moneyZero();
        for (const inv of allInvoices) {
          goods = addMoney(goods, parseMoney(String(inv.subtotal)) ?? moneyZero());
          vat = addMoney(vat, parseMoney(String(inv.vatTotal)) ?? moneyZero());
          value = addMoney(value, parseMoney(String(inv.grandTotal)) ?? moneyZero());
        }
        const financial = compareAbOrderTo504cFinancials({
          abGoods: moneyToString(parseMoney(String(orderRow.subtotal)) ?? moneyZero(), 2),
          abDelivery: moneyToString(parseMoney(String(orderRow.deliveryTotal)) ?? moneyZero(), 2),
          abVat: moneyToString(parseMoney(String(orderRow.vatTotal)) ?? moneyZero(), 2),
          abTotal: moneyToString(parseMoney(String(orderRow.grandTotal)) ?? moneyZero(), 2),
          c504Goods: moneyToString(goods, 2),
          c504Vat: moneyToString(vat, 2),
          c504Value: moneyToString(value, 2),
        });
        const financiallyComplete = financial.status === "OK";

        if (!hasKnownBackorder || financiallyComplete) {
          // Full despatch — only set line despatchedQty when completing fully (entire order).
          for (const item of items) {
            await tx.orderItem.update({
              where: { id: item.id },
              data: { despatchedQty: item.qty },
            });
          }
          await tx.order.update({
            where: { id: order.id },
            data: { status: "DISPATCHED" },
          });
          await recordFulfilmentEvent(tx, {
            orderId: order.id,
            kind: "DESPATCHED",
            summary: hasKnownBackorder
              ? "Remaining items on your order have been despatched"
              : "Your order has been despatched",
            source: "AUTOPART_504C",
            invoiceId: invoice.id,
            lineQuantitiesKnown: true,
            limitation: null,
          });
          emailActions.push({
            kind: "FULL",
            orderId: order.id,
            remainingAfterBackorder: hasKnownBackorder,
          });
          ordersDespatched += 1;
        } else {
          // Partial — do NOT invent line despatched quantities from 504C totals.
          await tx.order.update({
            where: { id: order.id },
            data: { status: "PARTIALLY_DESPATCHED" },
          });
          await recordFulfilmentEvent(tx, {
            orderId: order.id,
            kind: "PART_DESPATCHED",
            summary: "Part of your order has been despatched; some items remain on backorder",
            source: "AUTOPART_504C",
            invoiceId: invoice.id,
            lineQuantitiesKnown: false,
            limitation: FULFILMENT_LINE_QTY_LIMITATION,
          });
          emailActions.push({
            kind: "PART",
            orderId: order.id,
            invoiceExternalRef: row.documentNumber,
          });
        }
      });

      for (const action of emailActions) {
        try {
          if (action.kind === "FULL") {
            await enqueueOrderDespatchedEmail(action.orderId, {
              remainingAfterBackorder: action.remainingAfterBackorder,
            });
          } else {
            await enqueueOrderPartDespatchedEmail({
              orderId: action.orderId,
              invoiceExternalRef: action.invoiceExternalRef,
              lineQuantitiesKnown: false,
            });
          }
          emailsQueued += 1;
        } catch (err) {
          await recordAuditEvent({
            action:
              action.kind === "FULL"
                ? "order.despatch_email_failed"
                : "order.part_despatch_email_failed",
            entityType: "Order",
            entityId: action.orderId,
            actorUserId: userId,
            metadata: {
              error: err instanceof Error ? err.message : "unknown",
            },
          });
        }
      }

      newInvoices += 1;
    }

    const status =
      parsed.errors.length > 0 || unmatchedAbRefs > 0 || parsed.malformedRows > 0
        ? "PARTIAL"
        : "SUCCESS";

    // Non-AB customer rows never force PARTIAL — they are expected company-wide noise.

    await prisma.autopart504cImportRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        rowsRead: parsed.rows.length,
        abReferencesFound: parsed.abInvoiceRows.length + parsed.abCreditRows.length,
        ordersMatched,
        newInvoices,
        duplicates,
        credits: parsed.abCreditRows.length,
        unmatchedAbRefs,
        invalidRows: parsed.malformedRows,
        nonAbRows: parsed.nonAbRows,
        ordersDespatched,
        emailsQueued,
        diagnostics: {
          errors: parsed.errors,
          unmatchedAbRefs: unmatched,
          headerFound: parsed.headerFound,
          reservationNote:
            "ACTIVE AB reservations CONSUMED on despatch; qtyOnHand untouched (Autopart Avail authoritative).",
        },
      },
    });

    await recordAuditEvent({
      action: "order.autopart_504c_import",
      entityType: "Autopart504cImportRun",
      entityId: run.id,
      actorUserId: userId,
      metadata: {
        status,
        ordersDespatched,
        newInvoices,
        duplicates,
        credits: parsed.abCreditRows.length,
        apcInvoked: false,
      },
    });

    return prisma.autopart504cImportRun.findUniqueOrThrow({ where: { id: run.id } });
  } catch (error) {
    await prisma.autopart504cImportRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        diagnostics: {
          error: error instanceof Error ? error.message : "unknown",
        },
      },
    });
    throw error;
  }
}

function issuesFromDiagnostics(diagnostics: unknown, unmatchedAbRefs: number): number {
  if (
    diagnostics &&
    typeof diagnostics === "object" &&
    "summary" in diagnostics &&
    diagnostics.summary &&
    typeof diagnostics.summary === "object" &&
    "issues" in diagnostics.summary &&
    typeof (diagnostics.summary as { issues?: unknown }).issues === "number"
  ) {
    return (diagnostics.summary as { issues: number }).issues;
  }
  return unmatchedAbRefs;
}

export async function listAutopart504cImportRuns(userId: string, limit = 25) {
  await require504cAdmin(userId);
  const rows = await prisma.autopart504cImportRun.findMany({
    orderBy: { startedAt: "desc" },
    take: Math.min(100, Math.max(1, limit)),
    select: {
      id: true,
      status: true,
      isDryRun: true,
      startedAt: true,
      finishedAt: true,
      source: true,
      filename: true,
      rowsRead: true,
      abReferencesFound: true,
      ordersMatched: true,
      newInvoices: true,
      duplicates: true,
      credits: true,
      unmatchedAbRefs: true,
      invalidRows: true,
      nonAbRows: true,
      ordersDespatched: true,
      emailsQueued: true,
      emailsFailed: true,
      diagnostics: true,
    },
  });

  return rows.map((run) => ({
    id: run.id,
    status: run.status,
    isDryRun: run.isDryRun,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    source: run.source,
    filename: run.filename,
    rowsRead: run.rowsRead,
    abReferencesFound: run.abReferencesFound,
    ordersMatched: run.ordersMatched,
    newInvoices: run.newInvoices,
    duplicates: run.duplicates,
    credits: run.credits,
    unmatchedAbRefs: run.unmatchedAbRefs,
    invalidRows: run.invalidRows,
    nonAbRows: run.nonAbRows,
    ordersDespatched: run.ordersDespatched,
    emailsQueued: run.emailsQueued,
    emailsFailed: run.emailsFailed,
    issues: issuesFromDiagnostics(run.diagnostics, run.unmatchedAbRefs),
    /** Dry-run counters are predictive; live counters are completed actions. */
    counterMode: run.isDryRun ? ("PREVIEW" as const) : ("ACTUAL" as const),
  }));
}

export async function getAutopart504cImportRunDetail(userId: string, runId: string) {
  await require504cAdmin(userId);
  const run = await prisma.autopart504cImportRun.findUnique({ where: { id: runId } });
  if (!run) {
    throw new AuthError("504C import run not found", "NOT_FOUND", 404);
  }

  const diagnostics = (run.diagnostics ?? null) as Autopart504cRunDiagnostics | null;
  const summary =
    diagnostics?.summary ??
    ({
      abMatches: run.ordersMatched,
      wouldCreate: run.isDryRun ? run.newInvoices : 0,
      duplicates: run.duplicates,
      wouldDespatch: run.isDryRun ? run.ordersDespatched : 0,
      issues: issuesFromDiagnostics(run.diagnostics, run.unmatchedAbRefs),
      credits: run.credits,
      nonAbIgnored: run.nonAbRows,
      wouldSendEmail: 0,
    } satisfies Autopart504cDryRunSummary);

  return {
    id: run.id,
    status: run.status,
    isDryRun: run.isDryRun,
    counterMode: run.isDryRun ? ("PREVIEW" as const) : ("ACTUAL" as const),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    source: run.source,
    filename: run.filename,
    rowsRead: run.rowsRead,
    abReferencesFound: run.abReferencesFound,
    ordersMatched: run.ordersMatched,
    newInvoices: run.newInvoices,
    duplicates: run.duplicates,
    credits: run.credits,
    unmatchedAbRefs: run.unmatchedAbRefs,
    invalidRows: run.invalidRows,
    nonAbRows: run.nonAbRows,
    ordersDespatched: run.ordersDespatched,
    emailsQueued: run.emailsQueued,
    emailsSent: run.emailsSent,
    emailsFailed: run.emailsFailed,
    issues: summary.issues,
    summary,
    plan: diagnostics?.plan ?? [],
    errors: diagnostics?.errors ?? [],
    headerFound: diagnostics?.headerFound ?? null,
    unmatchedAbRefList: diagnostics?.unmatchedAbRefs ?? [],
  };
}

/** Scheduler entry — no-op while disabled. */
export async function runAutopart504cScheduledPollIfEnabled(): Promise<{ ran: boolean; reason: string }> {
  const settings = await getAutopart504cFeedSettings();
  if (!settings.enabled) {
    return { ran: false, reason: "504C feed disabled (default). Automatic polling OFF." };
  }
  if (!settings.configured) {
    return { ran: false, reason: "504C feed not configured." };
  }
  // Mailbox polling not activated in this phase — requires Autopart report email.
  return {
    ran: false,
    reason: "504C enabled flag is on but live mailbox ingestion awaits Autopart email configuration task.",
  };
}

/**
 * Admin "Poll mailbox now".
 * When disabled/not configured, does not run production reconciliation.
 */
export async function pollAutopart504cMailboxNow(
  userId: string,
): Promise<{ ran: boolean; reason: string }> {
  await require504cAdmin(userId);
  const settings = await getAutopart504cFeedSettings();
  if (!settings.enabled || !settings.configured) {
    return {
      ran: false,
      reason:
        "504C Invoice Feed is DISABLED / NOT CONFIGURED. Use Upload 504C test file (dry-run) instead. Live mailbox poll stays off until Autopart configures the scheduled report and an admin enables the feed.",
    };
  }
  return runAutopart504cScheduledPollIfEnabled();
}
