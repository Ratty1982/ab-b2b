/**
 * Microsoft 365 authorisation-code + PKCE flow.
 * Refresh tokens stay inside the store, encrypted. Callers receive a public status only.
 */
import { randomBytes } from "node:crypto";

import {
  activeIdentityKey,
  assertAppRelativeLocation,
  assertCanConnect,
  assertMicrosoftAuthorizeUrl,
  buildMicrosoftAuthorizeUrl,
  grantedScopeSet,
  hasCalendarConsent,
  hashOAuthState,
  microsoft365BrowserLocation,
  pkceChallengeS256,
  readIdTokenClaims,
  sanitizeMicrosoftMessage,
  scopesForConnect,
  type Microsoft365Actor,
  type Microsoft365AppConfig,
  type Microsoft365Gate,
  type Microsoft365HealthRow,
  type Microsoft365Status,
  Microsoft365Error,
} from "@/domain/microsoft-365-crm";
import { resolveMicrosoftGraphUrl, resolveMicrosoftTokenUrl } from "@/domain/microsoft-graph-security";
import { decryptSecret, encryptSecret } from "@/server/crypto/secret";
import {
  MicrosoftIdentityConflict,
  type Microsoft365Store,
  type StoredConnection,
} from "@/server/microsoft-365/store";

const STATE_TTL_MS = 10 * 60 * 1000;
const ACCESS_SKEW_MS = 120_000;

export type MicrosoftFetch = (
  input: string,
  init?: { method?: string; headers?: HeadersInit; body?: string | URLSearchParams },
) => Promise<Response>;

export type Microsoft365Deps = {
  store: Microsoft365Store;
  fetchImpl?: MicrosoftFetch;
  now?: () => Date;
  random?: (size: number) => Buffer;
};

function deps(input: Microsoft365Deps) {
  return {
    store: input.store,
    fetchImpl:
      input.fetchImpl ??
      ((url, init) => fetch(url, init)),
    now: input.now ?? (() => new Date()),
    random: input.random ?? ((size: number) => randomBytes(size)),
  };
}

function newId(random: (size: number) => Buffer): string {
  return random(16).toString("base64url");
}

function platformFlags(gate: Microsoft365Gate): { platformEnabled: boolean; configured: boolean } {
  if (gate.state === "ready") return { platformEnabled: true, configured: true };
  if (gate.state === "disabled") return { platformEnabled: false, configured: gate.configured };
  return { platformEnabled: true, configured: false };
}

function publicConnection(row: StoredConnection, gate: Microsoft365Gate) {
  const live = gate.state === "ready" && row.status === "CONNECTED";
  return {
    status: row.status,
    displayName: row.displayName,
    email: row.microsoftEmail,
    taskSyncEnabled: live && row.taskSyncEnabled,
    calendarSyncEnabled: live && row.calendarSyncEnabled && hasCalendarConsent(row.scopes),
    calendarConsented: hasCalendarConsent(row.scopes),
    lastTaskSyncAt: row.lastTaskSyncAt?.toISOString() ?? null,
    lastCalendarSyncAt: row.lastCalendarSyncAt?.toISOString() ?? null,
    lastError: row.lastError,
    connectedAt: row.connectedAt?.toISOString() ?? null,
  };
}

