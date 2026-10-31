/**
 * Load the tenant's Microsoft signing keys. Redirects off login.microsoftonline.com are rejected.
 */
import { MICROSOFT_LOGIN_HOST } from "@/domain/microsoft-graph-security";
import {
  microsoftSigningKeysUrl,
  parseMicrosoftSigningKeys,
  type MicrosoftSigningKey,
  Microsoft365Error,
} from "@/domain/microsoft-365-crm";
import type { MicrosoftFetch } from "@/server/microsoft-365/http";

const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; keys: MicrosoftSigningKey[] }>();

export function clearMicrosoftSigningKeyCache(): void {
  cache.clear();
}

export async function fetchMicrosoftSigningKeys(
  tenantId: string,
  fetchImpl: MicrosoftFetch,
  now = Date.now(),
  options?: { refresh?: boolean },
): Promise<MicrosoftSigningKey[]> {
  const url = microsoftSigningKeysUrl(tenantId);
  if (!options?.refresh) {
    const cached = cache.get(url);
    if (cached && cached.expiresAt > now) return cached.keys;
  }

  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Microsoft365Error("TOKEN", "Microsoft signing keys were rejected");
  }
  if (response.url) {
    let landed: URL;
    try {
      landed = new URL(response.url);
    } catch {
      throw new Microsoft365Error("TOKEN", "Microsoft signing keys were rejected");
    }
    if (landed.protocol !== "https:" || landed.hostname !== MICROSOFT_LOGIN_HOST) {
      throw new Microsoft365Error("TOKEN", "Microsoft signing keys were rejected");
    }
  }
  if (!response.ok) throw new Microsoft365Error("TOKEN", "Microsoft signing keys were rejected");
  const body = (await response.json().catch(() => null)) as unknown;
  const keys = parseMicrosoftSigningKeys(body);
  cache.set(url, { expiresAt: now + CACHE_MS, keys });
  return keys;
}
