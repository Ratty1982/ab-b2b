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

export const tradeApplicationSubmitSchema = z.object({
  companyName: z.string().trim().min(1).max(200),
  tradingName: z.string().trim().max(200).optional().nullable(),
  companyNumber: z.string().trim().max(40).optional().nullable(),
  vatNumber: z.string().trim().max(40).optional().nullable(),
  businessType: z.string().trim().max(120).optional().nullable(),
  website: z.string().trim().max(300).optional().nullable(),
  tradingAddress: z
    .object({
      line1: z.string().trim().min(1).max(200),
      line2: z.string().trim().max(200).optional().nullable(),
      town: z.string().trim().min(1).max(120),
      county: z.string().trim().max(120).optional().nullable(),
      postcode: z.string().trim().min(1).max(20),
      country: z.string().trim().length(2).default("GB"),
    })
    .optional()
    .nullable(),
  primaryContact: z.object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    role: z.string().trim().max(120).optional().nullable(),
    email: z.string().trim().email().max(320),
    phone: z.string().trim().max(40).optional().nullable(),
  }),
  estimatedSpend: z.string().trim().max(120).optional().nullable(),
  brandsInterest: z.array(z.string().trim().max(80)).max(20).default([]),
  notes: z.string().trim().max(4000).optional().nullable(),
  /**
   * Applicant-claimed Autopart / existing account number.
   * Evidence for staff review only — never auto-links a Company ERP account.
   */
  claimedAutopartCustomerCode: z.string().trim().max(80).optional().nullable(),
  /** Honeypot — must be empty */
  websiteConfirm: z.string().max(0).optional(),
});

export const tradeApplicationDecisionSchema = z.object({
  id: z.string().cuid(),
  reviewNotes: z.string().trim().max(4000).optional().nullable(),
  salesRepId: z.string().cuid().optional().nullable(),
  priceListId: z.string().cuid().optional().nullable(),
  paymentTerms: z.string().trim().max(120).optional().nullable(),
});
