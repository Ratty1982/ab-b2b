/**
 * Keeps Sales Enquiry off the rest of the portal's database connections.
 *
 * The Prisma pool is small (production limit 5). A customer report used to open
 * several copies of the same heavy query at once, and each copy could start
 * PostgreSQL parallel workers that resized /dev/shm. This guard:
 * - shares one in-flight execution for an identical report
 * - rejects further reports immediately instead of queueing them
 * - applies a statement timeout and disables parallel workers on that connection
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";

export const SALES_ENQUIRY_MAX_CONCURRENT = 2;
export const SALES_ENQUIRY_STATEMENT_TIMEOUT = "20s";
const REPORT_TRANSACTION_TIMEOUT_MS = 25_000;
const REPORT_CONNECTION_WAIT_MS = 500;

const inflight = new Map<string, Promise<unknown>>();
let active = 0;
const reportConnections = new AsyncLocalStorage<Prisma.TransactionClient>();

export function resetReportGuardForTests(): void {
  inflight.clear();
  active = 0;
}

export function reportGuardActiveCount(): number {
  return active;
}

export function hasReportDb(): boolean {
  return reportConnections.getStore() != null;
}

export function reportDb(): Prisma.TransactionClient {
  const db = reportConnections.getStore();
  if (!db) {
    throw new Error("Sales enquiry query ran without a report connection");
  }
  return db;
}

export class SalesEnquiryReportError extends AuthError {
  constructor(message: string, code: "SALES_ENQUIRY_BUSY" | "SALES_ENQUIRY_TIMEOUT" | "SALES_ENQUIRY_FAILED") {
    super(message, code, code === "SALES_ENQUIRY_BUSY" ? 429 : 503);
    this.name = "SalesEnquiryReportError";
  }
}

/** Runs identical reports once. A third distinct report is rejected with no queue. */
export function runBoundedReport<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  if (active >= SALES_ENQUIRY_MAX_CONCURRENT) {
    throw new SalesEnquiryReportError(
      "A sales enquiry report is already running. Wait a moment and try again.",
      "SALES_ENQUIRY_BUSY",
    );
  }
  active += 1;
  const promise = Promise.resolve()
    .then(work)
    .finally(() => {
      active = Math.max(0, active - 1);
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

export function mapReportFailure(error: unknown): Error {
  if (error instanceof AuthError) return error;
  const message = error instanceof Error ? error.message : "";
  const code = postgresCode(error);
  if (
    code === "57014" ||
    code === "53100" ||
    /statement timeout/i.test(message) ||
    /canceling statement due to statement timeout/i.test(message)
  ) {
    console.error("[sales-enquiry] report timed out", error);
    return new SalesEnquiryReportError(
      "This sales enquiry took too long and was stopped so the rest of the portal stays available. Try again.",
      "SALES_ENQUIRY_TIMEOUT",
    );
  }
  if (
    code === "P2024" ||
    code === "P2028" ||
    /Timed out fetching a new connection/i.test(message) ||
    /Unable to start a transaction/i.test(message) ||
    /connection pool/i.test(message)
  ) {
    console.error("[sales-enquiry] report connection unavailable", error);
    return new SalesEnquiryReportError(
      "Sales enquiry is busy. Wait a moment and try again.",
      "SALES_ENQUIRY_BUSY",
    );
  }
  return error instanceof Error ? error : new Error("Sales enquiry failed");
}

/**
 * One pooled connection for a report. Nested calls reuse it instead of taking another.
 * Parallel workers are off so a large aggregate cannot resize /dev/shm.
 */
export async function withReportSql<T>(key: string, work: () => Promise<T>): Promise<T> {
  if (hasReportDb()) return work();
  try {
    return await runBoundedReport(key, () =>
      prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT set_config('statement_timeout', ${SALES_ENQUIRY_STATEMENT_TIMEOUT}, true)`;
          await tx.$queryRaw`SELECT set_config('max_parallel_workers_per_gather', ${"0"}, true)`;
          return reportConnections.run(tx, work);
        },
        { maxWait: REPORT_CONNECTION_WAIT_MS, timeout: REPORT_TRANSACTION_TIMEOUT_MS },
      ),
    );
  } catch (error) {
    throw mapReportFailure(error);
  }
}

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const meta = (error as { meta?: { code?: unknown } }).meta;
  if (typeof meta?.code === "string") return meta.code;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
