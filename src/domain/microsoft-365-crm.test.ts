import { createSign, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  MICROSOFT_365_BASE_SCOPES,
  MICROSOFT_365_CALENDAR_SCOPE,
  assertAcceptedMicrosoftScopes,
  assertAppRelativeLocation,
  assertSingleTenantId,
  buildMicrosoftAuthorizeUrl,
  isMicrosoft365CrmEnabled,
  isOAuthTransactionOpen,
  microsoft365BrowserLocation,
  microsoft365ReturnNotice,
  oauthTransactionConsumeFilter,
  parseMicrosoftSigningKeys,
  pkceChallengeS256,
  readMicrosoft365Gate,
  readMicrosoftIdTokenKeyId,
  resolveMicrosoft365RedirectUri,
  sanitizeMicrosoftMessage,
  scopesForConnect,
  verifyMicrosoftIdToken,
  type MicrosoftSigningKey,
  Microsoft365Error,
} from "@/domain/microsoft-365-crm";

const APP = "https://automotivebrands.co.uk";
const TENANT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const ENC = "microsoft-365-encryption-key-32chars";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" });
const SIGNING_KEY: MicrosoftSigningKey = {
  kid: "test-key",
  n: String(publicJwk.n),
  e: String(publicJwk.e),
};

function jwt(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: "RS256", kid: "test-key" },
  signature?: string,
): string {
  const head = Buffer.from(JSON.stringify(header)).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  if (header["alg"] === "none") return `${head}.${body}.x`;
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  signer.end();
  return `${head}.${body}.${signature ?? signer.sign(privateKey).toString("base64url")}`;
}

describe("Microsoft 365 feature flag and scopes", () => {
  it("stays off unless explicitly enabled", () => {
    expect(isMicrosoft365CrmEnabled(undefined)).toBe(false);
    expect(isMicrosoft365CrmEnabled("")).toBe(false);
    expect(isMicrosoft365CrmEnabled("false")).toBe(false);
    expect(isMicrosoft365CrmEnabled("off")).toBe(false);
    expect(isMicrosoft365CrmEnabled("true")).toBe(true);
    expect(isMicrosoft365CrmEnabled("ON")).toBe(true);
  });

  it("requests delegated task scopes and calendar only when asked", () => {
    expect(scopesForConnect(false)).toEqual([...MICROSOFT_365_BASE_SCOPES]);
    expect(scopesForConnect(false).join(" ")).not.toMatch(/Mail\.|Tasks\.ReadWrite\.All|Calendars/);
    expect(scopesForConnect(true)).toContain(MICROSOFT_365_CALENDAR_SCOPE);
    expect(scopesForConnect(true)).not.toContain("Mail.Read");
    expect(scopesForConnect(true)).not.toContain("Mail.Send");
  });

  it("rejects common and consumers tenants", () => {
    expect(() => assertSingleTenantId("common")).toThrow(Microsoft365Error);
    expect(() => assertSingleTenantId("organizations")).toThrow(Microsoft365Error);
  });
});

