/**
 * Microsoft 365 CRM connection policy.
 * Scopes, PKCE, OAuth state, redirect checks, and ID token signature checks.
 * Signing keys are supplied by the caller. This module does not fetch them.
 * No tokens are accepted from the browser.
 */
import { createHash, createPublicKey, createVerify } from "node:crypto";

import { MICROSOFT_LOGIN_HOST, resolveMicrosoftTokenUrl } from "@/domain/microsoft-graph-security";

export const MICROSOFT_365_CALLBACK_PATH = "/api/microsoft-365/callback";
export const MICROSOFT_365_RETURN_PATH = "/crm/microsoft";
export const MICROSOFT_365_TASK_LIST_NAME = "Automotive Brands CRM";

export const MICROSOFT_365_BASE_SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "User.Read",
  "Tasks.ReadWrite",
] as const;

export const MICROSOFT_365_CALENDAR_SCOPE = "Calendars.ReadWrite";

/** Never request mailbox access or tenant-wide task scopes. */
export const MICROSOFT_365_FORBIDDEN_SCOPES = [
  "Mail.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "Tasks.Read",
  "Tasks.Read.All",
  "Tasks.ReadWrite.All",
  "Calendars.Read",
  "Calendars.ReadWrite.Shared",
] as const;

const TENANT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESERVED_TENANTS = new Set(["common", "organizations", "consumers"]);

export const MICROSOFT_365_RETURN_REASONS = [
  "connected",
  "disabled",
  "not_configured",
  "state",
  "tenant",
  "denied",
  "token",
  "forbidden",
] as const;

export type Microsoft365ReturnReason = (typeof MICROSOFT_365_RETURN_REASONS)[number];

export class Microsoft365Error extends Error {
  readonly code:
    | "FORBIDDEN"
    | "DISABLED"
    | "NOT_CONFIGURED"
    | "NOT_CONNECTED"
    | "REVOKED"
    | "RATE_LIMITED"
    | "TOKEN"
    | "TENANT"
    | "STATE";

  constructor(code: Microsoft365Error["code"], message: string) {
    super(message);
    this.name = "Microsoft365Error";
    this.code = code;
  }
}

/** Off unless an operator sets an explicit on value. */
export function isMicrosoft365CrmEnabled(flag: string | undefined): boolean {
  if (flag == null) return false;
  const value = flag.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

export function assertSingleTenantId(tenantId: string): string {
  const tid = tenantId.trim();
  if (!tid || RESERVED_TENANTS.has(tid.toLowerCase()) || !TENANT_GUID.test(tid)) {
    throw new Microsoft365Error("TENANT", "Microsoft tenant id must be a single-tenant GUID");
  }
  return tid;
}

export function scopesForConnect(includeCalendar: boolean): string[] {
  const scopes: string[] = [...MICROSOFT_365_BASE_SCOPES];
  if (includeCalendar) scopes.push(MICROSOFT_365_CALENDAR_SCOPE);
  for (const scope of scopes) {
    if ((MICROSOFT_365_FORBIDDEN_SCOPES as readonly string[]).includes(scope)) {
      throw new Microsoft365Error("FORBIDDEN", "Refusing a forbidden Microsoft scope");
    }
  }
  return scopes;
}

export function grantedScopeSet(scope: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (scope ?? "").split(/[\s,]+/)) {
    if (!part) continue;
    const prefix = "https://graph.microsoft.com/";
    out.add(part.startsWith(prefix) ? part.slice(prefix.length) : part);
  }
  return out;
}

export function hasCalendarConsent(scopes: string | undefined): boolean {
  return grantedScopeSet(scopes).has(MICROSOFT_365_CALENDAR_SCOPE);
}

export function pkceChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("base64url");
}

export type Microsoft365AppConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type Microsoft365Gate =
  | { state: "disabled"; configured: boolean }
  | { state: "not_configured" }
  | { state: "ready"; config: Microsoft365AppConfig };

export function resolveMicrosoft365RedirectUri(
  appUrl: string | undefined,
  override: string | undefined,
): string | null {
  const candidate = override?.trim() || defaultRedirectUri(appUrl);
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== MICROSOFT_365_CALLBACK_PATH) return null;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (!local) {
    if (!appUrl) return null;
    let app: URL;
    try {
      app = new URL(appUrl);
    } catch {
      return null;
    }
    if (url.origin !== app.origin) return null;
  }
  return `${url.origin}${url.pathname}`;
}

function defaultRedirectUri(appUrl: string | undefined): string | null {
  if (!appUrl?.trim()) return null;
  try {
    const app = new URL(appUrl);
    return `${app.origin}${MICROSOFT_365_CALLBACK_PATH}`;
  } catch {
    return null;
  }
}

