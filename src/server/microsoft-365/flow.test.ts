import { createSign, generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  hashOAuthState,
  isOAuthTransactionOpen,
  pkceChallengeS256,
  type Microsoft365Actor,
  type Microsoft365Gate,
  type MicrosoftSigningKey,
} from "@/domain/microsoft-365-crm";
import { decryptSecret } from "@/server/crypto/secret";
import {
  beginMicrosoftConnect,
  type MicrosoftFetch,
  completeMicrosoftCallback,
  disconnectMicrosoftAccount,
  getMicrosoft365Status,
  refreshMicrosoftConnection,
  updateMicrosoft365Preferences,
  type Microsoft365Deps,
} from "@/server/microsoft-365/flow";
import { decryptMicrosoftToken } from "@/server/microsoft-365/token-cipher";
import {
  MicrosoftIdentityConflict,
  type Microsoft365Store,
  type StoredConnection,
  type StoredHealthRow,
  type StoredOAuthTransaction,
  type StoredSyncEvent,
} from "@/server/microsoft-365/store";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-31T12:00:00.000Z");
const REFRESH = "refresh-MARKER-9f3a-not-a-jwt";
const ACCESS = "access-MARKER-9f3a-not-a-jwt";
const MS_KEY = "microsoft-365-test-encryption-key-32ch";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" });
const TEST_KEY: MicrosoftSigningKey = {
  kid: "test-key",
  n: String(publicJwk.n),
  e: String(publicJwk.e),
};

let previousEncryptionKey: string | undefined;

beforeAll(() => {
  previousEncryptionKey = process.env["MICROSOFT_365_ENCRYPTION_KEY"];
  process.env["MICROSOFT_365_ENCRYPTION_KEY"] = MS_KEY;
});

afterAll(() => {
  if (previousEncryptionKey === undefined) delete process.env["MICROSOFT_365_ENCRYPTION_KEY"];
  else process.env["MICROSOFT_365_ENCRYPTION_KEY"] = previousEncryptionKey;
});

function signedDeps(extra: Microsoft365Deps): Microsoft365Deps {
  return { signingKeys: async () => [TEST_KEY], ...extra };
}

const ready: Microsoft365Gate = {
  state: "ready",
  config: {
    tenantId: TENANT,
    clientId: CLIENT,
    clientSecret: "client-secret-value",
    redirectUri: "https://automotivebrands.co.uk/api/microsoft-365/callback",
  },
};

function actor(partial: Partial<Microsoft365Actor> & Pick<Microsoft365Actor, "userId">): Microsoft365Actor {
  return {
    userId: partial.userId,
    actorType: partial.actorType ?? "INTERNAL",
    canConnect: partial.canConnect ?? true,
    canViewAdminHealth: partial.canViewAdminHealth ?? false,
  };
}

function memoryStore(): Microsoft365Store & {
  transactions: StoredOAuthTransaction[];
  connections: StoredConnection[];
  events: StoredSyncEvent[];
} {
  const transactions: StoredOAuthTransaction[] = [];
  const connections: StoredConnection[] = [];
  const events: StoredSyncEvent[] = [];
  return {
    transactions,
    connections,
    events,
    async insertTransaction(row) {
      transactions.push(row);
    },
    async consumeTransaction(stateHash, now) {
      const row = transactions.find((item) => item.stateHash === stateHash);
      if (!row || !isOAuthTransactionOpen(row, now)) return null;
      row.consumedAt = now;
      return { ...row };
    },
    async deleteTransactionsForUser(userId) {
      for (let i = transactions.length - 1; i >= 0; i -= 1) {
        if (transactions[i]?.userId === userId) transactions.splice(i, 1);
      }
    },
    async findConnectionByUser(userId) {
      return connections.find((item) => item.userId === userId) ?? null;
    },
    async findActiveIdentity(activeIdentityKey) {
      return connections.find((item) => item.activeIdentityKey === activeIdentityKey && item.status === "CONNECTED") ?? null;
    },
    async saveConnection(row) {
      const clash = connections.find(
        (item) => item.activeIdentityKey && item.activeIdentityKey === row.activeIdentityKey && item.userId !== row.userId,
      );
      if (clash) throw new MicrosoftIdentityConflict();
      const index = connections.findIndex((item) => item.userId === row.userId);
      if (index >= 0) connections[index] = row;
      else connections.push(row);
    },
    async listHealth(): Promise<StoredHealthRow[]> {
      return connections.map((item) => ({
        userId: item.userId,
        userEmail: `${item.userId}@automotivebrands.co.uk`,
        displayName: item.displayName,
        microsoftEmail: item.microsoftEmail,
        status: item.status,
        taskSyncEnabled: item.taskSyncEnabled,
        calendarSyncEnabled: item.calendarSyncEnabled,
        lastError: item.lastError,
        lastTokenRefreshAt: item.lastTokenRefreshAt,
        connectedAt: item.connectedAt,
      }));
    },
    async appendEvent(event) {
      events.push(event);
    },
  };
}

