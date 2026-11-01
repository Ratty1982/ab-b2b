/**
 * Uses the same in-process timer style as the stock schedulers.
 * A tick with the outbound flag off returns before claiming jobs or calling Microsoft.
 */
import { runProductionOutboundBatch } from "@/server/microsoft-365/outbound-runtime";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let stopping = false;

export function startMicrosoftTodoOutboundScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => {
    if (ticking || stopping) return;
    ticking = true;
    void runProductionOutboundBatch()
      .catch((error) => {
        console.error("[ab:microsoft-todo]", {
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
  process.once("SIGTERM", stopMicrosoftTodoOutboundScheduler);
  process.once("SIGINT", stopMicrosoftTodoOutboundScheduler);
}

export function stopMicrosoftTodoOutboundScheduler(): void {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  ticking = false;
  stopping = false;
}
