import { CERTIFICATION_BADGE_MAX_BYTES } from "@/domain/certifications";
import { AuthError } from "@/server/rbac/guards";
import { sniffImageType } from "@/server/media/process-image";

const BADGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function isAllowedCertificationBadgeContentType(contentType: string): boolean {
  return BADGE_CONTENT_TYPES.has(contentType);
}

export function assertImageBufferForBadge(bytes: Buffer): void {
  const type = sniffImageType(bytes);
  if (!type || !BADGE_CONTENT_TYPES.has(type)) {
    throw new AuthError("Badge must be a PNG, JPEG, or WebP image", "VALIDATION", 400);
  }
  if (bytes.length > CERTIFICATION_BADGE_MAX_BYTES) {
    throw new AuthError("Badge image is too large", "VALIDATION", 400);
  }
}
