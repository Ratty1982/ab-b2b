/**
 * SalesRep customer-facing contact profile (pure validation).
 * Auth identity remains on User — these fields are for trade customers only.
 */
import { z } from "zod";

/** Preserve leading zeroes; allow UK / international punctuation. */
export function normalizePhoneInput(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.slice(0, 40);
}

export function isPlausiblePhone(raw: string): boolean {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  return /^[+]?[\d\s()./-]+$/.test(raw.trim());
}

export function telHrefFromPhone(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const compact = raw.trim().replace(/[^\d+]/g, "");
  if (compact.replace(/\D/g, "").length < 7) return null;
  return `tel:${compact}`;
}

/** Empty / omitted / null → null; preserve trimmed string otherwise. */
function optionalTrimmedString(max: number) {
  return z.preprocess((raw) => {
    if (raw == null) return null;
    if (typeof raw !== "string") return raw;
    const t = raw.trim();
    return t === "" ? null : t.slice(0, max);
  }, z.string().max(max).nullable());
}

const optionalEmail = z.preprocess((raw) => {
  if (raw == null) return null;
  if (typeof raw !== "string") return raw;
  const t = raw.trim().toLowerCase();
  return t === "" ? null : t;
}, z
  .string()
  .email("Enter a valid business email")
  .max(254)
  .nullable());

const optionalPhone = z.preprocess((raw) => {
  if (raw == null) return null;
  return normalizePhoneInput(typeof raw === "string" ? raw : String(raw));
}, z
  .string()
  .max(40)
  .nullable()
  .refine((v) => v == null || isPlausiblePhone(v), {
    message: "Enter a valid telephone number",
  }));

export const salesRepProfileUpdateSchema = z.object({
  id: z.string().min(1),
  // preprocess coerces omitted/empty → null so keys may be absent in partial payloads
  displayName: optionalTrimmedString(120).nullish(),
  jobTitle: optionalTrimmedString(120).nullish(),
  businessEmail: optionalEmail.nullish(),
  phone: optionalPhone.nullish(),
  mobile: optionalPhone.nullish(),
  customerContactEnabled: z.boolean(),
  active: z.boolean(),
  photoMediaId: optionalTrimmedString(64).nullish(),
  photoAlt: optionalTrimmedString(200).nullish(),
  photoFocalX: z.number().int().min(0).max(100).optional(),
  photoFocalY: z.number().int().min(0).max(100).optional(),
});

export type SalesRepProfileUpdateInput = z.infer<typeof salesRepProfileUpdateSchema>;

export function defaultSalesRepJobTitle(jobTitle: string | null | undefined): string {
  const t = jobTitle?.trim();
  return t || "Account Manager";
}
