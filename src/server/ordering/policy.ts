/**
 * Server-side effective backorder policy — always resolve via the central helper.
 */

import {
  resolveBackorderPolicy,
  type EffectiveBackorderPolicy,
  type VariantBackorderPolicy,
} from "@/domain/backorder";
import { getGlobalBackorderPolicy } from "@/server/ordering/settings";

export async function resolveVariantBackorderPolicy(
  variantPolicy: VariantBackorderPolicy | string | null | undefined,
  globalPolicy?: EffectiveBackorderPolicy | null,
): Promise<EffectiveBackorderPolicy> {
  const global = globalPolicy ?? (await getGlobalBackorderPolicy());
  return resolveBackorderPolicy({ globalPolicy: global, variantPolicy });
}

/**
 * Trusted sellable for customer ordering/allocation.
 * Stale positive Autopart stock is untrusted → treat as 0 (may still backorder when ALLOW).
 */
export function trustedSellableForOrdering(input: {
  sellableQty: number;
  stale: boolean;
}): number {
  const qty = Math.max(0, Math.trunc(input.sellableQty));
  if (input.stale && qty > 0) return 0;
  return qty;
}
