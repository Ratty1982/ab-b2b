import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  bootstrapCatalogue,
  createCategory,
  listCategories,
  updateCategory,
  updateBrand,
} from "@/server/catalogue/service";

const prisma = new PrismaClient();
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
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("catalogue.admin@example.invalid", ["SUPER_ADMIN"]);
  salesRepUserId = await ensureUser("catalogue.sales@example.invalid", ["SALES_REPRESENTATIVE"]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("catalogue categories", () => {
  it("bootstraps a tree with subcategories and lets an editor nest a new child", async () => {
    const boot = await bootstrapCatalogue(prisma);
    expect(boot.categories).toBeGreaterThan(0);

    const tree = await listCategories(adminId);
    const braking = tree.find((c) => c.name === "Braking" && !c.parentId);
    expect(braking).toBeTruthy();
    expect(tree.some((c) => c.parentId === braking?.id)).toBe(true);

    const child = await createCategory(adminId, {
      name: `Pads ${Date.now()}`,
      parentId: braking!.id,
      isActive: true,
      sortOrder: 20,
    });
    expect(child.parentId).toBe(braking!.id);

    const renamed = await updateCategory(adminId, {
      id: child.id,
      name: child.name,
      slug: child.slug,
      parentId: braking!.id,
      description: "Workshop pads",
      isActive: true,
      sortOrder: 20,
    });
    expect(renamed.description).toBe("Workshop pads");
  });

  it("rejects a grandchild subcategory", async () => {
    const tree = await listCategories(adminId);
    const child = tree.find((c) => c.parentId);
    expect(child).toBeTruthy();
    await expect(
      createCategory(adminId, {
        name: "Too deep",
        parentId: child!.id,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("denies catalogue edits without products.edit", async () => {
    await expect(createCategory(salesRepUserId, { name: "Nope" })).rejects.toBeInstanceOf(AuthError);
  });

  it("updates a brand record", async () => {
    const { listBrands } = await import("@/server/catalogue/service");
    const brands = await listBrands(adminId);
    const pm = brands.find((b) => b.slug === "power-maxed") ?? brands[0];
    expect(pm).toBeTruthy();
    const updated = await updateBrand(adminId, {
      id: pm!.id,
      name: pm!.name,
      slug: pm!.slug,
      tagline: "Braking and drivetrain",
      description: pm!.description,
      isActive: true,
      sortOrder: pm!.sortOrder,
    });
    expect(updated.tagline).toBe("Braking and drivetrain");
  });
});
