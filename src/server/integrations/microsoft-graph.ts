/**
 * Minimal Microsoft Graph client (client-credentials) — READ-ONLY SDS operations.
 *
 * Exposes ONLY:
 * - getUserDrive (bootstrap resolve; may require broader Entra consent during cutover)
 * - getDriveItemByPath / getDriveItem
 * - listFolderChildren
 * - downloadDriveItem
 *
 * No generic Graph proxy. No arbitrary browser-supplied URLs.
 * No write / update / delete methods.
 * Server-only — never import from client bundles.
 */
import { publicMicrosoftErrorMessage } from "@/domain/sharepoint-sds";
import {
  assertSafeGraphResourceId,
  resolveMicrosoftGraphUrl,
  resolveMicrosoftTokenUrl,
} from "@/domain/microsoft-graph-security";

export type GraphDriveItem = {
  id: string;
  name: string;
  size?: number;
  eTag?: string | null;
  cTag?: string | null;
  lastModifiedDateTime?: string | null;
  webUrl?: string | null;
  parentReference?: { id?: string | null; driveId?: string | null } | null;
  file?: { mimeType?: string } | null;
  folder?: Record<string, unknown> | null;
};

export type GraphClientConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

export type GraphFetch = typeof fetch;

type TokenCache = { accessToken: string; expiresAtMs: number };

export class MicrosoftGraphError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 502, code = "GRAPH_ERROR") {
    super(message);
    this.name = "MicrosoftGraphError";
    this.status = status;
    this.code = code;
  }
}

export function createMicrosoftGraphClient(
  config: GraphClientConfig,
  fetchImpl: GraphFetch = fetch,
) {
  let cache: TokenCache | null = null;

  async function getAccessToken(): Promise<string> {
    const now = Date.now();
    if (cache && cache.expiresAtMs > now + 60_000) return cache.accessToken;

    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });
    const tokenUrl = resolveMicrosoftTokenUrl(config.tenantId);
    const res = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      const combined = [json.error, json.error_description, `Token HTTP ${res.status}`]
        .filter(Boolean)
        .join(": ");
      throw new MicrosoftGraphError(
        publicMicrosoftErrorMessage(new Error(combined)),
        res.status === 401 || res.status === 400 ? 401 : 502,
        "AUTH_FAILED",
      );
    }
    cache = {
      accessToken: json.access_token,
      expiresAtMs: now + Math.max(60, Number(json.expires_in) || 3600) * 1000,
    };
    return cache.accessToken;
  }

  async function graphGetJson<T>(pathOrUrl: string): Promise<T> {
    const token = await getAccessToken();
    const url = resolveMicrosoftGraphUrl(pathOrUrl);
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      const message = errBody.error?.message || `Graph HTTP ${res.status}`;
      throw new MicrosoftGraphError(
        publicMicrosoftErrorMessage(new Error(message)),
        res.status,
        errBody.error?.code || "GRAPH_HTTP",
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async function graphGetBytes(pathOrUrl: string): Promise<Buffer> {
    const token = await getAccessToken();
    const url = resolveMicrosoftGraphUrl(pathOrUrl);
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new MicrosoftGraphError(
        publicMicrosoftErrorMessage(new Error(`Download failed (HTTP ${res.status})`)),
        res.status,
        "DOWNLOAD_FAILED",
      );
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  async function getUserDrive(userPrincipalName: string): Promise<{ id: string; name?: string }> {
    const upn = userPrincipalName.trim();
    if (!upn || upn.length > 320 || upn.includes("/") || upn.includes("..")) {
      throw new MicrosoftGraphError("Invalid user principal name", 400, "VALIDATION");
    }
    return graphGetJson(`/users/${encodeURIComponent(upn)}/drive`);
  }

  async function getDriveItemByPath(
    driveId: string,
    folderPath: string,
  ): Promise<GraphDriveItem> {
    const safeDrive = assertSafeGraphResourceId(driveId, "drive id");
    const clean = folderPath.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!clean || clean.includes("..") || clean.length > 1000) {
      throw new MicrosoftGraphError("Invalid folder path", 400, "VALIDATION");
    }
    const encoded = clean
      .split("/")
      .map((p) => encodeURIComponent(p))
      .join("/");
    return graphGetJson(`/drives/${encodeURIComponent(safeDrive)}/root:/${encoded}`);
  }

  async function getDriveItem(driveId: string, itemId: string): Promise<GraphDriveItem> {
    const safeDrive = assertSafeGraphResourceId(driveId, "drive id");
    const safeItem = assertSafeGraphResourceId(itemId, "item id");
    return graphGetJson(
      `/drives/${encodeURIComponent(safeDrive)}/items/${encodeURIComponent(safeItem)}?$select=id,name,size,file,folder,eTag,cTag,lastModifiedDateTime,webUrl,parentReference`,
    );
  }

  /**
   * List all children under a folder, following Graph @odata.nextLink pagination.
   * nextLink hosts are validated to graph.microsoft.com only.
   */
  async function listFolderChildren(
    driveId: string,
    folderItemId: string,
    opts?: { pageSize?: number; maxItems?: number },
  ): Promise<GraphDriveItem[]> {
    const safeDrive = assertSafeGraphResourceId(driveId, "drive id");
    const safeFolder = assertSafeGraphResourceId(folderItemId, "folder id");
    const pageSize = Math.min(200, Math.max(1, opts?.pageSize ?? 200));
    const maxItems = opts?.maxItems ?? 2000;
    const select =
      "id,name,size,file,folder,eTag,cTag,lastModifiedDateTime,webUrl,parentReference";
    let next: string | null =
      `/drives/${encodeURIComponent(safeDrive)}/items/${encodeURIComponent(safeFolder)}/children?$select=${select}&$top=${pageSize}`;
    const out: GraphDriveItem[] = [];
    while (next) {
      const page: {
        value?: GraphDriveItem[];
        "@odata.nextLink"?: string;
      } = await graphGetJson(next);
      for (const item of page.value ?? []) {
        out.push(item);
        if (out.length >= maxItems) return out;
      }
      next = page["@odata.nextLink"] ?? null;
    }
    return out;
  }

  async function downloadDriveItem(driveId: string, itemId: string): Promise<Buffer> {
    const safeDrive = assertSafeGraphResourceId(driveId, "drive id");
    const safeItem = assertSafeGraphResourceId(itemId, "item id");
    return graphGetBytes(
      `/drives/${encodeURIComponent(safeDrive)}/items/${encodeURIComponent(safeItem)}/content`,
    );
  }

  return {
    getUserDrive,
    getDriveItemByPath,
    getDriveItem,
    listFolderChildren,
    downloadDriveItem,
  };
}

export type MicrosoftGraphClient = ReturnType<typeof createMicrosoftGraphClient>;
