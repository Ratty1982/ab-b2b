import { loadAutopartStockConfig } from "@/server/stock/config";
import { runScheduledStockSync } from "@/server/stock/service";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

/** Tick only. Imports still require a Europe/London stock window. Leave disabled when Coolify cron is used. */
export function startStockScheduler(): void {
  const config = loadAutopartStockConfig();
  if (!config.schedulerEnabled) return;
  if (started) return;
  started = true;
  const tick = () => {
    void runScheduledStockSync({ dryRun: false, trigger: "schedule" }).catch((error) => {
      console.error("[ab:stock-sync:schedule]", error instanceof Error ? error.message : error);
    });
  };
  timer = setInterval(tick, 60_000);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopStockScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
