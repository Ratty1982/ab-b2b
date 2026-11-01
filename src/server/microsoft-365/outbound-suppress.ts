/**
 * Suppress outbound enqueue while inbound apply is writing CRM fields that
 * originated from Microsoft. Prevents echo loops without bypassing mutators.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<{ suppress: true }>();

export function isOutboundSuppressed(): boolean {
  return store.getStore()?.suppress === true;
}

export async function withOutboundSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  return store.run({ suppress: true }, fn);
}
