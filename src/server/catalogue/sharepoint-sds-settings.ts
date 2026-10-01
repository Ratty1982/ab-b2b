/**
 * SharePoint SDS source settings — encrypted client secret, stable Graph IDs.
 * Configuration mutations require integrations.sharepoint.manage.
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
import {
  assertAuthorisedSdsResource,
  assertSafeGraphResourceId,
  isAllowedSharePointFolderUrl,
  isValidEntraGuid,
} from "@/domain/microsoft-graph-security";
import { createMicrosoftGraphClient } from "@/server/integrations/microsoft-graph";
import {
  requireDocumentsView,
  requireSharePointIntegrationManage,
} from "@/server/catalogue/product-documents";
import { getServerEnv } from "@/server/env";

export const SHAREPOINT_SDS_SETTINGS_ID = "singleton";

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v || null;
}

function isProduction(): boolean {
  try {
    return getServerEnv().NODE_ENV === "production";
  } catch {
    return process.env["NODE_ENV"] === "production";
  }
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
  /** True when a secret is available — never the secret value. */
  hasClientSecret: boolean;
  /** True when Coolify/env secret is the source of truth. */
  secretFromEnv: boolean;
  /** Production recommendation flag for operators. */
  preferEnvSecret: boolean;
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
  recommendedPermission: "Files.SelectedOperations.Selected";
};

function resolveClientSecret(encrypted: string | null | undefined): string | null {
  // Environment secret is always authoritative when present (production preference).
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
    preferEnvSecret: true,
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
    recommendedPermission: "Files.SelectedOperations.Selected",
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
  /** Write-only — empty preserves existing. Never returned. */
  clientSecret: z.string().max(500).optional(),
  userPrincipalName: z.string().trim().email().max(320).optional().nullable(),
  /** Manual bootstrap of stable IDs for least-privilege cutover (no getUserDrive). */
  driveId: z.string().trim().max(256).optional().nullable(),
  folderItemId: z.string().trim().max(256).optional().nullable(),
});