function jwt(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", kid: "test-key" }): string {
  const head = Buffer.from(JSON.stringify(header)).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  if (header["alg"] === "none") return `${head}.${body}.`;
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  signer.end();
  return `${head}.${body}.${signer.sign(privateKey).toString("base64url")}`;
}

function tokenPayload(nonce: string, oid = "oid-1") {
  return jwt({
    oid,
    tid: TENANT,
    aud: CLIENT,
    iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
    exp: Math.floor(NOW.getTime() / 1000) + 600,
    nonce,
    name: "Alex Sales",
    preferred_username: "alex@automotivebrands.co.uk",
  });
}

function installFetch(store: ReturnType<typeof memoryStore>, options?: { oid?: string; status?: number; error?: string; fail?: boolean; scope?: string }) {
  const calls: string[] = [];
  const fetchImpl: MicrosoftFetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (options?.fail) throw new Error("network down");
    if (url.includes("/oauth2/v2.0/token")) {
      const body = String(init?.body ?? "");
      expect(body).toContain("client_secret");
      if (body.includes("grant_type=authorization_code")) expect(body).not.toContain(REFRESH);
      if (options?.error) {
        return new Response(JSON.stringify({ error: options.error }), { status: options.status ?? 400 });
      }
      if ((options?.status ?? 200) >= 400) {
        const status = options?.status ?? 400;
        return new Response(JSON.stringify({ error: "server_error" }), {
          status,
          ...(status === 429 ? { headers: { "retry-after": "12" } } : {}),
        });
      }
      const nonce = [...store.transactions].reverse().find((item) => item.consumedAt)?.nonce ?? "nonce";
      return new Response(
        JSON.stringify({
          access_token: ACCESS,
          refresh_token: REFRESH,
          expires_in: 3600,
          id_token: tokenPayload(nonce, options?.oid ?? "oid-1"),
          scope: options?.scope ?? "openid profile offline_access User.Read Tasks.ReadWrite",
        }),
        { status: 200 },
      );
    }
    const oid = options?.oid ?? "oid-1";
    return new Response(JSON.stringify({ id: oid.toUpperCase(), displayName: "Alex Sales", mail: "alex@automotivebrands.co.uk" }), {
      status: 200,
    });
  };
  return { fetchImpl, calls };
}

async function connect(store: ReturnType<typeof memoryStore>, userId = "user-a", includeCalendar = false) {
  const buffers = [Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(16, 3), Buffer.alloc(16, 4)];
  let n = 0;
  const begun = await beginMicrosoftConnect(
    actor({ userId }),
    includeCalendar,
    ready,
    signedDeps({
      store,
      now: () => NOW,
      random: () => buffers[n++] ?? Buffer.alloc(16, n),
    }),
  );
  const state = buffers[0]!.toString("base64url");
  const verifier = buffers[1]!.toString("base64url");
  const url = new URL(begun.authorizationUrl);
  expect(url.searchParams.get("code_challenge")).toBe(pkceChallengeS256(verifier));
  expect(store.transactions[0]?.stateHash).toBe(hashOAuthState(state));
  expect(store.transactions[0]?.codeVerifierEncrypted).not.toContain(verifier);
  const { fetchImpl, calls } = installFetch(store);
  const done = await completeMicrosoftCallback(
    actor({ userId }),
    { code: "auth-code", state },
    ready,
    signedDeps({
      store,
      fetchImpl,
      now: () => NOW,
    }),
  );
  return { done, calls, state, url };
}

