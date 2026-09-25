import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { acceptTradeInvitation } from "@/server/applications/service";
import { setEmailAdapterForTests, setEmailTransportForTests } from "@/infra/email";
import { createMockSmtpTransport } from "@/infra/email/smtp";
import {
  clearEmailDiagnosticRateLimitsForTests,
  getOrCreateEmailSettings,
  setSmtpTransportFactoryForTests,
  updateEmailSettings,
} from "@/server/email/settings";
import { encryptSecret } from "@/server/crypto/secret";
import {
  createStaffUser,
  deactivateStaffUser,
  deleteStaffUser,
  evaluateUserDeletionSafety,
  listStaffUsers,
  reactivateStaffUser,
  resendStaffInvitation,
  resetStaffUserPassword,
  sendUserPasswordResetEmail,
  updateStaffUser,
} from "@/server/users/service";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let adminId = "";
let salesRepUserId = "";

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
      },
    });
  }
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  const hasCredential = await prisma.authAccount.findFirst({
    where: { userId: user.id, providerId: "credential" },
  });
  if (!hasCredential) {
    await prisma.authAccount.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: await hashPassword("AdminSeedPass99!"),
      },
    });
  }
  return user.id;
}

async function enableEmail() {
  clearEmailDiagnosticRateLimitsForTests();
  setSmtpTransportFactoryForTests(null);
  setEmailAdapterForTests(null);
  setEmailTransportForTests(null);
  await prisma.emailSettings.deleteMany({});
  await getOrCreateEmailSettings();
  const mock = createMockSmtpTransport({ sendResult: { ok: true, id: "staff-invite" } });
  setEmailTransportForTests(mock);
  setSmtpTransportFactoryForTests(() => mock);
  await updateEmailSettings(adminId, {
    enabled: true,
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpSecurity: "STARTTLS",
    smtpUsername: "b2b@example.com",
    smtpPassword: "secret",
    replacePassword: true,
    fromName: "Automotive Brands",
    fromEmail: "b2b@example.com",
  });
  return mock;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`staff.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
  salesRepUserId = await ensureUser(`staff.sales.${suffix}@example.invalid`, [
    "SALES_REPRESENTATIVE",
  ]);
});

beforeEach(async () => {
  await enableEmail();
});

afterEach(() => {
  setSmtpTransportFactoryForTests(null);
  setEmailAdapterForTests(null);
  setEmailTransportForTests(null);
  clearEmailDiagnosticRateLimitsForTests();
});

afterAll(async () => {
  await prisma.emailSettings.updateMany({ data: { enabled: false } });
  await prisma.$disconnect();
});

describe("staff users — invitations & lifecycle", () => {
  it("denies list without users.manage", async () => {
    await expect(listStaffUsers(salesRepUserId)).rejects.toBeInstanceOf(AuthError);
  });

  it("creates an invited user, sends USER_INVITATION, and does not store a password", async () => {
    const email = `staff.created.${Date.now()}@example.invalid`;
    const created = await createStaffUser(adminId, {
      firstName: "Workshop",
      lastName: "Tester",
      email,
      role: "MARKETING",
    });
    expect(created.user.email).toBe(email);
    expect(created.user.role).toBe("MARKETING");
    expect(created.user.status).toBe("INVITED");
    expect(created.invitationSent).toBe(true);
    expect(created.user.canResendInvitation).toBe(true);
    expect(created.user.canSendPasswordReset).toBe(false);

    const account = await prisma.authAccount.findFirst({
      where: { userId: created.user.id, providerId: "credential" },
    });
    expect(account).toBeNull();

    const mail = await prisma.transactionalEmail.findFirst({
      where: { purpose: "USER_INVITATION", entityId: created.user.id },
    });
    expect(mail).toBeTruthy();
    expect(mail!.subject).toContain("account is ready");
    expect(mail!.htmlBody).toContain("Set your password");
    expect(mail!.textBody).toContain(email);
    expect(mail!.htmlBody).toContain("Automotive Brands");
    expect(JSON.stringify(mail)).not.toContain("smtpPassword");
    expect(mail!.htmlBody ?? "").not.toMatch(/tokenHash/i);

    const invite = await prisma.userInvitation.findFirst({
      where: { userId: created.user.id, kind: "STAFF_USER", status: "PENDING" },
    });
    expect(invite).toBeTruthy();
    expect(invite!.tokenHash).toBeTruthy();
  });

  it("rejects duplicate email and sales-rep creation", async () => {
    const email = `staff.dup.${Date.now()}@example.invalid`;
    await createStaffUser(adminId, {
      firstName: "Dup",
      lastName: "One",
      email,
      role: "ACCOUNTS",
    });
    await expect(
      createStaffUser(adminId, {
        firstName: "Dup",
        lastName: "Two",
        email,
        role: "ACCOUNTS",
      }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/already exists/i) });
    await expect(
      createStaffUser(salesRepUserId, {
        firstName: "Nope",
        lastName: "Nope",
        email: `staff.nope.${Date.now()}@example.invalid`,
        role: "ACCOUNTS",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("accepts invitation, activates account, and blocks password-reset action while invited", async () => {
    const email = `staff.activate.${Date.now()}@example.invalid`;
    const created = await createStaffUser(adminId, {
      firstName: "Activate",
      lastName: "Me",
      email,
      role: "CUSTOMER_SERVICE",
    });
    await expect(sendUserPasswordResetEmail(adminId, created.user.id)).rejects.toBeInstanceOf(
      AuthError,
    );

    const invite = await prisma.userInvitation.findFirstOrThrow({
      where: { userId: created.user.id, status: "PENDING" },
    });
    // Recover token from email body for test (production never stores raw token).
    const mail = await prisma.transactionalEmail.findFirstOrThrow({
      where: { purpose: "USER_INVITATION", entityId: created.user.id },
    });
    const match = mail.textBody.match(/\/activate\?token=([^\s]+)/);
    expect(match?.[1]).toBeTruthy();
    const token = decodeURIComponent(match![1]!);

    const activated = await acceptTradeInvitation({
      token,
      password: "StaffActivate99!",
      confirmPassword: "StaffActivate99!",
    });
    expect(activated.userId).toBe(created.user.id);
    expect(activated.kind).toBe("STAFF_USER");

    const user = await prisma.user.findUniqueOrThrow({ where: { id: created.user.id } });
    expect(user.status).toBe("ACTIVE");
    expect(
      await prisma.authAccount.count({
        where: { userId: created.user.id, providerId: "credential" },
      }),
    ).toBe(1);
    expect(
      await prisma.userInvitation.findUniqueOrThrow({ where: { id: invite.id } }),
    ).toMatchObject({ status: "ACCEPTED" });

    // Second use of token fails
    await expect(
      acceptTradeInvitation({
        token,
        password: "StaffActivate99!",
        confirmPassword: "StaffActivate99!",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("resends invitation with a new token when still invited", async () => {
    const created = await createStaffUser(adminId, {
      firstName: "Resend",
      lastName: "Me",
      email: `staff.resend.${Date.now()}@example.invalid`,
      role: "MARKETING",
    });
    const before = await prisma.userInvitation.findFirstOrThrow({
      where: { userId: created.user.id, status: "PENDING" },
    });
    const resent = await resendStaffInvitation(adminId, { id: created.user.id });
    expect(resent.invitationSent).toBe(true);
    const after = await prisma.userInvitation.findFirstOrThrow({
      where: { userId: created.user.id, status: "PENDING" },
    });
    expect(after.id).not.toBe(before.id);
    expect(after.tokenHash).not.toBe(before.tokenHash);
    expect(
      await prisma.userInvitation.findUniqueOrThrow({ where: { id: before.id } }),
    ).toMatchObject({ status: "REVOKED" });
  });

  it("records DEFERRED/FAILED when SMTP fails but keeps the user", async () => {
    const fail = createMockSmtpTransport({
      sendResult: { ok: false, detail: "smtp down" },
    });
    setEmailTransportForTests(fail);
    setSmtpTransportFactoryForTests(() => fail);

    const created = await createStaffUser(adminId, {
      firstName: "Fail",
      lastName: "Mail",
      email: `staff.failmail.${Date.now()}@example.invalid`,
      role: "ACCOUNTS",
    });
    expect(created.user.status).toBe("INVITED");
    expect(created.invitationSent).toBe(false);
    expect(created.invitationDeferred).toBe(true);
    expect(await prisma.user.count({ where: { id: created.user.id } })).toBe(1);
    const mail = await prisma.transactionalEmail.findFirst({
      where: { purpose: "USER_INVITATION", entityId: created.user.id },
    });
    expect(mail).toBeTruthy();
    expect(["FAILED", "DEFERRED", "PENDING"]).toContain(mail!.status);
  });

  it("updates role, creates sales-rep, refuses self-disable", async () => {
    const created = await createStaffUser(adminId, {
      firstName: "To",
      lastName: "Manage",
      email: `staff.manage.${Date.now()}@example.invalid`,
      role: "CUSTOMER_SERVICE",
    });
    // Activate via emergency force-set so update paths for ACTIVE work.
    await resetStaffUserPassword(adminId, {
      id: created.user.id,
      password: "long-enough-password",
    });

    const updated = await updateStaffUser(adminId, {
      id: created.user.id,
      name: "To Manage Updated",
      role: "SALES_REPRESENTATIVE",
      status: "ACTIVE",
    });
    expect(updated.name).toBe("To Manage Updated");
    expect(updated.role).toBe("SALES_REPRESENTATIVE");
    const rep = await prisma.salesRep.findUnique({ where: { userId: created.user.id } });
    expect(rep?.active).toBe(true);

    await expect(
      updateStaffUser(adminId, { id: adminId, status: "DISABLED" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("deactivates with session revocation and reactivates", async () => {
    const created = await createStaffUser(adminId, {
      firstName: "Deact",
      lastName: "User",
      email: `staff.deact.${Date.now()}@example.invalid`,
      role: "MARKETING",
    });
    await resetStaffUserPassword(adminId, {
      id: created.user.id,
      password: "DeactivatePass99!",
    });
    await prisma.authSession.create({
      data: {
        userId: created.user.id,
        token: `tok-deact-${created.user.id}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await expect(deactivateStaffUser(adminId, { id: adminId })).rejects.toBeInstanceOf(AuthError);

    const deactivated = await deactivateStaffUser(adminId, { id: created.user.id });
    expect(deactivated.status).toBe("DISABLED");
    expect(await prisma.authSession.count({ where: { userId: created.user.id } })).toBe(0);

    const reactivated = await reactivateStaffUser(adminId, { id: created.user.id });
    expect(reactivated.status).toBe("ACTIVE");
  });

  it("allows hard delete for disposable invited users and blocks established users without transfer", async () => {
    const disposable = await createStaffUser(adminId, {
      firstName: "Disposable",
      lastName: "Invite",
      email: `staff.disp.${Date.now()}@example.invalid`,
      role: "MARKETING",
    });
    const safety = await evaluateUserDeletionSafety(disposable.user.id);
    expect(safety.safe).toBe(true);
    await expect(deleteStaffUser(adminId, { id: adminId })).rejects.toBeInstanceOf(AuthError);
    await deleteStaffUser(adminId, { id: disposable.user.id });
    expect(await prisma.user.findUnique({ where: { id: disposable.user.id } })).toBeNull();
    // Audit preserved with null target
    expect(
      await prisma.auditEvent.count({
        where: { action: "USER_DELETED", entityId: disposable.user.id },
      }),
    ).toBeGreaterThan(0);

    const established = await createStaffUser(adminId, {
      firstName: "Established",
      lastName: "User",
      email: `staff.est.${Date.now()}@example.invalid`,
      role: "MARKETING",
    });
    await resetStaffUserPassword(adminId, {
      id: established.user.id,
      password: "EstablishedPass99!",
    });
    await prisma.user.update({
      where: { id: established.user.id },
      data: { lastLoginAt: new Date() },
    });
    const blocked = await evaluateUserDeletionSafety(established.user.id);
    expect(blocked.safe).toBe(false);
    await expect(deleteStaffUser(adminId, { id: established.user.id })).rejects.toMatchObject({
      message: expect.stringMatching(/transfer|business history/i),
    });
    expect(await prisma.user.findUnique({ where: { id: established.user.id } })).toBeTruthy();
  });

  it("transfers sales assignments then deletes an established user", async () => {
    const source = await createStaffUser(adminId, {
      firstName: "Source",
      lastName: "Rep",
      email: `staff.source.${Date.now()}@example.invalid`,
      role: "SALES_REPRESENTATIVE",
    });
    await resetStaffUserPassword(adminId, {
      id: source.user.id,
      password: "SourceRepPass99!",
    });
    const target = await createStaffUser(adminId, {
      firstName: "Target",
      lastName: "Rep",
      email: `staff.target.${Date.now()}@example.invalid`,
      role: "SALES_REPRESENTATIVE",
    });
    await resetStaffUserPassword(adminId, {
      id: target.user.id,
      password: "TargetRepPass99!",
    });

    const sourceRep = await prisma.salesRep.findUniqueOrThrow({
      where: { userId: source.user.id },
    });
    const targetRep = await prisma.salesRep.findUniqueOrThrow({
      where: { userId: target.user.id },
    });
    const company = await prisma.company.create({
      data: {
        name: `Transfer Co ${Date.now()}`,
        status: "ACTIVE",
        taxStatus: "STANDARD",
      },
    });
    await prisma.companyAssignment.create({
      data: { companyId: company.id, salesRepId: sourceRep.id },
    });
    await prisma.lead.create({
      data: {
        companyName: "Transfer Lead",
        contactName: "Lead Contact",
        email: `lead.${Date.now()}@example.invalid`,
        ownerId: source.user.id,
        status: "NEW",
      },
    });

    await deleteStaffUser(adminId, {
      id: source.user.id,
      transferToUserId: target.user.id,
    });

    expect(await prisma.user.findUnique({ where: { id: source.user.id } })).toBeNull();
    expect(
      await prisma.companyAssignment.count({
        where: { companyId: company.id, salesRepId: targetRep.id },
      }),
    ).toBe(1);
    expect(await prisma.lead.count({ where: { ownerId: target.user.id } })).toBe(1);
    expect(await prisma.company.findUnique({ where: { id: company.id } })).toBeTruthy();
  });

  it("blocks self-deactivate and last Super Admin demotion", async () => {
    await expect(deactivateStaffUser(adminId, { id: adminId })).rejects.toBeInstanceOf(AuthError);

    const extra = await createStaffUser(adminId, {
      firstName: "Extra",
      lastName: "Admin",
      email: `staff.extra.admin.${Date.now()}@example.invalid`,
      role: "SUPER_ADMIN",
    });
    await resetStaffUserPassword(adminId, {
      id: extra.user.id,
      password: "ExtraAdminPass99!",
    });
    const deactivated = await deactivateStaffUser(adminId, { id: extra.user.id });
    expect(deactivated.status).toBe("DISABLED");

    const otherActiveSupers = await prisma.user.findMany({
      where: {
        id: { not: adminId },
        status: "ACTIVE",
        actorType: "INTERNAL",
        userRoles: { some: { role: { key: "SUPER_ADMIN" } } },
      },
      select: { id: true },
    });
    if (otherActiveSupers.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: otherActiveSupers.map((u) => u.id) } },
        data: { status: "DISABLED" },
      });
    }
    try {
      await expect(
        updateStaffUser(adminId, { id: adminId, role: "MARKETING" }),
      ).rejects.toMatchObject({ message: expect.stringMatching(/Super Admin/i) });
    } finally {
      if (otherActiveSupers.length > 0) {
        await prisma.user.updateMany({
          where: { id: { in: otherActiveSupers.map((u) => u.id) } },
          data: { status: "ACTIVE" },
        });
      }
    }
  });

  it("force-sets password, creates credential if missing, and signs them out", async () => {
    const created = await createStaffUser(adminId, {
      firstName: "Reset",
      lastName: "Me",
      email: `staff.reset.${Date.now()}@example.invalid`,
      role: "MARKETING",
    });
    const generated = await resetStaffUserPassword(adminId, { id: created.user.id });
    expect(generated.email).toBe(created.user.email);
    expect(generated.temporaryPassword).toMatch(/^Ab-/);

    await prisma.authSession.create({
      data: {
        userId: created.user.id,
        token: `tok-${created.user.id}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const custom = await resetStaffUserPassword(adminId, {
      id: created.user.id,
      password: "another-long-password",
    });
    expect(custom.temporaryPassword).toBe("another-long-password");
    expect(await prisma.authSession.count({ where: { userId: created.user.id } })).toBe(0);

    await expect(
      resetStaffUserPassword(salesRepUserId, { id: created.user.id }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("encrypts SMTP secret independently of user invites", async () => {
    expect(encryptSecret("x").startsWith("v1:")).toBe(true);
  });
});
