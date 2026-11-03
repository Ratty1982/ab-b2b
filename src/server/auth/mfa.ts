/**
 * Authenticator enrolment — Better Auth twoFactor (TOTP + backup codes).
 * Secrets and recovery codes are returned once to the signed-in user.
 * They are never written to audit metadata, logs, or security email.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import QRCode from "qrcode";
import { z } from "zod";

import { auth } from "@/infra/auth";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { resolveRequestClientSession } from "@/server/auth/request-session";
import { revokeTrustedDevices } from "@/server/auth/trusted-devices";
import { assessAttempt } from "@/server/security/attempts";
import { publishSecurityAlert } from "@/server/security/alerts";
import {
  isCustomerMfaEnforced,
  isPrivilegedMfaEnforced,
  isStaffMfaEnforced,
  mfaEnrollmentRequired,
} from "@/domain/mfa-policy";

const passwordSchema = z.object({
  password: z.string().min(1).max(128),
});

const codeSchema = z.object({
  code: z.string().trim().min(6).max(12),
});

function manualKeyFromTotpUri(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get("secret");
  } catch {
    return null;
  }
}

async function signedInUser() {
  const session = await resolveRequestClientSession();
  if (!session.signedIn) return null;
  return session.user;
}

export const getMfaStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await signedInUser();
  if (!user) {
    return { ok: false as const, error: "Unauthenticated" };
  }
  const enrollmentRequired = mfaEnrollmentRequired({
    actorType: user.actorType,
    systemRoles: user.systemRoles,
    twoFactorEnabled: user.twoFactorEnabled,
  });
  return {
    ok: true as const,
    data: {
      twoFactorEnabled: user.twoFactorEnabled,
      mfaRequired: user.mfaRequired,
      enrollmentRequired,
      privilegedEnforcement: isPrivilegedMfaEnforced(),
      staffEnforcement: isStaffMfaEnforced(),
      customerEnforcement: isCustomerMfaEnforced(),
    },
  };
});

export const beginMfaEnrollmentFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => passwordSchema.parse(data))
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const user = await signedInUser();
    if (!user) {
      return { ok: false as const, error: "Not permitted" };
    }
    try {
      const result = await auth.api.enableTwoFactor({
        body: { password: data.password },
        headers,
      });
      if (!result || typeof result !== "object" || !("totpURI" in result)) {
        return { ok: false as const, error: "Could not start setup. Check your password." };
      }
      const totpURI = String((result as { totpURI: string }).totpURI ?? "");
      const backupCodes = Array.isArray((result as { backupCodes?: string[] }).backupCodes)
        ? (result as { backupCodes: string[] }).backupCodes
        : [];
      const manualKey = manualKeyFromTotpUri(totpURI);
      if (!totpURI || !manualKey) {
        return { ok: false as const, error: "Could not start setup. Check your password." };
      }
      const qrDataUrl = await QRCode.toDataURL(totpURI, {
        margin: 1,
        width: 220,
        errorCorrectionLevel: "M",
      });
      await recordAuditEvent({
        action: "MFA_ENROLLMENT_STARTED",
        entityType: "User",
        entityId: user.id,
        actorUserId: user.id,
        metadata: { method: "totp" },
      });
      return {
        ok: true as const,
        data: {
          qrDataUrl,
          manualKey,
          backupCodes,
        },
      };
    } catch {
      return { ok: false as const, error: "Could not start setup. Check your password." };
    }
  });

export const confirmMfaEnrollmentFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => codeSchema.parse(data))
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const user = await signedInUser();
    if (!user) {
      return { ok: false as const, error: "Not permitted" };
    }
    const attempt = assessAttempt({ scope: "mfa", headers });
    if (!attempt.allowed) {
      await publishSecurityAlert({
        kind: "REPEATED_MFA_FAILURE",
        dedupeKey: `mfa-enrol:${attempt.clientKey ?? "no-cookie"}`,
        summary: "Repeated authenticator setup attempts were blocked.",
        metadata: { trustedAddress: attempt.trustedAddress },
      });
      return { ok: false as const, error: "Too many attempts. Please wait and try again." };
    }
    const code = data.code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      return { ok: false as const, error: "Enter the 6-digit code from your app." };
    }
    try {
      await auth.api.verifyTOTP({
        body: { code },
        headers,
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabled: true, twoFactorEnabled: true },
      });
      await recordAuditEvent({
        action: "MFA_ENABLED",
        entityType: "User",
        entityId: user.id,
        actorUserId: user.id,
        metadata: { method: "totp" },
      });
      return { ok: true as const };
    } catch {
      await recordAuditEvent({
        action: "MFA_ENROLLMENT_FAILED",
        entityType: "User",
        entityId: user.id,
        actorUserId: user.id,
        metadata: { method: "totp" },
      });
      return { ok: false as const, error: "That code was not accepted. Wait for a new code and try again." };
    }
  });

export const regenerateMfaBackupCodesFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => passwordSchema.parse(data))
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const user = await signedInUser();
    if (!user) {
      return { ok: false as const, error: "Not permitted" };
    }
    if (!user.twoFactorEnabled) {
      return { ok: false as const, error: "Set up the authenticator before creating new recovery codes." };
    }
    try {
      const result = await auth.api.generateBackupCodes({
        body: { password: data.password },
        headers,
      });
      const backupCodes = Array.isArray(result?.backupCodes) ? result.backupCodes : [];
      if (backupCodes.length === 0) {
        return { ok: false as const, error: "Could not create new recovery codes. Check your password." };
      }
      await recordAuditEvent({
        action: "MFA_BACKUP_CODES_REGENERATED",
        entityType: "User",
        entityId: user.id,
        actorUserId: user.id,
        metadata: { count: backupCodes.length },
      });
      return { ok: true as const, data: { backupCodes } };
    } catch {
      return { ok: false as const, error: "Could not create new recovery codes. Check your password." };
    }
  });

export const disableMfaFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => passwordSchema.parse(data))
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const user = await signedInUser();
    if (!user) {
      return { ok: false as const, error: "Not permitted" };
    }
    if (
      mfaEnrollmentRequired({
        actorType: user.actorType,
        systemRoles: user.systemRoles,
        twoFactorEnabled: false,
      })
    ) {
      return {
        ok: false as const,
        error: "Your role needs an authenticator, so it cannot be switched off.",
      };
    }
    try {
      await auth.api.disableTwoFactor({
        body: { password: data.password },
        headers,
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { mfaEnabled: false, twoFactorEnabled: false },
      });
      await revokeTrustedDevices(user.id);
      await recordAuditEvent({
        action: "MFA_DISABLED",
        entityType: "User",
        entityId: user.id,
        actorUserId: user.id,
        metadata: {},
      });
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Could not switch off the authenticator. Check your password." };
    }
  });
