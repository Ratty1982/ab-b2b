/**
 * PL-006 — public CMS media must be bound to published/public use.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import {
  getPublicCmsMediaBytes,
  isCmsMediaPubliclyEligible,
} from "@/server/cms/media";

const prisma = new PrismaClient();
const stamp = Date.now();
let adminId = "";
let draftMediaId = "";
let publishedMediaId = "";

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
  adminId = await ensureUser(`cms.media.${stamp}@example.invalid`, ["SUPER_ADMIN"]);

  const draft = await prisma.cmsMedia.create({
    data: {
      filename: `draft-${stamp}.png`,
      contentType: "image/png",
      sizeBytes: 68,
      storageKey: `test/draft-${stamp}.png`,
      storageProvider: "local",
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
      uploadedById: adminId,
    },
  });
  draftMediaId = draft.id;

  const published = await prisma.cmsMedia.create({
    data: {
      filename: `pub-${stamp}.png`,
      contentType: "image/png",
      sizeBytes: 68,
      storageKey: `test/pub-${stamp}.png`,
      storageProvider: "local",
      bytes: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
      uploadedById: adminId,
    },
  });
  publishedMediaId = published.id;

  await prisma.brand.create({
    data: {
      name: `Public Media Brand ${stamp}`,
      slug: `pub-media-brand-${stamp}`,
      isActive: true,
      logoMediaId: publishedMediaId,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PL-006 CMS media public eligibility", () => {
  it("denies anonymous access to unbound draft media", async () => {
    expect(await isCmsMediaPubliclyEligible(draftMediaId)).toBe(false);
    expect(await getPublicCmsMediaBytes(draftMediaId)).toBeNull();
    expect(await getPublicCmsMediaBytes(draftMediaId, { actorUserId: null })).toBeNull();
  });

  it("allows anonymous access to brand-bound published media", async () => {
    expect(await isCmsMediaPubliclyEligible(publishedMediaId)).toBe(true);
    const bytes = await getPublicCmsMediaBytes(publishedMediaId);
    expect(bytes?.contentType).toBe("image/png");
    expect(bytes?.bytes.length).toBeGreaterThan(0);
  });

  it("allows authorised CMS staff to preview draft media", async () => {
    const preview = await getPublicCmsMediaBytes(draftMediaId, { actorUserId: adminId });
    expect(preview?.contentType).toBe("image/png");
    expect(preview?.bytes.length).toBeGreaterThan(0);
  });
});
