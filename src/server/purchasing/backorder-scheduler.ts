/**
 * Autopart 216V in-app scheduler.
 * Default: DISABLED. Tick is registered but never imports while enabled=false.
 * Expected window: working days from 18:00 Europe/London.
 */

import { due216vPollWindow } from "@/domain/autopart-216v-freshness";
import { prisma } from "@/infra/database/client";
import { run216vScheduledPollIfEnabled } from "@/server/purchasing/backorder-poll";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastWindowKey: string | null = null;

function windowKey(now = new Date()): string {
  return now.toISOString().slice(0, 13);
}

export function startAutopart216vScheduler(): void {
  if (started) return;
  started = true;
  console.info("[ab:216v]", {
    event: "AUTOPART_216V_SCHEDULER_STARTED",
    note: "Automatic import remains OFF until AutopartBackorderFeedSettings.enabled=true",
  });

  const tick = () => {
    if (ticking) return;
    ticking = true;
    void (async () => {
      const settings = await prisma.autopartBackorderFeedSettings.upsert({
        where: { id: "default" },
        create: { id: "default" },
        update: {},
      });
      if (!settings.enabled || !settings.configured) return;
      if (!due216vPollWindow(new Date(), settings.scheduleHour)) return;
      const key = windowKey();
      if (lastWindowKey === key) return;
      lastWindowKey = key;
      const result = await run216vScheduledPollIfEnabled();
      console.info("[ab:216v]", { event: "AUTOPART_216V_SCHEDULE_TICK", window: key, ...result });
      await prisma.autopartBackorderFeedSettings
        .update({ where: { id: "default" }, data: { lastPolledAt: new Date() } })
        .catch(() => undefined);
    })()
      .catch((error) => {
        console.error("[ab:216v]", {
          event: "AUTOPART_216V_SCHEDULE_FAILED",
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

export function stopAutopart216vScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  ticking = false;
  lastWindowKey = null;
}
