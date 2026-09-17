import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import {
  CMS_MEDIA_CONTENT_TYPES,
  CMS_MEDIA_MAX_BYTES,
  cmsMediaDeleteSchema,
  cmsMediaUpdateSchema,
  cmsMediaUploadSchema,
} from "@/domain/cms";
import { collectMediaIds } from "@/domain/cms-editor";
import { cmsMediaPublicPath } from "@/lib/cms-media";
import {
  deleteMediaObject,
  getMediaObjectBytes,
  getMediaStorageStatus,
  putMediaObject,
} from "@/server/cms/storage";

function sanitizeFilename(name: string): string {
  const base = name.replaceAll("\\", "/").split("/").pop() ?? "image";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return cleaned || "image";
}

function decodeBase64Body(raw: string): Buffer {
  const trimmed = raw.trim();
  const comma = trimmed.indexOf(",");
  const payload =
    trimmed.startsWith("data:") && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  return Buffer.from(payload, "base64");
}

function sniffImageType(buf: Buffer): (typeof CMS_MEDIA_CONTENT_TYPES)[number] | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 6) {
    const header = buf.toString("ascii", 0, 6);
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  return null;
}

export function readImageSize(buf: Buffer): { width: number; height: number } | null {
  const type = sniffImageType(buf);
  if (type === "image/png" && buf.length >= 24) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (type === "image/gif" && buf.length >= 10) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (type === "image/jpeg") {
    let i = 2;
    while (i + 8 < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1]!;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const seglen = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + seglen;
    }
  }
  if (type === "image/webp" && buf.length >= 30 && buf.toString("ascii", 12, 16) === "VP8 ") {
    // lossy VP8
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    if (width && height) return { width, height };
  }
  return null;
}

export type CmsMediaListItem = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  altText: string | null;
  createdAt: string;
  uploadedById: string | null;
  uploadedByName: string | null;
  storageProvider: string;
  src: string;
  inUse: boolean;
  usageCount: number;
};

function toListItem(
  row: {
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number | null;
    width: number | null;
    height: number | null;
    altText: string | null;
    createdAt: Date;
    uploadedById: string | null;
    storageProvider: string;
  },
  usage: Map<string, number>,
  names: Map<string, string>,
): CmsMediaListItem {
  const usageCount = usage.get(row.id) ?? 0;
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    altText: row.altText,
    createdAt: row.createdAt.toISOString(),
    uploadedById: row.uploadedById,
    uploadedByName: row.uploadedById ? names.get(row.uploadedById) ?? null : null,
    storageProvider: row.storageProvider,
    src: cmsMediaPublicPath(row.id),
    inUse: usageCount > 0,
    usageCount,
  };
}

async function mediaUsageCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const bump = (id: string | null | undefined) => {
    if (!id) return;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  };

  const sections = await prisma.cmsSection.findMany({ select: { config: true } });
  for (const section of sections) {
    for (const id of collectMediaIds(section.config)) bump(id);
  }
  const pages = await prisma.cmsPage.findMany({ select: { ogImageMediaId: true } });
  for (const page of pages) bump(page.ogImageMediaId);
  const brands = await prisma.brand.findMany({
    where: { logoMediaId: { not: null } },
    select: { logoMediaId: true },
  });
  for (const brand of brands) bump(brand.logoMediaId);
  return counts;
}

