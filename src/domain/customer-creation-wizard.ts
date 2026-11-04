/**
 * Guided customer setup. Progress is the company record plus the shared
 * onboarding summary. Finishing the wizard does not write anything.
 */
import { z } from "zod";
import { BUSINESS_TYPES } from "@/domain/trade-application";
import { COMPANY_STATUSES } from "@/domain/company";

export const WIZARD_STEPS = [
  { id: 1, key: "details", label: "Customer details", optional: false },
  { id: 2, key: "autopart", label: "Autopart account", optional: true },
  { id: 3, key: "trading", label: "Pricing and terms", optional: true },
  { id: 4, key: "history", label: "Sales history", optional: true },
  { id: 5, key: "portal", label: "Portal access", optional: true },
  { id: 6, key: "review", label: "Review", optional: false },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];

const CUSTOMER_TYPE_LINE = /^Customer type:\s*(.+)$/i;

export function parseWizardStep(value: unknown): WizardStepId | undefined {
  const step = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(step) || step < 1 || step > 6) return undefined;
  return step as WizardStepId;
}

export function normaliseMatchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalisePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export type DuplicateMatchReason = "name" | "email" | "phone" | "similar_name";
export type DuplicateStrength = "strong" | "possible";

export function classifyCustomerDuplicate(
  query: { name: string; email?: string | null; phone?: string | null },
  candidate: {
    name: string;
    tradingName?: string | null;
    primaryEmail?: string | null;
    phone?: string | null;
  },
): { strength: DuplicateStrength; reason: DuplicateMatchReason } | null {
  const name = normaliseMatchText(query.name);
  const candidateNames = [candidate.name, candidate.tradingName ?? ""]
    .map(normaliseMatchText)
    .filter(Boolean);
  if (name && candidateNames.some((item) => item === name)) {
    return { strength: "strong", reason: "name" };
  }
  const email = query.email?.trim().toLowerCase() ?? "";
  const candidateEmail = candidate.primaryEmail?.trim().toLowerCase() ?? "";
  if (email && candidateEmail && email === candidateEmail) {
    return { strength: "strong", reason: "email" };
  }
  const phone = normalisePhone(query.phone ?? "");
  const candidatePhone = normalisePhone(candidate.phone ?? "");
  if (phone.length >= 6 && candidatePhone && phone === candidatePhone) {
    return { strength: "strong", reason: "phone" };
  }
  if (
    name.length >= 4 &&
    candidateNames.some((item) => item.includes(name) || name.includes(item))
  ) {
    return { strength: "possible", reason: "similar_name" };
  }
  return null;
}

export function splitCustomerTypeNotes(notes: string | null | undefined): {
  customerType: string | null;
  notes: string;
} {
  if (!notes?.trim()) return { customerType: null, notes: "" };
  const lines = notes.split(/\n/);
  const index = lines.findIndex((line) => CUSTOMER_TYPE_LINE.test(line.trim()));
  if (index < 0) return { customerType: null, notes: notes.trim() };
  const match = lines[index]!.trim().match(CUSTOMER_TYPE_LINE);
  const rest = lines
    .filter((_, lineIndex) => lineIndex !== index)
    .join("\n")
    .trim();
  return { customerType: match?.[1]?.trim() || null, notes: rest };
}

export function mergeCustomerTypeNotes(
  notes: string | null | undefined,
  customerType: string | null | undefined,
): string | null {
  const rest = splitCustomerTypeNotes(notes).notes.trim();
  const type = customerType?.trim() ?? "";
  const parts = [type ? `Customer type: ${type}` : "", rest].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

export function customerTypeChoices(): readonly string[] {
  return BUSINESS_TYPES;
}

export function suggestWizardStep(input: {
  contactCount: number;
  addressCount: number;
  salesCode: string | null;
  salesCodeVerified: boolean;
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE";
  status: string;
}): WizardStepId {
  if (input.contactCount === 0 && input.addressCount === 0) return 1;
  if (!input.salesCodeVerified) return 2;
  if (input.status === "ACTIVE" && input.historyStatus !== "COMPLETE") return 4;
  return 6;
}

/**
 * Opening the customer from the last step is navigation only.
 * It must not activate, verify, complete history, or send mail.
 */
export function wizardFinishPlan(companyId: string) {
  return {
    companyId,
    mutations: [] as const,
    activatesCustomer: false,
    verifiesSalesAccount: false,
    completesHistory: false,
    sendsInvitation: false,
    createsTransactions: false,
  };
}

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable().or(z.literal(""));

export const customerCreationDetailsSchema = z
  .object({
    companyId: z.string().cuid().optional().nullable(),
    name: z.string().trim().min(1).max(200),
    tradingName: optionalText(200),
    customerType: z.string().trim().max(120).optional().nullable().or(z.literal("")),
    status: z.enum(COMPANY_STATUSES).default("PROSPECT"),
    taxStatus: z.enum(["STANDARD", "ZERO_RATED", "EXEMPT", "OUTSIDE_SCOPE"]).default("STANDARD"),
    phone: optionalText(40),
    primaryEmail: z.string().trim().email().max(320).optional().nullable().or(z.literal("")),
    notes: optionalText(5000),
    salesRepId: z.string().cuid().optional().nullable().or(z.literal("")),
    confirmDespiteDuplicates: z.boolean().optional(),
    confirmActivation: z.boolean().optional(),
    contact: z
      .object({
        firstName: z.string().trim().max(100).optional().nullable().or(z.literal("")),
        lastName: z.string().trim().max(100).optional().nullable().or(z.literal("")),
        email: z.string().trim().email().max(320).optional().nullable().or(z.literal("")),
        phone: optionalText(40),
        jobTitle: optionalText(120),
      })
      .optional()
      .nullable(),
    address: z
      .object({
        line1: optionalText(200),
        line2: optionalText(200),
        town: optionalText(120),
        county: optionalText(120),
        postcode: optionalText(20),
        country: z.string().trim().max(2).optional().nullable().or(z.literal("")),
      })
      .optional()
      .nullable(),
  })
  .superRefine((value, ctx) => {
    const contact = value.contact;
    const contactStarted = Boolean(
      contact &&
      [contact.firstName, contact.lastName, contact.email, contact.phone, contact.jobTitle].some(
        (item) => item?.trim(),
      ),
    );
    if (contactStarted && (!contact?.firstName?.trim() || !contact.lastName?.trim())) {
      ctx.addIssue({
        code: "custom",
        path: ["contact", "firstName"],
        message: "Enter the primary contact's first and last name.",
      });
    }
    const address = value.address;
    const addressStarted = Boolean(
      address &&
      [address.line1, address.line2, address.town, address.county, address.postcode].some((item) =>
        item?.trim(),
      ),
    );
    if (
      addressStarted &&
      (!address?.line1?.trim() || !address.town?.trim() || !address.postcode?.trim())
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["address", "line1"],
        message: "Enter address line 1, town, and postcode.",
      });
    }
    if (value.status === "ACTIVE" && !value.confirmActivation) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmActivation"],
        message:
          "Confirm activation. Making the account active does not verify an Autopart code or record sales history.",
      });
    }
  });

export const duplicateSearchSchema = z.object({
  name: z.string().trim().max(200).optional().default(""),
  email: z.string().trim().max(320).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  excludeCompanyId: z.string().cuid().optional().nullable(),
});
