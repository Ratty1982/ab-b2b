/**
 * SharePoint SDS source settings — encrypted client secret, stable Graph IDs.
 */
import { z } from "zod";
import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";
import { recordAuditEvent } from "@/server/audit/record";
import { encryptSecret, decryptSecret } from "@/server/crypto/secret";
import {
  parseSharePointFolderUrl,
  publicMicrosoftErrorMessage,
} from "@/domain/sharepoint-sds";
import { createMicrosoftGraphClient } from "@/server/integrations/microsoft-graph";
import {
  requireDocumentsManage,
  requireDocumentsView,
} from "@/server/catalogue/product-documents";

export const SHAREPOINT_SDS_SETTINGS_ID = "singleton";

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v || null;
}

export async function getOrCreateSharePointSdsSettings() {
  return prisma.sharePointSdsSettings.upsert({
    where: { id: SHAREPOINT_SDS_SETTINGS_ID },
    create: { id: SHAREPOINT_SDS_SETTINGS_ID },
    update: {},
  });
}

export type SharePointSdsPublicSettings = {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  sourceLabel: string;
  folderDisplayName: string;
  folderUrlHint: string | null;
  tenantId: string | null;
  clientId: string | null;
  hasClientSecret: boolean;
  secretFromEnv: boolean;
  userPrincipalName: string | null;
  driveId: string | null;
  folderItemId: string | null;
  folderResolved: boolean;
  lastConnectionTestAt: string | null;
  lastConnectionTestOk: boolean | null;
  lastConnectionTestError: string | null;
  lastScanAt: string | null;
  lastScanError: string | null;
  lastScanFileCount: number | null;
};

function resolveClientSecret(encrypted: string | null | undefined): string | null {
  return env("MICROSOFT_GRAPH_CLIENT_SECRET") ?? decryptSecret(encrypted);
}

export async function toPublicSharePointSdsSettings(): Promise<SharePointSdsPublicSettings> {
  const row = await getOrCreateSharePointSdsSettings();
  const tenantId = env("MICROSOFT_GRAPH_TENANT_ID") ?? row.tenantId;
  const clientId = env("MICROSOFT_GRAPH_CLIENT_ID") ?? row.clientId;
  const secret = resolveClientSecret(row.clientSecretEncrypted);
  const driveId = row.driveId;
  const folderItemId = row.folderItemId;
  const folderResolved = Boolean(driveId && folderItemId);
  const configured = Boolean(tenantId && clientId && secret);
  return {
    enabled: row.enabled,
    configured,
    connected: Boolean(configured && folderResolved && row.lastConnectionTestOk),
    sourceLabel: row.sourceLabel,
    folderDisplayName: row.folderDisplayName,
    folderUrlHint: row.folderUrlHint,
    tenantId,
    clientId,
    hasClientSecret: Boolean(secret),
    secretFromEnv: Boolean(env("MICROSOFT_GRAPH_CLIENT_SECRET")),
    userPrincipalName: row.userPrincipalName,
    driveId,
    folderItemId,
    folderResolved,
    lastConnectionTestAt: row.lastConnectionTestAt?.toISOString() ?? null,
    lastConnectionTestOk: row.lastConnectionTestOk,
    lastConnectionTestError: row.lastConnectionTestError,
    lastScanAt: row.lastScanAt?.toISOString() ?? null,
    lastScanError: row.lastScanError,
    lastScanFileCount: row.lastScanFileCount,
  };
}

export async function getSharePointSdsSettingsForActor(actorUserId: string) {
  await requireDocumentsView(actorUserId);
  return toPublicSharePointSdsSettings();
}

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  sourceLabel: z.string().trim().min(1).max(120).optional(),
  folderDisplayName: z.string().trim().min(1).max(200).optional(),
  folderUrlHint: z.string().trim().max(2000).optional().nullable(),
  tenantId: z.string().trim().max(80).optional().nullable(),
  clientId: z.string().trim().max(80).optional().nullable(),
  /** Write-only — empty preserves existing. */
  clientSecret: z.string().max(500).optional(),
  userPrincipalName: z.string().trim().email().optional().nullable(),
});

