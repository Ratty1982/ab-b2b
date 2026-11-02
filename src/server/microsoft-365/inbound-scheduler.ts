/**
 * Shares the one-minute timer style with outbound. Flag off → no Graph or CRM writes.
 */
import { runProductionInboundBatch } from "@/server/microsoft-365/inbound-runtime";

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let stopping = false;

export function startMicrosoftTodoInboundScheduler(): void {
  if (started) return;
  started = true;
  const tick = () => {
    if (ticking || stopping) return;
    ticking = true;
    void runProductionInboundBatch()
      .catch((error) => {
        console.error("[ab:microsoft-todo-inbound]", {
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
  process.once("SIGTERM", stopMicrosoftTodoInboundScheduler);
  process.once("SIGINT", stopMicrosoftTodoInboundScheduler);
}

export function stopMicrosoftTodoInboundScheduler(): void {
  stopping = true;
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
  ticking = false;
  stopping = false;
}
