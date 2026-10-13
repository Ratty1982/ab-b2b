/**
 * Sales campaign workflow and order-time savings.
 * Price maths stay in the trade-price resolver. This module does not apply a second discount.
 */
import { z } from "zod";
import { moneyFromUnknown, moneyToString, moneyZero, mulRatio, subMoney, type Money } from "@/domain/money";
import { inValidityWindow } from "@/domain/trade-price-resolution";
import { safePromotionImageUrl } from "@/domain/customer-promotions";

export const CAMPAIGN_GOVERNANCE = [
  "LEGACY",
  "DRAFT",
  "PENDING_APPROVAL",
  "REJECTED",
  "APPROVED",
  "CANCELLED",
] as const;

export type CampaignGovernance = (typeof CAMPAIGN_GOVERNANCE)[number];

export const CAMPAIGN_DISPLAY_LABEL: Record<string, string> = {
  LEGACY_ACTIVE: "Active",
  LEGACY_SCHEDULED: "Scheduled",
  LEGACY_EXPIRED: "Expired",
  LEGACY_DISABLED: "Disabled",
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  REJECTED: "Rejected",
  APPROVED: "Approved",
  SCHEDULED: "Scheduled",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

export function campaignDisplayStatus(input: {
  campaignStatus: CampaignGovernance;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  at: Date;
}): { status: string; label: string } {
  if (input.campaignStatus === "LEGACY") {
    if (!input.isActive) return labelled("LEGACY_DISABLED");
    if (input.startsAt && input.at < input.startsAt) return labelled("LEGACY_SCHEDULED");
    if (input.endsAt && input.at > input.endsAt) return labelled("LEGACY_EXPIRED");
    return labelled("LEGACY_ACTIVE");
  }
  if (input.campaignStatus !== "APPROVED") return labelled(input.campaignStatus);
  if (!input.isActive) return labelled("APPROVED");
  if (input.endsAt && input.at > input.endsAt) return labelled("EXPIRED");
  if (input.startsAt && input.at < input.startsAt) return labelled("SCHEDULED");
  if (!inValidityWindow(input.at, input.startsAt, input.endsAt)) return labelled("APPROVED");
  return labelled("ACTIVE");
}

function labelled(status: string): { status: string; label: string } {
  return { status, label: CAMPAIGN_DISPLAY_LABEL[status] ?? status };
}

const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .transform((value) => value.toUpperCase())
  .refine((value) => /^[A-Z0-9][A-Z0-9_-]*$/.test(value), "Use letters, numbers, hyphens or underscores");

export const campaignDraftSchema = z.object({
  id: z.string().cuid().optional(),
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  imageUrl: z.string().trim().max(500).nullable().optional(),
  type: z.enum(["PERCENT", "FIXED"]),
  value: z.number().positive().max(1_000_000),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  skus: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
  appliesToNegotiatedPrices: z.boolean().optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});

export const campaignReviewSchema = z.object({
  id: z.string().cuid(),
  reason: z.string().trim().min(1).max(500).optional(),
  appliesToNegotiatedPrices: z.boolean().optional(),
  confirmNegotiatedPrices: z.boolean().optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});

export function assertCampaignCommercial(input: {
  type: "PERCENT" | "FIXED";
  value: number;
  startsAt: Date | null;
  endsAt: Date | null;
  skus: string[];
  requireSkus: boolean;
}): void {
  if (input.type === "PERCENT" && input.value > 100) {
    throw new CampaignInputError("Percent discount cannot exceed 100");
  }
  if (input.startsAt && input.endsAt && input.endsAt <= input.startsAt) {
    throw new CampaignInputError("End date must be after the start date");
  }
  if (input.requireSkus && input.skus.length === 0) {
    throw new CampaignInputError("Choose at least one product SKU");
  }
}

export class CampaignInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignInputError";
  }
}

export function campaignImageUrl(value: string | null | undefined): string | null {
  if (value == null || value.trim() === "") return null;
  const safe = safePromotionImageUrl(value);
  if (!safe) throw new CampaignInputError("Image must be an https URL or a site path");
  return safe;
}

/** Verifiable unit saving. Missing or inconsistent baselines stay unavailable. */
export function promotionalUnitSaving(baseline: unknown, charged: unknown): Money | null {
  const before = moneyFromUnknown(baseline);
  const after = moneyFromUnknown(charged);
  if (!before || !after) return null;
  if (before.minor < after.minor) return null;
  return subMoney(before, after);
}

export function promotionalLineSaving(input: {
  qty: number;
  baselineUnitPrice: unknown;
  unitPrice: unknown;
}): { savings: string | null } {
  const unit = promotionalUnitSaving(input.baselineUnitPrice, input.unitPrice);
  if (!unit || !Number.isFinite(input.qty) || input.qty < 1) return { savings: null };
  const line = mulRatio(unit, BigInt(Math.trunc(input.qty)), 1n);
  return { savings: moneyToString(line) };
}

export function summariseSavings(
  lines: Array<{ baselineUnitPrice: unknown; unitPrice: unknown; qty: number }>,
): {
  coverage: "complete" | "partial" | "unavailable";
  savingsExVat: string | null;
  linesWithBaseline: number;
  linesWithoutBaseline: number;
} {
  let withBaseline = 0;
  let withoutBaseline = 0;
  let total = moneyZero();
  let any = false;
  for (const line of lines) {
    const saving = promotionalLineSaving(line);
    if (saving.savings == null && moneyFromUnknown(line.baselineUnitPrice) == null) {
      withoutBaseline += 1;
      continue;
    }
    if (saving.savings == null) {
      withoutBaseline += 1;
      continue;
    }
    withBaseline += 1;
    any = true;
    const money = moneyFromUnknown(saving.savings);
    if (money) total = { minor: total.minor + money.minor };
  }
  if (!any) {
    return {
      coverage: "unavailable",
      savingsExVat: null,
      linesWithBaseline: withBaseline,
      linesWithoutBaseline: withoutBaseline,
    };
  }
  return {
    coverage: withoutBaseline === 0 ? "complete" : "partial",
    savingsExVat: moneyToString(total),
    linesWithBaseline: withBaseline,
    linesWithoutBaseline: withoutBaseline,
  };
}
