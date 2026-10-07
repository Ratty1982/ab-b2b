/**
 * In-app scheduler for ongoing Autopart 504 + TRM21QC email ingestion.
 * Default: DISABLED. Tick runs every minute but never imports while enabled=false.
 * Due windows are 13:15 and 18:15 Europe/London, Monday–Friday.
 */

import { dueOngoingSalesWindow } from "@/domain/autopart-ongoing-sales-schedule";
import { prisma } from "@/infra/database/client";
import { runOngoingSalesScheduledPollIfEnabled } from "@/server/companies/autopart-ongoing-sales-poll";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lastWindowKey: string | null = null;

export function startAutopartOngoingSalesScheduler(): void {
  if (started) return;
  started = true;
  console.info("[ab:ongoing-sales]", {
    event: "AUTOPART_ONGOING_SALES_SCHEDULER_STARTED",
    note: "Automatic import remains OFF until AutopartOngoingSalesFeedSettings.enabled=true",
  });

  const tick = () => {
    if (ticking) return;
    ticking = true;
    void (async () => {
      const settings = await prisma.autopartOngoingSalesFeedSettings.upsert({
        where: { id: "default" },
        create: { id: "default" },
        update: {},
      });
      if (!settings.enabled || !settings.configured) return;

      let hours: number[] = [13, 18];
      try {
        const parsed = JSON.parse(settings.scheduleHoursJson) as unknown;
        if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) {
          hours = parsed as number[];
        }
      } catch {
        /* defaults */
      }

      const due = dueOngoingSalesWindow(new Date(), settings.workingDaysOnly, hours);
      if (!due) return;
      if (lastWindowKey === due.key) return;
      lastWindowKey = due.key;

      const result = await runOngoingSalesScheduledPollIfEnabled();
      console.info("[ab:ongoing-sales]", {
        event: "AUTOPART_ONGOING_SALES_SCHEDULE_TICK",
        window: due.key,
        ...result,
      });
    })()
      .catch((error) => {
        console.error("[ab:ongoing-sales]", {
          event: "AUTOPART_ONGOING_SALES_SCHEDULE_FAILED",
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

export function stopAutopartOngoingSalesScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  ticking = false;
  lastWindowKey = null;
}
