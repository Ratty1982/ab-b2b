import { z } from "zod";

/** Lead.source value for motorsport partnership enquiries. */
export const MOTORSPORT_PARTNERSHIP_LEAD_SOURCE = "MOTORSPORT_PARTNERSHIP" as const;

/**
 * Official Power Maxed Racing site — CMS-overridable.
 * Leave blank in CMS to hide the external CTA until confirmed.
 */
export const DEFAULT_POWER_MAXED_RACING_URL = "";

export const MOTORSPORT_INTEREST_OPTIONS = [
  "Commercial Sponsorship",
  "Brand Partnership",
  "Hospitality",
  "Trade Customer Experience",
  "Other",
] as const;

export type MotorsportInterest = (typeof MOTORSPORT_INTEREST_OPTIONS)[number];

export const MOTORSPORT_BUDGET_OPTIONS = [
  "Not sure yet",
  "Under £5,000",
  "£5,000–£10,000",
  "£10,000–£25,000",
  "£25,000–£50,000",
  "£50,000+",
] as const;

export type MotorsportBudget = (typeof MOTORSPORT_BUDGET_OPTIONS)[number];

export const motorsportPartnershipEnquirySchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  contactName: z.string().trim().min(1, "Contact name is required").max(120),
  email: z.string().trim().email("Enter a valid email address").max(200),
  telephone: z.string().trim().max(40).optional().default(""),
  industry: z.string().trim().max(120).optional().default(""),
  interestedIn: z.enum(MOTORSPORT_INTEREST_OPTIONS, {
    message: "Select an area of interest",
  }),
  approximateBudget: z
    .union([z.enum(MOTORSPORT_BUDGET_OPTIONS), z.literal("")])
    .optional()
    .transform((v) => (v === "" || v == null ? undefined : v)),
  message: z.string().trim().min(1, "Please include a short message").max(4000),
  consent: z.literal(true, {
    message: "Consent is required to send this enquiry",
  }),
  /** Honeypot — filled bots are rejected after parse. */
  websiteConfirm: z.string().max(200).optional().default(""),
});

export type MotorsportPartnershipEnquiryInput = z.infer<typeof motorsportPartnershipEnquirySchema>;

export function formatMotorsportLeadNotes(input: {
  interestedIn: string;
  approximateBudget?: string | undefined;
  industry?: string | undefined;
  message: string;
}): string {
  const lines = [
    `Interest: ${input.interestedIn}`,
    input.approximateBudget ? `Budget: ${input.approximateBudget}` : null,
    input.industry ? `Industry: ${input.industry}` : null,
    "",
    input.message,
  ].filter((line) => line !== null) as string[];
  return lines.join("\n");
}

/** Homepage motorsport feature default copy (also CMS-seeded). */
export const HOMEPAGE_MOTORSPORT_DEFAULTS = {
  eyebrow: "POWER MAXED MOTORSPORT",
  headline: "FROM THE TRADE COUNTER\nTO THE STARTING GRID.",
  supporting:
    "Our brands don't just sit on the shelf. Power Maxed and Steel Seal are represented on track through Power Maxed Racing, creating opportunities for brand exposure, customer engagement and commercial partnerships.",
  ctaLabel: "Explore Motorsport",
  ctaHref: "/motorsport",
  secondaryCtaLabel: "Partner with the Team",
  secondaryCtaHref: "/motorsport#partnerships",
  features: [
    {
      title: "Racing",
      body: "Follow Power Maxed Racing and our involvement in British motorsport.",
      icon: "flag" as const,
    },
    {
      title: "Partnerships",
      body: "Commercial sponsorship and brand exposure opportunities.",
      icon: "handshake" as const,
    },
    {
      title: "Trade Experiences",
      body: "Motorsport experiences and customer engagement opportunities.",
      icon: "users" as const,
    },
  ],
};

/** /motorsport landing defaults — CMS sections override when published. */
export const MOTORSPORT_PAGE_DEFAULTS = {
  seoTitle: "Power Maxed Motorsport & Partnerships | Automotive Brands",
  metaDescription:
    "Discover Automotive Brands' involvement with Power Maxed Racing and explore motorsport sponsorship, partnership and trade engagement opportunities.",
  hero: {
    eyebrow: "POWER MAXED MOTORSPORT",
    headline: "BUILT FOR THE TRADE.\nPROVEN ON THE TRACK.",
    supporting:
      "Automotive Brands uses motorsport to bring our brands, customers and commercial partners closer to one of Britain's most exciting automotive environments.",
    ctaLabel: "Explore Partnership Opportunities",
    ctaHref: "#partnerships",
    secondaryCtaLabel: "Visit Power Maxed Racing",
    externalRacingUrl: DEFAULT_POWER_MAXED_RACING_URL,
  },
  about: {
    heading: "POWER MAXED RACING",
    body: "Power Maxed Racing provides Automotive Brands with a high-profile motorsport platform, connecting our brands with automotive audiences, trade customers and commercial partners.",
  },
  brandsOnTrack: {
    heading: "OUR BRANDS ON TRACK",
    body: "Power Maxed and Steel Seal branding is represented through the motorsport programme — linking the trade products you order with genuine on-track brand exposure.",
    powerMaxedLabel: "Shop Power Maxed",
    powerMaxedHref: "/brands/power-maxed",
    steelSealLabel: "Shop Steel Seal",
    steelSealHref: "/brands/steel-seal",
  },
  partnerships: {
    eyebrow: "COMMERCIAL OPPORTUNITIES",
    headline: "PARTNER WITH POWER MAXED RACING",
    body: "Power Maxed Racing offers businesses the opportunity to connect with automotive audiences through commercial partnerships, brand exposure, hospitality and customer engagement.",
    opportunities: [
      {
        title: "Brand Partnerships",
        body: "Explore opportunities for your business to be associated with the Power Maxed Racing programme.",
      },
      {
        title: "Hospitality",
        body: "Discuss motorsport hospitality and customer engagement opportunities.",
      },
      {
        title: "Trade Customer Experiences",
        body: "Explore ways to use motorsport to strengthen customer and supplier relationships.",
      },
      {
        title: "Commercial Activation",
        body: "Discuss opportunities to activate a partnership across relevant Automotive Brands and motorsport channels.",
      },
    ],
  },
};
