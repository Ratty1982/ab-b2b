/**
 * Optional first production administrator bootstrap.
 *
 * Env (all required together to create; omit all to skip):
 *   INITIAL_ADMIN_EMAIL
 *   INITIAL_ADMIN_PASSWORD  (min 10 chars — Better Auth policy)
 *   INITIAL_ADMIN_NAME      (optional; defaults from email local-part)
 *
 * Idempotent:
 * - Creates user + Better Auth credential account + SUPER_ADMIN on first run
 * - On subsequent runs: ensures SUPER_ADMIN role; NEVER resets password
 * - Never logs the password
 */
import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

export type InitialAdminStatus = "created" | "already_existed" | "skipped" | "misconfigured";

export interface InitialAdminResult {
  status: InitialAdminStatus;
  email?: string;
  message: string;
}

function readInitialAdminEnv():
  | { kind: "absent" }
  | { kind: "partial"; missing: string[] }
  | { kind: "present"; email: string; password: string; name: string } {
  const email = process.env["INITIAL_ADMIN_EMAIL"]?.trim();
  const password = process.env["INITIAL_ADMIN_PASSWORD"];
  const nameRaw = process.env["INITIAL_ADMIN_NAME"]?.trim();

  const hasEmail = Boolean(email);
  const hasPassword = password !== undefined && password.length > 0;

  if (!hasEmail && !hasPassword && !nameRaw) {
    return { kind: "absent" };
  }

  const missing: string[] = [];
  if (!hasEmail) missing.push("INITIAL_ADMIN_EMAIL");
  if (!hasPassword) missing.push("INITIAL_ADMIN_PASSWORD");
  if (missing.length) {
    return { kind: "partial", missing };
  }

  return {
    kind: "present",
    email: email!.toLowerCase(),
    password: password!,
    name: nameRaw || email!.split("@")[0] || "Administrator",
  };
}

export async function bootstrapInitialAdmin(prisma: PrismaClient): Promise<InitialAdminResult> {
  const env = readInitialAdminEnv();

  if (env.kind === "absent") {
    return {
      status: "skipped",
      message:
        "INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD not set — skipping initial admin creation",
    };
  }

  if (env.kind === "partial") {
    return {
      status: "misconfigured",
      message: `Partial initial-admin configuration. Missing: ${env.missing.join(", ")}`,
    };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.email)) {
    return {
      status: "misconfigured",
      message: "INITIAL_ADMIN_EMAIL is not a valid email address",
    };
  }

  if (env.password.length < 10) {
    return {
      status: "misconfigured",
      message: "INITIAL_ADMIN_PASSWORD must be at least 10 characters",
    };
  }

  const existing = await prisma.user.findUnique({
    where: { email: env.email },
    include: { userRoles: { include: { role: true } }, accounts: true },
  });

  const superAdminRole = await prisma.role.findUnique({
    where: { key: "SUPER_ADMIN" },
  });
  if (!superAdminRole) {
    return {
      status: "misconfigured",
      message: "SUPER_ADMIN role missing — run RBAC bootstrap first",
    };
  }

  if (existing) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId: { userId: existing.id, roleId: superAdminRole.id },
      },
      create: { userId: existing.id, roleId: superAdminRole.id },
      update: {},
    });

    // Ensure account is usable as internal admin without touching credentials
    if (existing.actorType !== "INTERNAL" || existing.status !== "ACTIVE") {
      await prisma.user.update({
        where: { id: existing.id },
        data: { actorType: "INTERNAL", status: "ACTIVE" },
      });
    }

    return {
      status: "already_existed",
      email: env.email,
      message: "Administrator already exists — ensured SUPER_ADMIN role; password left unchanged",
    };
  }

  const passwordHash = await hashPassword(env.password);
  const user = await prisma.user.create({
    data: {
      email: env.email,
      name: env.name,
      actorType: "INTERNAL",
      status: "ACTIVE",
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.authAccount.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: passwordHash,
    },
  });

  await prisma.userRole.create({
    data: { userId: user.id, roleId: superAdminRole.id },
  });

  return {
    status: "created",
    email: env.email,
    message: "Initial SUPER_ADMIN administrator created",
  };
}
