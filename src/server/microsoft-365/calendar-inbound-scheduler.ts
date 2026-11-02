/**
 * Shares the one-minute timer style with outbound calendar. Flag off → no Graph or CRM writes.
 */
import { runProductionCalendarInboundBatch } from "@/server/microsoft-365/calendar-inbound-runtime";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let stopping = false;

export function startMicrosoftCalendarInboundScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => {
    if (ticking || stopping) return;
    ticking = true;
    void runProductionCalendarInboundBatch()
      .catch((error) => {
        console.error("[ab:microsoft-calendar-inbound]", {
          event: "INBOUND_TICK_FAILED",
          error: error instanceof Error ? error.message : "tick failed",
        });
      })
      .finally(() => {
        ticking = false;
      });
  };
  timer = setInterval(tick, 60_000);
  if (typeof timer.unref === "function") timer.unref();
  process.once("SIGTERM", stopMicrosoftCalendarInboundScheduler);
  process.once("SIGINT", stopMicrosoftCalendarInboundScheduler);
}

export function stopMicrosoftCalendarInboundScheduler(): void {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  ticking = false;
  stopping = false;
}
