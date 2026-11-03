/**
 * Authenticator behaviour against a dedicated PostgreSQL database.
 * Import the database guard before Prisma or Better Auth connect.
 */
import "@/server/testing/use-protect-integration-database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";

import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { auth } from "@/infra/auth";
import { AuthError, requireAdminAccess, requireAuthenticatedUser, requireTradePortalAccess } from "@/server/rbac/guards";
import { deactivateStaffUser, resetUserAuthenticator } from "@/server/users/service";
import { revokeTrustedDevices } from "@/server/auth/trusted-devices";
import { isPrivilegedMfaEnforced, isStaffMfaEnforced, isCustomerMfaEnforced } from "@/domain/mfa-policy";
import { createMockSmtpTransport } from "@/infra/email/smtp";
import {
  getOrCreateEmailSettings,
  setSmtpTransportFactoryForTests,
  updateEmailSettings,
} from "@/server/email/settings";

const prisma = new PrismaClient();
const PASSWORD = "Mfa-Test-Password-99";
const stamp = Date.now().toString(36);

type Jar = Map<string, string>;

function clearFlags() {
  delete process.env["MFA_ENFORCE_PRIVILEGED"];
  delete process.env["MFA_ENFORCE_STAFF"];
  delete process.env["MFA_ENFORCE_CUSTOMERS"];
}

function headersFrom(jar: Jar): Headers {
  const headers = new Headers();
  if (jar.size > 0) {
    headers.set("cookie", [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; "));
  }
  return headers;
}

function absorbCookies(jar: Jar, headers: Headers | undefined) {
  if (!headers) return;
  const lines = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  for (const line of lines) {
    const pair = line.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const drop = /max-age=0/i.test(line) || value === "";
    if (drop) jar.delete(name);
    else jar.set(name, value);
  }
}

async function callAuth(
  endpoint: (input: {
    body: Record<string, unknown>;
    headers: Headers;
    returnHeaders: true;
  }) => Promise<unknown>,
  body: Record<string, unknown>,
  jar: Jar,
): Promise<{ ok: true; body: unknown } | { ok: false; error: unknown }> {
  try {
    const result = await endpoint({ body, headers: headersFrom(jar), returnHeaders: true });
    const wrapped = result as { headers?: Headers; response?: unknown };
    if (wrapped && typeof wrapped === "object" && wrapped.headers instanceof Headers) {
      absorbCookies(jar, wrapped.headers);
      return { ok: true, body: wrapped.response };
    }
    return { ok: true, body: result };
  } catch (error) {
    const headerCarrier = error as { headers?: Headers };
    if (headerCarrier?.headers instanceof Headers) absorbCookies(jar, headerCarrier.headers);
    return { ok: false, error };
  }
}

function mustBody(result: { ok: true; body: unknown } | { ok: false; error: unknown }): unknown {
  if (!result.ok) throw new Error(errorText(result.error));
  return result.body;
}

function errorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const body = "body" in error ? JSON.stringify((error as { body?: unknown }).body) : "";
  const message = error instanceof Error ? error.message : "";
  return `${message} ${body}`;
}

function otpForUri(uri: string) {
  const encoded = new URL(uri).searchParams.get("secret");
  if (!encoded) throw new Error("Authenticator setup link did not include a secret");
  const raw = new TextDecoder().decode(base32.decode(encoded));
  return createOTP(raw, { digits: 6, period: 30 });
}

async function shiftedCode(uri: string, periods: number): Promise<string> {
  const otp = otpForUri(uri);
  const counter = Math.floor(Date.now() / 30_000) + periods;
  return otp.hotp(counter);
}

async function makeUser(input: {
  email: string;
  actorType: "INTERNAL" | "TRADE";
  roles?: string[];
  status?: "ACTIVE" | "DISABLED" | "INVITED";
}) {
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.email.split("@")[0]!,
      status: input.status ?? "ACTIVE",
      actorType: input.actorType,
      emailVerified: true,
    },
  });
  await prisma.authAccount.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: await hashPassword(PASSWORD),
    },
  });
  for (const key of input.roles ?? []) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  }
  return user;
}