export async function updateSharePointSdsSettings(actorUserId: string, raw: unknown) {
  await requireDocumentsManage(actorUserId);
  const input = updateSchema.parse(raw ?? {});
  const row = await getOrCreateSharePointSdsSettings();

  let clientSecretEncrypted = row.clientSecretEncrypted;
  if (input.clientSecret && input.clientSecret.trim()) {
    clientSecretEncrypted = encryptSecret(input.clientSecret.trim());
  }

  const updated = await prisma.sharePointSdsSettings.update({
    where: { id: SHAREPOINT_SDS_SETTINGS_ID },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.sourceLabel !== undefined ? { sourceLabel: input.sourceLabel } : {}),
      ...(input.folderDisplayName !== undefined
        ? { folderDisplayName: input.folderDisplayName }
        : {}),
      ...(input.folderUrlHint !== undefined ? { folderUrlHint: input.folderUrlHint } : {}),
      ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
      ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
      ...(input.userPrincipalName !== undefined
        ? { userPrincipalName: input.userPrincipalName }
        : {}),
      clientSecretEncrypted,
      updatedByUserId: actorUserId,
    },
  });

  await recordAuditEvent({
    action: "catalogue.sharepoint_sds_settings_updated",
    entityType: "SharePointSdsSettings",
    entityId: updated.id,
    actorUserId,
    metadata: {
      enabled: updated.enabled,
      hasSecret: Boolean(clientSecretEncrypted || env("MICROSOFT_GRAPH_CLIENT_SECRET")),
      folderResolved: Boolean(updated.driveId && updated.folderItemId),
    },
  });

  return toPublicSharePointSdsSettings();
}

export type SharePointRuntimeConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  userPrincipalName: string | null;
  driveId: string | null;
  folderItemId: string | null;
  folderDisplayName: string;
  folderUrlHint: string | null;
  sourceLabel: string;
};

export async function loadSharePointRuntimeConfig(): Promise<SharePointRuntimeConfig | null> {
  const row = await getOrCreateSharePointSdsSettings();
  const tenantId = env("MICROSOFT_GRAPH_TENANT_ID") ?? row.tenantId;
  const clientId = env("MICROSOFT_GRAPH_CLIENT_ID") ?? row.clientId;
  const clientSecret = resolveClientSecret(row.clientSecretEncrypted);
  if (!tenantId || !clientId || !clientSecret) return null;
  return {
    tenantId,
    clientId,
    clientSecret,
    userPrincipalName: row.userPrincipalName,
    driveId: row.driveId,
    folderItemId: row.folderItemId,
    folderDisplayName: row.folderDisplayName,
    folderUrlHint: row.folderUrlHint,
    sourceLabel: row.sourceLabel,
  };
}

/** Resolve drive + folder item IDs from UPN + path or URL hint; persist them. */
export async function resolveSharePointSdsFolder(actorUserId: string) {
  await requireDocumentsManage(actorUserId);
  const runtime = await loadSharePointRuntimeConfig();
  if (!runtime) {
    throw new AuthError(
      "Microsoft Graph is not configured — set tenant ID, client ID and client secret",
      "NOT_CONFIGURED",
      400,
    );
  }

  const row = await getOrCreateSharePointSdsSettings();
  let upn = runtime.userPrincipalName;
  let folderPath: string | null = null;

  const hint = runtime.folderUrlHint?.trim();
  if (hint) {
    const parsed = parseSharePointFolderUrl(hint);
    if (parsed.userPrincipalName) upn = parsed.userPrincipalName;
    if (parsed.folderPath) folderPath = parsed.folderPath;
  }

  if (!upn) {
    throw new AuthError(
      "User principal name required (e.g. george.parker@automotivebrands.co.uk)",
      "VALIDATION",
      400,
    );
  }
  if (!folderPath && !runtime.folderItemId) {
    throw new AuthError(
      "Provide a SharePoint folder URL or resolve a folder path",
      "VALIDATION",
      400,
    );
  }

  const client = createMicrosoftGraphClient({
    tenantId: runtime.tenantId,
    clientId: runtime.clientId,
    clientSecret: runtime.clientSecret,
  });

  try {
    const drive = await client.getUserDrive(upn);
    let folderItemId = runtime.folderItemId;
    let folderName = row.folderDisplayName;

    if (folderPath) {
      const item = await client.getDriveItemByPath(drive.id, folderPath);
      if (!item.folder) {
        throw new AuthError("Resolved path is not a folder", "VALIDATION", 400);
      }
      folderItemId = item.id;
      folderName = item.name || folderName;
    } else if (folderItemId) {
      const item = await client.getDriveItem(drive.id, folderItemId);
      folderName = item.name || folderName;
    }

    if (!folderItemId) {
      throw new AuthError("Folder not found", "NOT_FOUND", 404);
    }

    await prisma.sharePointSdsSettings.update({
      where: { id: SHAREPOINT_SDS_SETTINGS_ID },
      data: {
        userPrincipalName: upn,
        driveId: drive.id,
        folderItemId,
        folderDisplayName: folderName,
        lastConnectionTestAt: new Date(),
        lastConnectionTestOk: true,
        lastConnectionTestError: null,
        updatedByUserId: actorUserId,
      },
    });

    return toPublicSharePointSdsSettings();
  } catch (err) {
    const message = publicMicrosoftErrorMessage(err);
    await prisma.sharePointSdsSettings.update({
      where: { id: SHAREPOINT_SDS_SETTINGS_ID },
      data: {
        lastConnectionTestAt: new Date(),
        lastConnectionTestOk: false,
        lastConnectionTestError: message,
        updatedByUserId: actorUserId,
      },
    });
    throw new AuthError(message, "CONNECTION_FAILED", 502);
  }
}

