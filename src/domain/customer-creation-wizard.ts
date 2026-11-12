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
  /**
   * Optional until the account is Active with a verified Autopart code.
   * Then staff must choose brand-new (zero history) or historical import before leaving.
   */
  { id: 4, key: "history", label: "Sales history baseline", optional: true },
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

/**
 * Compare UK telephone numbers across common staff formats.
 * Spaces, brackets, +44, 0044, and a national leading 0 all reduce to one digit string.
 */
export function normalisePhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("44") && digits.length >= 11) {
    const rest = digits.slice(2);
    digits = rest.startsWith("0") ? rest : `0${rest}`;
  }
  return digits;
}

/** Last digits used when scanning stored formatted phone values. */
export function phoneMatchTail(value: string, length = 8): string {
  const national = normalisePhone(value);
  if (!national) return "";
  const significant = national.startsWith("0") ? national.slice(1) : national;
  return significant.slice(-Math.min(length, significant.length));
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
  if (phone.length >= 8 && candidatePhone.length >= 8 && phone === candidatePhone) {
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
  let customerType: string | null = null;
  const rest: string[] = [];
  for (const line of lines) {
    const match = line.trim().match(CUSTOMER_TYPE_LINE);
    if (match) {
      if (!customerType) customerType = match[1]?.trim() || null;
      continue;
    }
    rest.push(line);
  }
  return { customerType, notes: rest.join("\n").trim() };
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
 * Active + verified customers must finish the sales-history baseline before
 * continuing past the history step. Activation alone does not create cutover.
 */
export function salesHistoryBaselineRequired(input: {
  status: string;
  salesCodeVerified: boolean;
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE";
}): boolean {
  return (
    input.status === "ACTIVE" &&
    input.salesCodeVerified &&
    input.historyStatus !== "COMPLETE"
  );
}

export function canContinuePastSalesHistory(input: {
  status: string;
  salesCodeVerified: boolean;
  historyStatus: "NOT_STARTED" | "REVIEW" | "COMPLETE";
}): { ok: true } | { ok: false; message: string } {
  if (!salesHistoryBaselineRequired(input)) return { ok: true };
  if (input.historyStatus === "REVIEW") {
    return {
      ok: false,
      message:
        "Import exceptions are waiting for review. Finish the historical import, or acknowledge the review, before continuing.",
    };
  }
  return {
    ok: false,
    message:
      "Choose a sales history baseline before continuing: confirm this is a brand-new Autopart account with no historical sales, or import historical 561L/SLRB. Active customers cannot receive ongoing 504/TRM21QC sales until cutover is complete.",
  };
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
        companyName: optionalText(200),
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
