/**
 * Minimal Microsoft Graph client (client-credentials).
 * Server-only — never import from client bundles.
 */
import { publicMicrosoftErrorMessage } from "@/domain/sharepoint-sds";

export type GraphDriveItem = {
  id: string;
  name: string;
  size?: number;
  eTag?: string | null;
  cTag?: string | null;
  lastModifiedDateTime?: string | null;
  webUrl?: string | null;
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
    const res = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      throw new MicrosoftGraphError(
        publicMicrosoftErrorMessage(
          new Error(json.error_description || json.error || `Token HTTP ${res.status}`),
        ),
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

  async function graphJson<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getAccessToken();
    const url = path.startsWith("https://")
      ? path
      : `https://graph.microsoft.com/v1.0${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init?.headers ?? {}),
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

  async function graphBytes(path: string): Promise<Buffer> {
    const token = await getAccessToken();
    const url = path.startsWith("https://")
      ? path
      : `https://graph.microsoft.com/v1.0${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetchImpl(url, {
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
    return graphJson(`/users/${encodeURIComponent(userPrincipalName)}/drive`);
  }

  async function getDriveItemByPath(
    driveId: string,
    folderPath: string,
  ): Promise<GraphDriveItem> {
    const clean = folderPath.replace(/^\/+/, "").replace(/\/+$/, "");
    const encoded = clean
      .split("/")
      .map((p) => encodeURIComponent(p))
      .join("/");
    return graphJson(`/drives/${encodeURIComponent(driveId)}/root:/${encoded}`);
  }

  async function getDriveItem(driveId: string, itemId: string): Promise<GraphDriveItem> {
    return graphJson(
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`,
    );
  }

  /**
   * List all children under a folder, following Graph @odata.nextLink pagination.
   */
  async function listFolderChildren(
    driveId: string,
    folderItemId: string,
    opts?: { pageSize?: number; maxItems?: number },
  ): Promise<GraphDriveItem[]> {
    const pageSize = Math.min(200, Math.max(1, opts?.pageSize ?? 200));
    const maxItems = opts?.maxItems ?? 2000;
    const select =
      "id,name,size,file,folder,eTag,cTag,lastModifiedDateTime,webUrl";
    let next: string | null =
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderItemId)}/children?$select=${select}&$top=${pageSize}`;
    const out: GraphDriveItem[] = [];
    while (next) {
      const page: {
        value?: GraphDriveItem[];
        "@odata.nextLink"?: string;
      } = await graphJson(next);
      for (const item of page.value ?? []) {
        out.push(item);
        if (out.length >= maxItems) return out;
      }
      next = page["@odata.nextLink"] ?? null;
    }
    return out;
  }

  async function downloadDriveItem(driveId: string, itemId: string): Promise<Buffer> {
    return graphBytes(
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
    );
  }

  return {
    getAccessToken,
    getUserDrive,
    getDriveItemByPath,
    getDriveItem,
    listFolderChildren,
    downloadDriveItem,
  };
}

export type MicrosoftGraphClient = ReturnType<typeof createMicrosoftGraphClient>;