describe("Microsoft 365 redirect and PKCE", () => {
  it("matches the RFC 7636 S256 vector", () => {
    expect(pkceChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("allows only the application callback on the APP_URL origin", () => {
    expect(resolveMicrosoft365RedirectUri(APP, undefined)).toBe(
      "https://automotivebrands.co.uk/api/microsoft-365/callback",
    );
    expect(resolveMicrosoft365RedirectUri(APP, "https://evil.example/api/microsoft-365/callback")).toBeNull();
    expect(resolveMicrosoft365RedirectUri(APP, "https://automotivebrands.co.uk/login")).toBeNull();
    expect(resolveMicrosoft365RedirectUri(APP, "http://automotivebrands.co.uk/api/microsoft-365/callback")).toBeNull();
    expect(
      resolveMicrosoft365RedirectUri(
        "http://localhost:43127",
        "http://localhost:43127/api/microsoft-365/callback",
      ),
    ).toBe("http://localhost:43127/api/microsoft-365/callback");
  });

  it("returns the browser to a fixed path", () => {
    expect(microsoft365BrowserLocation("connected")).toBe("/crm/microsoft?microsoft=connected");
    expect(microsoft365BrowserLocation("session")).toBe("/login?returnTo=%2Fcrm%2Fmicrosoft");
    expect(() => assertAppRelativeLocation("https://evil.example")).toThrow(Microsoft365Error);
    expect(() => assertAppRelativeLocation("//evil.example")).toThrow(Microsoft365Error);
    expect(assertAppRelativeLocation("/crm/microsoft?microsoft=token")).toBe("/crm/microsoft?microsoft=token");
    expect(microsoft365ReturnNotice("https://evil.example")).toBeNull();
    expect(microsoft365ReturnNotice("connected")).toMatch(/not exported/);
  });

  it("builds a single-tenant authorise URL without mail scopes or the client secret", () => {
    const url = new URL(
      buildMicrosoftAuthorizeUrl({
        tenantId: TENANT,
        clientId: CLIENT,
        redirectUri: "https://automotivebrands.co.uk/api/microsoft-365/callback",
        scopes: scopesForConnect(false),
        state: "state-1",
        codeChallenge: "challenge",
        nonce: "nonce-1",
        prompt: "select_account",
      }),
    );
    expect(url.hostname).toBe("login.microsoftonline.com");
    expect(url.pathname).toBe(`/${TENANT}/oauth2/v2.0/authorize`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).not.toMatch(/Mail\.|Calendars/);
    expect(url.searchParams.get("client_secret")).toBeNull();
  });
});

describe("Microsoft 365 identity token", () => {
  const now = new Date("2026-10-31T12:00:00.000Z");
  const base = {
    oid: "oid-1",
    tid: TENANT,
    aud: CLIENT,
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    exp: Math.floor(now.getTime() / 1000) + 600,
    nonce: "nonce-1",
    name: "Alex Sales",
    preferred_username: "alex@automotivebrands.co.uk",
  };
  const expected = { tenantId: TENANT, clientId: CLIENT, nonce: "nonce-1", now, keys: [SIGNING_KEY] };

  it("accepts a signed organisation token and rejects unverified claims", () => {
    expect(verifyMicrosoftIdToken(jwt(base), expected).oid).toBe("oid-1");
    expect(verifyMicrosoftIdToken(jwt({ ...base, iss: `${base.iss}/` }), expected).tid).toBe(TENANT);
    expect(verifyMicrosoftIdToken(jwt({ ...base, aud: [CLIENT, "other"] }), expected).oid).toBe("oid-1");

    const signed = jwt(base);
    const [head, , sig] = signed.split(".");
    const tampered = Buffer.from(JSON.stringify({ ...base, oid: "attacker" })).toString("base64url");
    expect(() => verifyMicrosoftIdToken(`${head}.${tampered}.${sig}`, expected)).toThrow(/identity token was rejected/);
    expect(() => verifyMicrosoftIdToken(jwt(base, { alg: "none", kid: "test-key" }), expected)).toThrow(/identity token was rejected/);
    expect(() => verifyMicrosoftIdToken(jwt(base, { alg: "HS256", kid: "test-key" }), expected)).toThrow(/identity token was rejected/);
    expect(() => verifyMicrosoftIdToken(jwt(base, { alg: "RS256" }), expected)).toThrow(/identity token was rejected/);
    expect(() => verifyMicrosoftIdToken(jwt(base, { alg: "RS256", kid: "other" }), expected)).toThrow(/identity token was rejected/);
    expect(() => verifyMicrosoftIdToken(jwt(base, { alg: "RS256", kid: "test-key", crit: ["cnf"] }), expected)).toThrow(
      /identity token was rejected/,
    );
    const forged = jwt(base);
    expect(() => verifyMicrosoftIdToken(`${forged.slice(0, -4)}AAAA`, expected)).toThrow(/identity token was rejected/);
    expect(readMicrosoftIdTokenKeyId(jwt(base))).toBe("test-key");
    expect(readMicrosoftIdTokenKeyId(jwt({ ...base, oid: "attacker" }, { alg: "none", kid: "test-key" }))).toBe("test-key");
    expect(() =>
      verifyMicrosoftIdToken(jwt({ ...base, iat: Math.floor(now.getTime() / 1000) + 121 }), expected),
    ).toThrow(/identity token was rejected/);
  });

  it("rejects the wrong tenant, audience, nonce, or expiry after the signature check", () => {
    expect(() =>
      verifyMicrosoftIdToken(jwt({ ...base, tid: "33333333-3333-4333-8333-333333333333" }), expected),
    ).toThrow(/authorised organisation/);
    expect(() => verifyMicrosoftIdToken(jwt({ ...base, aud: "33333333-3333-4333-8333-333333333333" }), expected)).toThrow(
      /identity token was rejected/,
    );
    expect(() => verifyMicrosoftIdToken(jwt({ ...base, nonce: "other" }), expected)).toThrow(/could not be confirmed/);
    expect(() =>
      verifyMicrosoftIdToken(jwt({ ...base, exp: Math.floor(now.getTime() / 1000) - 121 }), expected),
    ).toThrow(/expired/);
    expect(() =>
      verifyMicrosoftIdToken(jwt({ ...base, nbf: Math.floor(now.getTime() / 1000) + 121 }), expected),
    ).toThrow(/not valid yet/);
    expect(() => verifyMicrosoftIdToken(jwt({ ...base, exp: "600" }), expected)).toThrow(/expired/);
  });

  it("requires delegated task scopes and refuses mailbox permissions", () => {
    expect(assertAcceptedMicrosoftScopes("openid profile offline_access User.Read Tasks.ReadWrite")).toContain("Tasks.ReadWrite");
    expect(
      assertAcceptedMicrosoftScopes("openid User.Read Tasks.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite"),
    ).toContain("Calendars.ReadWrite");
    expect(() => assertAcceptedMicrosoftScopes("openid User.Read Tasks.ReadWrite Mail.Read")).toThrow(/does not accept/);
    expect(() => assertAcceptedMicrosoftScopes("User.Read Tasks.ReadWrite.All")).toThrow(/does not accept/);
    expect(() => assertAcceptedMicrosoftScopes("openid User.Read")).toThrow(/required permissions/);
  });

  it("treats an OAuth transaction as open only before expiry and before consume", () => {
    const expiresAt = new Date("2026-10-31T12:10:00.000Z");
    expect(isOAuthTransactionOpen({ consumedAt: null, expiresAt }, new Date("2026-10-31T12:09:59.000Z"))).toBe(true);
    expect(isOAuthTransactionOpen({ consumedAt: null, expiresAt }, expiresAt)).toBe(false);
    expect(isOAuthTransactionOpen({ consumedAt: expiresAt, expiresAt }, new Date("2026-10-31T12:00:00.000Z"))).toBe(false);
    expect(oauthTransactionConsumeFilter("row-1", expiresAt)).toEqual({
      id: "row-1",
      consumedAt: null,
      expiresAt: { gt: expiresAt },
    });
  });

  it("scrubs tokens from stored messages", () => {
    const cleaned = sanitizeMicrosoftMessage(
      "invalid_grant access_token=abc refresh_token=secret Bearer eyJhbGciOi.eyJvaWQi.sig",
    );
    expect(cleaned).not.toContain("secret");
    expect(cleaned).not.toContain("eyJ");
    expect(cleaned).toContain("invalid_grant");
  });
});

describe("Microsoft 365 configuration gate", () => {
  it("reports a complete app as configured but disabled until the flag is on", () => {
    const off = readMicrosoft365Gate({
      enabledFlag: "false",
      tenantId: TENANT,
      clientId: CLIENT,
      clientSecret: "secret",
      appUrl: APP,
      encryptionKey: ENC,
    });
    expect(off).toEqual({ state: "disabled", configured: true });
    const on = readMicrosoft365Gate({
      enabledFlag: "true",
      tenantId: TENANT,
      clientId: CLIENT,
      clientSecret: "secret",
      appUrl: APP,
      encryptionKey: ENC,
    });
    expect(on.state).toBe("ready");
    if (on.state === "ready") expect(JSON.stringify(on.config)).not.toContain(ENC);
    expect(
      readMicrosoft365Gate({
        enabledFlag: "true",
        tenantId: TENANT,
        clientId: CLIENT,
        clientSecret: "secret",
        appUrl: APP,
      }).state,
    ).toBe("not_configured");
    expect(
      readMicrosoft365Gate({
        enabledFlag: "true",
        tenantId: TENANT,
        clientId: CLIENT,
        clientSecret: "secret",
        appUrl: APP,
        encryptionKey: "too-short",
      }).state,
    ).toBe("not_configured");
    expect(readMicrosoft365Gate({ enabledFlag: "true", tenantId: "common", clientId: CLIENT, clientSecret: "x", appUrl: APP, encryptionKey: ENC }).state).toBe(
      "not_configured",
    );
  });
});

describe("Microsoft 365 schema", () => {
  it("adds unique mapping keys and leaves task sync off by default", () => {
    const sql = readFileSync(
      join(process.cwd(), "prisma/migrations/20261031120000_microsoft_365_crm_connection/migration.sql"),
      "utf8",
    );
    expect(sql).toContain('"taskSyncEnabled" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).toContain('"MicrosoftTaskMapping_userId_taskId_key"');
    expect(sql).toContain('"MicrosoftTaskMapping_tenantId_microsoftUserId_microsoftTaskId_key"');
    expect(sql).toContain('"MicrosoftAccountConnection_activeIdentityKey_key"');
    expect(sql).not.toMatch(/ALTER TABLE "Task" ADD/);
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/^\s*(UPDATE|DELETE|DROP|TRUNCATE)\b/im);
    expect(statements).not.toMatch(/ALTER TABLE "(User|Task|Order|Company|Invoice)"/);
    const altered = [...statements.matchAll(/ALTER TABLE "([^"]+)"/g)].map((match) => match[1]);
    expect(altered.length).toBeGreaterThan(0);
    expect(altered.every((name) => name?.startsWith("Microsoft"))).toBe(true);
    expect(parseMicrosoftSigningKeys({ keys: [{ kty: "RSA", use: "sig", alg: "RS256", kid: "kid", n: "n", e: "e" }] })).toEqual([
      { kid: "kid", n: "n", e: "e" },
    ]);
    expect(() => parseMicrosoftSigningKeys({ keys: [{ kty: "oct", kid: "kid" }] })).toThrow(/signing keys were rejected/);
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(schema).toContain("model MicrosoftAccountConnection");
    expect(schema).toContain("model MicrosoftCalendarMapping");
    expect(schema).toContain("model Task");
  });
});
