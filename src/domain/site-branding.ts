/**
 * Website chrome branding (header logo).
 * Catalogue brand logos stay on Brand.logoMediaId; email shells keep static /brand assets.
 */

export const SITE_BRANDING_SETTINGS_ID = "singleton";

/** Fallback mark when no custom header logo is configured. */
export const DEFAULT_SITE_HEADER_LOGO_SRC = "/brand/ab-logo.jpg";

/** Header logos are smaller assets than general CMS media — keep uploads lean. */
export const SITE_HEADER_LOGO_MAX_BYTES = 2 * 1024 * 1024;

export const SITE_HEADER_LOGO_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SiteHeaderLogoContentType = (typeof SITE_HEADER_LOGO_CONTENT_TYPES)[number];

/** Reject logos that are too small to render crisply in the header chrome. */
export const SITE_HEADER_LOGO_MIN_EDGE = 32;

/** Reject absurdly large bitmaps that waste storage / bandwidth. */
export const SITE_HEADER_LOGO_MAX_EDGE = 4096;

export const SITE_HEADER_LOGO_ACCEPT = SITE_HEADER_LOGO_CONTENT_TYPES.join(",");

export type PublicSiteBranding = {
  headerLogoSrc: string;
  isCustom: boolean;
  /** Cache-bust token derived from settings updatedAt when custom. */
  cacheKey: string | null;
};

export type SiteBrandingSettingsDto = {
  headerLogoMediaId: string | null;
  headerLogoSrc: string;
  headerLogoAlt: string | null;
  isCustom: boolean;
  width: number | null;
  height: number | null;
  contentType: string | null;
  sizeBytes: number | null;
  filename: string | null;
  updatedAt: string;
  updatedByUserId: string | null;
};

export function isSiteHeaderLogoContentType(
  value: string | null | undefined,
): value is SiteHeaderLogoContentType {
  return (
    value === "image/jpeg" || value === "image/png" || value === "image/webp"
  );
}

export function guessSiteHeaderLogoContentType(filename: string): SiteHeaderLogoContentType | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return null;
}

/** Explicit SVG rejection (including mislabeled uploads). */
export function looksLikeSvgUpload(opts: {
  filename?: string | null;
  contentType?: string | null;
  bytes?: Uint8Array | Buffer | null;
}): boolean {
  const filename = (opts.filename ?? "").toLowerCase();
  if (filename.endsWith(".svg") || filename.endsWith(".svgz")) return true;
  const type = (opts.contentType ?? "").toLowerCase();
  if (type.includes("svg")) return true;
  const bytes = opts.bytes;
  if (!bytes || bytes.length < 4) return false;
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 256)))
    .toString("utf8")
    .trimStart()
    .toLowerCase();
  return head.startsWith("<svg") || head.startsWith("<?xml");
}

export function validateSiteHeaderLogoDimensions(
  width: number,
  height: number,
): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return "Image has invalid dimensions";
  }
  if (width < SITE_HEADER_LOGO_MIN_EDGE || height < SITE_HEADER_LOGO_MIN_EDGE) {
    return `Logo must be at least ${SITE_HEADER_LOGO_MIN_EDGE}×${SITE_HEADER_LOGO_MIN_EDGE} pixels`;
  }
  if (width > SITE_HEADER_LOGO_MAX_EDGE || height > SITE_HEADER_LOGO_MAX_EDGE) {
    return `Logo must be at most ${SITE_HEADER_LOGO_MAX_EDGE}×${SITE_HEADER_LOGO_MAX_EDGE} pixels`;
  }
  return null;
}

export function buildHeaderLogoSrc(mediaId: string, updatedAt: Date | string | number): string {
  const ms =
    updatedAt instanceof Date
      ? updatedAt.getTime()
      : typeof updatedAt === "number"
        ? updatedAt
        : new Date(updatedAt).getTime();
  return `/api/cms-media/${mediaId}?v=${Number.isFinite(ms) ? ms : Date.now()}`;
}
