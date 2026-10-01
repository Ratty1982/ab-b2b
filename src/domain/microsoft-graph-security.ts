/**
 * Microsoft Graph security helpers — fixed hosts, ID validation, resource allowlists.
 * Pure functions; safe for unit tests without network.
 */

/** Only these hosts may be contacted by the Graph client. */
export const MICROSOFT_GRAPH_API_HOST = "graph.microsoft.com";
export const MICROSOFT_LOGIN_HOST = "login.microsoftonline.com";

/**
 * Recommended production application permission for SDS folder read.
 * Consent alone grants zero access — a folder-level resource grant is required.
 */
export const RECOMMENDED_GRAPH_APPLICATION_PERMISSION =
  "Files.SelectedOperations.Selected" as const;

/** Role assigned on the authorised driveItem (folder). */
export const RECOMMENDED_GRAPH_RESOURCE_ROLE = "read" as const;

/** Previous broad permission — do not request for new consent. */
export const LEGACY_GRAPH_APPLICATION_PERMISSION = "Files.Read.All" as const;

/** Allowed hosts for operator-pasted OneDrive/SharePoint folder URLs (no open SSRF). */
export const ALLOWED_SHAREPOINT_FOLDER_URL_HOST_SUFFIXES = [
  ".sharepoint.com",
  "-my.sharepoint.com",
] as const;

const GRAPH_ID_RE = /^[A-Za-z0-9!@._\-{}()]+$/;

/** Reject path traversal / oversized / clearly malformed Graph resource IDs. */
export function isSafeGraphResourceId(value: string | null | undefined): boolean {
  if (value == null) return false;
  const v = value.trim();
  if (!v || v.length > 256) return false;
  if (v.includes("..") || v.includes("/") || v.includes("\\") || v.includes("\0")) return false;
  return GRAPH_ID_RE.test(v);
}

export function assertSafeGraphResourceId(
  value: string,
  label = "Graph resource id",
): string {
  const trimmed = value.trim();
  if (!isSafeGraphResourceId(trimmed)) {
    throw new Error(`Invalid ${label}`);
  }
  return trimmed;
}

/**
 * Resolve a Graph request URL: relative paths become graph.microsoft.com/v1.0/…
 * Absolute URLs (pagination nextLink) are accepted only for the Graph API host over HTTPS.
 */
export function resolveMicrosoftGraphUrl(pathOrUrl: string): string {
  const raw = pathOrUrl.trim();
  if (!raw) throw new Error("Empty Graph path");
  if (raw.includes("\0") || raw.includes("..")) {
    throw new Error("Invalid Graph path");
  }

  if (raw.startsWith("https://") || raw.startsWith("http://")) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("Invalid Graph URL");
    }
    if (url.protocol !== "https:") {
      throw new Error("Graph URL must use HTTPS");
    }
    if (url.hostname !== MICROSOFT_GRAPH_API_HOST) {
      throw new Error("Graph URL host is not allowed");
    }
    return url.toString();
  }

  const path = raw.startsWith("/") ? raw : `/${raw}`;
  return `https://${MICROSOFT_GRAPH_API_HOST}/v1.0${path}`;
}

export function resolveMicrosoftTokenUrl(tenantId: string): string {
  const tid = tenantId.trim();
  if (!tid || tid.length > 80 || tid.includes("/") || tid.includes("..") || tid.includes("\\")) {
    throw new Error("Invalid tenant id");
  }
  return `https://${MICROSOFT_LOGIN_HOST}/${encodeURIComponent(tid)}/oauth2/v2.0/token`;
}

/** Validate operator-supplied folder URL — SharePoint/OneDrive hosts only. */
export function isAllowedSharePointFolderUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_SHAREPOINT_FOLDER_URL_HOST_SUFFIXES.some(
    (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
  );
}

export type AuthorisedSdsResource = {
  tenantId: string;
  driveId: string;
  folderItemId: string;
};

/** Every scan/download must target the persisted authorised resource. */
export function assertAuthorisedSdsResource(input: {
  configured: AuthorisedSdsResource;
  driveId: string;
  folderItemId?: string | null;
  itemParentFolderId?: string | null;
}): void {
  const driveId = assertSafeGraphResourceId(input.driveId, "drive id");
  const configuredDrive = assertSafeGraphResourceId(input.configured.driveId, "configured drive id");
  if (driveId !== configuredDrive) {
    throw new Error("Drive is outside the authorised SDS resource");
  }
  if (input.folderItemId) {
    const folderId = assertSafeGraphResourceId(input.folderItemId, "folder id");
    const configuredFolder = assertSafeGraphResourceId(
      input.configured.folderItemId,
      "configured folder id",
    );
    if (folderId !== configuredFolder) {
      throw new Error("Folder is outside the authorised SDS resource");
    }
  }
  if (input.itemParentFolderId) {
    const parent = assertSafeGraphResourceId(input.itemParentFolderId, "parent folder id");
    const configuredFolder = assertSafeGraphResourceId(
      input.configured.folderItemId,
      "configured folder id",
    );
    if (parent !== configuredFolder) {
      throw new Error("File is outside the authorised SDS folder");
    }
  }
}

export function isValidEntraGuid(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}
