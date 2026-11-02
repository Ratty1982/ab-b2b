/**
 * Admin and public certification management.
 * Badges use CmsMedia. Certificate PDFs use CMS object storage (not CmsMedia).
 */
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  CERTIFICATION_BADGE_MAX_BYTES,
  CERTIFICATION_DEFAULT_ALT,
  INITIAL_ISO_CERTIFICATION_DRAFT,
  certificationListQuerySchema,
  certificationPdfPublicPath,
  certificationUpsertSchema,
  isCertificationPubliclyVisible,
  isPdfBytes,
  parseStandardsInput,
  publishingRequirementsMet,
  type PublicCertification,
  type PublicCertificationPlacement,
} from "@/domain/certifications";
import { cmsMediaPublicPath } from "@/lib/cms-media";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { getMediaObjectBytes } from "@/server/cms/storage";
import {
  assertImageBufferForBadge,
  isAllowedCertificationBadgeContentType,
} from "@/server/certifications/badge";
import {
  cleanupDeletedCertificationPdf,
  clearCertificatePdfObject,
  defaultCertificatePdfStorageDeps,
  replaceCertificatePdfObject,
  type CertificatePdfStorageDeps,
  validateCertificatePdfUpload,
} from "@/server/certifications/pdf-storage";

export { assertImageBufferForBadge } from "@/server/certifications/badge";

let pdfStorageDeps: CertificatePdfStorageDeps = defaultCertificatePdfStorageDeps();

/** Test-only override for PDF storage side effects. */
export function setCertificationPdfStorageDepsForTests(
  deps: CertificatePdfStorageDeps | null,
): void {
  pdfStorageDeps = deps ?? defaultCertificatePdfStorageDeps();
}

function sanitizeFilename(name: string): string {
  const base = name.replaceAll("\\", "/").split("/").pop() ?? "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return cleaned || "file";
}

