/**
 * Website branding settings — header logo for site chrome.
 * Admin → Settings → General. Singleton row; media bytes via CmsMedia storage.
 */

import { prisma } from "@/infra/database/client";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import { putMediaObject, getMediaStorageStatus } from "@/server/cms/storage";
import { processImageUpload, sniffImageType } from "@/server/media/process-image";
import {
  SITE_BRANDING_SETTINGS_ID,
  DEFAULT_SITE_HEADER_LOGO_SRC,
  SITE_HEADER_LOGO_MAX_BYTES,
  buildHeaderLogoSrc,
  isSiteHeaderLogoContentType,
  looksLikeSvgUpload,
  validateSiteHeaderLogoDimensions,
  type PublicSiteBranding,
  type SiteBrandingSettingsDto,
  type SiteHeaderLogoContentType,
} from "@/domain/site-branding";

function decodeBase64Body(raw: string): Buffer {
  const trimmed = raw.trim();
  const comma = trimmed.indexOf(",");
  const payload = trimmed.startsWith("data:") && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  return Buffer.from(payload, "base64");
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/[/\\]/g, "_").replace(/[^\w.\- ()]+/g, "_").trim();
  return (base || "logo").slice(0, 180);
}

function toDto(row: {
  headerLogoMediaId: string | null;
  headerLogoAlt: string | null;
  updatedAt: Date;
  updatedByUserId: string | null;
  headerLogoMedia: {
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number | null;
    width: number | null;
    height: number | null;
    altText: string | null;
  } | null;
}): SiteBrandingSettingsDto {
  const isCustom = Boolean(row.headerLogoMediaId && row.headerLogoMedia);
  return {
    headerLogoMediaId: isCustom ? row.headerLogoMediaId : null,
    headerLogoSrc: isCustom
      ? buildHeaderLogoSrc(row.headerLogoMediaId!, row.updatedAt)
      : DEFAULT_SITE_HEADER_LOGO_SRC,
    headerLogoAlt: row.headerLogoAlt ?? row.headerLogoMedia?.altText ?? null,
    isCustom,
    width: row.headerLogoMedia?.width ?? null,
    height: row.headerLogoMedia?.height ?? null,
    contentType: row.headerLogoMedia?.contentType ?? null,
    sizeBytes: row.headerLogoMedia?.sizeBytes ?? null,
    filename: row.headerLogoMedia?.filename ?? null,
    updatedAt: row.updatedAt.toISOString(),
    updatedByUserId: row.updatedByUserId,
  };
}

const mediaSelect = {
  id: true,
  filename: true,
  contentType: true,
  sizeBytes: true,
  width: true,
  height: true,
  altText: true,
} as const;

async function loadSettingsRow() {
  return prisma.siteBrandingSettings.findUnique({
    where: { id: SITE_BRANDING_SETTINGS_ID },
    select: {
      headerLogoMediaId: true,
      headerLogoAlt: true,
      updatedAt: true,
      updatedByUserId: true,
      headerLogoMedia: { select: mediaSelect },
    },
  });
}

/** Public chrome — no auth. Does not create the singleton row. */
export async function getPublicSiteBranding(): Promise<PublicSiteBranding> {
  const row = await loadSettingsRow();
  if (!row?.headerLogoMediaId || !row.headerLogoMedia) {
    return {
      headerLogoSrc: DEFAULT_SITE_HEADER_LOGO_SRC,
      isCustom: false,
      cacheKey: null,
    };
  }
  const cacheKey = String(row.updatedAt.getTime());
  return {
    headerLogoSrc: buildHeaderLogoSrc(row.headerLogoMediaId, row.updatedAt),
    isCustom: true,
    cacheKey,
  };
}

export async function getSiteBrandingSettingsForActor(
  userId: string,
): Promise<SiteBrandingSettingsDto> {
  await requireSystemPermission(userId, "settings.view");
  const existing = await loadSettingsRow();
  if (existing) return toDto(existing);
  const created = await prisma.siteBrandingSettings.upsert({
    where: { id: SITE_BRANDING_SETTINGS_ID },
    create: { id: SITE_BRANDING_SETTINGS_ID },
    update: {},
    select: {
      headerLogoMediaId: true,
      headerLogoAlt: true,
      updatedAt: true,
      updatedByUserId: true,
      headerLogoMedia: { select: mediaSelect },
    },
  });
  return toDto(created);
}

