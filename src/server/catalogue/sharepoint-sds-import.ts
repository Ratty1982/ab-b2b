/**
 * SharePoint SDS scan → existing Product Documents preview/import pipeline.
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import {
  buildSharePointSourceMetadata,
  isPdfFilename,
  publicMicrosoftErrorMessage,
  readSharePointSourceMetadata,
  SHAREPOINT_SDS_MAX_FILES,
  SHAREPOINT_SDS_SOURCE,
} from "@/domain/sharepoint-sds";
import {
  assertAuthorisedSdsResource,
  assertSafeGraphResourceId,
} from "@/domain/microsoft-graph-security";
import { validateProductDocumentPdf } from "@/domain/product-documents";
import { createMicrosoftGraphClient } from "@/server/integrations/microsoft-graph";
import {
  buildSdsPreviewItems,
  loadCatalogueMatchCandidates,
  requireDocumentsManage,
  uploadProductDocument,
  type BulkPreviewItem,
  type BulkPreviewStatus,
} from "@/server/catalogue/product-documents";
import { assertSharePointSdsWorkflowEnabled } from "@/server/catalogue/sharepoint-sds-gate";
import {
  loadSharePointRuntimeConfig,
  loadAuthorisedSdsResource,
  getOrCreateSharePointSdsSettings,
  SHAREPOINT_SDS_SETTINGS_ID,
  toPublicSharePointSdsSettings,
} from "@/server/catalogue/sharepoint-sds-settings";

function summarise(items: Array<{ status: string }>) {
  const summary = {
    FILES_FOUND: items.filter((i) => i.status !== "SOURCE_MISSING").length,
    MATCHED: 0,
    REVIEW: 0,
    NO_MATCH: 0,
    ALREADY_ATTACHED: 0,
    EXISTING_SDS: 0,
    UPDATED_SOURCE: 0,
    SOURCE_MISSING: 0,
    INVALID: 0,
    DOWNLOAD_FAILED: 0,
  };
  for (const item of items) {
    if (item.status === "MATCHED") summary.MATCHED += 1;
    else if (item.status === "REVIEW") summary.REVIEW += 1;
    else if (item.status === "NO_MATCH") summary.NO_MATCH += 1;
    else if (item.status === "ALREADY_ATTACHED") summary.ALREADY_ATTACHED += 1;
    else if (item.status === "EXISTING_SDS") summary.EXISTING_SDS += 1;
    else if (item.status === "UPDATED_SOURCE") summary.UPDATED_SOURCE += 1;
    else if (item.status === "SOURCE_MISSING") summary.SOURCE_MISSING += 1;
    else if (item.status === "INVALID") summary.INVALID += 1;
    else if (item.status === "DOWNLOAD_FAILED") summary.DOWNLOAD_FAILED += 1;
  }
  return summary;
}

export async function scanSharePointSdsFolder(actorUserId: string) {
  assertSharePointSdsWorkflowEnabled();
  await requireDocumentsManage(actorUserId);
  const authorised = await loadAuthorisedSdsResource();
  const runtime = await loadSharePointRuntimeConfig();
  if (!authorised || !runtime?.driveId || !runtime.folderItemId) {
    throw new AuthError(
      "SharePoint folder is not connected — configure and test connection first",
      "NOT_CONFIGURED",
      400,
    );
  }

  assertAuthorisedSdsResource({
    configured: authorised,
    driveId: runtime.driveId,
    folderItemId: runtime.folderItemId,
  });

  const client = createMicrosoftGraphClient({
    tenantId: runtime.tenantId,
    clientId: runtime.clientId,
    clientSecret: runtime.clientSecret,
  });

  let children;
  try {
    children = await client.listFolderChildren(runtime.driveId, runtime.folderItemId, {
      pageSize: 200,
      maxItems: SHAREPOINT_SDS_MAX_FILES + 50,
    });
  } catch (err) {
    const message = publicMicrosoftErrorMessage(err);
    await prisma.sharePointSdsSettings.update({
      where: { id: SHAREPOINT_SDS_SETTINGS_ID },
      data: { lastScanError: message, lastScanAt: new Date() },
    });
    await recordAuditEvent({
      action: "catalogue.sharepoint_sds_scan_failed",
      entityType: "SharePointSdsSettings",
      entityId: SHAREPOINT_SDS_SETTINGS_ID,
      actorUserId,
      metadata: { error: message, driveId: runtime.driveId, folderItemId: runtime.folderItemId },
    });
    throw new AuthError(message, "SCAN_FAILED", 502);
  }

  const pdfItems = children.filter((c) => {
    if (c.folder || !c.file || !isPdfFilename(c.name ?? "")) return false;
    // Bound children to the authorised folder when Graph returns parentReference.
    if (c.parentReference?.driveId && c.parentReference.driveId !== authorised.driveId) {
      return false;
    }
    if (c.parentReference?.id && c.parentReference.id !== authorised.folderItemId) {
      return false;
    }
    return true;
  });
  if (pdfItems.length > SHAREPOINT_SDS_MAX_FILES) {
    throw new AuthError(
      `Folder has more than ${SHAREPOINT_SDS_MAX_FILES} PDFs — narrow the folder or contact engineering`,
      "TOO_MANY",
      400,
    );
  }

  const catalogue = await loadCatalogueMatchCandidates();
  type PreviewInput = {
    clientKey: string;
    filename: string;
    contentType: string;
    bytes: Buffer | null;
    downloadError?: string | null;
    sharepointItemId: string;
    sharepointEtag: string | null;
    sharepointLastModified: string | null;
  };
  const previewInputs: PreviewInput[] = [];

  for (let i = 0; i < pdfItems.length; i++) {
    const item = pdfItems[i]!;
    const clientKey = `sp-${item.id}`;
    try {
      assertSafeGraphResourceId(item.id, "item id");
      assertAuthorisedSdsResource({
        configured: authorised,
        driveId: runtime.driveId,
        folderItemId: runtime.folderItemId,
        itemParentFolderId: item.parentReference?.id ?? runtime.folderItemId,
      });
      const bytes = await client.downloadDriveItem(runtime.driveId, item.id);
      const validated = validateProductDocumentPdf({
        filename: item.name,
        contentType: item.file?.mimeType ?? "application/pdf",
        bytes,
      });
      if (!validated.ok) {
        previewInputs.push({
          clientKey,
          filename: item.name,
          contentType: item.file?.mimeType ?? "application/pdf",
          bytes: null,
          downloadError: validated.error,
          sharepointItemId: item.id,
          sharepointEtag: item.eTag ?? null,
          sharepointLastModified: item.lastModifiedDateTime ?? null,
        });
        continue;
      }
      previewInputs.push({
        clientKey,
        filename: validated.filename,
        contentType: validated.contentType,
        bytes,
        sharepointItemId: item.id,
        sharepointEtag: item.eTag ?? null,
        sharepointLastModified: item.lastModifiedDateTime ?? null,
      });
    } catch (err) {
      previewInputs.push({
        clientKey,
        filename: item.name,
        contentType: item.file?.mimeType ?? "application/pdf",
        bytes: null,
        downloadError: publicMicrosoftErrorMessage(err),
        sharepointItemId: item.id,
        sharepointEtag: item.eTag ?? null,
        sharepointLastModified: item.lastModifiedDateTime ?? null,
      });
    }
  }

  const previewItems = await buildSdsPreviewItems(previewInputs, catalogue);

  // SOURCE_MISSING — B2B CURRENT SDS from this folder whose Graph item disappeared.
  const remoteIds = new Set(pdfItems.map((p) => p.id));
  const currentSharepointDocs = await prisma.productDocument.findMany({
    where: { type: "SAFETY_DATA_SHEET", status: "CURRENT" },
    select: {
      id: true,
      productId: true,
      title: true,
      originalFilename: true,
      createdAt: true,
      sourceMetadata: true,
      product: {
        select: {
          name: true,
          variants: {
            where: { isDefault: true },
            take: 1,
            select: { sku: true },
          },
        },
      },
    },
  });

  const missingRows: BulkPreviewItem[] = [];
  for (const doc of currentSharepointDocs) {
    const meta = readSharePointSourceMetadata(doc.sourceMetadata);
    if (!meta) continue;
    if (meta.driveId !== runtime.driveId) continue;
    if (meta.folderItemId && meta.folderItemId !== runtime.folderItemId) continue;
    if (remoteIds.has(meta.itemId)) continue;
    missingRows.push({
      clientKey: `missing-${doc.id}`,
      filename: meta.filename || doc.originalFilename,
      sizeBytes: 0,
      checksumSha256: "",
      status: "SOURCE_MISSING",
      message:
        "SharePoint source file is missing — B2B SDS remains active until changed manually",
      productId: doc.productId,
      productName: doc.product.name,
      sku: doc.product.variants[0]?.sku ?? null,
      brandName: null,
      matchMethod: null,
      candidates: [],
      existingDocumentId: doc.id,
      existingSds: {
        id: doc.id,
        filename: doc.originalFilename,
        title: doc.title,
        uploadedAt: doc.createdAt.toISOString(),
      },
    });
  }

  const allItems = [...previewItems, ...missingRows];
  const summary = summarise(allItems);

  const session = await prisma.sharePointSdsScanSession.create({
    data: {
      status: "READY",
      createdByUserId: actorUserId,
      driveId: runtime.driveId,
      folderItemId: runtime.folderItemId,
      folderName: runtime.folderDisplayName,
      summaryJson: summary,
      items: {
        create: allItems.map((item) => {
          const src = previewInputs.find((p) => p.clientKey === item.clientKey);
          return {
            clientKey: item.clientKey,
            filename: item.filename,
            graphItemId: src?.sharepointItemId ?? null,
            graphEtag: src?.sharepointEtag ?? null,
            graphCtag: null,
            graphLastModified: src?.sharepointLastModified
              ? new Date(src.sharepointLastModified)
              : null,
            sizeBytes: item.sizeBytes,
            checksumSha256: item.checksumSha256,
            status: item.status,
            message: item.message,
            productId: item.productId,
            productName: item.productName,
            sku: item.sku,
            candidatesJson: item.candidates,
            existingDocumentId: item.existingDocumentId ?? null,
          };
        }),
      },
    },
  });

  await prisma.sharePointSdsSettings.update({
    where: { id: SHAREPOINT_SDS_SETTINGS_ID },
    data: {
      lastScanAt: new Date(),
      lastScanError: null,
      lastScanFileCount: summary.FILES_FOUND ?? 0,
    },
  });

  await recordAuditEvent({
    action: "catalogue.sharepoint_sds_scan",
    entityType: "SharePointSdsScanSession",
    entityId: session.id,
    actorUserId,
    metadata: {
      ...summary,
      driveId: runtime.driveId,
      folderItemId: runtime.folderItemId,
    },
  });

  return {
    sessionId: session.id,
    summary,
    settings: await toPublicSharePointSdsSettings(),
    page: await listSharePointScanPage(actorUserId, {
      sessionId: session.id,
      page: 1,
      pageSize: 50,
    }),
  };
}

export async function listSharePointScanPage(
  actorUserId: string,
  raw: { sessionId: string; page?: number; pageSize?: number; status?: string },
) {
  assertSharePointSdsWorkflowEnabled();
  await requireDocumentsManage(actorUserId);
  const sessionId = raw.sessionId;
  const page = Math.max(1, Number(raw.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(raw.pageSize) || 50));
  const status = raw.status?.trim() || "";

  const session = await prisma.sharePointSdsScanSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) throw new AuthError("Scan session not found", "NOT_FOUND", 404);

  const where = {
    sessionId,
    ...(status ? { status } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.sharePointSdsScanItem.count({ where }),
    prisma.sharePointSdsScanItem.findMany({
      where,
      orderBy: [{ status: "asc" }, { filename: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    sessionId,
    summary: (session.summaryJson as Record<string, number> | null) ?? {},
    folderName: session.folderName,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    items: rows.map((r) => ({
      id: r.id,
      clientKey: r.clientKey,
      filename: r.filename,
      status: r.status as BulkPreviewStatus,
      message: r.message,
      productId: r.productId,
      productName: r.productName,
      sku: r.sku,
      sizeBytes: r.sizeBytes,
      checksumSha256: r.checksumSha256,
      existingDocumentId: r.existingDocumentId,
      candidates: (r.candidatesJson as Array<{
        productId: string;
        name: string;
        sku: string;
      }> | null) ?? [],
      graphItemId: r.graphItemId,
    })),
  };
}

const confirmSchema = z.object({
  sessionId: z.string().min(1),
  items: z.array(
    z.object({
      clientKey: z.string().min(1),
      productId: z.string().min(1),
      action: z.enum(["IMPORT", "REPLACE", "SKIP"]),
    }),
  ),
});

export async function confirmSharePointSdsImport(actorUserId: string, raw: unknown) {
  assertSharePointSdsWorkflowEnabled();
  await requireDocumentsManage(actorUserId);
  const input = confirmSchema.parse(raw);
  const authorised = await loadAuthorisedSdsResource();
  const runtime = await loadSharePointRuntimeConfig();
  if (!authorised || !runtime?.driveId) {
    throw new AuthError("SharePoint is not configured", "NOT_CONFIGURED", 400);
  }

  const session = await prisma.sharePointSdsScanSession.findUnique({
    where: { id: input.sessionId },
    include: { items: true },
  });
  if (!session) throw new AuthError("Scan session not found", "NOT_FOUND", 404);

  // Session must target the currently authorised resource — reject substitution.
  try {
    assertAuthorisedSdsResource({
      configured: authorised,
      driveId: session.driveId,
      folderItemId: session.folderItemId,
    });
  } catch {
    throw new AuthError(
      "Scan session does not match the authorised SDS folder",
      "FORBIDDEN",
      403,
    );
  }

  const byKey = new Map(session.items.map((i) => [i.clientKey, i]));
  const client = createMicrosoftGraphClient({
    tenantId: runtime.tenantId,
    clientId: runtime.clientId,
    clientSecret: runtime.clientSecret,
  });

  const results: Array<{
    clientKey: string;
    filename: string;
    status: "IMPORTED" | "REPLACED" | "SKIPPED" | "FAILED";
    message: string;
    documentId?: string;
  }> = [];

  let imported = 0;
  let replaced = 0;
  let skipped = 0;
  let failed = 0;

  for (const sel of input.items) {
    const row = byKey.get(sel.clientKey);
    if (!row) {
      failed += 1;
      results.push({
        clientKey: sel.clientKey,
        filename: sel.clientKey,
        status: "FAILED",
        message: "Scan row not found",
      });
      continue;
    }
    if (
      row.status === "SOURCE_MISSING" ||
      row.status === "INVALID" ||
      row.status === "DOWNLOAD_FAILED" ||
      row.status === "ALREADY_ATTACHED"
    ) {
      skipped += 1;
      results.push({
        clientKey: sel.clientKey,
        filename: row.filename,
        status: "SKIPPED",
        message: `Skipped (${row.status})`,
      });
      continue;
    }
    if (sel.action === "SKIP") {
      skipped += 1;
      results.push({
        clientKey: sel.clientKey,
        filename: row.filename,
        status: "SKIPPED",
        message: "Skipped",
      });
      continue;
    }
    if (!row.graphItemId) {
      failed += 1;
      results.push({
        clientKey: sel.clientKey,
        filename: row.filename,
        status: "FAILED",
        message: "Missing SharePoint item id",
      });
      continue;
    }

    try {
      assertSafeGraphResourceId(row.graphItemId, "item id");
      // Downloads always use the authorised drive — never a client-supplied drive id.
      const bytes = await client.downloadDriveItem(authorised.driveId, row.graphItemId);
      const validated = validateProductDocumentPdf({
        filename: row.filename,
        contentType: "application/pdf",
        bytes,
      });
      if (!validated.ok) {
        throw new Error(validated.error);
      }
      const sourceMetadata = buildSharePointSourceMetadata({
        driveId: authorised.driveId,
        itemId: row.graphItemId,
        filename: validated.filename,
        lastModified: row.graphLastModified?.toISOString() ?? null,
        eTag: row.graphEtag,
        cTag: row.graphCtag,
        folderItemId: authorised.folderItemId,
      });

      const replaceExisting = sel.action === "REPLACE" || row.status === "UPDATED_SOURCE";
      // Explicit confirmation required — scan never auto-imports.
      const doc = await uploadProductDocument(actorUserId, {
        productId: sel.productId,
        type: "SAFETY_DATA_SHEET",
        filename: validated.filename,
        contentType: "application/pdf",
        base64: bytes.toString("base64"),
        replaceExisting,
        sourceMetadata,
      });

      // Force replaceExisting for UPDATED_SOURCE even if action is IMPORT
      if (sel.action === "REPLACE" || row.status === "UPDATED_SOURCE") {
        replaced += 1;
        results.push({
          clientKey: sel.clientKey,
          filename: row.filename,
          status: "REPLACED",
          message: "Imported from SharePoint (replaced previous)",
          documentId: doc.id,
        });
      } else {
        imported += 1;
        results.push({
          clientKey: sel.clientKey,
          filename: row.filename,
          status: "IMPORTED",
          message: "Imported from SharePoint",
          documentId: doc.id,
        });
      }

      await prisma.sharePointSdsScanItem.update({
        where: { id: row.id },
        data: {
          status: sel.action === "REPLACE" || row.status === "UPDATED_SOURCE"
            ? "REPLACED"
            : "IMPORTED",
          productId: sel.productId,
        },
      });
    } catch (err) {
      failed += 1;
      results.push({
        clientKey: sel.clientKey,
        filename: row.filename,
        status: "FAILED",
        message: err instanceof Error ? err.message : "Import failed",
      });
    }
  }

  await prisma.sharePointSdsScanSession.update({
    where: { id: session.id },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });

  await recordAuditEvent({
    action: "catalogue.sharepoint_document_import",
    entityType: "SharePointSdsScanSession",
    entityId: session.id,
    actorUserId,
    metadata: {
      source: SHAREPOINT_SDS_SOURCE,
      imported,
      replaced,
      skipped,
      failed,
      total: input.items.length,
    },
  });

  return { imported, replaced, skipped, failed, results };
}

/** Update a scan row's chosen product (REVIEW / NO_MATCH). */
export async function updateSharePointScanItemProduct(
  actorUserId: string,
  raw: { sessionId: string; clientKey: string; productId: string },
) {
  assertSharePointSdsWorkflowEnabled();
  await requireDocumentsManage(actorUserId);
  const product = await prisma.product.findUnique({
    where: { id: raw.productId },
    select: {
      id: true,
      name: true,
      variants: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        take: 1,
        select: { sku: true },
      },
      productDocuments: {
        where: { type: "SAFETY_DATA_SHEET", status: "CURRENT" },
        take: 1,
        select: { id: true, checksumSha256: true },
      },
    },
  });
  if (!product) throw new AuthError("Product not found", "NOT_FOUND", 404);

  const item = await prisma.sharePointSdsScanItem.findFirst({
    where: { sessionId: raw.sessionId, clientKey: raw.clientKey },
  });
  if (!item) throw new AuthError("Scan item not found", "NOT_FOUND", 404);

  let status = item.status;
  let message = item.message;
  if (status === "REVIEW" || status === "NO_MATCH") {
    const existing = product.productDocuments[0];
    if (existing) {
      if (existing.checksumSha256 && existing.checksumSha256 === item.checksumSha256) {
        status = "ALREADY_ATTACHED";
        message = "Exact PDF already attached";
      } else {
        status = "EXISTING_SDS";
        message = "Product already has a current SDS — choose Replace or Skip";
      }
    } else {
      status = "MATCHED";
      message = "Manually selected product";
    }
  }

  const updated = await prisma.sharePointSdsScanItem.update({
    where: { id: item.id },
    data: {
      productId: product.id,
      productName: product.name,
      sku: product.variants[0]?.sku ?? null,
      status,
      message,
      existingDocumentId: product.productDocuments[0]?.id ?? item.existingDocumentId,
    },
  });

  return {
    clientKey: updated.clientKey,
    productId: updated.productId,
    productName: updated.productName,
    sku: updated.sku,
    status: updated.status,
    message: updated.message,
  };
}

export async function getSharePointSdsImportStatus(actorUserId: string) {
  assertSharePointSdsWorkflowEnabled();
  await requireDocumentsManage(actorUserId);
  await getOrCreateSharePointSdsSettings();
  return toPublicSharePointSdsSettings();
}
