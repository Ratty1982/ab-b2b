/**
 * Customer-facing promotion presentation.
 * Eligibility reuses the trade-price engine. This module does not calculate
 * a replacement unit price and does not write Promotion rows.
 */
import { formatGbpFromUnknown, parsePromotionMetadata } from "@/domain/pricing-management";
import { moneyFromUnknown, moneyToString } from "@/domain/money";
import { formatQuoteDateOnlyUk } from "@/domain/quote";
import { londonBusinessDate, londonCivilTime } from "@/domain/stock-schedule";
import { promotionApplies, type PromotionKind } from "@/domain/trade-price-resolution";

export type CustomerPromotionKind = Exclude<PromotionKind, "QUANTITY_DEAL">;

export type CustomerPromotionSource = {
  id: string;
  code: string;
  name: string;
  type: PromotionKind;
  value: unknown;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  metadata: unknown;
};

/** True when the pricing engine can apply this promotion to a matching product. */
export function promotionVisibleToCustomer(promo: CustomerPromotionSource, at: Date): boolean {
  return promotionApplies(
    {
      id: promo.id,
      code: promo.code,
      name: promo.name,
      type: promo.type,
      value: promo.value,
      startsAt: promo.startsAt,
      endsAt: promo.endsAt,
      isActive: promo.isActive,
      variantIds: null,
      skus: null,
    },
    { variantId: "", sku: "", at },
  );
}

export function customerPromotionOfferLabel(type: CustomerPromotionKind, value: unknown): string {
  if (type === "PERCENT") {
    const money = moneyFromUnknown(value);
    if (!money) return "Percent off";
    return `${trimDecimal(moneyToString(money))}% off`;
  }
  const amount = formatGbpFromUnknown(value);
  return amount ? `${amount} off each unit` : "Amount off each unit";
}

export function customerPromotionValidityLabel(startsAt: Date | null, endsAt: Date | null): string {
  const start = startsAt ? formatQuoteDateOnlyUk(londonDateOnly(startsAt)) : null;
  const end = endsAt ? formatQuoteDateOnlyUk(londonDateOnly(endsAt)) : null;
  if (start && end) return `${start} to ${end}`;
  if (start) return `From ${start}`;
  if (end) return `Until ${end}`;
  return "Open ended";
}

export function customerPromotionScope(metadata: unknown): {
  catalogueWide: boolean;
  variantIds: string[];
  skus: string[];
} {
  return parsePromotionMetadata(metadata);
}

/** Optional customer copy stored on promotion metadata. Plain text and a safe image URL only. */
export function customerPromotionCopy(
  metadata: unknown,
  columns?: { description?: string | null; imageUrl?: string | null },
): {
  description: string | null;
  imageUrl: string | null;
} {
  const rec =
    metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const columnDescription = typeof columns?.description === "string" ? columns.description.trim() : "";
  const metadataDescription = typeof rec["description"] === "string" ? rec["description"].trim() : "";
  const raw = columnDescription || metadataDescription;
  const description = raw ? raw.slice(0, 500) : null;
  const imageUrl = safePromotionImageUrl(columns?.imageUrl) ?? safePromotionImageUrl(rec["imageUrl"]);
  return { description, imageUrl };
}

export function safePromotionImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.includes("\\")) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:" && !url.username && !url.password) return url.toString();
  } catch {
    return null;
  }
  return null;
}

function londonDateOnly(value: Date): string {
  return londonBusinessDate(londonCivilTime(value));
}

function trimDecimal(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
