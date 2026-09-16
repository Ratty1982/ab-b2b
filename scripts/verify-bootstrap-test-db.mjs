import { PrismaClient } from "@prisma/client";
import { verifyPassword } from "better-auth/crypto";

const prisma = new PrismaClient();

const perms = await prisma.permission.count();
const roles = await prisma.role.count();
const links = await prisma.rolePermission.count();
const companies = await prisma.company.count();
const users = await prisma.user.findMany({
  include: { accounts: true, userRoles: { include: { role: true } } },
});

console.log(
  JSON.stringify(
    {
      perms,
      roles,
      links,
      companies,
      users: users.map((u) => ({
        email: u.email,
        roles: u.userRoles.map((r) => r.role.key),
        accounts: u.accounts.length,
      })),
    },
    null,
    2,
  ),
);

const admin = users.find((u) => u.email === "ops@automotivebrands.example");
if (!admin) throw new Error("admin missing");
const hash = admin.accounts.find((a) => a.providerId === "credential")?.password;
if (!hash) throw new Error("credential account missing");

const stillOriginal = await verifyPassword({
  hash,
  password: "InitialAdmin-Pass-1!",
});
const changedToSecond = await verifyPassword({
  hash,
  password: "DifferentPassword-ShouldNotApply!!",
});

console.log({ stillOriginalPassword: stillOriginal, changedToSecondPassword: changedToSecond });

if (perms < 40 || roles !== 7 || companies !== 0 || !stillOriginal || changedToSecond) {
  process.exit(1);
}

await prisma.$disconnect();