export async function getMicrosoft365Status(
  actor: Microsoft365Actor,
  gate: Microsoft365Gate,
  input: Microsoft365Deps,
): Promise<Microsoft365Status> {
  const { store } = deps(input);
  if (actor.actorType !== "INTERNAL") {
    throw new Microsoft365Error("FORBIDDEN", "Microsoft 365 is available to staff only");
  }
  const row = await store.findConnectionByUser(actor.userId);
  const flags = platformFlags(gate);
  let health: Microsoft365HealthRow[] | null = null;
  if (actor.canViewAdminHealth) {
    const rows = await store.listHealth();
    health = rows.map((item) => ({
      userId: item.userId,
      userEmail: item.userEmail,
      displayName: item.displayName,
      microsoftEmail: item.microsoftEmail,
      status: item.status,
      taskSyncEnabled: flags.platformEnabled && item.status === "CONNECTED" && item.taskSyncEnabled,
      calendarSyncEnabled: flags.platformEnabled && item.status === "CONNECTED" && item.calendarSyncEnabled,
      lastError: item.lastError,
      lastTokenRefreshAt: item.lastTokenRefreshAt?.toISOString() ?? null,
      connectedAt: item.connectedAt?.toISOString() ?? null,
    }));
  }
  return {
    ...flags,
    canConnect: actor.canConnect && actor.actorType === "INTERNAL",
    connection: row ? publicConnection(row, gate) : null,
    health,
  };
}

export async function beginMicrosoftConnect(
  actor: Microsoft365Actor,
  includeCalendar: boolean,
  gate: Microsoft365Gate,
  input: Microsoft365Deps,
): Promise<{ authorizationUrl: string }> {
  assertCanConnect(actor);
  if (gate.state === "disabled") {
    throw new Microsoft365Error("DISABLED", "Microsoft 365 integration is turned off");
  }
  if (gate.state !== "ready") {
    throw new Microsoft365Error("NOT_CONFIGURED", "Microsoft 365 is not configured");
  }
  const { store, now, random } = deps(input);
  const state = random(32).toString("base64url");
  const verifier = random(32).toString("base64url");
  const nonce = random(16).toString("base64url");
  const created = now();
  await store.insertTransaction({
    id: newId(random),
    userId: actor.userId,
    stateHash: hashOAuthState(state),
    codeVerifierEncrypted: encryptSecret(verifier),
    nonce,
    includeCalendar,
    redirectUri: gate.config.redirectUri,
    expiresAt: new Date(created.getTime() + STATE_TTL_MS),
    consumedAt: null,
  });
  const authorizationUrl = assertMicrosoftAuthorizeUrl(
    buildMicrosoftAuthorizeUrl({
      tenantId: gate.config.tenantId,
      clientId: gate.config.clientId,
      redirectUri: gate.config.redirectUri,
      scopes: scopesForConnect(includeCalendar),
      state,
      codeChallenge: pkceChallengeS256(verifier),
      nonce,
      prompt: includeCalendar ? "consent" : "select_account",
    }),
  );
  return { authorizationUrl };
}

