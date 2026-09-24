import { z } from "zod";

/** Default department seeds — names/order remain editable in admin; not hard-coded in public render. */
export const DEFAULT_TEAM_DEPARTMENTS = [
  {
    slug: "leadership",
    name: "Leadership",
    description: null as string | null,
    sortOrder: 10,
  },
  {
    slug: "trade-sales-accounts",
    name: "Trade Sales & Accounts",
    description: null,
    sortOrder: 20,
  },
  {
    slug: "marketing-administration",
    name: "Marketing & Administration",
    description: null,
    sortOrder: 30,
  },
  {
    slug: "operations-production",
    name: "Operations & Production",
    description: null,
    sortOrder: 40,
  },
] as const;

export function teamMemberDisplayName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, " ").trim();
}

export function teamMemberInitials(firstName: string, lastName: string): string {
  const a = firstName.trim().charAt(0);
  const b = lastName.trim().charAt(0);
  return `${a}${b}`.toUpperCase() || "AB";
}

/**
 * Job titles safe to show on public surfaces.
 * Blank / recognised placeholder CMS values are omitted — admin still keeps the raw string.
 */
const PUBLIC_JOB_TITLE_PLACEHOLDERS = new Set([
  "what is my job title",
  "what is my job title?",
  "job title here",
  "tbc",
  "tba",
  "todo",
  "unknown",
  "n/a",
  "na",
  "none",
  "placeholder",
  "coming soon",
  "photo coming soon",
]);

export function publicTeamJobTitle(jobTitle: string | null | undefined): string | null {
  const trimmed = emptyToNull(jobTitle ?? null);
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase().replace(/[.!]+$/g, "").trim();
  if (PUBLIC_JOB_TITLE_PLACEHOLDERS.has(normalized)) return null;
  if (/^what\s+is\s+my\s+job\s+title\??$/i.test(trimmed)) return null;
  if (/^(tbc|tba|todo|n\/?a|unknown|placeholder)[.!?]*$/i.test(trimmed)) return null;
  return trimmed;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

const optionalUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .optional()
  .nullable()
  .or(z.literal(""));

const optionalEmail = z
  .string()
  .trim()
  .email()
  .max(320)
  .optional()
  .nullable()
  .or(z.literal(""));

export const teamDepartmentUpsertSchema = z.object({
  id: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  isPublic: z.boolean().default(true),
});

export const teamMemberUpsertSchema = z.object({
  id: z.string().cuid().optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  jobTitle: z.string().trim().max(160).optional().nullable(),
  bio: z.string().trim().max(1200).optional().nullable(),
  email: optionalEmail,
  phone: z.string().trim().max(40).optional().nullable(),
  linkedInUrl: optionalUrl,
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  isPublic: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
  isContactable: z.boolean().default(false),
  departmentId: z.string().cuid().optional().nullable(),
  photoMediaId: z.string().cuid().optional().nullable(),
  photoAlt: z.string().trim().max(200).optional().nullable(),
  photoFocalX: z.number().int().min(0).max(100).default(50),
  photoFocalY: z.number().int().min(0).max(100).default(50),
  salesRepId: z.string().cuid().optional().nullable(),
});

export const teamMemberListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  departmentId: z.string().cuid().optional(),
  visibility: z.enum(["all", "public", "hidden"]).default("all"),
});

export type TeamDepartmentUpsertInput = z.infer<typeof teamDepartmentUpsertSchema>;
export type TeamMemberUpsertInput = z.infer<typeof teamMemberUpsertSchema>;

/** Normalize optional string fields after Zod parse. */
export function normalizeTeamMemberInput(input: TeamMemberUpsertInput) {
  return {
    ...input,
    jobTitle: emptyToNull(input.jobTitle ?? null),
    bio: emptyToNull(input.bio ?? null),
    email: emptyToNull(input.email ?? null),
    phone: emptyToNull(input.phone ?? null),
    linkedInUrl: emptyToNull(input.linkedInUrl ?? null),
    photoAlt: emptyToNull(input.photoAlt ?? null),
    departmentId: input.departmentId || null,
    photoMediaId: input.photoMediaId || null,
    salesRepId: input.salesRepId || null,
  };
}

export function normalizeTeamDepartmentInput(input: TeamDepartmentUpsertInput) {
  return {
    ...input,
    description: emptyToNull(input.description ?? null),
  };
}