export async function updateSharePointSdsSettings(actorUserId: string, raw: unknown) {
  await requireSharePointIntegrationManage(actorUserId);
  const input = updateSchema.parse(raw ?? {});
  const row = await getOrCreateSharePointSdsSettings();

  if (input.folderUrlHint != null && input.folderUrlHint.trim()) {
    if (!isAllowedSharePointFolderUrl(input.folderUrlHint)) {
      throw new AuthError(
        "Folder URL must be an https://*.sharepoint.com OneDrive/SharePoint link",
        "VALIDATION",
        400,
      );
    }
  }

  if (input.tenantId != null && input.tenantId.trim()) {
    const tid = input.tenantId.trim();
    if (!isValidEntraGuid(tid) && !/^[A-Za-z0-9._-]{1,80}$/.test(tid)) {
      throw new AuthError("Invalid tenant ID", "VALIDATION", 400);
    }
  }
  if (input.clientId != null && input.clientId.trim()) {
    if (!isValidEntraGuid(input.clientId)) {
      throw new AuthError("Client ID must be a valid Entra application (GUID)", "VALIDATION", 400);
    }
  }
  if (input.driveId != null && input.driveId.trim()) {
    assertSafeGraphResourceId(input.driveId, "drive id");
  }
  if (input.folderItemId != null && input.folderItemId.trim()) {
    assertSafeGraphResourceId(input.folderItemId, "folder id");
  }

  const envSecretPresent = Boolean(env("MICROSOFT_GRAPH_CLIENT_SECRET"));
  let clientSecretEncrypted = row.clientSecretEncrypted;
  let credentialReplaced = false;
  if (input.clientSecret && input.clientSecret.trim()) {
    if (envSecretPresent && isProduction()) {
      // Env is authoritative in production — ignore DB write of secret.
      clientSecretEncrypted = row.clientSecretEncrypted;
    } else {
      clientSecretEncrypted = encryptSecret(input.clientSecret.trim());
      credentialReplaced = true;
    }
  }

  const prevEnabled = row.enabled;
  const updated = await prisma.sharePointSdsSettings.update({
    where: { id: SHAREPOINT_SDS_SETTINGS_ID },
    data: {
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.sourceLabel !== undefined ? { sourceLabel: input.sourceLabel } : {}),
      ...(input.folderDisplayName !== undefined
        ? { folderDisplayName: input.folderDisplayName }
        : {}),
      ...(input.folderUrlHint !== undefined ? { folderUrlHint: input.folderUrlHint } : {}),
      ...(input.tenantId !== undefined
        ? { tenantId: env("MICROSOFT_GRAPH_TENANT_ID") ? row.tenantId : input.tenantId }
        : {}),
      ...(input.clientId !== undefined
        ? { clientId: env("MICROSOFT_GRAPH_CLIENT_ID") ? row.clientId : input.clientId }
        : {}),
      ...(input.userPrincipalName !== undefined
        ? { userPrincipalName: input.userPrincipalName }
        : {}),
      ...(input.driveId !== undefined
        ? { driveId: input.driveId?.trim() || null }
        : {}),
      ...(input.folderItemId !== undefined
        ? { folderItemId: input.folderItemId?.trim() || null }
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
      enabledChanged: input.enabled !== undefined && input.enabled !== prevEnabled,
      credentialReplaced,
      secretFromEnv: envSecretPresent,
      folderResolved: Boolean(updated.driveId && updated.folderItemId),
      driveId: updated.driveId,
      folderItemId: updated.folderItemId,
      sourceLabel: updated.sourceLabel,
      // never: clientSecret, tokens
    },
  });

  if (input.enabled !== undefined && input.enabled !== prevEnabled) {
    await recordAuditEvent({
      action: input.enabled
        ? "catalogue.sharepoint_sds_integration_enabled"
        : "catalogue.sharepoint_sds_integration_disabled",
      entityType: "SharePointSdsSettings",
      entityId: updated.id,
      actorUserId,
      metadata: { sourceLabel: updated.sourceLabel },
    });
  }

  if (credentialReplaced) {
    await recordAuditEvent({
      action: "catalogue.sharepoint_sds_credential_configured",
      entityType: "SharePointSdsSettings",
      entityId: updated.id,
      actorUserId,
      metadata: { storage: "encrypted_db", secretFromEnv: false },
    });
  }

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

/** Authorised SDS resource bound for scan/download allowlisting. */
export async function loadAuthorisedSdsResource(): Promise<{
  tenantId: string;
  driveId: string;
  folderItemId: string;
} | null> {
  const runtime = await loadSharePointRuntimeConfig();
  if (!runtime?.driveId || !runtime.folderItemId) return null;
  return {
    tenantId: runtime.tenantId,
    driveId: assertSafeGraphResourceId(runtime.driveId, "drive id"),
    folderItemId: assertSafeGraphResourceId(runtime.folderItemId, "folder id"),
  };
}

/**
 * Resolve drive + folder item IDs from UPN + path, or validate manually stored IDs.
 * With Files.SelectedOperations.Selected, prefer pasting driveId + folderItemId
 * (getUserDrive may fail without broader consent used only for bootstrap).
 */
export async function resolveSharePointSdsFolder(actorUserId: string) {
  await requireSharePointIntegrationManage(actorUserId);
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
    if (!isAllowedSharePointFolderUrl(hint)) {
      throw new AuthError(
        "Folder URL must be an https://*.sharepoint.com OneDrive/SharePoint link",
        "VALIDATION",
        400,
      );
    }
    const parsed = parseSharePointFolderUrl(hint);
    if (parsed.userPrincipalName) upn = parsed.userPrincipalName;
    if (parsed.folderPath) folderPath = parsed.folderPath;
  }

  const client = createMicrosoftGraphClient({
    tenantId: runtime.tenantId,
    clientId: runtime.clientId,
    clientSecret: runtime.clientSecret,
  });

  try {
    let driveId = runtime.driveId;
    let folderItemId = runtime.folderItemId;
    let folderName = row.folderDisplayName;

    // Least-privilege path: stable IDs already stored — verify only.
    if (driveId && folderItemId && !folderPath) {
      const item = await client.getDriveItem(driveId, folderItemId);
      if (!item.folder) {
        throw new AuthError("Configured item is not a folder", "VALIDATION", 400);
      }
      folderName = item.name || folderName;
    } else {
      // Bootstrap via UPN + path (may require temporary broader Graph access).
      if (!upn) {
        throw new AuthError(
          "User principal name required, or paste drive ID + folder item ID for least-privilege setup",
          "VALIDATION",
          400,
        );
      }
      if (!folderPath && !folderItemId) {
        throw new AuthError(
          "Provide a SharePoint folder URL/path or paste a folder item ID",
          "VALIDATION",
          400,
        );
      }

      if (!driveId) {
        const drive = await client.getUserDrive(upn);
        driveId = drive.id;
      }
      driveId = assertSafeGraphResourceId(driveId, "drive id");

      if (folderPath) {
        const item = await client.getDriveItemByPath(driveId, folderPath);
        if (!item.folder) {
          throw new AuthError("Resolved path is not a folder", "VALIDATION", 400);
        }
        folderItemId = item.id;
        folderName = item.name || folderName;
      } else if (folderItemId) {
        const item = await client.getDriveItem(driveId, folderItemId);
        if (!item.folder) {
          throw new AuthError("Configured item is not a folder", "VALIDATION", 400);
        }
        folderName = item.name || folderName;
      }
    }

    if (!driveId || !folderItemId) {
      throw new AuthError("Folder not found", "NOT_FOUND", 404);
    }

    await prisma.sharePointSdsSettings.update({
      where: { id: SHAREPOINT_SDS_SETTINGS_ID },
      data: {
        userPrincipalName: upn,
        driveId,
        folderItemId,
        folderDisplayName: folderName,
        lastConnectionTestAt: new Date(),
        lastConnectionTestOk: true,
        lastConnectionTestError: null,
        updatedByUserId: actorUserId,
      },
    });

    await recordAuditEvent({
      action: "catalogue.sharepoint_sds_folder_resolved",
      entityType: "SharePointSdsSettings",
      entityId: SHAREPOINT_SDS_SETTINGS_ID,
      actorUserId,
      metadata: {
        driveId,
        folderItemId,
        folderName,
        upn: upn ?? null,
      },
    });

    return toPublicSharePointSdsSettings();
  } catch (err) {
    if (err instanceof AuthError) throw err;
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
  await requireSharePointIntegrationManage(actorUserId);
  const runtime = await loadSharePointRuntimeConfig();
  if (!runtime) {
    throw new AuthError("Microsoft Graph is not configured", "NOT_CONFIGURED", 400);
  }
  if (!runtime.driveId || !runtime.folderItemId) {
    if (runtime.folderUrlHint || runtime.userPrincipalName) {
      return resolveSharePointSdsFolder(actorUserId);
    }
    throw new AuthError(
      "Folder not resolved — paste drive/folder IDs or resolve from a folder URL",
      "NOT_CONFIGURED",
      400,
    );
  }

  assertAuthorisedSdsResource({
    configured: {
      tenantId: runtime.tenantId,
      driveId: runtime.driveId,
      folderItemId: runtime.folderItemId,
    },
    driveId: runtime.driveId,
    folderItemId: runtime.folderItemId,
  });

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
      metadata: {
        ok: true,
        folderName: folder.name,
        driveId: runtime.driveId,
        folderItemId: runtime.folderItemId,
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
