import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { microsoftSigningKeysUrl } from "@/domain/microsoft-365-crm";
import type { MicrosoftFetch } from "@/server/microsoft-365/http";
import { clearMicrosoftSigningKeyCache, fetchMicrosoftSigningKeys } from "@/server/microsoft-365/signing-keys";

const TENANT = "11111111-1111-4111-8111-111111111111";
const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
const body = {
  keys: [{ kty: "RSA", use: "sig", alg: "RS256", kid: "live", n: jwk.n, e: jwk.e }, { kty: "oct", kid: "skip" }],
};

afterEach(() => {
  clearMicrosoftSigningKeyCache();
});

describe("Microsoft signing keys", () => {
  it("loads tenant keys over HTTPS and ignores redirects", async () => {
    const calls: Array<{ url: string; redirect: string | undefined }> = [];
    const fetchImpl: MicrosoftFetch = async (input, init) => {
      calls.push({ url: input, redirect: init?.redirect });
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const keys = await fetchMicrosoftSigningKeys(TENANT, fetchImpl, 1_000);
    expect(keys.map((item) => item.kid)).toEqual(["live"]);
    expect(calls[0]?.url).toBe(microsoftSigningKeysUrl(TENANT));
    expect(calls[0]?.redirect).toBe("manual");

    const again = await fetchMicrosoftSigningKeys(TENANT, async () => {
      throw new Error("cache miss");
    }, 1_000);
    expect(again).toEqual(keys);

    let refreshed = false;
    await fetchMicrosoftSigningKeys(
      TENANT,
      async () => {
        refreshed = true;
        return new Response(JSON.stringify(body), { status: 200 });
      },
      1_000,
      { refresh: true },
    );
    expect(refreshed).toBe(true);
  });

  it("rejects a redirect and a response that left login.microsoftonline.com", async () => {
    const redirected: MicrosoftFetch = async () => new Response(null, { status: 302, headers: { location: "https://evil.example/keys" } });
    await expect(fetchMicrosoftSigningKeys(TENANT, redirected, 2_000)).rejects.toThrow(/signing keys were rejected/);

    const offHost: MicrosoftFetch = async () => {
      const response = new Response(JSON.stringify(body), { status: 200 });
      Object.defineProperty(response, "url", { value: "https://evil.example/keys" });
      return response;
    };
    await expect(fetchMicrosoftSigningKeys(TENANT, offHost, 3_000)).rejects.toThrow(/signing keys were rejected/);
  });
});