export function readMicrosoft365Gate(env: {
  enabledFlag?: string | undefined;
  tenantId?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  redirectUri?: string | undefined;
  appUrl?: string | undefined;
  /** Dedicated token key. Presence is checked; the value is not retained on the gate. */
  encryptionKey?: string | undefined;
}): Microsoft365Gate {
  const redirectUri = resolveMicrosoft365RedirectUri(env.appUrl, env.redirectUri);
  const tenantRaw = env.tenantId?.trim() ?? "";
  const clientId = env.clientId?.trim() ?? "";
  const clientSecret = env.clientSecret?.trim() ?? "";
  let tenantId = "";
  let tenantOk = false;
  try {
    if (tenantRaw) {
      tenantId = assertSingleTenantId(tenantRaw);
      tenantOk = true;
    }
  } catch {
    tenantOk = false;
  }
  const encryptionKeyOk = (env.encryptionKey?.trim().length ?? 0) >= 32;
  const configured = Boolean(tenantOk && clientId && clientSecret && redirectUri && encryptionKeyOk);
  if (!isMicrosoft365CrmEnabled(env.enabledFlag)) return { state: "disabled", configured };
  if (!configured || !redirectUri) return { state: "not_configured" };
  return {
    state: "ready",
    config: { tenantId, clientId, clientSecret, redirectUri },
  };
}

export function buildMicrosoftAuthorizeUrl(input: {
  tenantId: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  nonce: string;
  prompt: "select_account" | "consent";
}): string {
  const tenantId = assertSingleTenantId(input.tenantId);
  const tokenUrl = new URL(resolveMicrosoftTokenUrl(tenantId));
  tokenUrl.pathname = tokenUrl.pathname.replace(/\/token$/, "/authorize");
  tokenUrl.searchParams.set("client_id", input.clientId);
  tokenUrl.searchParams.set("response_type", "code");
  tokenUrl.searchParams.set("redirect_uri", input.redirectUri);
  tokenUrl.searchParams.set("response_mode", "query");
  tokenUrl.searchParams.set("scope", input.scopes.join(" "));
  tokenUrl.searchParams.set("state", input.state);
  tokenUrl.searchParams.set("nonce", input.nonce);
  tokenUrl.searchParams.set("code_challenge", input.codeChallenge);
  tokenUrl.searchParams.set("code_challenge_method", "S256");
  tokenUrl.searchParams.set("prompt", input.prompt);
  if (tokenUrl.hostname !== MICROSOFT_LOGIN_HOST || tokenUrl.protocol !== "https:") {
    throw new Microsoft365Error("TOKEN", "Microsoft authorisation URL host is not allowed");
  }
  return tokenUrl.toString();
}

export function assertMicrosoftAuthorizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Microsoft365Error("TOKEN", "Microsoft authorisation URL is invalid");
  }
  if (url.protocol !== "https:" || url.hostname !== MICROSOFT_LOGIN_HOST) {
    throw new Microsoft365Error("TOKEN", "Microsoft authorisation URL host is not allowed");
  }
  return url.toString();
}

export type IdTokenClaims = {
  oid: string;
  tid: string;
  name: string | null;
  preferredUsername: string | null;
};

/** RSA signing key from the tenant JWKS. Only `n` and `e` are used, and only after `alg` is RS256. */
export type MicrosoftSigningKey = {
  kid: string;
  n: string;
  e: string;
};

const CLOCK_SKEW_MS = 120_000;

export function microsoftSigningKeysUrl(tenantId: string): string {
  const tid = assertSingleTenantId(tenantId);
  return `https://${MICROSOFT_LOGIN_HOST}/${tid}/discovery/v2.0/keys`;
}

export function parseMicrosoftSigningKeys(body: unknown): MicrosoftSigningKey[] {
  if (!body || typeof body !== "object" || !Array.isArray((body as { keys?: unknown }).keys)) {
    throw new Microsoft365Error("TOKEN", "Microsoft signing keys were rejected");
  }
  const keys: MicrosoftSigningKey[] = [];
  for (const item of (body as { keys: unknown[] }).keys) {
    if (!item || typeof item !== "object") continue;
    const jwk = item as Record<string, unknown>;
    if (jwk["kty"] !== "RSA") continue;
    if (jwk["use"] != null && jwk["use"] !== "sig") continue;
    if (jwk["alg"] != null && jwk["alg"] !== "RS256") continue;
    if (typeof jwk["kid"] !== "string" || typeof jwk["n"] !== "string" || typeof jwk["e"] !== "string") continue;
    if (!jwk["kid"] || !jwk["n"] || !jwk["e"]) continue;
    keys.push({ kid: jwk["kid"], n: jwk["n"], e: jwk["e"] });
  }
  if (keys.length === 0) throw new Microsoft365Error("TOKEN", "Microsoft signing keys were rejected");
  return keys;
}

