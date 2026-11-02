/**
 * Uses the same in-process timer style as the To Do schedulers.
 * A tick with the calendar flag off returns before claiming jobs or calling Microsoft.
 */
import { runProductionCalendarOutboundBatch } from "@/server/microsoft-365/calendar-outbound-runtime";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let stopping = false;

export function startMicrosoftCalendarOutboundScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => {
    if (ticking || stopping) return;
    ticking = true;
    void runProductionCalendarOutboundBatch()
      .catch((error) => {
        console.error("[ab:microsoft-calendar]", {
          event: "OUTBOUND_TICK_FAILED",
          error: error instanceof Error ? error.message : "tick failed",
        });
      })
      .finally(() => {
        ticking = false;
      });
  };
  timer = setInterval(tick, 60_000);
  if (typeof timer.unref === "function") timer.unref();
  process.once("SIGTERM", stopMicrosoftCalendarOutboundScheduler);
  process.once("SIGINT", stopMicrosoftCalendarOutboundScheduler);
}

export function stopMicrosoftCalendarOutboundScheduler(): void {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  ticking = false;
  stopping = false;
}
