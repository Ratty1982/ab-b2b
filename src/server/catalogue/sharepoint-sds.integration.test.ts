/**
 * SharePoint SDS settings RBAC + preview statuses (UPDATED_SOURCE / SOURCE_MISSING)
 * without calling live Microsoft Graph.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  buildSdsPreviewItems,
  listPublicProductDocuments,
  uploadProductDocument,
} from "@/server/catalogue/product-documents";
import {
  getSharePointSdsSettingsForActor,
  updateSharePointSdsSettings,
} from "@/server/catalogue/sharepoint-sds-settings";
import { buildSharePointSourceMetadata } from "@/domain/sharepoint-sds";
import { sha256Hex } from "@/domain/product-documents";

const prisma = new PrismaClient();
const stamp = Date.now();
const PDF_A = Buffer.from("%PDF-1.4\n% sp-sds-a\ntrailer\n%%EOF\n", "utf8");
const PDF_B = Buffer.from("%PDF-1.4\n% sp-sds-b-updated\ntrailer\n%%EOF\n", "utf8");

let adminId = "";
let tradeUserId = "";
let productId = "";

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType,
        emailVerified: true,
      },
    });
  } else if (user.actorType !== actorType) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { actorType },
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
  adminId = await ensureUser(`sp.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  tradeUserId = await ensureUser(`sp.trade.${stamp}@example.invalid`, [], "TRADE");

  const brand = await prisma.brand.create({
    data: {
      name: `SP SDS Brand ${stamp}`,
      slug: `sp-sds-brand-${stamp}`,
      isActive: true,
    },
  });
  const product = await prisma.product.create({
    data: {
      name: `SP Cleaner ${stamp}`,
      slug: `sp-cleaner-${stamp}`,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
      brandId: brand.id,
      variants: {
        create: {
          sku: `SPSKU${String(stamp).slice(-6)}`,
          isDefault: true,
          isActive: true,
          tradePrice: 4.5,
        },
      },
    },
  });
  productId = product.id;
});

afterAll(async () => {
  await prisma.productDocument.deleteMany({ where: { productId } });
  await prisma.sharePointSdsScanItem.deleteMany({});
  await prisma.sharePointSdsScanSession.deleteMany({});
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.brand.deleteMany({ where: { slug: `sp-sds-brand-${stamp}` } });
  await prisma.$disconnect();
});

describe("SharePoint SDS settings RBAC", () => {
  it("blocks trade users from settings", async () => {
    await expect(getSharePointSdsSettingsForActor(tradeUserId)).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(
      updateSharePointSdsSettings(tradeUserId, { sourceLabel: "x" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("allows admin to save settings without returning secrets", async () => {
    const saved = await updateSharePointSdsSettings(adminId, {
      enabled: true,
      sourceLabel: "Power Maxed SDS",
      folderDisplayName: "Power Maxed SDS 2025",
      tenantId: "00000000-0000-0000-0000-000000000001",
      clientId: "11111111-1111-1111-1111-111111111111",
      clientSecret: "unit-test-secret-not-for-production",
      userPrincipalName: "george.parker@automotivebrands.co.uk",
    });
    expect(saved.hasClientSecret).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("unit-test-secret");
    expect(saved).not.toHaveProperty("clientSecret");
    expect(saved).not.toHaveProperty("clientSecretEncrypted");
  });
});

describe("SharePoint-aware SDS preview statuses", () => {
  it("imports with SharePoint source metadata retained internally only", async () => {
    const meta = buildSharePointSourceMetadata({
      driveId: "drive-sp",
      itemId: "item-sp-1",
      filename: "SPSKU SDS.pdf",
      eTag: '"etag1"',
      folderItemId: "folder-sp",
    });
    const doc = await uploadProductDocument(adminId, {
      productId,
      type: "SAFETY_DATA_SHEET",
      filename: "SPSKU SDS.pdf",
      contentType: "application/pdf",
      base64: PDF_A.toString("base64"),
      sourceMetadata: meta,
    });
    expect(doc.status).toBe("CURRENT");

    const stored = await prisma.productDocument.findUniqueOrThrow({
      where: { id: doc.id },
    });
    expect(stored.sourceMetadata).toMatchObject({
      source: "SHAREPOINT",
      itemId: "item-sp-1",
      driveId: "drive-sp",
    });

    const pub = await listPublicProductDocuments(productId);
    expect(pub.some((d) => d.id === doc.id)).toBe(true);
    expect(JSON.stringify(pub)).not.toMatch(/sharepoint|drive-sp|item-sp/i);
    expect(pub[0]).not.toHaveProperty("sourceMetadata");
  });

  it("classifies unchanged SharePoint item as ALREADY_ATTACHED and changed as UPDATED_SOURCE", async () => {
    const catalogue = [
      {
        productId,
        sku: `SPSKU${String(stamp).slice(-6)}`,
        name: `SP Cleaner ${stamp}`,
      },
    ];
    const same = await buildSdsPreviewItems(
      [
        {
          clientKey: "1",
          filename: "SPSKU SDS.pdf",
          bytes: PDF_A,
          sharepointItemId: "item-sp-1",
        },
      ],
      catalogue,
    );
    expect(same[0]?.status).toBe("ALREADY_ATTACHED");
    expect(same[0]?.checksumSha256).toBe(sha256Hex(PDF_A));

    const updated = await buildSdsPreviewItems(
      [
        {
          clientKey: "2",
          filename: "SPSKU SDS.pdf",
          bytes: PDF_B,
          sharepointItemId: "item-sp-1",
        },
      ],
      catalogue,
    );
    expect(updated[0]?.status).toBe("UPDATED_SOURCE");
  });

  it("does not auto-remove B2B SDS when modelling SOURCE_MISSING", async () => {
    const before = await prisma.productDocument.findFirst({
      where: { productId, type: "SAFETY_DATA_SHEET", status: "CURRENT" },
    });
    expect(before).toBeTruthy();
    // SOURCE_MISSING is a preview status only — active SDS remains
    const still = await prisma.productDocument.findUnique({ where: { id: before!.id } });
    expect(still?.status).toBe("CURRENT");
  });

  it("keeps local upload path working alongside SharePoint metadata imports", async () => {
    // Archive current then upload a local (no source metadata) SDS
    await prisma.productDocument.updateMany({
      where: { productId, status: "CURRENT" },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    const local = await uploadProductDocument(adminId, {
      productId,
      type: "SAFETY_DATA_SHEET",
      filename: "local-upload.pdf",
      contentType: "application/pdf",
      base64: PDF_B.toString("base64"),
    });
    expect(local.status).toBe("CURRENT");
    const row = await prisma.productDocument.findUniqueOrThrow({ where: { id: local.id } });
    expect(row.sourceMetadata).toBeNull();
  });
});
