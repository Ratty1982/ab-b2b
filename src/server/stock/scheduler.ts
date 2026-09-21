import { loadAutopartStockConfig } from "@/server/stock/config";
import { runConfiguredStockSync } from "@/server/stock/service";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

export function startStockScheduler(): void {
  const config = loadAutopartStockConfig();
  if (!config.schedulerEnabled) return;
  if (started) return;
  started = true;
  const ms = Math.max(60_000, config.scheduleMinutes * 60_000);
  const tick = () => {
    void runConfiguredStockSync({ dryRun: false, trigger: "schedule" }).catch((error) => {
      console.error("[ab:stock-sync:schedule]", error instanceof Error ? error.message : error);
    });
  };
  timer = setInterval(tick, ms);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopStockScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
