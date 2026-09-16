/**
 * DEVELOPMENT seed only — never run automatically in production.
 *
 * bun run db:seed
 *
 * Credentials come from DEV_SEED_PASSWORD (default printed to console only).
 * Emails use @example.invalid — local-only fake addresses.
 *
 * Production system data (permissions/roles) is applied via:
 *   bun run db:bootstrap:production
 * which is also invoked by the Docker entrypoint after migrate deploy.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

import type { SystemRoleKey } from "../src/domain/permissions";
import { bootstrapRbac } from "./bootstrap/rbac";

const prisma = new PrismaClient();

function assertDevSeedAllowed() {
  const nodeEnv = process.env["NODE_ENV"] ?? "development";
  if (nodeEnv === "production" && process.env["ALLOW_PRODUCTION_SEED"] !== "true") {
    throw new Error(
      "Refusing to seed development sample data in production. Use db:bootstrap:production for system RBAC.",
    );
  }
}

async function createCredentialUser(opts: {
  email: string;
  name: string;
  password: string;
  actorType: "INTERNAL" | "TRADE";
  roleKeys?: SystemRoleKey[];
}) {
  const existing = await prisma.user.findUnique({ where: { email: opts.email } });
  if (existing) {
    if (opts.roleKeys?.length) {
      for (const key of opts.roleKeys) {
        const role = await prisma.role.findUniqueOrThrow({ where: { key } });
        await prisma.userRole.upsert({
          where: { userId_roleId: { userId: existing.id, roleId: role.id } },
          create: { userId: existing.id, roleId: role.id },
          update: {},
        });
      }
    }
    return existing;
  }

  const passwordHash = await hashPassword(opts.password);
  const user = await prisma.user.create({
    data: {
      email: opts.email,
      name: opts.name,
      actorType: opts.actorType,
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

  if (opts.roleKeys?.length) {
    for (const key of opts.roleKeys) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key } });
      await prisma.userRole.create({
        data: { userId: user.id, roleId: role.id },
      });
    }
  }

  return user;
}

async function main() {
  assertDevSeedAllowed();

  const password = process.env["DEV_SEED_PASSWORD"] ?? "DevOnly-ChangeMe-Phase1!";

  console.log("[ab:seed] Bootstrapping RBAC, then development sample users…");
  await bootstrapRbac(prisma);

  const company = await prisma.company.upsert({
    where: { accountNumber: "ABC001" },
    create: {
      accountNumber: "ABC001",
      name: "ABC Motor Factors Ltd",
      tradingName: "ABC Motor Factors",
      status: "ACTIVE",
      paymentTerms: "30 days",
      currency: "GBP",
    },
    update: { name: "ABC Motor Factors Ltd", status: "ACTIVE" },
  });

  const superAdmin = await createCredentialUser({
    email: "superadmin@example.invalid",
    name: "Rachel Tibbs",
    password,
    actorType: "INTERNAL",
    roleKeys: ["SUPER_ADMIN"],
  });

  const salesManager = await createCredentialUser({
    email: "sales.manager@example.invalid",
    name: "Priya Shah",
    password,
    actorType: "INTERNAL",
    roleKeys: ["SALES_MANAGER"],
  });

  const salesRep = await createCredentialUser({
    email: "sales.rep@example.invalid",
    name: "James Whitfield",
    password,
    actorType: "INTERNAL",
    roleKeys: ["SALES_REPRESENTATIVE"],
  });

  await createCredentialUser({
    email: "accounts@example.invalid",
    name: "Helen Crowe",
    password,
    actorType: "INTERNAL",
    roleKeys: ["ACCOUNTS"],
  });

  await createCredentialUser({
    email: "marketing@example.invalid",
    name: "Tom Blake",
    password,
    actorType: "INTERNAL",
    roleKeys: ["MARKETING"],
  });

  await createCredentialUser({
    email: "management@example.invalid",
    name: "Alex Morgan",
    password,
    actorType: "INTERNAL",
    roleKeys: ["MANAGEMENT"],
  });

  const tradeAdmin = await createCredentialUser({
    email: "trade.admin@example.invalid",
    name: "Sam Patel",
    password,
    actorType: "TRADE",
  });
  const tradeBuyer = await createCredentialUser({
    email: "trade.buyer@example.invalid",
    name: "Dan Reeves",
    password,
    actorType: "TRADE",
  });
  const tradeAccounts = await createCredentialUser({
    email: "trade.accounts@example.invalid",
    name: "Nina Cole",
    password,
    actorType: "TRADE",
  });
  const tradeReadOnly = await createCredentialUser({
    email: "trade.readonly@example.invalid",
    name: "Chris Ng",
    password,
    actorType: "TRADE",
  });

  const memberships: Prisma.CompanyUserCreateManyInput[] = [
    {
      companyId: company.id,
      userId: tradeAdmin.id,
      role: "TRADE_ADMIN",
      status: "ACTIVE",
      isDefault: true,
    },
    {
      companyId: company.id,
      userId: tradeBuyer.id,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
    {
      companyId: company.id,
      userId: tradeAccounts.id,
      role: "TRADE_ACCOUNTS",
      status: "ACTIVE",
      isDefault: true,
    },
    {
      companyId: company.id,
      userId: tradeReadOnly.id,
      role: "TRADE_READ_ONLY",
      status: "ACTIVE",
      isDefault: true,
    },
  ];

  for (const m of memberships) {
    await prisma.companyUser.upsert({
      where: { companyId_userId: { companyId: m.companyId, userId: m.userId } },
      create: m,
      update: { role: m.role, status: "ACTIVE", isDefault: m.isDefault },
    });
  }

  const managerRep = await prisma.salesRep.upsert({
    where: { userId: salesManager.id },
    create: {
      userId: salesManager.id,
      code: "SM01",
      region: "UK South",
      active: true,
    },
    update: { active: true },
  });

  const rep = await prisma.salesRep.upsert({
    where: { userId: salesRep.id },
    create: {
      userId: salesRep.id,
      code: "SR01",
      region: "UK South",
      managerId: managerRep.id,
      active: true,
    },
    update: { managerId: managerRep.id, active: true },
  });

  await prisma.companyAssignment.upsert({
    where: {
      companyId_salesRepId: { companyId: company.id, salesRepId: rep.id },
    },
    create: {
      companyId: company.id,
      salesRepId: rep.id,
      isPrimary: true,
    },
    update: { isPrimary: true },
  });

  await prisma.company.upsert({
    where: { accountNumber: "XYZ999" },
    create: {
      accountNumber: "XYZ999",
      name: "Unassigned Factors Ltd",
      status: "ACTIVE",
    },
    update: {},
  });

  console.log("[ab:seed] Done (development sample data only).");
  console.log("[ab:seed] Development users (@example.invalid):");
  console.log("  superadmin@example.invalid");
  console.log("  sales.manager@example.invalid");
  console.log("  sales.rep@example.invalid");
  console.log("  accounts@example.invalid");
  console.log("  marketing@example.invalid");
  console.log("  management@example.invalid");
  console.log("  trade.admin@example.invalid");
  console.log("  trade.buyer@example.invalid");
  console.log("  trade.accounts@example.invalid");
  console.log("  trade.readonly@example.invalid");
  if (!process.env["DEV_SEED_PASSWORD"]) {
    console.log(`[ab:seed] Password (DEV_SEED_PASSWORD not set): ${password}`);
  } else {
    console.log("[ab:seed] Password: (from DEV_SEED_PASSWORD)");
  }
  void superAdmin;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