async function signIn(email: string, jar: Jar = new Map()) {
  const result = await callAuth(
    auth.api.signInEmail as never,
    { email, password: PASSWORD },
    jar,
  );
  return { ...result, jar };
}

function redirecting(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && "twoFactorRedirect" in body && (body as { twoFactorRedirect?: boolean }).twoFactorRedirect);
}

async function sessionCount(userId: string) {
  return prisma.authSession.count({ where: { userId } });
}

async function trustCount(userId: string) {
  return prisma.authVerification.count({
    where: { value: userId, identifier: { startsWith: "trust-device-" } },
  });
}

function assertClean(text: string, secrets: string[]) {
  const lower = text.toLowerCase();
  expect(lower).not.toContain("otpauth");
  expect(lower).not.toContain("secret");
  for (const secret of secrets) {
    if (secret) expect(text).not.toContain(secret);
  }
}

describe("authenticator integration", () => {
  const emails = {
    enrol: `mfa.enrol.${stamp}@example.invalid`,
    login: `mfa.login.${stamp}@example.invalid`,
    backup: `mfa.backup.${stamp}@example.invalid`,
    disable: `mfa.disable.${stamp}@example.invalid`,
    trust: `mfa.trust.${stamp}@example.invalid`,
    lock: `mfa.lock.${stamp}@example.invalid`,
    session: `mfa.session.${stamp}@example.invalid`,
    staff: `mfa.staff.${stamp}@example.invalid`,
    accounts: `mfa.accounts.${stamp}@example.invalid`,
    manager: `mfa.manager.${stamp}@example.invalid`,
    trade: `mfa.trade.${stamp}@example.invalid`,
    disabled: `mfa.disabled.${stamp}@example.invalid`,
    resetTarget: `mfa.reset.target.${stamp}@example.invalid`,
    resetActor: `mfa.reset.actor.${stamp}@example.invalid`,
    resetOrdinary: `mfa.reset.ordinary.${stamp}@example.invalid`,
    concurrent: `mfa.concurrent.${stamp}@example.invalid`,
  };
  let actorId = "";

  beforeAll(async () => {
    clearFlags();
    await bootstrapRbac(prisma);
    actorId = (await makeUser({ email: emails.resetActor, actorType: "INTERNAL", roles: ["SUPER_ADMIN"] })).id;
    await getOrCreateEmailSettings();
    setSmtpTransportFactoryForTests(() => createMockSmtpTransport({ sendResult: { ok: true, id: "mfa" } }));
    await updateEmailSettings(actorId, {
      enabled: true,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpSecurity: "STARTTLS",
      smtpUsername: "b2b@example.com",
      smtpPassword: "smtp-secret",
      replacePassword: true,
      fromName: "Automotive Brands",
      fromEmail: "b2b@example.com",
    });
  }, 120_000);

  afterAll(async () => {
    clearFlags();
    setSmtpTransportFactoryForTests(null);
    await prisma.$disconnect();
  });

  it("leaves enforcement flags off and lets a password session through", async () => {
    clearFlags();
    expect(isPrivilegedMfaEnforced()).toBe(false);
    expect(isStaffMfaEnforced()).toBe(false);
    expect(isCustomerMfaEnforced()).toBe(false);
    const user = await makeUser({ email: emails.session, actorType: "INTERNAL", roles: ["SUPER_ADMIN"] });
    const signed = await signIn(emails.session);
    expect(signed.ok).toBe(true);
    expect(redirecting(signed.ok ? signed.body : null)).toBe(false);
    expect(await sessionCount(user.id)).toBe(1);
    await expect(requireAuthenticatedUser(user.id)).resolves.toMatchObject({ userId: user.id });
    await expect(requireAdminAccess(user.id)).resolves.toMatchObject({ userId: user.id });
  });

  it("does not activate the authenticator until the enrolment code is accepted", async () => {
    const user = await makeUser({ email: emails.enrol, actorType: "INTERNAL", roles: ["SUPER_ADMIN"] });
    const jar = new Map<string, string>();
    const signed = await signIn(emails.enrol, jar);
    expect(signed.ok).toBe(true);
    const started = await callAuth(auth.api.enableTwoFactor as never, { password: PASSWORD }, jar);
    expect(started.ok).toBe(true);
    const totpURI = String((started.ok ? (started.body as { totpURI?: string }).totpURI : "") ?? "");
    const backupCodes = (started.ok ? (started.body as { backupCodes?: string[] }).backupCodes : []) ?? [];
    expect(totpURI.startsWith("otpauth://")).toBe(true);
    expect(backupCodes.length).toBe(10);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const factor = await prisma.twoFactor.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.twoFactorEnabled).toBe(false);
    expect(factor.verified).toBe(false);
    expect(factor.secret).not.toContain("otpauth");
    const wrong = await callAuth(auth.api.verifyTOTP as never, { code: "000000" }, jar);
    expect(wrong.ok).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(false);

    const expired = await shiftedCode(totpURI, -2);
    const current = await shiftedCode(totpURI, 0);
    if (expired !== current) {
      const expiredAttempt = await callAuth(auth.api.verifyTOTP as never, { code: expired }, jar);
      expect(expiredAttempt.ok).toBe(false);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(false);
    }
    const confirmed = await callAuth(auth.api.verifyTOTP as never, { code: current }, jar);
    expect(confirmed.ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorEnabled).toBe(true);
    expect((await prisma.twoFactor.findFirstOrThrow({ where: { userId: user.id } })).verified).toBe(true);
  });

  it("requires a code after the password and rejects an invalid or expired code", async () => {
    const user = await makeUser({ email: emails.login, actorType: "INTERNAL", roles: ["ACCOUNTS"] });
    const setup = new Map<string, string>();
    await signIn(emails.login, setup);
    const started = await callAuth(auth.api.enableTwoFactor as never, { password: PASSWORD }, setup);
    const totpURI = String((mustBody(started) as { totpURI: string }).totpURI);
    await callAuth(auth.api.verifyTOTP as never, { code: await shiftedCode(totpURI, 0) }, setup);
    await callAuth(auth.api.signOut as never, {}, setup);

    const challenge = new Map<string, string>();
    const passwordOnly = await signIn(emails.login, challenge);
    expect(passwordOnly.ok).toBe(true);
    expect(redirecting(mustBody(passwordOnly))).toBe(true);
    expect(await sessionCount(user.id)).toBe(0);
    const pendingSession = await auth.api.getSession({ headers: headersFrom(challenge) });
    expect(pendingSession).toBeNull();

    const invalid = await callAuth(auth.api.verifyTOTP as never, { code: "000000" }, challenge);
    expect(invalid.ok).toBe(false);
    expect(await sessionCount(user.id)).toBe(0);
    const expiredCode = await shiftedCode(totpURI, -2);
    const fresh = await shiftedCode(totpURI, 0);
    if (expiredCode !== fresh) {
      const expired = await callAuth(auth.api.verifyTOTP as never, { code: expiredCode }, challenge);
      expect(expired.ok).toBe(false);
      expect(await sessionCount(user.id)).toBe(0);
    }
    const accepted = await callAuth(auth.api.verifyTOTP as never, { code: fresh }, challenge);
    expect(accepted.ok).toBe(true);
    expect(await sessionCount(user.id)).toBe(1);
    expect(await auth.api.getSession({ headers: headersFrom(challenge) })).toMatchObject({
      user: { id: user.id },
    });
  });

  it("accepts a recovery code once, replaces the set, and rejects the old code", async () => {
    const user = await makeUser({ email: emails.backup, actorType: "INTERNAL", roles: ["SUPER_ADMIN"] });
    const setup = new Map<string, string>();
    await signIn(emails.backup, setup);
    const started = await callAuth(auth.api.enableTwoFactor as never, { password: PASSWORD }, setup);
    const totpURI = String((mustBody(started) as { totpURI: string }).totpURI);
    const original = [...((mustBody(started) as { backupCodes: string[] }).backupCodes)];
    await callAuth(auth.api.verifyTOTP as never, { code: await shiftedCode(totpURI, 0) }, setup);
    const replaced = await callAuth(auth.api.generateBackupCodes as never, { password: PASSWORD }, setup);
    expect(replaced.ok).toBe(true);
    const nextCodes = (mustBody(replaced) as { backupCodes?: string[] }).backupCodes ?? [];
    expect(nextCodes.length).toBe(10);
    expect(nextCodes.some((code) => original.includes(code))).toBe(false);
    await callAuth(auth.api.signOut as never, {}, setup);

    const first = new Map<string, string>();
    await signIn(emails.backup, first);
    const used = await callAuth(auth.api.verifyBackupCode as never, { code: nextCodes[0] }, first);
    expect(used.ok).toBe(true);
    expect(await sessionCount(user.id)).toBe(1);
    await callAuth(auth.api.signOut as never, {}, first);

    const reuse = new Map<string, string>();
    await signIn(emails.backup, reuse);
    const again = await callAuth(auth.api.verifyBackupCode as never, { code: nextCodes[0] }, reuse);
    expect(again.ok).toBe(false);
    expect(await sessionCount(user.id)).toBe(0);
    const stale = await callAuth(auth.api.verifyBackupCode as never, { code: original[0] }, reuse);
    expect(stale.ok).toBe(false);
    const freshCode = await callAuth(auth.api.verifyBackupCode as never, { code: nextCodes[1] }, reuse);
    expect(freshCode.ok).toBe(true);
  });

  it("lets a password sign-in through again after the authenticator is switched off", async () => {
    const user = await makeUser({ email: emails.disable, actorType: "INTERNAL", roles: ["MANAGEMENT"] });
    const jar = new Map<string, string>();
    await signIn(emails.disable, jar);
    const started = await callAuth(auth.api.enableTwoFactor as never, { password: PASSWORD }, jar);
    const totpURI = String((mustBody(started) as { totpURI: string }).totpURI);
    await callAuth(auth.api.verifyTOTP as never, { code: await shiftedCode(totpURI, 0) }, jar);
    await callAuth(auth.api.signOut as never, {}, jar);
    const challenge = new Map<string, string>();
    await signIn(emails.disable, challenge);
    await callAuth(auth.api.verifyTOTP as never, { code: await shiftedCode(totpURI, 0), trustDevice: true }, challenge);
    expect(await trustCount(user.id)).toBe(1);
    for (const [name, value] of challenge) jar.set(name, value);
    const disabled = await callAuth(auth.api.disableTwoFactor as never, { password: PASSWORD }, jar);
    expect(disabled.ok).toBe(true);
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, mfaEnabled: false },
    });
    await revokeTrustedDevices(user.id);
    expect(await prisma.twoFactor.count({ where: { userId: user.id } })).toBe(0);
    expect(await trustCount(user.id)).toBe(0);
    await callAuth(auth.api.signOut as never, {}, jar);
    const again = await signIn(emails.disable);
    expect(again.ok).toBe(true);
    expect(redirecting(mustBody(again))).toBe(false);
    expect(await sessionCount(user.id)).toBeGreaterThan(0);
  });

  it("remembers a browser for 30 days and forgets it when that record expires or the password changes", async () => {
    const user = await makeUser({ email: emails.trust, actorType: "INTERNAL", roles: ["SUPER_ADMIN"] });
    const setup = new Map<string, string>();
    await signIn(emails.trust, setup);
    const started = await callAuth(auth.api.enableTwoFactor as never, { password: PASSWORD }, setup);
    const totpURI = String((mustBody(started) as { totpURI: string }).totpURI);
    await callAuth(auth.api.verifyTOTP as never, { code: await shiftedCode(totpURI, 0) }, setup);
    await callAuth(auth.api.signOut as never, {}, setup);
    const trustedSignIn = new Map<string, string>();
    await signIn(emails.trust, trustedSignIn);
    await callAuth(
      auth.api.verifyTOTP as never,
      { code: await shiftedCode(totpURI, 0), trustDevice: true },
      trustedSignIn,
    );
    for (const [name, value] of trustedSignIn) setup.set(name, value);
    const trust = await prisma.authVerification.findFirstOrThrow({
      where: { value: user.id, identifier: { startsWith: "trust-device-" } },
    });
    const lifetime = trust.expiresAt.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(lifetime).toBeLessThan(31 * 24 * 60 * 60 * 1000);
    await callAuth(auth.api.signOut as never, {}, setup);
    const remembered = await signIn(emails.trust, setup);
    expect(redirecting(mustBody(remembered))).toBe(false);
    expect(await sessionCount(user.id)).toBe(1);

    const rotated = await prisma.authVerification.findFirstOrThrow({
      where: { value: user.id, identifier: { startsWith: "trust-device-" } },
    });
    await prisma.authVerification.update({
      where: { id: rotated.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await prisma.authSession.deleteMany({ where: { userId: user.id } });
    const expiredTrust = await signIn(emails.trust, setup);
    expect(redirecting(mustBody(expiredTrust))).toBe(true);
    expect(await sessionCount(user.id)).toBe(0);

    const second = new Map<string, string>();
    await signIn(emails.trust, second);
    await callAuth(auth.api.verifyTOTP as never, { code: await shiftedCode(totpURI, 0), trustDevice: true }, second);
    const other = new Map<string, string>();
    await signIn(emails.trust, other);
    await callAuth(auth.api.verifyTOTP as never, { code: await shiftedCode(totpURI, 0) }, other);
    expect(await sessionCount(user.id)).toBe(2);
    const changed = await callAuth(
      auth.api.changePassword as never,
      { currentPassword: PASSWORD, newPassword: "Mfa-Changed-Password-99", revokeOtherSessions: false },
      second,
    );
    expect(changed.ok).toBe(true);
    expect(await trustCount(user.id)).toBe(0);
    expect(await sessionCount(user.id)).toBe(1);

    await prisma.authVerification.create({
      data: {
        identifier: `trust-device-reset-${stamp}`,
        value: user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const token = `reset-${stamp}`;
    await prisma.authVerification.create({
      data: {
        identifier: `reset-password:${token}`,
        value: user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const reset = await callAuth(
      auth.api.resetPassword as never,
      { token, newPassword: "Mfa-Reset-Password-99" },
      new Map(),
    );
    expect(reset.ok).toBe(true);
    expect(await trustCount(user.id)).toBe(0);
    expect(await sessionCount(user.id)).toBe(0);
  });

  it("locks the account row after repeated failures so another process sees the same lock", async () => {
    const user = await makeUser({ email: emails.lock, actorType: "INTERNAL", roles: ["SUPER_ADMIN"] });
    const setup = new Map<string, string>();
    await signIn(emails.lock, setup);
    const started = await callAuth(auth.api.enableTwoFactor as never, { password: PASSWORD }, setup);
    const totpURI = String((mustBody(started) as { totpURI: string }).totpURI);
    await callAuth(auth.api.verifyTOTP as never, { code: await shiftedCode(totpURI, 0) }, setup);
    await callAuth(auth.api.signOut as never, {}, setup);

    for (let challenge = 0; challenge < 2; challenge += 1) {
      const jar = new Map<string, string>();
      await signIn(emails.lock, jar);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const failed = await callAuth(auth.api.verifyTOTP as never, { code: "000000" }, jar);
        expect(failed.ok).toBe(false);
      }
    }
    const locked = await prisma.twoFactor.findFirstOrThrow({ where: { userId: user.id } });
    expect(locked.failedVerificationCount).toBeGreaterThanOrEqual(10);
    expect(locked.lockedUntil && locked.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    const otherInstance = new Map<string, string>();
    await signIn(emails.lock, otherInstance);
    const correctWhileLocked = await callAuth(
      auth.api.verifyTOTP as never,
      { code: await shiftedCode(totpURI, 0) },
      otherInstance,
    );
    expect(correctWhileLocked.ok).toBe(false);
    expect(errorText(correctWhileLocked.ok ? null : correctWhileLocked.error).toLowerCase()).toContain("lock");
    expect(await sessionCount(user.id)).toBe(0);
  });

  it("blocks an existing password session when enforcement is switched on", async () => {
    clearFlags();
    const superAdmin = await prisma.user.findUniqueOrThrow({ where: { email: emails.session } });
    const accounts = await makeUser({ email: emails.accounts, actorType: "INTERNAL", roles: ["ACCOUNTS"] });
    const manager = await makeUser({ email: emails.manager, actorType: "INTERNAL", roles: ["MANAGEMENT"] });
    const staff = await makeUser({ email: emails.staff, actorType: "INTERNAL", roles: ["SALES_REPRESENTATIVE"] });
    const trade = await makeUser({ email: emails.trade, actorType: "TRADE" });
    const company = await prisma.company.create({
      data: { name: `MFA trade ${stamp}`, status: "ACTIVE", accountNumber: `MFA-${stamp}` },
    });
    await prisma.companyUser.create({
      data: { companyId: company.id, userId: trade.id, role: "TRADE_BUYER", status: "ACTIVE", isDefault: true },
    });

    process.env["MFA_ENFORCE_PRIVILEGED"] = "true";
    await expect(requireAuthenticatedUser(superAdmin.id)).rejects.toMatchObject({ code: "MFA_ENROLLMENT_REQUIRED" });
    await expect(requireAdminAccess(superAdmin.id)).rejects.toMatchObject({ code: "MFA_ENROLLMENT_REQUIRED" });
    await expect(requireAuthenticatedUser(accounts.id)).rejects.toMatchObject({ code: "MFA_ENROLLMENT_REQUIRED" });
    await expect(requireAuthenticatedUser(manager.id)).resolves.toMatchObject({ userId: manager.id });
    await expect(requireAuthenticatedUser(trade.id)).resolves.toMatchObject({ userId: trade.id });
    await expect(requireTradePortalAccess(trade.id)).resolves.toMatchObject({ userId: trade.id });
    const stillSignedIn = await auth.api.getSession({
      headers: headersFrom((await signIn(emails.session)).jar),
    });
    expect(stillSignedIn?.user.id).toBe(superAdmin.id);
    await expect(requireAuthenticatedUser(stillSignedIn?.user.id)).rejects.toMatchObject({
      code: "MFA_ENROLLMENT_REQUIRED",
    });

    process.env["MFA_ENFORCE_STAFF"] = "true";
    await expect(requireAuthenticatedUser(manager.id)).rejects.toMatchObject({ code: "MFA_ENROLLMENT_REQUIRED" });
    await expect(requireAuthenticatedUser(staff.id)).rejects.toMatchObject({ code: "MFA_ENROLLMENT_REQUIRED" });
    await expect(requireAuthenticatedUser(trade.id)).resolves.toMatchObject({ userId: trade.id });

    process.env["MFA_ENFORCE_CUSTOMERS"] = "true";
    await expect(requireAuthenticatedUser(trade.id)).rejects.toMatchObject({ code: "MFA_ENROLLMENT_REQUIRED" });
    await expect(requireTradePortalAccess(trade.id)).rejects.toMatchObject({ code: "MFA_ENROLLMENT_REQUIRED" });

    await prisma.user.update({ where: { id: superAdmin.id }, data: { twoFactorEnabled: true } });
    await expect(requireAuthenticatedUser(superAdmin.id)).resolves.toMatchObject({ userId: superAdmin.id });
    clearFlags();
    await expect(requireAuthenticatedUser(staff.id)).resolves.toMatchObject({ userId: staff.id });
    await expect(requireAuthenticatedUser(trade.id)).resolves.toMatchObject({ userId: trade.id });
  });

  it("stops a disabled account from signing in or using a leftover session", async () => {
    const user = await makeUser({ email: emails.disabled, actorType: "INTERNAL", roles: ["SALES_REPRESENTATIVE"] });
    const signed = await signIn(emails.disabled);
    expect(signed.ok).toBe(true);
    await deactivateStaffUser(actorId, { id: user.id });
    expect(await sessionCount(user.id)).toBe(0);
    expect(await trustCount(user.id)).toBe(0);
    const blocked = await signIn(emails.disabled);
    expect(blocked.ok).toBe(false);
    await prisma.authSession.create({
      data: {
        userId: user.id,
        token: `leftover-${stamp}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await expect(requireAuthenticatedUser(user.id)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("lets only a different Super Admin reset an authenticator, and tells the account without the secret", async () => {
    const target = await makeUser({ email: emails.resetTarget, actorType: "INTERNAL", roles: ["ACCOUNTS"] });
    const ordinary = await makeUser({
      email: emails.resetOrdinary,
      actorType: "INTERNAL",
      roles: ["MANAGEMENT"],
    });
    await prisma.userPermissionOverride.create({
      data: { userId: ordinary.id, permissionKey: "users.manage", effect: "ALLOW" },
    });
    const setup = new Map<string, string>();
    await signIn(emails.resetTarget, setup);
    const started = await callAuth(auth.api.enableTwoFactor as never, { password: PASSWORD }, setup);
    const totpURI = String((mustBody(started) as { totpURI: string }).totpURI);
    const backup = ((mustBody(started) as { backupCodes: string[] }).backupCodes)[0]!;
    await callAuth(auth.api.verifyTOTP as never, { code: await shiftedCode(totpURI, 0), trustDevice: true }, setup);
    const storedSecret = (await prisma.twoFactor.findFirstOrThrow({ where: { userId: target.id } })).secret;

    await expect(resetUserAuthenticator(ordinary.id, { id: target.id, password: PASSWORD })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(resetUserAuthenticator(actorId, { id: actorId, password: PASSWORD })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(resetUserAuthenticator(actorId, { id: target.id, password: "wrong-password" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(await prisma.twoFactor.count({ where: { userId: target.id } })).toBe(1);

    const captured: string[] = [];
    const recipients: string[] = [];
    setSmtpTransportFactoryForTests(() =>
      createMockSmtpTransport({
        sendResult: { ok: true, id: "mfa-reset" },
        onSend: (message) => {
          recipients.push(message.to);
          captured.push(`${message.subject}\n${message.text ?? ""}`);
        },
      }),
    );
    const logs: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(" "));
    };
    let reset: { emailSent: boolean };
    try {
      reset = await resetUserAuthenticator(actorId, { id: target.id, password: PASSWORD });
    } finally {
      console.error = original;
    }
    expect(reset.emailSent).toBe(true);
    expect(JSON.stringify(reset)).not.toContain(storedSecret);
    expect(JSON.stringify(reset)).not.toContain(backup);
    expect(await prisma.twoFactor.count({ where: { userId: target.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).twoFactorEnabled).toBe(false);
    expect(await sessionCount(target.id)).toBe(0);
    expect(await trustCount(target.id)).toBe(0);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "MFA_ADMIN_RESET", entityId: target.id },
    });
    const auditText = JSON.stringify(audit);
    const notice = captured.join("\n");
    assertClean(`${auditText}\n${notice}\n${logs.join("\n")}`, [storedSecret, backup, totpURI, PASSWORD]);
    expect(recipients).toContain(emails.resetTarget);
    expect(notice.toLowerCase()).toContain("authenticator");
  });

  it("keeps two browsers signed in until a password change removes the other one", async () => {
    const user = await makeUser({ email: emails.concurrent, actorType: "INTERNAL", roles: ["CUSTOMER_SERVICE"] });
    const first = await signIn(emails.concurrent);
    const second = await signIn(emails.concurrent);
    expect(first.ok && second.ok).toBe(true);
    expect(await sessionCount(user.id)).toBe(2);
    const changed = await callAuth(
      auth.api.changePassword as never,
      { currentPassword: PASSWORD, newPassword: "Mfa-Concurrent-Password-99", revokeOtherSessions: false },
      second.jar,
    );
    expect(changed.ok).toBe(true);
    expect(await sessionCount(user.id)).toBe(1);
    expect(await auth.api.getSession({ headers: headersFrom(first.jar) })).toBeNull();
    expect(await auth.api.getSession({ headers: headersFrom(second.jar) })).toMatchObject({
      user: { id: user.id },
    });
  });
});