type TokenJson = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postToken(
  config: Microsoft365AppConfig,
  body: URLSearchParams,
  fetchImpl: MicrosoftFetch,
): Promise<{ status: number; json: TokenJson; retryAfter: string | null }> {
  const response = await fetchImpl(resolveMicrosoftTokenUrl(config.tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const json = (await response.json().catch(() => ({}))) as TokenJson;
  return { status: response.status, json, retryAfter: response.headers.get("retry-after") };
}

function tokenError(json: TokenJson, status: number): string {
  return sanitizeMicrosoftMessage(json.error || json.error_description || `Token HTTP ${status}`);
}

export async function completeMicrosoftCallback(
  actor: { userId: string } | null,
  query: { code?: string | null; state?: string | null; error?: string | null },
  gate: Microsoft365Gate,
  input: Microsoft365Deps,
): Promise<{ location: string }> {
  const finish = (reason: Parameters<typeof microsoft365BrowserLocation>[0]) => ({
    location: assertAppRelativeLocation(microsoft365BrowserLocation(reason)),
  });
  if (query.error) return finish(query.error === "access_denied" ? "denied" : "token");
  if (!query.code || !query.state) return finish("state");
  if (!actor) return finish("session");
  if (gate.state === "disabled") return finish("disabled");
  if (gate.state !== "ready") return finish("not_configured");

  const { store, fetchImpl, now, random } = deps(input);
  const current = now();
  const transaction = await store.consumeTransaction(hashOAuthState(query.state), current);
  if (!transaction) return finish("state");
  if (transaction.userId !== actor.userId) return finish("forbidden");
  const verifier = decryptSecret(transaction.codeVerifierEncrypted);
  if (!verifier) return finish("token");

  let token: { status: number; json: TokenJson };
  try {
    token = await postToken(
      gate.config,
      new URLSearchParams({
        client_id: gate.config.clientId,
        client_secret: gate.config.clientSecret,
        grant_type: "authorization_code",
        code: query.code,
        redirect_uri: transaction.redirectUri,
        code_verifier: verifier,
      }),
      fetchImpl,
    );
  } catch (error) {
    await record(store, current, actor.userId, null, "TOKEN_EXCHANGE_FAILED", error);
    return finish("token");
  }
  if (!token.json.access_token || !token.json.refresh_token || !token.json.id_token || token.status >= 400) {
    await record(store, current, actor.userId, null, "TOKEN_EXCHANGE_FAILED", tokenError(token.json, token.status));
    return finish("token");
  }

  let claims;
  try {
    claims = readIdTokenClaims(token.json.id_token, {
      tenantId: gate.config.tenantId,
      clientId: gate.config.clientId,
      nonce: transaction.nonce,
      now: current,
    });
  } catch (error) {
    const reason = error instanceof Microsoft365Error && error.code === "STATE" ? "state" : "tenant";
    await record(store, current, actor.userId, null, "TENANT_REJECTED", error);
    return finish(reason);
  }

  let profile: { id?: string; displayName?: string; mail?: string; userPrincipalName?: string };
  try {
    const me = await fetchImpl(resolveMicrosoftGraphUrl("/me?$select=id,displayName,mail,userPrincipalName"), {
      headers: { Authorization: `Bearer ${token.json.access_token}`, Accept: "application/json" },
    });
    profile = (await me.json().catch(() => ({}))) as typeof profile;
    if (!me.ok || !profile.id) {
      await record(store, current, actor.userId, null, "PROFILE_FAILED", `Graph HTTP ${me.status}`);
      return finish("token");
    }
  } catch (error) {
    await record(store, current, actor.userId, null, "PROFILE_FAILED", error);
    return finish("token");
  }
  if (profile.id !== claims.oid) {
    await record(store, current, actor.userId, null, "PROFILE_MISMATCH", "Microsoft profile did not match the identity token");
    return finish("tenant");
  }

  const key = activeIdentityKey(claims.tid, claims.oid);
  const other = await store.findActiveIdentity(key);
  if (other && other.userId !== actor.userId) return finish("forbidden");

  const existing = await store.findConnectionByUser(actor.userId);
  const scopes = [...grantedScopeSet(token.json.scope)].join(" ");
  const calendarOk = hasCalendarConsent(scopes);
  const row: StoredConnection = {
    id: existing?.id ?? newId(random),
    userId: actor.userId,
    status: "CONNECTED",
    tenantId: claims.tid,
    microsoftUserId: claims.oid,
    activeIdentityKey: key,
    microsoftEmail: profile.mail || profile.userPrincipalName || claims.preferredUsername,
    displayName: profile.displayName || claims.name,
    scopes,
    taskSyncEnabled: existing?.taskSyncEnabled ?? false,
    calendarSyncEnabled: calendarOk ? (existing?.calendarSyncEnabled ?? false) : false,
    accessTokenEncrypted: encryptSecret(token.json.access_token),
    refreshTokenEncrypted: encryptSecret(token.json.refresh_token),
    accessTokenExpiresAt: new Date(current.getTime() + Math.max(60, Number(token.json.expires_in) || 3600) * 1000),
    lastTokenRefreshAt: current,
    lastTaskSyncAt: existing?.lastTaskSyncAt ?? null,
    lastCalendarSyncAt: existing?.lastCalendarSyncAt ?? null,
    lastError: null,
    connectedAt: existing?.connectedAt ?? current,
    disconnectedAt: null,
  };
  try {
    await store.saveConnection(row);
  } catch (error) {
    if (error instanceof MicrosoftIdentityConflict) return finish("forbidden");
    throw error;
  }
  await record(store, current, actor.userId, row.id, "CONNECTED", "Microsoft 365 account connected");
  return finish("connected");
}

export async function disconnectMicrosoftAccount(
  actor: Microsoft365Actor,
  gate: Microsoft365Gate,
  input: Microsoft365Deps,
): Promise<Microsoft365Status> {
  if (actor.actorType !== "INTERNAL") {
    throw new Microsoft365Error("FORBIDDEN", "Not permitted to disconnect Microsoft 365");
  }
  const { store, now } = deps(input);
  const current = now();
  const existing = await store.findConnectionByUser(actor.userId);
  if (existing) {
    await store.saveConnection({
      ...existing,
      status: "REVOKED",
      activeIdentityKey: null,
      accessTokenEncrypted: null,
      refreshTokenEncrypted: null,
      accessTokenExpiresAt: null,
      taskSyncEnabled: false,
      calendarSyncEnabled: false,
      disconnectedAt: current,
      lastError: null,
    });
    await record(store, current, actor.userId, existing.id, "DISCONNECTED", "Microsoft 365 account disconnected");
  }
  await store.deleteTransactionsForUser(actor.userId);
  return getMicrosoft365Status(actor, gate, input);
}

export async function updateMicrosoft365Preferences(
  actor: Microsoft365Actor,
  inputPrefs: { taskSyncEnabled: boolean; calendarSyncEnabled: boolean },
  gate: Microsoft365Gate,
  depsInput: Microsoft365Deps,
): Promise<{ needsCalendarConsent: boolean; status: Microsoft365Status }> {
  assertCanConnect(actor);
  const { store, now } = deps(depsInput);
  const existing = await store.findConnectionByUser(actor.userId);
  if (!existing || existing.status !== "CONNECTED") {
    throw new Microsoft365Error("NOT_CONNECTED", "Connect Microsoft 365 before changing sync preferences");
  }
  const turningOn = inputPrefs.taskSyncEnabled || inputPrefs.calendarSyncEnabled;
  if (turningOn && gate.state !== "ready") {
    throw new Microsoft365Error(
      gate.state === "disabled" ? "DISABLED" : "NOT_CONFIGURED",
      "Microsoft 365 integration is turned off",
    );
  }
  if (inputPrefs.calendarSyncEnabled && !hasCalendarConsent(existing.scopes)) {
    return { needsCalendarConsent: true, status: await getMicrosoft365Status(actor, gate, depsInput) };
  }
  const current = now();
  await store.saveConnection({
    ...existing,
    taskSyncEnabled: inputPrefs.taskSyncEnabled,
    calendarSyncEnabled: inputPrefs.calendarSyncEnabled,
    lastError: null,
  });
  await record(store, current, actor.userId, existing.id, "PREFERENCES_UPDATED", "Microsoft sync preferences updated");
  return { needsCalendarConsent: false, status: await getMicrosoft365Status(actor, gate, depsInput) };
}

export async function refreshMicrosoftConnection(
  actor: Microsoft365Actor,
  gate: Microsoft365Gate,
  input: Microsoft365Deps,
): Promise<{ refreshed: boolean }> {
  assertCanConnect(actor);
  if (gate.state !== "ready") {
    throw new Microsoft365Error(gate.state === "disabled" ? "DISABLED" : "NOT_CONFIGURED", "Microsoft 365 integration is turned off");
  }
  const { store, fetchImpl, now } = deps(input);
  const existing = await store.findConnectionByUser(actor.userId);
  if (!existing || existing.status !== "CONNECTED") {
    throw new Microsoft365Error("NOT_CONNECTED", "Microsoft 365 is not connected");
  }
  const current = now();
  if (
    existing.accessTokenEncrypted &&
    existing.accessTokenExpiresAt &&
    existing.accessTokenExpiresAt.getTime() - current.getTime() > ACCESS_SKEW_MS
  ) {
    return { refreshed: false };
  }
  const refreshToken = decryptSecret(existing.refreshTokenEncrypted);
  if (!refreshToken) {
    await revoke(store, existing, current, "Microsoft 365 needs to be connected again");
    throw new Microsoft365Error("REVOKED", "Microsoft 365 needs to be connected again");
  }
  let token: { status: number; json: TokenJson; retryAfter: string | null };
  try {
    token = await postToken(
      gate.config,
      new URLSearchParams({
        client_id: gate.config.clientId,
        client_secret: gate.config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: scopesForConnect(hasCalendarConsent(existing.scopes)).join(" "),
      }),
      fetchImpl,
    );
  } catch (error) {
    await store.saveConnection({
      ...existing,
      lastError: sanitizeMicrosoftMessage(error instanceof Error ? error.message : "Microsoft 365 could not be reached"),
    });
    await record(store, current, actor.userId, existing.id, "TOKEN_REFRESH_FAILED", error);
    throw new Microsoft365Error("TOKEN", "Microsoft 365 could not be reached");
  }
  if (token.status === 429) {
    const message = token.retryAfter
      ? `Microsoft rate limited token refresh. Retry after ${token.retryAfter} seconds.`
      : "Microsoft rate limited token refresh.";
    await store.saveConnection({ ...existing, lastError: message });
    throw new Microsoft365Error("RATE_LIMITED", message);
  }
  const fatal =
    token.status === 401 ||
    token.status === 400 ||
    token.json.error === "invalid_grant" ||
    token.json.error === "interaction_required" ||
    token.json.error === "consent_required";
  if (fatal || !token.json.access_token) {
    await revoke(store, existing, current, "Microsoft 365 authorisation expired. Connect the account again.");
    await record(store, current, actor.userId, existing.id, "TOKEN_REFRESH_FAILED", tokenError(token.json, token.status));
    throw new Microsoft365Error("REVOKED", "Microsoft 365 authorisation expired. Connect the account again.");
  }
  const nextRefresh = token.json.refresh_token ? encryptSecret(token.json.refresh_token) : existing.refreshTokenEncrypted;
  await store.saveConnection({
    ...existing,
    accessTokenEncrypted: encryptSecret(token.json.access_token),
    refreshTokenEncrypted: nextRefresh,
    accessTokenExpiresAt: new Date(current.getTime() + Math.max(60, Number(token.json.expires_in) || 3600) * 1000),
    lastTokenRefreshAt: current,
    lastError: null,
    scopes: token.json.scope ? [...grantedScopeSet(token.json.scope)].join(" ") : existing.scopes,
  });
  await record(store, current, actor.userId, existing.id, "TOKEN_REFRESHED", "Microsoft access token refreshed");
  return { refreshed: true };
}

async function revoke(
  store: Microsoft365Store,
  existing: StoredConnection,
  current: Date,
  message: string,
): Promise<void> {
  await store.saveConnection({
    ...existing,
    status: "REVOKED",
    activeIdentityKey: null,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    accessTokenExpiresAt: null,
    taskSyncEnabled: false,
    calendarSyncEnabled: false,
    disconnectedAt: current,
    lastError: message,
  });
}

async function record(
  store: Microsoft365Store,
  current: Date,
  userId: string,
  connectionId: string | null,
  kind: string,
  error: unknown,
): Promise<void> {
  const message = sanitizeMicrosoftMessage(error instanceof Error ? error.message : String(error));
  await store.appendEvent({
    id: randomBytes(16).toString("base64url"),
    userId,
    connectionId,
    kind,
    message,
    createdAt: current,
  });
}