function decodeBase64Body(raw: string): Buffer {
  const trimmed = raw.trim();
  const comma = trimmed.indexOf(",");
  const payload =
    trimmed.startsWith("data:") && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  return Buffer.from(payload, "base64");
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

const adminInclude = {
  imageMedia: {
    select: { id: true, altText: true, width: true, height: true, contentType: true },
  },
} satisfies Prisma.SiteCertificationInclude;

function serializeAdmin(
  row: Prisma.SiteCertificationGetPayload<{ include: typeof adminInclude }>,
) {
  return {
    id: row.id,
    title: row.title,
    issuingOrganisation: row.issuingOrganisation,
    certificateNumber: row.certificateNumber,
    standards: row.standards,
    scope: row.scope,
    description: row.description,
    imageMediaId: row.imageMediaId,
    imageAltText: row.imageAltText,
    image: row.imageMedia
      ? {
          mediaId: row.imageMedia.id,
          src: cmsMediaPublicPath(row.imageMedia.id),
          alt: row.imageAltText || row.imageMedia.altText || CERTIFICATION_DEFAULT_ALT,
          width: row.imageMedia.width,
          height: row.imageMedia.height,
        }
      : null,
    hasCertificatePdf: Boolean(row.certificatePdfStorageKey),
    certificatePdfFilename: row.certificatePdfFilename,
    certificatePdfUrl: row.certificatePdfStorageKey ? certificationPdfPublicPath(row.id) : null,
    issueDate: dateOnly(row.issueDate),
    expiryDate: dateOnly(row.expiryDate),
    published: row.published,
    archived: row.archived,
    showOnHomepage: row.showOnHomepage,
    showInFooter: row.showInFooter,
    showOnAboutPage: row.showOnAboutPage,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publiclyVisible: isCertificationPubliclyVisible(row),
  };
}

function toPublic(row: Prisma.SiteCertificationGetPayload<{ include: typeof adminInclude }>): PublicCertification {
  return {
    id: row.id,
    title: row.title,
    issuingOrganisation: row.issuingOrganisation,
    certificateNumber: row.certificateNumber,
    standards: row.standards,
    scope: row.scope,
    description: row.description,
    imageSrc: row.imageMedia ? cmsMediaPublicPath(row.imageMedia.id) : null,
    imageAlt: row.imageAltText || row.imageMedia?.altText || CERTIFICATION_DEFAULT_ALT,
    imageWidth: row.imageMedia?.width ?? null,
    imageHeight: row.imageMedia?.height ?? null,
    certificatePdfUrl: row.certificatePdfStorageKey ? certificationPdfPublicPath(row.id) : null,
    issueDate: dateOnly(row.issueDate),
    expiryDate: dateOnly(row.expiryDate),
    showOnHomepage: row.showOnHomepage,
    showInFooter: row.showInFooter,
    showOnAboutPage: row.showOnAboutPage,
    displayOrder: row.displayOrder,
  };
}

export async function ensureInitialCertificationDraft(actorUserId?: string | null) {
  const existing = await prisma.siteCertification.findFirst({
    where: {
      OR: [
        { certificateNumber: INITIAL_ISO_CERTIFICATION_DRAFT.certificateNumber },
        {
          title: INITIAL_ISO_CERTIFICATION_DRAFT.title,
          issuingOrganisation: INITIAL_ISO_CERTIFICATION_DRAFT.issuingOrganisation,
        },
      ],
    },
  });
  if (existing) return { created: false, id: existing.id };

  const created = await prisma.siteCertification.create({
    data: {
      ...INITIAL_ISO_CERTIFICATION_DRAFT,
      certificateNumber: INITIAL_ISO_CERTIFICATION_DRAFT.certificateNumber,
      standards: [...INITIAL_ISO_CERTIFICATION_DRAFT.standards],
      createdById: actorUserId ?? null,
      updatedById: actorUserId ?? null,
    },
  });
  return { created: true, id: created.id };
}

export async function listCertificationsAdmin(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.certifications.view");
  await ensureInitialCertificationDraft(actorUserId);
  const input = certificationListQuerySchema.parse(raw ?? {});
  const where: Prisma.SiteCertificationWhereInput = {};
  if (input.visibility === "published") where.published = true;
  if (input.visibility === "draft") {
    where.published = false;
    where.archived = false;
  }
  if (input.visibility === "archived") where.archived = true;
  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { issuingOrganisation: { contains: q, mode: "insensitive" } },
      { certificateNumber: { contains: q, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.siteCertification.findMany({
    where,
    include: adminInclude,
    orderBy: [{ displayOrder: "asc" }, { updatedAt: "desc" }],
  });
  return { items: rows.map(serializeAdmin) };
}

export async function getCertificationAdmin(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.certifications.view");
  const { id } = z.object({ id: z.string().min(1) }).parse(raw ?? {});
  const row = await prisma.siteCertification.findUnique({ where: { id }, include: adminInclude });
  if (!row) throw new AuthError("Certification not found", "NOT_FOUND", 404);
  return serializeAdmin(row);
}

export async function upsertCertification(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "cms.certifications.edit");
  if (!hasPermission(profile, "cms.certifications.edit")) {
    throw new AuthError("Not permitted to edit certifications", "FORBIDDEN", 403);
  }
  const parsed = certificationUpsertSchema.parse({
    ...(typeof raw === "object" && raw ? raw : {}),
    standards: parseStandardsInput(
      typeof raw === "object" && raw && "standards" in raw
        ? (raw as { standards?: unknown }).standards
        : [],
    ),
  });

  const publishGate = publishingRequirementsMet({
    published: parsed.published,
    imageMediaId: parsed.imageMediaId,
    title: parsed.title,
    issuingOrganisation: parsed.issuingOrganisation,
  });
  if (!publishGate.ok) {
    throw new AuthError(publishGate.error, "VALIDATION", 400);
  }

  if (parsed.imageMediaId) {
    await assertBadgeMedia(parsed.imageMediaId);
  }

  const data = {
    title: parsed.title.trim(),
    issuingOrganisation: parsed.issuingOrganisation.trim(),
    certificateNumber: parsed.certificateNumber?.trim() || null,
    standards: parsed.standards,
    scope: parsed.scope?.trim() || null,
    description: parsed.description?.trim() || null,
    imageMediaId: parsed.imageMediaId || null,
    imageAltText: parsed.imageAltText?.trim() || CERTIFICATION_DEFAULT_ALT,
    issueDate: parseOptionalDate(parsed.issueDate),
    expiryDate: parseOptionalDate(parsed.expiryDate),
    published: parsed.archived ? false : parsed.published,
    archived: parsed.archived,
    showOnHomepage: parsed.showOnHomepage,
    showInFooter: parsed.showInFooter,
    showOnAboutPage: parsed.showOnAboutPage,
    displayOrder: parsed.displayOrder,
    updatedById: actorUserId,
  };

  const row = parsed.id
    ? await prisma.siteCertification.update({
        where: { id: parsed.id },
        data,
        include: adminInclude,
      })
    : await prisma.siteCertification.create({
        data: { ...data, createdById: actorUserId },
        include: adminInclude,
      });

  await recordAuditEvent({
    action: parsed.id ? "cms.certification.updated" : "cms.certification.created",
    entityType: "SiteCertification",
    entityId: row.id,
    actorUserId,
    metadata: {
      published: row.published,
      archived: row.archived,
      title: row.title,
    },
  });

  return serializeAdmin(row);
}

export async function archiveCertification(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.certifications.edit");
  const { id } = z.object({ id: z.string().min(1) }).parse(raw ?? {});
  const row = await prisma.siteCertification.update({
    where: { id },
    data: { archived: true, published: false, updatedById: actorUserId },
    include: adminInclude,
  });
  await recordAuditEvent({
    action: "cms.certification.archived",
    entityType: "SiteCertification",
    entityId: row.id,
    actorUserId,
  });
  return serializeAdmin(row);
}

export async function deleteCertification(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.certifications.edit");
  const { id, confirm } = z
    .object({ id: z.string().min(1), confirm: z.literal(true) })
    .parse(raw ?? {});
  const existing = await prisma.siteCertification.findUnique({ where: { id } });
  if (!existing) throw new AuthError("Certification not found", "NOT_FOUND", 404);
  if (existing.published && !existing.archived) {
    throw new AuthError(
      "Unpublish or archive the certification before deleting it",
      "VALIDATION",
      400,
    );
  }
  // Delete the DB row first so public fetches cannot keep serving the PDF.
  await prisma.siteCertification.delete({ where: { id } });
  await cleanupDeletedCertificationPdf(pdfStorageDeps, existing);
  await recordAuditEvent({
    action: "cms.certification.deleted",
    entityType: "SiteCertification",
    entityId: id,
    actorUserId,
    metadata: {
      confirmed: confirm,
      title: existing.title,
      hadCertificatePdf: Boolean(existing.certificatePdfStorageKey),
    },
  });
  return { ok: true as const };
}

export async function attachCertificationBadge(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.certifications.edit");
  const input = z
    .object({
      certificationId: z.string().min(1),
      mediaId: z.string().min(1),
      altText: z.string().max(300).optional().nullable(),
    })
    .parse(raw ?? {});
  const media = await assertBadgeMedia(input.mediaId);
  const row = await prisma.siteCertification.update({
    where: { id: input.certificationId },
    data: {
      imageMediaId: media.id,
      imageAltText: input.altText?.trim() || CERTIFICATION_DEFAULT_ALT,
      updatedById: actorUserId,
    },
    include: adminInclude,
  });
  await recordAuditEvent({
    action: "cms.certification.badge_attached",
    entityType: "SiteCertification",
    entityId: row.id,
    actorUserId,
    metadata: { mediaId: media.id },
  });
  return serializeAdmin(row);
}

export async function removeCertificationBadge(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.certifications.edit");
  const { id } = z.object({ id: z.string().min(1) }).parse(raw ?? {});
  const row = await prisma.siteCertification.update({
    where: { id },
    data: {
      imageMediaId: null,
      published: false,
      updatedById: actorUserId,
    },
    include: adminInclude,
  });
  await recordAuditEvent({
    action: "cms.certification.badge_removed",
    entityType: "SiteCertification",
    entityId: row.id,
    actorUserId,
  });
  return serializeAdmin(row);
}

export async function uploadCertificationPdf(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.certifications.edit");
  const input = z
    .object({
      certificationId: z.string().min(1),
      filename: z.string().min(1).max(200),
      contentType: z.string().min(1).max(100),
      bodyBase64: z.string().min(1),
    })
    .parse(raw ?? {});

  const bytes = decodeBase64Body(input.bodyBase64);
  validateCertificatePdfUpload({ bytes, contentType: input.contentType });

  const existing = await prisma.siteCertification.findUnique({
    where: { id: input.certificationId },
  });
  if (!existing) throw new AuthError("Certification not found", "NOT_FOUND", 404);

  const filename = sanitizeFilename(
    input.filename.endsWith(".pdf") ? input.filename : `${input.filename}.pdf`,
  );
  const storageKey = `certifications/${input.certificationId}/${randomBytes(12).toString("hex")}-${filename}`;

  await replaceCertificatePdfObject({
    prisma,
    deps: pdfStorageDeps,
    certificationId: existing.id,
    existing,
    filename,
    bytes,
    storageKey,
    actorUserId,
  });

  const row = await prisma.siteCertification.findUniqueOrThrow({
    where: { id: existing.id },
    include: adminInclude,
  });

  await recordAuditEvent({
    action: "cms.certification.pdf_uploaded",
    entityType: "SiteCertification",
    entityId: row.id,
    actorUserId,
    metadata: { filename, sizeBytes: bytes.length },
  });
  return serializeAdmin(row);
}

export async function removeCertificationPdf(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "cms.certifications.edit");
  const { id } = z.object({ id: z.string().min(1) }).parse(raw ?? {});
  const existing = await prisma.siteCertification.findUnique({ where: { id } });
  if (!existing) throw new AuthError("Certification not found", "NOT_FOUND", 404);

  await clearCertificatePdfObject({
    prisma,
    deps: pdfStorageDeps,
    certificationId: existing.id,
    existing,
    actorUserId,
  });

  const row = await prisma.siteCertification.findUniqueOrThrow({
    where: { id: existing.id },
    include: adminInclude,
  });
  await recordAuditEvent({
    action: "cms.certification.pdf_removed",
    entityType: "SiteCertification",
    entityId: row.id,
    actorUserId,
  });
  return serializeAdmin(row);
}

export async function listPublicCertifications(
  placement?: PublicCertificationPlacement,
): Promise<PublicCertification[]> {
  const where: Prisma.SiteCertificationWhereInput = {
    published: true,
    archived: false,
  };
  if (placement === "homepage") where.showOnHomepage = true;
  if (placement === "footer") where.showInFooter = true;
  if (placement === "about") where.showOnAboutPage = true;

  const rows = await prisma.siteCertification.findMany({
    where,
    include: adminInclude,
    orderBy: [{ displayOrder: "asc" }, { title: "asc" }],
  });

  return rows.filter((row) => isCertificationPubliclyVisible(row)).map(toPublic);
}

export async function getPublicCertificationPdfBytes(id: string): Promise<{
  bytes: Buffer;
  filename: string;
  contentType: string;
} | null> {
  const row = await prisma.siteCertification.findUnique({ where: { id } });
  if (!row || !isCertificationPubliclyVisible(row) || !row.certificatePdfStorageKey) return null;

  const fromStore = await getMediaObjectBytes({
    storageProvider: row.certificatePdfStorageProvider || "database",
    storageKey: row.certificatePdfStorageKey,
    bytes: row.certificatePdfBytes,
  });
  if (!fromStore || !isPdfBytes(fromStore)) return null;
  return {
    bytes: fromStore,
    filename: row.certificatePdfFilename || "certificate.pdf",
    contentType: "application/pdf",
  };
}

/** Admin-only PDF fetch (includes unpublished drafts). */
export async function getAdminCertificationPdfBytes(
  actorUserId: string,
  id: string,
): Promise<{ bytes: Buffer; filename: string; contentType: string } | null> {
  await requireSystemPermission(actorUserId, "cms.certifications.view");
  const row = await prisma.siteCertification.findUnique({ where: { id } });
  if (!row?.certificatePdfStorageKey) return null;
  const fromStore = await getMediaObjectBytes({
    storageProvider: row.certificatePdfStorageProvider || "database",
    storageKey: row.certificatePdfStorageKey,
    bytes: row.certificatePdfBytes,
  });
  if (!fromStore || !isPdfBytes(fromStore)) return null;
  return {
    bytes: fromStore,
    filename: row.certificatePdfFilename || "certificate.pdf",
    contentType: "application/pdf",
  };
}

async function assertBadgeMedia(mediaId: string) {
  const media = await prisma.cmsMedia.findUnique({ where: { id: mediaId } });
  if (!media) throw new AuthError("Badge media not found", "NOT_FOUND", 404);
  if (!isAllowedCertificationBadgeContentType(media.contentType)) {
    throw new AuthError("Certification badge must be a PNG, JPEG, or WebP image", "VALIDATION", 400);
  }
  if ((media.sizeBytes ?? 0) > CERTIFICATION_BADGE_MAX_BYTES) {
    throw new AuthError("Badge image is too large", "VALIDATION", 400);
  }
  if (media.bytes && media.bytes.length) {
    assertImageBufferForBadge(Buffer.from(media.bytes));
  } else if (media.storageProvider === "s3" && media.storageKey) {
    const fromStore = await getMediaObjectBytes({
      storageProvider: media.storageProvider,
      storageKey: media.storageKey,
      bytes: null,
    });
    if (!fromStore) {
      throw new AuthError("Badge media could not be read for validation", "VALIDATION", 400);
    }
    assertImageBufferForBadge(fromStore);
  }
  return media;
}
