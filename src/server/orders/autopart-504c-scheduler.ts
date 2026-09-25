/**
 * Autopart 504C in-app scheduler.
 * Default: DISABLED. Tick runs every minute but never imports while enabled=false.
 */

import { due504cWindow } from "@/domain/autopart-504c-schedule";
import { prisma } from "@/infra/database/client";
import {
  getAutopart504cFeedSettings,
  runAutopart504cScheduledPollIfEnabled,
} from "@/server/orders/autopart-504c";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastWindowKey: string | null = null;

export function startAutopart504cScheduler(): void {
  if (started) return;
  started = true;
  console.info("[ab:504c]", {
    event: "AUTOPART_504C_SCHEDULER_STARTED",
    note: "Automatic import remains OFF until Autopart504cFeedSettings.enabled=true",
  });

  const tick = () => {
    if (ticking) return;
    ticking = true;
    void (async () => {
      const settings = await getAutopart504cFeedSettings();
      if (!settings.enabled) {
        return;
      }
      const due = due504cWindow(new Date(), settings.workingDaysOnly);
      if (!due) return;
      if (lastWindowKey === due.key) return;
      lastWindowKey = due.key;
      const result = await runAutopart504cScheduledPollIfEnabled();
      console.info("[ab:504c]", {
        event: "AUTOPART_504C_SCHEDULE_TICK",
        window: due.key,
        ...result,
      });
      await prisma.autopart504cFeedSettings
        .update({
          where: { id: "default" },
          data: { lastPolledAt: new Date() },
        })
        .catch(() => undefined);
    })()
      .catch((error) => {
        console.error("[ab:504c]", {
          event: "AUTOPART_504C_SCHEDULE_FAILED",
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

export function stopAutopart504cScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  ticking = false;
  lastWindowKey = null;
}