export async function listCmsMedia(actorUserId: string, q?: string) {
  await requireSystemPermission(actorUserId, "cms.media.read");
  const query = q?.trim().toLowerCase() ?? "";
  const rows = await prisma.cmsMedia.findMany({
    orderBy: { createdAt: "desc" },
    take: 400,
    select: {
      id: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
      width: true,
      height: true,
      altText: true,
      createdAt: true,
      uploadedById: true,
      storageProvider: true,
    },
  });
  const usage = await mediaUsageCounts();
  const uploaderIds = [...new Set(rows.map((r) => r.uploadedById).filter(Boolean))] as string[];
  const users = uploaderIds.length
    ? await prisma.user.findMany({
        where: { id: { in: uploaderIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
  const mapped = rows.map((row) => toListItem(row, usage, names));
  if (!query) return mapped;
  return mapped.filter((item) => {
    const hay = `${item.filename} ${item.altText ?? ""} ${item.uploadedByName ?? ""}`.toLowerCase();
    return hay.includes(query);
  });
}

export async function uploadCmsMedia(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.media.manage");
  const status = getMediaStorageStatus();
  if (!status.uploadsEnabled) {
    throw new AuthError(status.message, "VALIDATION", 400);
  }
  const input = cmsMediaUploadSchema.parse(raw);
  const bytes = decodeBase64Body(input.base64);
  if (!bytes.length) {
    throw new AuthError("Empty file", "VALIDATION", 400);
  }
  if (bytes.length > CMS_MEDIA_MAX_BYTES) {
    throw new AuthError("File is larger than 8 MB", "VALIDATION", 400);
  }
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    throw new AuthError("Unsupported image format", "VALIDATION", 400);
  }
  if (sniffed !== input.contentType) {
    throw new AuthError("File contents do not match the declared type", "VALIDATION", 400);
  }

  const filename = sanitizeFilename(input.filename);
  const storageKey = `cms-media/${crypto.randomUUID()}/${filename}`;
  const size = readImageSize(bytes);
  const stored = await putMediaObject({ storageKey, bytes, contentType: sniffed });

  const created = await prisma.cmsMedia.create({
    data: {
      filename,
      contentType: sniffed,
      sizeBytes: bytes.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
      altText: input.altText?.trim() || null,
      storageProvider: stored.provider,
      storageKey: stored.storageKey,
      bytes: stored.bytes ? Buffer.from(stored.bytes) : null,
      uploadedById: actorUserId,
    },
    select: {
      id: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
      width: true,
      height: true,
      altText: true,
      createdAt: true,
      uploadedById: true,
      storageProvider: true,
    },
  });

  await recordAuditEvent({
    action: "cms.media_uploaded",
    entityType: "CmsMedia",
    entityId: created.id,
    actorUserId,
    metadata: {
      filename: created.filename,
      contentType: created.contentType,
      sizeBytes: created.sizeBytes,
      provider: stored.provider,
    },
  });

  return toListItem(created, new Map(), new Map());
}

export async function updateCmsMedia(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.media.manage");
  const input = cmsMediaUpdateSchema.parse(raw);
  const existing = await prisma.cmsMedia.findUnique({ where: { id: input.id } });
  if (!existing) throw new AuthError("Image not found", "NOT_FOUND", 404);
  const updated = await prisma.cmsMedia.update({
    where: { id: existing.id },
    data: { altText: input.altText === undefined ? existing.altText : input.altText?.trim() || null },
    select: {
      id: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
      width: true,
      height: true,
      altText: true,
      createdAt: true,
      uploadedById: true,
      storageProvider: true,
    },
  });
  const usage = await mediaUsageCounts();
  return toListItem(updated, usage, new Map());
}

export async function deleteCmsMedia(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.media.manage");
  const input = cmsMediaDeleteSchema.parse(raw);
  const existing = await prisma.cmsMedia.findUnique({
    where: { id: input.id },
    select: { id: true, storageProvider: true, storageKey: true, filename: true },
  });
  if (!existing) throw new AuthError("Image not found", "NOT_FOUND", 404);
  const usage = await mediaUsageCounts();
  if ((usage.get(existing.id) ?? 0) > 0) {
    throw new AuthError("This image is still used on a page or brand. Remove it there first.", "VALIDATION", 400);
  }
  await deleteMediaObject(existing);
  await prisma.cmsMedia.delete({ where: { id: existing.id } });
  await recordAuditEvent({
    action: "cms.media_deleted",
    entityType: "CmsMedia",
    entityId: existing.id,
    actorUserId,
    metadata: { filename: existing.filename },
  });
  return { id: existing.id };
}

/** Public bytes for rendering published pages. Does not include upload metadata beyond headers. */
export async function getPublicCmsMediaBytes(id: string) {
  if (!id || id.length > 64) return null;
  const row = await prisma.cmsMedia.findUnique({
    where: { id },
    select: { bytes: true, contentType: true, filename: true, storageProvider: true, storageKey: true },
  });
  if (!row) return null;
  const bytes = await getMediaObjectBytes(row);
  if (!bytes) return null;
  return { bytes, contentType: row.contentType, filename: row.filename };
}

export { getMediaStorageStatus };