export async function testSharePointSdsConnection(actorUserId: string) {
  await requireDocumentsManage(actorUserId);
  const runtime = await loadSharePointRuntimeConfig();
  if (!runtime) {
    throw new AuthError("Microsoft Graph is not configured", "NOT_CONFIGURED", 400);
  }
  if (!runtime.driveId || !runtime.folderItemId) {
    // Attempt resolve first if URL hint present
    if (runtime.folderUrlHint || runtime.userPrincipalName) {
      return resolveSharePointSdsFolder(actorUserId);
    }
    throw new AuthError(
      "Folder not resolved — save a folder URL and click Resolve folder",
      "NOT_CONFIGURED",
      400,
    );
  }

  const client = createMicrosoftGraphClient({
    tenantId: runtime.tenantId,
    clientId: runtime.clientId,
    clientSecret: runtime.clientSecret,
  });

  try {
    const folder = await client.getDriveItem(runtime.driveId, runtime.folderItemId);
    if (!folder.folder) {
      throw new Error("Configured item is not a folder");
    }
    // List one page to prove children access
    await client.listFolderChildren(runtime.driveId, runtime.folderItemId, {
      pageSize: 1,
      maxItems: 1,
    });

    await prisma.sharePointSdsSettings.update({
      where: { id: SHAREPOINT_SDS_SETTINGS_ID },
      data: {
        folderDisplayName: folder.name || runtime.folderDisplayName,
        lastConnectionTestAt: new Date(),
        lastConnectionTestOk: true,
        lastConnectionTestError: null,
        updatedByUserId: actorUserId,
      },
    });

    await recordAuditEvent({
      action: "catalogue.sharepoint_sds_connection_tested",
      entityType: "SharePointSdsSettings",
      entityId: SHAREPOINT_SDS_SETTINGS_ID,
      actorUserId,
      metadata: { ok: true, folderName: folder.name },
    });

    return toPublicSharePointSdsSettings();
  } catch (err) {
    const message = publicMicrosoftErrorMessage(err);
    await prisma.sharePointSdsSettings.update({
      where: { id: SHAREPOINT_SDS_SETTINGS_ID },
      data: {
        lastConnectionTestAt: new Date(),
        lastConnectionTestOk: false,
        lastConnectionTestError: message,
        updatedByUserId: actorUserId,
      },
    });
    await recordAuditEvent({
      action: "catalogue.sharepoint_sds_connection_tested",
      entityType: "SharePointSdsSettings",
      entityId: SHAREPOINT_SDS_SETTINGS_ID,
      actorUserId,
      metadata: { ok: false, error: message },
    });
    throw new AuthError(message, "CONNECTION_FAILED", 502);
  }
}
