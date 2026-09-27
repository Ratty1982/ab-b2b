import { z } from "zod";

/** Lead.source value for anonymous / prospect callback enquiries. */
export const CALLBACK_REQUEST_LEAD_SOURCE = "CALLBACK_REQUEST" as const;

/** Activity.metadata.kind for callback requests. */
export const CALLBACK_REQUEST_ACTIVITY_KIND = "CALLBACK_REQUEST" as const;

/** Soft duplicate window for rapid resubmits. */
export const CALLBACK_DEDUP_WINDOW_MS = 10 * 60 * 1000;

const optionalTrimmed = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v == null || v === "" ? "" : v));

export const callbackEnquirySchema = z
  .object({
    name: z.string().trim().min(1, "Your name is required").max(120),
    company: optionalTrimmed,
    email: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v == null || v === "" ? "" : v.toLowerCase()))
      .refine((v) => v === "" || z.string().email().safeParse(v).success, {
        message: "Enter a valid email address",
      }),
    telephone: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => (v == null || v === "" ? "" : v)),
    message: z.string().trim().min(1, "Please tell us how we can help").max(4000),
    /** Honeypot — filled bots are rejected after parse. */
    websiteConfirm: z.string().max(200).optional().default(""),
    /** Client-generated key for soft idempotency (optional). */
    clientRequestId: z.string().trim().max(80).optional().default(""),
  })
  .superRefine((val, ctx) => {
    if (!val.email && !val.telephone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide an email address or telephone number",
        path: ["email"],
      });
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide an email address or telephone number",
        path: ["telephone"],
      });
    }
  });

export type CallbackEnquiryInput = z.infer<typeof callbackEnquirySchema>;

export function formatCallbackActivityBody(input: {
  name: string;
  email: string;
  telephone: string;
  companyName: string | null;
  accountManagerName: string | null;
  message: string;
  accountKind: "trade_customer" | "prospect";
}): string {
  const lines = [
    `Customer: ${input.name}`,
    input.companyName ? `Company: ${input.companyName}` : null,
    input.email ? `Email: ${input.email}` : null,
    input.telephone ? `Telephone: ${input.telephone}` : null,
    `Account: ${input.accountKind === "trade_customer" ? "Existing trade customer" : "Prospect"}`,
    input.accountManagerName ? `Assigned to: ${input.accountManagerName}` : "Assigned to: Trade team",
    "",
    "Message:",
    input.message,
  ].filter((line) => line !== null) as string[];
  return lines.join("\n");
}

export function callbackSupportingCopy(accountManagerName: string | null | undefined): string {
  const name = accountManagerName?.trim();
  if (name) {
    return `Need help? Send ${name} and the trade team a callback request.`;
  }
  return "Need to speak to our trade team? Send us your details and we'll get back to you.";
}
