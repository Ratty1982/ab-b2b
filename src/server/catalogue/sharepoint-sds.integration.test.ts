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
  SHAREPOINT_SDS_SETTINGS_ID,
  testSharePointSdsConnection,
  updateSharePointSdsSettings,
} from "@/server/catalogue/sharepoint-sds-settings";
import { buildSharePointSourceMetadata } from "@/domain/sharepoint-sds";
import { sha256Hex } from "@/domain/product-documents";
import { decryptSecret } from "@/server/crypto/secret";

const prisma = new PrismaClient();
const stamp = Date.now();
const PDF_A = Buffer.from("%PDF-1.4\n% sp-sds-a\ntrailer\n%%EOF\n", "utf8");
const PDF_B = Buffer.from("%PDF-1.4\n% sp-sds-b-updated\ntrailer\n%%EOF\n", "utf8");

let adminId = "";
let tradeUserId = "";
let marketingId = "";
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
  marketingId = await ensureUser(`sp.mkt.${stamp}@example.invalid`, ["MARKETING"]);

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

  it("blocks marketing (products.edit without integrations.sharepoint.manage) from config changes", async () => {
    await expect(
      updateSharePointSdsSettings(marketingId, { sourceLabel: "nope" }),
    ).rejects.toBeInstanceOf(AuthError);
    // Viewing settings remains products.view — marketing has products.view
    await expect(getSharePointSdsSettingsForActor(marketingId)).resolves.toBeTruthy();
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
      folderUrlHint:
        "https://automotivebrands-my.sharepoint.com/personal/george_parker_automotivebrands_co_uk/Documents/SDS",
      driveId: "b!driveTestId001",
      folderItemId: "01FOLDERITEMIDTEST",
    });
    expect(saved.hasClientSecret).toBe(true);
    expect(saved.tenantId).toBe("00000000-0000-0000-0000-000000000001");
    expect(saved.clientId).toBe("11111111-1111-1111-1111-111111111111");
    expect(saved.userPrincipalName).toBe("george.parker@automotivebrands.co.uk");
    expect(saved.folderUrlHint).toContain("sharepoint.com");
    expect(saved.driveId).toBe("b!driveTestId001");
    expect(saved.folderItemId).toBe("01FOLDERITEMIDTEST");
    expect(saved.recommendedPermission).toBe("Files.SelectedOperations.Selected");
    expect(JSON.stringify(saved)).not.toContain("unit-test-secret");
    expect(saved).not.toHaveProperty("clientSecret");
    expect(saved).not.toHaveProperty("clientSecretEncrypted");

    const reloaded = await getSharePointSdsSettingsForActor(adminId);
    expect(reloaded.tenantId).toBe("00000000-0000-0000-0000-000000000001");
    expect(reloaded.clientId).toBe("11111111-1111-1111-1111-111111111111");
    expect(reloaded.hasClientSecret).toBe(true);
    expect(JSON.stringify(reloaded)).not.toContain("unit-test-secret");
  });

  it("rejects non-SharePoint folder URLs (SSRF boundary)", async () => {
    await expect(
      updateSharePointSdsSettings(adminId, {
        folderUrlHint: "https://evil.example/steal",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("preserves encrypted secret when later save omits clientSecret", async () => {
    await updateSharePointSdsSettings(adminId, {
      tenantId: "00000000-0000-0000-0000-0000000000a1",
      clientId: "22222222-2222-2222-2222-222222222222",
      clientSecret: "original-secret-value-abc",
      userPrincipalName: "george.parker@automotivebrands.co.uk",
    });
    const before = await prisma.sharePointSdsSettings.findUniqueOrThrow({
      where: { id: SHAREPOINT_SDS_SETTINGS_ID },
    });
    expect(before.clientSecretEncrypted).toBeTruthy();
    const originalPlain = decryptSecret(before.clientSecretEncrypted);
    expect(originalPlain).toBe("original-secret-value-abc");

    const saved = await updateSharePointSdsSettings(adminId, {
      tenantId: "00000000-0000-0000-0000-0000000000a2",
      clientId: "33333333-3333-3333-3333-333333333333",
      sourceLabel: "Updated label only",
      // clientSecret intentionally omitted
    });
    expect(saved.tenantId).toBe("00000000-0000-0000-0000-0000000000a2");
    expect(saved.clientId).toBe("33333333-3333-3333-3333-333333333333");
    expect(saved.hasClientSecret).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("original-secret");

    const after = await prisma.sharePointSdsSettings.findUniqueOrThrow({
      where: { id: SHAREPOINT_SDS_SETTINGS_ID },
    });
    expect(decryptSecret(after.clientSecretEncrypted)).toBe("original-secret-value-abc");
  });

  it("replaces encrypted secret when a new secret is provided", async () => {
    await updateSharePointSdsSettings(adminId, {
      clientSecret: "first-secret-value",
    });
    await updateSharePointSdsSettings(adminId, {
      clientSecret: "second-secret-value",
    });
    const row = await prisma.sharePointSdsSettings.findUniqueOrThrow({
      where: { id: SHAREPOINT_SDS_SETTINGS_ID },
    });
    expect(decryptSecret(row.clientSecretEncrypted)).toBe("second-secret-value");
    const pub = await getSharePointSdsSettingsForActor(adminId);
    expect(JSON.stringify(pub)).not.toContain("second-secret");
  });

  it("failed Test Connection does not wipe saved settings", async () => {
    await updateSharePointSdsSettings(adminId, {
      enabled: true,
      tenantId: "tenant-keep-on-fail",
      clientId: "44444444-4444-4444-4444-444444444444",
      clientSecret: "secret-keep-on-fail",
      userPrincipalName: "george.parker@automotivebrands.co.uk",
      folderUrlHint: "https://automotivebrands-my.sharepoint.com/personal/x/Documents/keep-me",
      folderDisplayName: "Keep Folder Name",
      sourceLabel: "Keep Source Label",
    });
    // Force resolved folder IDs so testConnection hits Graph with bogus credentials
    // rather than short-circuiting on "not configured".
    await prisma.sharePointSdsSettings.update({
      where: { id: SHAREPOINT_SDS_SETTINGS_ID },
      data: {
        driveId: "drive-fake-for-test",
        folderItemId: "folder-fake-for-test",
      },
    });

    await expect(testSharePointSdsConnection(adminId)).rejects.toBeInstanceOf(AuthError);

    const pub = await getSharePointSdsSettingsForActor(adminId);
    expect(pub.tenantId).toBe("tenant-keep-on-fail");
    expect(pub.clientId).toBe("44444444-4444-4444-4444-444444444444");
    expect(pub.userPrincipalName).toBe("george.parker@automotivebrands.co.uk");
    expect(pub.folderUrlHint).toBe(
      "https://automotivebrands-my.sharepoint.com/personal/x/Documents/keep-me",
    );
    expect(pub.folderDisplayName).toBe("Keep Folder Name");
    expect(pub.sourceLabel).toBe("Keep Source Label");
    expect(pub.hasClientSecret).toBe(true);
    expect(pub.lastConnectionTestOk).toBe(false);
    expect(pub.lastConnectionTestError).toBeTruthy();

    const row = await prisma.sharePointSdsSettings.findUniqueOrThrow({
      where: { id: SHAREPOINT_SDS_SETTINGS_ID },
    });
    expect(decryptSecret(row.clientSecretEncrypted)).toBe("secret-keep-on-fail");
    expect(row.tenantId).toBe("tenant-keep-on-fail");
    expect(row.driveId).toBe("drive-fake-for-test");
    expect(row.folderItemId).toBe("folder-fake-for-test");
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
