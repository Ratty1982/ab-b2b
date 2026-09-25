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
import { moneyZero, parseMoney, moneyToString } from "@/domain/money";
import { AUTOPART_504C_SCHEDULE_LABEL } from "@/domain/autopart-504c-schedule";
import { enqueueOrderDespatchedEmail } from "@/server/orders/despatch-email";

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

export type Autopart504cDryRunPreview = {
  headerFound: boolean;
  errors: string[];
  rowsRead: number;
  abReferencesFound: number;
  abInvoices: Array<{
    documentNumber: string;
    abOrderNumber: string;
    accountCode: string;
    goods: string | null;
    vat: string | null;
    value: string | null;
    match: "MATCHED" | "UNKNOWN_AB_ORDER" | "DUPLICATE" | "ORDER_NOT_PROCESSING";
    orderId: string | null;
    orderStatus: string | null;
  }>;
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

async function assessInvoiceRow(
  row: Autopart504cRow,
): Promise<Autopart504cDryRunPreview["abInvoices"][number]> {
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

export async function dryRunAutopart504cFile(
  userId: string,
  input: { text: string; filename?: string },
): Promise<Autopart504cDryRunPreview & { runId: string }> {
  await require504cAdmin(userId);
  const parsed = parseAutopart504cReport(input.text);
  const abInvoices: Autopart504cDryRunPreview["abInvoices"] = [];
  for (const row of parsed.abInvoiceRows) {
    abInvoices.push(await assessInvoiceRow(row));
  }
  const unmatchedAbRefs = [
    ...new Set(
      abInvoices.filter((r) => r.match === "UNKNOWN_AB_ORDER").map((r) => r.abOrderNumber),
    ),
  ];

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
      ordersMatched: abInvoices.filter((r) => r.match === "MATCHED").length,
      newInvoices: 0,
      duplicates: abInvoices.filter((r) => r.match === "DUPLICATE").length,
      credits: parsed.abCreditRows.length,
      unmatchedAbRefs: unmatchedAbRefs.length,
      invalidRows: parsed.malformedRows,
      nonAbRows: parsed.nonAbRows,
      ordersDespatched: 0,
      createdByUserId: userId,
      diagnostics: {
        errors: parsed.errors,
        unmatchedAbRefs,
        headerFound: parsed.headerFound,
      },
    },
  });

  return {
    runId: run.id,
    headerFound: parsed.headerFound,
    errors: parsed.errors,
    rowsRead: parsed.rows.length,
    abReferencesFound: parsed.abInvoiceRows.length + parsed.abCreditRows.length,
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
  const despatchedOrderIds: string[] = [];

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

      await prisma.$transaction(async (tx) => {
        await tx.invoice.create({
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

        if (order.status === "CONFIRMED" || order.status === "PICKING") {
          await tx.order.update({
            where: { id: order.id },
            data: { status: "DISPATCHED" },
          });

          // Consume AB reservations (release hold). Do NOT mutate qtyOnHand —
          // Autopart Avail sync remains authoritative physical stock.
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

          despatchedOrderIds.push(order.id);
          ordersDespatched += 1;
        }
      });

      newInvoices += 1;
    }

    for (const orderId of despatchedOrderIds) {
      try {
        await enqueueOrderDespatchedEmail(orderId);
        emailsQueued += 1;
      } catch (err) {
        await recordAuditEvent({
          action: "order.despatch_email_failed",
          entityType: "Order",
          entityId: orderId,
          actorUserId: userId,
          metadata: {
            error: err instanceof Error ? err.message : "unknown",
          },
        });
      }
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

export async function listAutopart504cImportRuns(userId: string, limit = 25) {
  await require504cAdmin(userId);
  return prisma.autopart504cImportRun.findMany({
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
    },
  });
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
