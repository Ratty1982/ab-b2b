/**
 * Recovers unfinished customer-history confirmation jobs after a process restart.
 * Does not enable ongoing mailbox / 504 / TRM21QC automatic importing.
 */
import {
  recoverAbandonedCustomerSalesHistoryJobs,
  reportCustomerSalesHistoryIndexHealth,
} from "@/server/companies/customer-sales-history-job";

const RECOVERY_INTERVAL_MS = 15_000;
const RECOVERY_BATCH = 5;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let stopping = false;

export function startCustomerSalesHistoryJobScheduler(): void {
  if (started) return;
  started = true;
  stopping = false;
  console.info("[ab:history-import]", {
    event: "HISTORY_JOB_SCHEDULER_STARTED",
    note: "Recovers unfinished historical import jobs only. Automatic ongoing sales import stays off.",
  });
  void reportCustomerSalesHistoryIndexHealth().catch((error) => {
    console.error("[ab:history-import]", {
      event: "HISTORY_INDEX_HEALTH_FAILED",
      error: error instanceof Error ? error.message : error,
    });
  });

  const tick = () => {
    if (stopping || ticking) return;
    ticking = true;
    void recoverAbandonedCustomerSalesHistoryJobs({ limit: RECOVERY_BATCH })
      .catch((error) => {
        console.error("[ab:history-import]", {
          event: "HISTORY_JOB_RECOVERY_FAILED",
          error: error instanceof Error ? error.message : error,
        });
      })
      .finally(() => {
        ticking = false;
      });
  };

  tick();
  timer = setInterval(tick, RECOVERY_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopCustomerSalesHistoryJobScheduler(): void {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  ticking = false;
}

export async function runCustomerSalesHistoryJobRecoveryOnce(limit = RECOVERY_BATCH) {
  return recoverAbandonedCustomerSalesHistoryJobs({ limit });
}