export async function uploadSiteHeaderLogo(
  userId: string,
  raw: {
    filename: string;
    contentType: string;
    base64: string;
    altText?: string | null;
  },
): Promise<SiteBrandingSettingsDto> {
  await requireSystemPermission(userId, "settings.edit");

  const status = getMediaStorageStatus();
  if (!status.uploadsEnabled) {
    throw new AuthError(status.message, "VALIDATION", 400);
  }

  const filename = sanitizeFilename(raw.filename ?? "");
  const declared = raw.contentType?.trim().toLowerCase() ?? "";
  const bytes = decodeBase64Body(raw.base64 ?? "");

  if (looksLikeSvgUpload({ filename, contentType: declared, bytes })) {
    throw new AuthError(
      "SVG uploads are not supported for the header logo. Use PNG, JPG or WebP.",
      "VALIDATION",
      400,
    );
  }
  if (!isSiteHeaderLogoContentType(declared)) {
    throw new AuthError("Header logo must be a PNG, JPG or WebP file", "VALIDATION", 400);
  }
  if (!bytes.length) {
    throw new AuthError("Empty file", "VALIDATION", 400);
  }
  if (bytes.length > SITE_HEADER_LOGO_MAX_BYTES) {
    throw new AuthError("Header logo must be 2 MB or smaller", "VALIDATION", 400);
  }

  const sniffed = sniffImageType(bytes);
  if (!sniffed || !isSiteHeaderLogoContentType(sniffed)) {
    throw new AuthError("Unsupported image format. Use PNG, JPG or WebP.", "VALIDATION", 400);
  }
  if (sniffed !== declared) {
    throw new AuthError("File contents do not match the declared type", "VALIDATION", 400);
  }

  const processed = await processImageUpload({
    buffer: bytes,
    mimeType: sniffed as SiteHeaderLogoContentType,
    usage: "BRAND_LOGO",
  });

  const dimError = validateSiteHeaderLogoDimensions(processed.width, processed.height);
  if (dimError) {
    throw new AuthError(dimError, "VALIDATION", 400);
  }

  const storageKey = `cms-media/${crypto.randomUUID()}/${filename}`;
  const stored = await putMediaObject({
    storageKey,
    bytes: processed.buffer,
    contentType: processed.mimeType,
  });

  const previous = await loadSettingsRow();
  const altText = raw.altText?.trim() || previous?.headerLogoAlt || "Automotive Brands";

  const createdMedia = await prisma.cmsMedia.create({
    data: {
      filename,
      contentType: processed.mimeType,
      sizeBytes: processed.fileSize,
      width: processed.width,
      height: processed.height,
      altText,
      storageProvider: stored.provider,
      storageKey: stored.storageKey,
      bytes: stored.bytes ? Buffer.from(stored.bytes) : null,
      uploadedById: userId,
    },
    select: mediaSelect,
  });

  const row = await prisma.siteBrandingSettings.upsert({
    where: { id: SITE_BRANDING_SETTINGS_ID },
    create: {
      id: SITE_BRANDING_SETTINGS_ID,
      headerLogoMediaId: createdMedia.id,
      headerLogoAlt: altText,
      updatedByUserId: userId,
    },
    update: {
      headerLogoMediaId: createdMedia.id,
      headerLogoAlt: altText,
      updatedByUserId: userId,
    },
    select: {
      headerLogoMediaId: true,
      headerLogoAlt: true,
      updatedAt: true,
      updatedByUserId: true,
      headerLogoMedia: { select: mediaSelect },
    },
  });

  await recordAuditEvent({
    action: "settings.site_branding_updated",
    entityType: "SiteBrandingSettings",
    entityId: SITE_BRANDING_SETTINGS_ID,
    actorUserId: userId,
    metadata: {
      change: "header_logo_replaced",
      mediaId: createdMedia.id,
      filename: createdMedia.filename,
      contentType: createdMedia.contentType,
      width: createdMedia.width,
      height: createdMedia.height,
      sizeBytes: createdMedia.sizeBytes,
      previousMediaId: previous?.headerLogoMediaId ?? null,
      storageProvider: stored.provider,
    },
    before: { headerLogoMediaId: previous?.headerLogoMediaId ?? null },
    after: { headerLogoMediaId: createdMedia.id },
  });

  return toDto(row);
}

export async function resetSiteHeaderLogo(userId: string): Promise<SiteBrandingSettingsDto> {
  await requireSystemPermission(userId, "settings.edit");
  const previous = await loadSettingsRow();

  const row = await prisma.siteBrandingSettings.upsert({
    where: { id: SITE_BRANDING_SETTINGS_ID },
    create: {
      id: SITE_BRANDING_SETTINGS_ID,
      headerLogoMediaId: null,
      headerLogoAlt: null,
      updatedByUserId: userId,
    },
    update: {
      headerLogoMediaId: null,
      headerLogoAlt: null,
      updatedByUserId: userId,
    },
    select: {
      headerLogoMediaId: true,
      headerLogoAlt: true,
      updatedAt: true,
      updatedByUserId: true,
      headerLogoMedia: { select: mediaSelect },
    },
  });

  await recordAuditEvent({
    action: "settings.site_branding_updated",
    entityType: "SiteBrandingSettings",
    entityId: SITE_BRANDING_SETTINGS_ID,
    actorUserId: userId,
    metadata: {
      change: "header_logo_reset",
      previousMediaId: previous?.headerLogoMediaId ?? null,
    },
    before: { headerLogoMediaId: previous?.headerLogoMediaId ?? null },
    after: { headerLogoMediaId: null },
  });

  return toDto(row);
}