describe("Microsoft 365 OAuth flow", () => {
  it("connects with PKCE, encrypts tokens, and hides them from status", async () => {
    const store = memoryStore();
    const { done, calls, url } = await connect(store);
    expect(done.location).toBe("/crm/microsoft?microsoft=connected");
    expect(url.searchParams.get("scope")).not.toMatch(/Mail\.|Calendars/);
    expect(calls[0]).toContain(`/${TENANT}/oauth2/v2.0/token`);
    expect(calls[0]).not.toContain("/common/");
    expect(calls[1]).toContain("https://graph.microsoft.com/");
    const row = store.connections[0];
    expect(row?.refreshTokenEncrypted?.startsWith("v2:")).toBe(true);
    expect(decryptSecret(row?.refreshTokenEncrypted)).toBeNull();
    expect(decryptMicrosoftToken(row?.refreshTokenEncrypted)).toBe(REFRESH);
    expect(JSON.stringify(store.events)).not.toContain(REFRESH);
    expect(JSON.stringify(store.events)).not.toContain(ACCESS);
    const status = await getMicrosoft365Status(actor({ userId: "user-a" }), ready, { store });
    expect(JSON.stringify(status)).not.toContain(REFRESH);
    expect(status.connection?.email).toBe("alex@automotivebrands.co.uk");
    expect(status.connection?.taskSyncEnabled).toBe(false);
    expect(row?.microsoftUserId).toBe("oid-1");
  });

  it("rejects a reused state, a signed-out browser, and another user's state", async () => {
    const store = memoryStore();
    const { state } = await connect(store);
    const { fetchImpl, calls } = installFetch(store);
    const replay = await completeMicrosoftCallback(
      actor({ userId: "user-a" }),
      { code: "auth-code", state },
      ready,
      signedDeps({
        store,
        fetchImpl,
        now: () => NOW,
      }),
    );
    expect(replay.location).toBe("/crm/microsoft?microsoft=state");
    expect(calls).toHaveLength(0);

    const fresh = memoryStore();
    const begun = await beginMicrosoftConnect(actor({ userId: "user-a" }), false, ready, { store: fresh, now: () => NOW });
    const rawState = new URL(begun.authorizationUrl).searchParams.get("state");
    const loggedOut = await completeMicrosoftCallback(
      null,
      { code: "auth-code", state: rawState },
      ready,
      signedDeps({
        store: fresh,
        fetchImpl,
        now: () => NOW,
      }),
    );
    expect(loggedOut.location).toBe("/login?returnTo=%2Fcrm%2Fmicrosoft");
    expect(fresh.connections).toHaveLength(0);

    const stolen = await completeMicrosoftCallback(
      actor({ userId: "user-b" }),
      { code: "auth-code", state: rawState },
      ready,
      signedDeps({
        store: fresh,
        fetchImpl,
        now: () => new Date(NOW.getTime() + 1000),
      }),
    );
    expect(stolen.location).toBe("/crm/microsoft?microsoft=forbidden");
    expect(fresh.connections).toHaveLength(0);
    const afterTheft = await completeMicrosoftCallback(
      actor({ userId: "user-a" }),
      { code: "auth-code", state: rawState },
      ready,
      signedDeps({
        store: fresh,
        fetchImpl,
        now: () => new Date(NOW.getTime() + 2000),
      }),
    );
    expect(afterTheft.location).toBe("/crm/microsoft?microsoft=state");
    expect(fresh.connections).toHaveLength(0);
  });

  it("does not start a connection when the flag is off or the user is not allowed", async () => {
    const store = memoryStore();
    await expect(
      beginMicrosoftConnect(actor({ userId: "user-a" }), false, { state: "disabled", configured: true }, { store }),
    ).rejects.toMatchObject({ code: "DISABLED" });
    await expect(
      beginMicrosoftConnect(actor({ userId: "user-a", actorType: "TRADE", canConnect: false }), false, ready, { store }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      beginMicrosoftConnect(actor({ userId: "user-a", canConnect: false }), false, ready, { store }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.transactions).toHaveLength(0);
  });

  it("refuses a second CRM user binding the same Microsoft identity", async () => {
    const store = memoryStore();
    await connect(store, "user-a");
    const buffers = [Buffer.alloc(32, 9), Buffer.alloc(32, 8), Buffer.alloc(16, 7), Buffer.alloc(16, 6)];
    let n = 0;
    const begun = await beginMicrosoftConnect(
      actor({ userId: "user-b" }),
      false,
      ready,
      signedDeps({
        store,
        now: () => NOW,
        random: () => buffers[n++] ?? Buffer.alloc(16),
      }),
    );
    const state = buffers[0]!.toString("base64url");
    const { fetchImpl } = installFetch(store, { oid: "oid-1" });
    const done = await completeMicrosoftCallback(
      actor({ userId: "user-b" }),
      { code: "other-code", state },
      ready,
      signedDeps({
        store,
        fetchImpl,
        now: () => NOW,
      }),
    );
    expect(begun.authorizationUrl).toContain("login.microsoftonline.com");
    expect(done.location).toBe("/crm/microsoft?microsoft=forbidden");
    expect(store.connections.map((item) => item.userId)).toEqual(["user-a"]);
    expect(decryptMicrosoftToken(store.connections[0]?.refreshTokenEncrypted)).toBe(REFRESH);
  });

  it("clears tokens on disconnect and keeps task sync off while the platform flag is off", async () => {
    const store = memoryStore();
    await connect(store);
    store.connections[0]!.taskSyncEnabled = true;
    const off = await getMicrosoft365Status(actor({ userId: "user-a", canViewAdminHealth: true }), { state: "disabled", configured: true }, {
      store,
    });
    expect(off.platformEnabled).toBe(false);
    expect(off.connection?.taskSyncEnabled).toBe(false);
    expect(JSON.stringify(off.health)).not.toContain(REFRESH);
    const after = await disconnectMicrosoftAccount(actor({ userId: "user-a" }), ready, { store, now: () => NOW });
    expect(after.connection?.status).toBe("REVOKED");
    expect(store.connections[0]?.refreshTokenEncrypted).toBeNull();
    expect(store.connections[0]?.activeIdentityKey).toBeNull();
    expect(store.transactions).toHaveLength(0);
  });

  it("refreshes an expired token, honours rate limits, and revokes invalid grants", async () => {
    const store = memoryStore();
    await connect(store);
    const fresh = await refreshMicrosoftConnection(actor({ userId: "user-a" }), ready, { store, now: () => NOW });
    expect(fresh.refreshed).toBe(false);

    store.connections[0]!.accessTokenExpiresAt = new Date(NOW.getTime() + 30_000);
    const { fetchImpl } = installFetch(store);
    const rotated = await refreshMicrosoftConnection(actor({ userId: "user-a" }), ready, {
      store,
      fetchImpl,
      now: () => NOW,
    });
    expect(rotated.refreshed).toBe(true);
    expect(decryptMicrosoftToken(store.connections[0]?.accessTokenEncrypted)).toBe(ACCESS);

    store.connections[0]!.accessTokenExpiresAt = new Date(NOW.getTime() + 30_000);
    const limited = installFetch(store, { status: 429 });
    await expect(
      refreshMicrosoftConnection(actor({ userId: "user-a" }), ready, { store, fetchImpl: limited.fetchImpl, now: () => NOW }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(decryptMicrosoftToken(store.connections[0]?.refreshTokenEncrypted)).toBe(REFRESH);

    store.connections[0]!.accessTokenExpiresAt = new Date(NOW.getTime() + 30_000);
    const denied = installFetch(store, { error: "invalid_grant", status: 400 });
    await expect(
      refreshMicrosoftConnection(actor({ userId: "user-a" }), ready, { store, fetchImpl: denied.fetchImpl, now: () => NOW }),
    ).rejects.toMatchObject({ code: "REVOKED" });
    expect(store.connections[0]?.status).toBe("REVOKED");
    expect(store.connections[0]?.refreshTokenEncrypted).toBeNull();
  });

  it("keeps tokens when the network fails and does not enable calendar sync without consent", async () => {
    const store = memoryStore();
    await connect(store);
    store.connections[0]!.accessTokenExpiresAt = new Date(NOW.getTime() - 1000);
    const failed = installFetch(store, { fail: true });
    await expect(
      refreshMicrosoftConnection(actor({ userId: "user-a" }), ready, { store, fetchImpl: failed.fetchImpl, now: () => NOW }),
    ).rejects.toMatchObject({ code: "TOKEN" });
    expect(store.connections[0]?.status).toBe("CONNECTED");
    expect(decryptMicrosoftToken(store.connections[0]?.refreshTokenEncrypted)).toBe(REFRESH);

    const prefs = await updateMicrosoft365Preferences(
      actor({ userId: "user-a" }),
      { taskSyncEnabled: true, calendarSyncEnabled: true },
      ready,
      { store, now: () => NOW },
    );
    expect(prefs.needsCalendarConsent).toBe(true);
    expect(store.connections[0]?.calendarSyncEnabled).toBe(false);
    expect(store.connections[0]?.taskSyncEnabled).toBe(false);
  });

  it("rejects the wrong Microsoft tenant before saving a connection", async () => {
    const store = memoryStore();
    const buffers = [Buffer.alloc(32, 4), Buffer.alloc(32, 5), Buffer.alloc(16, 6), Buffer.alloc(16, 7)];
    let n = 0;
    await beginMicrosoftConnect(
      actor({ userId: "user-a" }),
      false,
      ready,
      signedDeps({
        store,
        now: () => NOW,
        random: () => buffers[n++] ?? Buffer.alloc(16),
      }),
    );
    const state = buffers[0]!.toString("base64url");
    const fetchImpl: MicrosoftFetch = async (input) => {
      const url = String(input);
      if (url.includes("/token")) {
        const nonce = store.transactions[0]?.nonce ?? "";
        return new Response(
          JSON.stringify({
            access_token: ACCESS,
            refresh_token: REFRESH,
            expires_in: 3600,
            id_token: jwt({
              oid: "oid-1",
              tid: "33333333-3333-4333-8333-333333333333",
              aud: CLIENT,
              iss: "https://login.microsoftonline.com/33333333-3333-4333-8333-333333333333/v2.0",
              exp: Math.floor(NOW.getTime() / 1000) + 600,
              nonce,
            }),
            scope: "openid profile offline_access User.Read Tasks.ReadWrite",
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 500 });
    };
    const calls: string[] = [];
    const done = await completeMicrosoftCallback(
      actor({ userId: "user-a" }),
      { code: "auth-code", state },
      ready,
      signedDeps({
        store,
        fetchImpl: async (input, init) => {
          calls.push(String(input));
          return fetchImpl(input, init);
        },
        now: () => NOW,
      }),
    );
    expect(done.location).toBe("/crm/microsoft?microsoft=tenant");
    expect(calls.some((url) => url.includes("graph.microsoft.com"))).toBe(false);
    expect(store.connections).toHaveLength(0);
    expect(JSON.stringify(store.events)).not.toContain(REFRESH);
  });

  it("rejects an expired OAuth transaction before calling Microsoft", async () => {
    const store = memoryStore();
    const buffers = [Buffer.alloc(32, 3), Buffer.alloc(32, 4), Buffer.alloc(16, 5), Buffer.alloc(16, 6)];
    let n = 0;
    await beginMicrosoftConnect(
      actor({ userId: "user-a" }),
      false,
      ready,
      signedDeps({ store, now: () => NOW, random: () => buffers[n++] ?? Buffer.alloc(16) }),
    );
    const state = buffers[0]!.toString("base64url");
    const calls: string[] = [];
    const fetchImpl: MicrosoftFetch = async (input) => {
      calls.push(String(input));
      return new Response("{}", { status: 500 });
    };
    const expired = await completeMicrosoftCallback(
      actor({ userId: "user-a" }),
      { code: "auth-code", state },
      ready,
      signedDeps({
        store,
        fetchImpl,
        now: () => new Date(NOW.getTime() + 10 * 60 * 1000),
      }),
    );
    expect(expired.location).toBe("/crm/microsoft?microsoft=state");
    expect(calls).toHaveLength(0);
    expect(store.connections).toHaveLength(0);
    expect(store.transactions[0]?.consumedAt).toBeNull();
  });

  it("does not call Microsoft or save a connection while the flag is off", async () => {
    const store = memoryStore();
    const buffers = [Buffer.alloc(32, 2), Buffer.alloc(32, 3), Buffer.alloc(16, 4), Buffer.alloc(16, 5)];
    let n = 0;
    await beginMicrosoftConnect(
      actor({ userId: "user-a" }),
      false,
      ready,
      signedDeps({ store, now: () => NOW, random: () => buffers[n++] ?? Buffer.alloc(16) }),
    );
    const state = buffers[0]!.toString("base64url");
    const calls: string[] = [];
    const fetchImpl: MicrosoftFetch = async (input) => {
      calls.push(String(input));
      return new Response("{}", { status: 500 });
    };
    const blocked = await completeMicrosoftCallback(
      actor({ userId: "user-a" }),
      { code: "auth-code", state },
      { state: "disabled", configured: true },
      signedDeps({ store, fetchImpl, now: () => NOW }),
    );
    expect(blocked.location).toBe("/crm/microsoft?microsoft=disabled");
    expect(calls).toHaveLength(0);
    expect(store.connections).toHaveLength(0);

    const live = memoryStore();
    await connect(live);
    live.connections[0]!.accessTokenExpiresAt = new Date(NOW.getTime() - 1000);
    const before = live.connections[0]?.refreshTokenEncrypted;
    await expect(
      refreshMicrosoftConnection(actor({ userId: "user-a" }), { state: "disabled", configured: true }, {
        store: live,
        fetchImpl,
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: "DISABLED" });
    expect(calls).toHaveLength(0);
    expect(live.connections[0]?.status).toBe("CONNECTED");
    expect(live.connections[0]?.refreshTokenEncrypted).toBe(before);
  });

  it("refuses mailbox scopes and does not keep those tokens", async () => {
    const store = memoryStore();
    const buffers = [Buffer.alloc(32, 7), Buffer.alloc(32, 8), Buffer.alloc(16, 9), Buffer.alloc(16, 1)];
    let n = 0;
    await beginMicrosoftConnect(
      actor({ userId: "user-a" }),
      false,
      ready,
      signedDeps({ store, now: () => NOW, random: () => buffers[n++] ?? Buffer.alloc(16) }),
    );
    const state = buffers[0]!.toString("base64url");
    const calls: string[] = [];
    const { fetchImpl } = installFetch(store, {
      scope: "openid profile offline_access User.Read Tasks.ReadWrite Mail.Read",
    });
    const done = await completeMicrosoftCallback(
      actor({ userId: "user-a" }),
      { code: "auth-code", state },
      ready,
      signedDeps({
        store,
        fetchImpl: async (input, init) => {
          calls.push(String(input));
          return fetchImpl(input, init);
        },
        now: () => NOW,
      }),
    );
    expect(done.location).toBe("/crm/microsoft?microsoft=token");
    expect(calls.some((url) => url.includes("graph.microsoft.com"))).toBe(false);
    expect(store.connections).toHaveLength(0);
    expect(JSON.stringify(store.events)).not.toContain(REFRESH);
    expect(JSON.stringify(store.events)).not.toContain("Mail.Read");
  });

  it("revokes a refresh that returns a forbidden scope and does not store the new token", async () => {
    const store = memoryStore();
    await connect(store);
    store.connections[0]!.accessTokenExpiresAt = new Date(NOW.getTime() + 30_000);
    const { fetchImpl } = installFetch(store, { scope: "openid User.Read Tasks.ReadWrite Mail.Send" });
    await expect(
      refreshMicrosoftConnection(actor({ userId: "user-a" }), ready, { store, fetchImpl, now: () => NOW }),
    ).rejects.toMatchObject({ code: "REVOKED" });
    expect(store.connections[0]?.status).toBe("REVOKED");
    expect(store.connections[0]?.refreshTokenEncrypted).toBeNull();
    expect(store.connections[0]?.accessTokenEncrypted).toBeNull();
  });

  it("disconnects locally without calling Microsoft or touching another user's tokens", async () => {
    const store = memoryStore();
    await connect(store, "user-a");
    const other = store.connections[0]!;
    store.connections.push({
      ...other,
      id: "connection-b",
      userId: "user-b",
      microsoftUserId: "oid-2",
      activeIdentityKey: `${TENANT}:oid-2`,
      refreshTokenEncrypted: other.refreshTokenEncrypted,
    });
    const calls: string[] = [];
    const fetchImpl: MicrosoftFetch = async (input) => {
      calls.push(String(input));
      throw new Error("disconnect must not call Microsoft");
    };
    const after = await disconnectMicrosoftAccount(actor({ userId: "user-a" }), ready, {
      store,
      fetchImpl,
      now: () => NOW,
    });
    expect(calls).toHaveLength(0);
    expect(after.connection?.status).toBe("REVOKED");
    expect(store.connections.find((item) => item.userId === "user-b")?.refreshTokenEncrypted).toBe(other.refreshTokenEncrypted);
    await expect(
      disconnectMicrosoftAccount(actor({ userId: "user-a", actorType: "TRADE", canConnect: false }), ready, { store }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects an unsigned identity token before reading its claims as a connection", async () => {
    const store = memoryStore();
    const buffers = [Buffer.alloc(32, 5), Buffer.alloc(32, 6), Buffer.alloc(16, 7), Buffer.alloc(16, 8)];
    let n = 0;
    await beginMicrosoftConnect(
      actor({ userId: "user-a" }),
      false,
      ready,
      signedDeps({ store, now: () => NOW, random: () => buffers[n++] ?? Buffer.alloc(16) }),
    );
    const state = buffers[0]!.toString("base64url");
    const nonce = store.transactions[0]?.nonce ?? "";
    const unsigned = jwt(
      {
        oid: "attacker",
        tid: TENANT,
        aud: CLIENT,
        iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
        exp: Math.floor(NOW.getTime() / 1000) + 600,
        nonce,
      },
      { alg: "none", kid: "test-key" },
    );
    const calls: string[] = [];
    const done = await completeMicrosoftCallback(
      actor({ userId: "user-a" }),
      { code: "auth-code", state },
      ready,
      signedDeps({
        store,
        now: () => NOW,
        fetchImpl: async (input) => {
          calls.push(String(input));
          if (String(input).includes("/token")) {
            return new Response(
              JSON.stringify({
                access_token: ACCESS,
                refresh_token: REFRESH,
                expires_in: 3600,
                id_token: unsigned,
                scope: "openid profile offline_access User.Read Tasks.ReadWrite",
              }),
              { status: 200 },
            );
          }
          return new Response(JSON.stringify({ id: "attacker" }), { status: 200 });
        },
      }),
    );
    expect(done.location).toBe("/crm/microsoft?microsoft=token");
    expect(calls.some((url) => url.includes("graph.microsoft.com"))).toBe(false);
    expect(store.connections).toHaveLength(0);
  });
});
