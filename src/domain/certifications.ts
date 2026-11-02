/**
 * Website certifications and accreditations (ISO 9001 / ISO 14001, etc.).
 * Public visibility requires published=true, archived=false, and not past expiry.
 * Issue/expiry dates must stay blank until verified against the official certificate.
 */
import { z } from "zod";

export const CERTIFICATION_BADGE_MAX_BYTES = 8 * 1024 * 1024;
export const CERTIFICATION_PDF_MAX_BYTES = 20 * 1024 * 1024;

export const CERTIFICATION_DEFAULT_ALT =
  "Citation ISO Certification — Automotive Brands ISO 9001:2015 and ISO 14001:2015 integrated management system certification.";

export const CERTIFICATION_HOMEPAGE_HEADING = "Our Commitment to Quality & the Environment";
export const CERTIFICATION_HOMEPAGE_SUPPORTING =
  "Automotive Brands is proud to hold ISO 9001:2015 and ISO 14001:2015 certification, reflecting our commitment to consistent quality, responsible environmental management and continual improvement.";

/** Seed draft for the Citation ISO certification. Remains unpublished until reviewed. */
export const INITIAL_ISO_CERTIFICATION_DRAFT = {
  title: "ISO 9001 & ISO 14001 Certified",
  issuingOrganisation: "Citation ISO Certification",
  certificateNumber: "530712026",
  standards: ["ISO 9001:2015", "ISO 14001:2015"] as string[],
  description:
    "Automotive Brands operates an integrated management system certified to ISO 9001:2015 and ISO 14001:2015, demonstrating our commitment to quality management, environmental responsibility and continual improvement.",
  imageAltText: CERTIFICATION_DEFAULT_ALT,
  published: false,
  archived: false,
  showOnHomepage: true,
  showInFooter: true,
  showOnAboutPage: true,
  displayOrder: 0,
} as const;

const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()])
  .optional()
  .transform((value) => {
    if (value == null || value === "") return null;
    return value;
  });

export const certificationUpsertSchema = z.object({
  id: z.string().min(1).optional().nullable(),
  title: z.string().trim().min(1).max(200),
  issuingOrganisation: z.string().trim().min(1).max(200),
  certificateNumber: z.string().trim().max(120).optional().nullable(),
  standards: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  scope: z.string().trim().max(2000).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  imageMediaId: z.string().min(1).optional().nullable(),
  imageAltText: z.string().trim().max(300).optional().nullable(),
  issueDate: optionalDate,
  expiryDate: optionalDate,
  published: z.boolean().default(false),
  archived: z.boolean().default(false),
  showOnHomepage: z.boolean().default(true),
  showInFooter: z.boolean().default(true),
  showOnAboutPage: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(10_000).default(0),
});

export type CertificationUpsertInput = z.infer<typeof certificationUpsertSchema>;

export const certificationListQuerySchema = z.object({
  q: z.string().max(200).optional().nullable(),
  visibility: z.enum(["all", "published", "draft", "archived"]).optional().default("all"),
});

export type PublicCertificationPlacement = "homepage" | "footer" | "about";

export type PublicCertification = {
  id: string;
  title: string;
  issuingOrganisation: string;
  certificateNumber: string | null;
  standards: string[];
  scope: string | null;
  description: string | null;
  imageSrc: string | null;
  imageAlt: string;
  imageWidth: number | null;
  imageHeight: number | null;
  certificatePdfUrl: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  showOnHomepage: boolean;
  showInFooter: boolean;
  showOnAboutPage: boolean;
  displayOrder: number;
};

/** Calendar date YYYY-MM-DD in Europe/London for expiry checks. */
export function londonCalendarDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Public visibility policy:
 * - archived records never appear
 * - unpublished records never appear
 * - records with expiryDate before today's London calendar date never appear
 * - missing badge image is allowed for text-only placements, but homepage/footer prefer image
 */
export function isCertificationPubliclyVisible(input: {
  published: boolean;
  archived: boolean;
  expiryDate: Date | null;
  now?: Date;
}): boolean {
  if (!input.published || input.archived) return false;
  if (!input.expiryDate) return true;
  const expiryDay = input.expiryDate.toISOString().slice(0, 10);
  return expiryDay >= londonCalendarDate(input.now ?? new Date());
}

export function certificationPdfPublicPath(id: string): string {
  return `/api/certifications/${encodeURIComponent(id)}/certificate`;
}

export function isPdfBytes(buf: Buffer): boolean {
  if (buf.length < 5) return false;
  return buf.subarray(0, 5).toString("ascii") === "%PDF-";
}

export function parseStandardsInput(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  if (typeof raw === "string") {
    return raw
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  return [];
}
