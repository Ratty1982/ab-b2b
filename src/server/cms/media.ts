import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import {
  CMS_MEDIA_CONTENT_TYPES,
  CMS_MEDIA_MAX_BYTES,
  cmsMediaUploadSchema,
} from "@/domain/cms";
import { cmsMediaPublicPath } from "@/lib/cms-media";

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

function toListItem(row: {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
  altText: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    altText: row.altText,
    createdAt: row.createdAt.toISOString(),
    src: cmsMediaPublicPath(row.id),
  };
}

export async function listCmsMedia(actorUserId: string) {
  await requireSystemPermission(actorUserId, "cms.media.read");
  const rows = await prisma.cmsMedia.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
      altText: true,
      createdAt: true,
    },
  });
  return rows.map(toListItem);
}

export async function uploadCmsMedia(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.media.manage");
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
  const created = await prisma.cmsMedia.create({
    data: {
      filename,
      contentType: sniffed,
      sizeBytes: bytes.length,
      altText: input.altText?.trim() || null,
      storageProvider: "database",
      storageKey: `cms-media/${crypto.randomUUID()}/${filename}`,
      bytes: Uint8Array.from(bytes),
      uploadedById: actorUserId,
    },
    select: {
      id: true,
      filename: true,
      contentType: true,
      sizeBytes: true,
      altText: true,
      createdAt: true,
    },
  });

  await recordAuditEvent({
    action: "cms.media_uploaded",
    entityType: "CmsMedia",
    entityId: created.id,
    actorUserId,
    metadata: { filename: created.filename, contentType: created.contentType, sizeBytes: created.sizeBytes },
  });

  return toListItem(created);
}

/** Public bytes for rendering published pages. Does not include upload metadata beyond headers. */
export async function getPublicCmsMediaBytes(id: string) {
  if (!id || id.length > 64) return null;
  const row = await prisma.cmsMedia.findUnique({
    where: { id },
    select: { bytes: true, contentType: true, filename: true },
  });
  if (!row?.bytes) return null;
  return { bytes: Buffer.from(row.bytes), contentType: row.contentType, filename: row.filename };
}
