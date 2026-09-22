import { loadAutopartStockConfig } from "@/server/stock/config";
import { runScheduledStockSync } from "@/server/stock/service";
import { prisma } from "@/infra/database/client";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

export function startStockScheduler(): void {
  const config = loadAutopartStockConfig();
  if (!config.schedulerEnabled) return;
  if (started) return;
  started = true;
  console.info("[ab:stock-sync]", { event: "AUTOPART_SCHEDULER_STARTED" });
  void prisma.stockScheduleState
    .upsert({
      where: { id: "singleton" },
      create: { id: "singleton", startedAt: new Date() },
      update: { startedAt: new Date() },
    })
    .catch(() => undefined);
  const tick = () => {
    if (ticking) return;
    ticking = true;
    void runScheduledStockSync({ dryRun: false, trigger: "schedule" })
      .catch((error) => {
        console.error("[ab:stock-sync]", {
          event: "AUTOPART_SCHEDULED_SYNC_FAILED",
          error: error instanceof Error ? error.message : error,
        });
      })
      .finally(() => {
        ticking = false;
      });
  };
  tick();
  timer = setInterval(tick, 60_000);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopStockScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  ticking = false;
}
