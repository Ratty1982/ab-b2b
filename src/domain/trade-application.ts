import { z } from "zod";

export const TRADE_APPLICATION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "MORE_INFO_REQUIRED",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export type TradeApplicationStatus = (typeof TRADE_APPLICATION_STATUSES)[number];

/** Staff may transition into these from open applications. */
export const OPEN_APPLICATION_STATUSES = [
  "SUBMITTED",
  "UNDER_REVIEW",
  "MORE_INFO_REQUIRED",
] as const;

export const BUSINESS_TYPES = [
  "Motor Factor",
  "Garage / Workshop",
  "Bodyshop",
  "Detailer / Valeter",
  "Car Dealership",
  "Parts Retailer",
  "Online Retailer",
  "Distributor / Wholesaler",
  "Fleet / Transport",
  "Performance / Motorsport",
  "Other",
] as const;

export const EXISTING_ACCOUNT_CLAIMS = ["yes", "no", "not_sure"] as const;

export const ESTIMATED_SPEND_RANGES = [
  "Under £500",
  "£500–£1,000",
  "£1,000–£2,500",
  "£2,500–£5,000",
  "£5,000+",
  "Prefer not to say",
] as const;

export const HOW_HEARD_OPTIONS = [
  "Existing customer",
  "Sales representative",
  "Web search",
  "Trade show / event",
  "Recommendation",
  "Social media",
  "Other",
] as const;

export const LAUNCH_BRAND_INTERESTS = ["power-maxed", "steel-seal"] as const;

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const tradeApplicationSubmitSchema = z
  .object({
    companyName: z.string().trim().min(1).max(200),
    tradingName: optionalText(200),
    companyNumber: optionalText(40),
    vatNumber: optionalText(40),
    businessType: z.enum(BUSINESS_TYPES),
    businessTypeOther: optionalText(120),
    website: optionalText(300),
    tradingAddress: z.object({
      line1: z.string().trim().min(1).max(200),
      line2: optionalText(200),
      town: z.string().trim().min(1).max(120),
      county: optionalText(120),
      postcode: z.string().trim().min(1).max(20),
      country: z.string().trim().length(2).default("GB"),
    }),
    primaryContact: z.object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      role: optionalText(120),
      email: z.string().trim().email().max(320),
      phone: z.string().trim().min(7).max(40),
    }),
    existingAccountClaim: z.enum(EXISTING_ACCOUNT_CLAIMS),
    /**
     * Applicant-claimed Autopart / existing account number.
     * Evidence for staff review only — never auto-links a Company ERP account.
     */
    claimedAutopartCustomerCode: optionalText(80),
    estimatedSpend: z.enum(ESTIMATED_SPEND_RANGES).optional().nullable(),
    howHeardAboutUs: z.enum(HOW_HEARD_OPTIONS).optional().nullable(),
    brandsInterest: z.array(z.string().trim().max(80)).max(20).default([]),
    notes: optionalText(4000),
    /** Required acknowledgement — stored as consentAcceptedAt when true. */
    consentAccepted: z.literal(true),
    /** Honeypot — must be empty */
    websiteConfirm: z.string().max(0).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.businessType === "Other" && !value.businessTypeOther?.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["businessTypeOther"],
        message: "Please describe your business type",
      });
    }
    if (
      value.existingAccountClaim === "yes" &&
      value.claimedAutopartCustomerCode &&
      value.claimedAutopartCustomerCode.length > 80
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["claimedAutopartCustomerCode"],
        message: "Account number is too long",
      });
    }
  });

export const tradeApplicationDecisionSchema = z.object({
  id: z.string().cuid(),
  reviewNotes: optionalText(4000),
  customerMessage: optionalText(4000),
  salesRepId: z.string().cuid().optional().nullable(),
  priceListId: z.string().cuid().optional().nullable(),
  paymentTerms: optionalText(120),
  /**
   * When the applicant email already belongs to another company or an
   * internal user, staff must explicitly confirm linking.
   */
  confirmExistingUserLink: z.boolean().optional().default(false),
});

export const tradeApplicationMoreInfoSchema = z.object({
  id: z.string().cuid(),
  customerMessage: z.string().trim().min(1).max(4000),
  reviewNotes: optionalText(4000),
});

export const tradeApplicationRejectSchema = z.object({
  id: z.string().cuid(),
  reviewNotes: z.string().trim().min(1).max(4000),
  customerMessage: optionalText(4000),
});

export const acceptTradeInviteSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string().min(10).max(128),
  confirmPassword: z.string().min(10).max(128),
}).superRefine((value, ctx) => {
  if (value.password !== value.confirmPassword) {
    ctx.addIssue({
      code: "custom",
      path: ["confirmPassword"],
      message: "Passwords do not match",
    });
  }
});

export function resolveBusinessTypeLabel(
  businessType: string | null | undefined,
  businessTypeOther?: string | null,
): string | null {
  if (!businessType) return null;
  if (businessType === "Other" && businessTypeOther?.trim()) {
    return `Other — ${businessTypeOther.trim()}`;
  }
  return businessType;
}
