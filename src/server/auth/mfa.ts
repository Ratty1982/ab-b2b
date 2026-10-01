/**
 * Privileged MFA enrollment helpers — Better Auth twoFactor (TOTP + backup codes).
 * Secrets/backup codes are never written to audit metadata or logs.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";

import { auth } from "@/infra/auth";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { resolveRequestClientSession } from "@/server/auth/request-session";
import { isPrivilegedMfaEnforced, profileRequiresMfa } from "@/domain/mfa-policy";

const passwordSchema = z.object({
  password: z.string().min(1).max(128),
});

const codeSchema = z.object({
  code: z.string().trim().min(6).max(12),
});

export const getMfaStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await resolveRequestClientSession();
  if (!session.signedIn) {
    return { ok: false as const, error: "Unauthenticated" };
  }
  if (session.user.actorType !== "INTERNAL") {
    return { ok: false as const, error: "MFA setup is for internal staff only" };
  }
  return {
    ok: true as const,
    data: {
      twoFactorEnabled: session.user.twoFactorEnabled,
      mfaRequired: session.user.mfaRequired,
      enforcementActive: isPrivilegedMfaEnforced(),
      systemRoles: session.user.systemRoles,
    },
  };
});

export const beginMfaEnrollmentFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => passwordSchema.parse(data))
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const session = await resolveRequestClientSession();
    if (!session.signedIn || session.user.actorType !== "INTERNAL") {
      return { ok: false as const, error: "Not permitted" };
    }
    try {
      const result = await auth.api.enableTwoFactor({
        body: { password: data.password },
        headers,
      });
      if (!result || typeof result !== "object" || !("totpURI" in result)) {
        return { ok: false as const, error: "Could not start MFA enrollment — check your password" };
      }
      const totpURI = String((result as { totpURI: string }).totpURI ?? "");
      const backupCodes = Array.isArray((result as { backupCodes?: string[] }).backupCodes)
        ? ((result as { backupCodes: string[] }).backupCodes)
        : [];
      if (!totpURI) {
        return { ok: false as const, error: "Could not start MFA enrollment — check your password" };
      }
      await recordAuditEvent({
        action: "MFA_ENROLLMENT_STARTED",
        entityType: "User",
        entityId: session.user.id,
        actorUserId: session.user.id,
        metadata: { method: "totp" },
      });
      // totpURI + backupCodes shown once to the operator — not audited.
      return {
        ok: true as const,
        data: {
          totpURI,
          backupCodes,
        },
      };
    } catch {
      return { ok: false as const, error: "Could not start MFA enrollment — check your password" };
    }
  });

export const confirmMfaEnrollmentFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => codeSchema.parse(data))
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const session = await resolveRequestClientSession();
    if (!session.signedIn || session.user.actorType !== "INTERNAL") {
      return { ok: false as const, error: "Not permitted" };
    }
    try {
      await auth.api.verifyTOTP({
        body: { code: data.code.replace(/\s+/g, "") },
        headers,
      });
      await prisma.user.update({
        where: { id: session.user.id },
        data: { mfaEnabled: true, twoFactorEnabled: true },
      });
      await recordAuditEvent({
        action: "MFA_ENABLED",
        entityType: "User",
        entityId: session.user.id,
        actorUserId: session.user.id,
        metadata: { method: "totp", required: profileRequiresMfa(session.user.systemRoles) },
      });
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Invalid authenticator code" };
    }
  });

export const disableMfaFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => passwordSchema.parse(data))
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const session = await resolveRequestClientSession();
    if (!session.signedIn || session.user.actorType !== "INTERNAL") {
      return { ok: false as const, error: "Not permitted" };
    }
    if (profileRequiresMfa(session.user.systemRoles) && isPrivilegedMfaEnforced()) {
      return {
        ok: false as const,
        error: "MFA is required for your role and cannot be disabled while enforcement is active",
      };
    }
    try {
      await auth.api.disableTwoFactor({
        body: { password: data.password },
        headers,
      });
      await prisma.user.update({
        where: { id: session.user.id },
        data: { mfaEnabled: false, twoFactorEnabled: false },
      });
      await recordAuditEvent({
        action: "MFA_DISABLED",
        entityType: "User",
        entityId: session.user.id,
        actorUserId: session.user.id,
        metadata: {},
      });
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Could not disable MFA — check your password" };
    }
  });
