/**
 * SharePoint / OneDrive SDS source helpers — URL parsing, source metadata shape.
 * No secrets. Safe for unit tests without Graph network.
 */

export const SHAREPOINT_SDS_SOURCE = "SHAREPOINT" as const;

export type SharePointDocumentSourceMetadata = {
  source: typeof SHAREPOINT_SDS_SOURCE;
  driveId: string;
  itemId: string;
  filename: string;
  lastModified: string | null;
  eTag: string | null;
  cTag: string | null;
  folderItemId: string | null;
  importedAt: string;
};

export type ParsedSharePointFolderUrl = {
  /** e.g. george.parker@automotivebrands.co.uk */
  userPrincipalName: string | null;
  /** Path relative to the user's Documents / drive root */
  folderPath: string | null;
  /** Raw id query path if present */
  encodedIdPath: string | null;
};

/** Soft ceiling for one SharePoint SDS folder scan. */
export const SHAREPOINT_SDS_MAX_FILES = 500;

export const SHAREPOINT_PREVIEW_STATUSES = [
  "MATCHED",
  "REVIEW",
  "NO_MATCH",
  "ALREADY_ATTACHED",
  "EXISTING_SDS",
  "UPDATED_SOURCE",
  "SOURCE_MISSING",
  "INVALID",
  "DOWNLOAD_FAILED",
] as const;

export type SharePointPreviewStatus = (typeof SHAREPOINT_PREVIEW_STATUSES)[number];

/**
 * Parse a OneDrive/SharePoint browser folder URL into UPN + folder path hints.
 * Production sync must still resolve and store Graph drive/item IDs.
 */
/**
 * OneDrive personal segment encodes '.' and '@' as '_'.
 * e.g. george_parker_automotivebrands_co_uk → george.parker@automotivebrands.co.uk
 */
export function upnFromPersonalSegment(rawUser: string): string | null {
  const raw = rawUser.trim();
  if (!raw) return null;
  // Prefer multi-part public suffixes (.co.uk, .com.au, …)
  const multi = raw.match(/^(.*)_(.+_(?:co|com|org)_[a-z]{2,})$/i);
  if (multi) {
    return `${multi[1]!.replace(/_/g, ".")}@${multi[2]!.replace(/_/g, ".")}`;
  }
  const simple = raw.match(/^(.*)_(.+_(?:com|net|org|io|uk))$/i);
  if (simple) {
    return `${simple[1]!.replace(/_/g, ".")}@${simple[2]!.replace(/_/g, ".")}`;
  }
  const parts = raw.split("_");
  if (parts.length < 3) return null;
  const tld = parts[parts.length - 1]!;
  const domainSecond = parts[parts.length - 2]!;
  const local = parts.slice(0, -2).join(".");
  return `${local}@${domainSecond}.${tld}`;
}

export function parseSharePointFolderUrl(raw: string): ParsedSharePointFolderUrl {
  const empty: ParsedSharePointFolderUrl = {
    userPrincipalName: null,
    folderPath: null,
    encodedIdPath: null,
  };
  const trimmed = raw.trim();
  if (!trimmed) return empty;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return empty;
  }

  const idParam = url.searchParams.get("id");
  let encodedIdPath: string | null = idParam;
  let pathFromId: string | null = null;
  if (idParam) {
    try {
      pathFromId = decodeURIComponent(idParam);
    } catch {
      pathFromId = idParam;
    }
  }

  let userPrincipalName: string | null = null;
  const personalMatch =
    pathFromId?.match(/\/personal\/([^/]+)\//i) ??
    url.pathname.match(/\/personal\/([^/]+)\//i);
  if (personalMatch?.[1]) {
    userPrincipalName = upnFromPersonalSegment(personalMatch[1]);
  }

  let folderPath: string | null = null;
  if (pathFromId) {
    // Strip /personal/{user}/Documents/ prefix → drive-relative path
    const afterDocs = pathFromId.replace(/^\/personal\/[^/]+\/Documents\/?/i, "");
    folderPath = afterDocs.replace(/^\/+/, "").replace(/\/+$/, "") || null;
  }

  return { userPrincipalName, folderPath, encodedIdPath };
}

export function buildSharePointSourceMetadata(input: {
  driveId: string;
  itemId: string;
  filename: string;
  lastModified?: string | null;
  eTag?: string | null;
  cTag?: string | null;
  folderItemId?: string | null;
  importedAt?: Date;
}): SharePointDocumentSourceMetadata {
  return {
    source: SHAREPOINT_SDS_SOURCE,
    driveId: input.driveId,
    itemId: input.itemId,
    filename: input.filename,
    lastModified: input.lastModified ?? null,
    eTag: input.eTag ?? null,
    cTag: input.cTag ?? null,
    folderItemId: input.folderItemId ?? null,
    importedAt: (input.importedAt ?? new Date()).toISOString(),
  };
}

export function readSharePointSourceMetadata(
  raw: unknown,
): SharePointDocumentSourceMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o["source"] !== SHAREPOINT_SDS_SOURCE) return null;
  if (typeof o["driveId"] !== "string" || typeof o["itemId"] !== "string") return null;
  return {
    source: SHAREPOINT_SDS_SOURCE,
    driveId: o["driveId"],
    itemId: o["itemId"],
    filename: typeof o["filename"] === "string" ? o["filename"] : "",
    lastModified: typeof o["lastModified"] === "string" ? o["lastModified"] : null,
    eTag: typeof o["eTag"] === "string" ? o["eTag"] : null,
    cTag: typeof o["cTag"] === "string" ? o["cTag"] : null,
    folderItemId: typeof o["folderItemId"] === "string" ? o["folderItemId"] : null,
    importedAt: typeof o["importedAt"] === "string" ? o["importedAt"] : "",
  };
}

export function isPdfFilename(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

/** Sanitise Graph/API errors for admin UI — never leak tokens. */
export function publicMicrosoftErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  if (lower.includes("invalid_client") || lower.includes("aadb2c") || lower.includes("unauthorized")) {
    return "Authentication failed — check tenant ID, client ID and client secret";
  }
  if (lower.includes("accessdenied") || lower.includes("forbidden") || lower.includes("403")) {
    return "Permission denied — grant Files.Read.All (application) admin consent";
  }
  if (lower.includes("itemnotfound") || lower.includes("404") || lower.includes("not found")) {
    return "Folder not found — resolve the SharePoint folder again";
  }
  if (lower.includes("token")) {
    return "Authentication failed — could not obtain a Microsoft Graph token";
  }
  // Strip anything that looks like a bearer/token fragment
  return msg.replace(/Bearer\s+\S+/gi, "[redacted]").replace(/v1:[A-Za-z0-9+/=:_-]+/g, "[redacted]").slice(0, 240);
}