function decodeJwtPart(part: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("shape");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Microsoft365Error("TOKEN", "Microsoft identity token was rejected");
  }
}

function issuerMatches(iss: string, tenantId: string): boolean {
  const trimmed = iss.endsWith("/") ? iss.slice(0, -1) : iss;
  return trimmed.toLowerCase() === `https://login.microsoftonline.com/${tenantId}/v2.0`.toLowerCase();
}

/**
 * Accept an ID token only after RS256 signature verification against the supplied Microsoft keys.
 * Claim checks run after the signature check. Unsigned tokens are rejected.
 */
export function verifyMicrosoftIdToken(
  idToken: string,
  expected: { tenantId: string; clientId: string; nonce: string; now: Date; keys: readonly MicrosoftSigningKey[] },
): IdTokenClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Microsoft365Error("TOKEN", "Microsoft identity token was rejected");
  }
  const header = decodeJwtPart(parts[0]);
  if (header["alg"] !== "RS256" || header["crit"] != null || typeof header["kid"] !== "string") {
    throw new Microsoft365Error("TOKEN", "Microsoft identity token was rejected");
  }
  const key = expected.keys.find((item) => item.kid === header["kid"]);
  if (!key) throw new Microsoft365Error("TOKEN", "Microsoft identity token was rejected");

  let signatureOk = false;
  try {
    const publicKey = createPublicKey({ key: { kty: "RSA", n: key.n, e: key.e }, format: "jwk" });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${parts[0]}.${parts[1]}`);
    verifier.end();
    signatureOk = verifier.verify(publicKey, Buffer.from(parts[2], "base64url"));
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) throw new Microsoft365Error("TOKEN", "Microsoft identity token was rejected");

  const payload = decodeJwtPart(parts[1]);
  const tid = typeof payload["tid"] === "string" ? payload["tid"] : "";
  const oid = typeof payload["oid"] === "string" ? payload["oid"] : "";
  const nonce = typeof payload["nonce"] === "string" ? payload["nonce"] : "";
  const aud = payload["aud"];
  const iss = typeof payload["iss"] === "string" ? payload["iss"] : "";
  const exp = payload["exp"];
  const nbf = payload["nbf"];
  const iat = payload["iat"];
  const audienceOk = aud === expected.clientId || (Array.isArray(aud) && aud.includes(expected.clientId));
  if (!audienceOk) {
    throw new Microsoft365Error("TOKEN", "Microsoft identity token was rejected");
  }
  if (!issuerMatches(iss, expected.tenantId) || tid.toLowerCase() !== expected.tenantId.toLowerCase() || !oid) {
    throw new Microsoft365Error("TENANT", "Microsoft account is not in the authorised organisation");
  }
  if (nonce !== expected.nonce) {
    throw new Microsoft365Error("STATE", "Microsoft sign-in could not be confirmed");
  }
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    throw new Microsoft365Error("TOKEN", "Microsoft identity token has expired");
  }
  const nowMs = expected.now.getTime();
  if (exp * 1000 < nowMs - CLOCK_SKEW_MS) {
    throw new Microsoft365Error("TOKEN", "Microsoft identity token has expired");
  }
  if (typeof nbf === "number" && nbf * 1000 > nowMs + CLOCK_SKEW_MS) {
    throw new Microsoft365Error("TOKEN", "Microsoft identity token is not valid yet");
  }
  if (typeof iat === "number" && iat * 1000 > nowMs + CLOCK_SKEW_MS) {
    throw new Microsoft365Error("TOKEN", "Microsoft identity token was rejected");
  }
  return {
    oid,
    tid,
    name: typeof payload["name"] === "string" ? payload["name"] : null,
    preferredUsername: typeof payload["preferred_username"] === "string" ? payload["preferred_username"] : null,
  };
}

/** Require the delegated task scopes and refuse mailbox or tenant-wide permissions. */
export function assertAcceptedMicrosoftScopes(scope: string | undefined): string {
  const granted = grantedScopeSet(scope);
  for (const forbidden of MICROSOFT_365_FORBIDDEN_SCOPES) {
    if (granted.has(forbidden)) {
      throw new Microsoft365Error("TOKEN", "Microsoft returned a permission this integration does not accept");
    }
  }
  if (!granted.has("User.Read") || !granted.has("Tasks.ReadWrite")) {
    throw new Microsoft365Error("TOKEN", "Microsoft did not grant the required permissions");
  }
  return [...granted].join(" ");
}

export function isOAuthTransactionOpen(
  row: { consumedAt: Date | null; expiresAt: Date },
  now: Date,
): boolean {
  return row.consumedAt == null && row.expiresAt.getTime() > now.getTime();
}

/** Database filter for a single successful consume. Expired or already-used rows match nothing. */
export function oauthTransactionConsumeFilter(
  id: string,
  now: Date,
): { id: string; consumedAt: null; expiresAt: { gt: Date } } {
  return { id, consumedAt: null, expiresAt: { gt: now } };
}

/** Header `kid` only. Payload claims are not read and are not trusted. */
export function readMicrosoftIdTokenKeyId(idToken: string): string | null {
  const part = idToken.split(".")[0];
  if (!part) return null;
  try {
    const header = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as unknown;
    if (!header || typeof header !== "object" || Array.isArray(header)) return null;
    const kid = (header as { kid?: unknown }).kid;
    return typeof kid === "string" && kid ? kid : null;
  } catch {
    return null;
  }
}

export function sanitizeMicrosoftMessage(raw: string): string {
  let text = raw.replace(/[\r\n]+/g, " ").trim();
  text = text.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]");
  text = text.replace(
    /(access_token|refresh_token|id_token|client_secret|code_verifier|code)=([^&\s]+)/gi,
    "$1=[redacted]",
  );
  text = text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
  if (text.length > 240) text = text.slice(0, 240);
  return text || "Microsoft 365 request failed";
}

export function microsoft365BrowserLocation(reason: Microsoft365ReturnReason | "session"): string {
  if (reason === "session") return "/login?returnTo=%2Fcrm%2Fmicrosoft";
  if (reason === "connected") return `${MICROSOFT_365_RETURN_PATH}?microsoft=connected`;
  return `${MICROSOFT_365_RETURN_PATH}?microsoft=${reason}`;
}

export function assertAppRelativeLocation(location: string): string {
  if (!location.startsWith("/") || location.startsWith("//") || location.includes("\\") || location.includes("://")) {
    throw new Microsoft365Error("TOKEN", "Redirect target is not allowed");
  }
  const path = location.split("?")[0];
  if (path !== MICROSOFT_365_RETURN_PATH && path !== "/login") {
    throw new Microsoft365Error("TOKEN", "Redirect target is not allowed");
  }
  return location;
}

export type Microsoft365Actor = {
  userId: string;
  actorType: "INTERNAL" | "TRADE";
  canConnect: boolean;
  canViewAdminHealth: boolean;
};

export function assertCanConnect(actor: Microsoft365Actor): void {
  if (actor.actorType !== "INTERNAL" || !actor.canConnect) {
    throw new Microsoft365Error("FORBIDDEN", "Not permitted to connect a Microsoft 365 account");
  }
}

export type Microsoft365HealthRow = {
  userId: string;
  userEmail: string;
  displayName: string | null;
  microsoftEmail: string | null;
  status: "CONNECTED" | "REVOKED" | "ERROR";
  taskSyncEnabled: boolean;
  calendarSyncEnabled: boolean;
  lastError: string | null;
  lastTokenRefreshAt: string | null;
  connectedAt: string | null;
};

export type Microsoft365Status = {
  platformEnabled: boolean;
  configured: boolean;
  canConnect: boolean;
  connection: null | {
    status: "CONNECTED" | "REVOKED" | "ERROR";
    displayName: string | null;
    email: string | null;
    taskSyncEnabled: boolean;
    calendarSyncEnabled: boolean;
    calendarConsented: boolean;
    lastTaskSyncAt: string | null;
    lastCalendarSyncAt: string | null;
    lastError: string | null;
    connectedAt: string | null;
  };
  health: Microsoft365HealthRow[] | null;
  outbound?: {
    engineEnabled: boolean;
    pending: number;
    failed: number;
    needsReview: number;
    canApproveUncertainCreate: boolean;
    uncertainJobs: Array<{
      jobId: string;
      taskId: string;
      taskTitle: string | null;
      assigneeName: string | null;
      assigneeEmail: string | null;
      lastError: string | null;
      knownMicrosoftTaskId: string | null;
      connectionId: string;
      updatedAt: string;
    }>;
  };
};

const RETURN_NOTICES: Record<Microsoft365ReturnReason, string> = {
  connected: "Microsoft 365 is connected. Existing CRM tasks are not exported.",
  disabled: "Microsoft 365 integration is turned off.",
  not_configured: "Microsoft 365 is not configured yet. An administrator must register the Entra application.",
  state: "The Microsoft sign-in could not be confirmed. Start the connection again.",
  tenant: "That Microsoft account is not in the authorised organisation.",
  denied: "Microsoft sign-in was cancelled.",
  token: "Microsoft did not complete the connection. Try again.",
  forbidden: "This Microsoft connection does not belong to your sign-in.",
};

export function microsoft365ReturnNotice(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (!(MICROSOFT_365_RETURN_REASONS as readonly string[]).includes(reason)) return null;
  return RETURN_NOTICES[reason as Microsoft365ReturnReason];
}

export function activeIdentityKey(tenantId: string, microsoftUserId: string): string {
  return `${tenantId.toLowerCase()}:${microsoftUserId.toLowerCase()}`;
}
