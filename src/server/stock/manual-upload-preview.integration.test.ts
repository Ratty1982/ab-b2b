import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { AuthError } from "@/server/rbac/guards";
import { applyStockFeed, ensureAutopartWarehouse } from "@/server/stock/service";
import { buildNative231Po3New } from "@/server/stock/fixtures/native-231po3new";
import {
  assertPreviewInventoryBaselineFresh,
  confirmManualStockUpload,
  inventoryBaselineFingerprint,
  previewManualStockUpload,
} from "@/server/stock/manual-upload-preview";

const prisma = new PrismaClient();
const stamp = Date.now();
let adminId = "";

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

function csv(rows: string[]) {
  return ["SKU,Description,Avail", ...rows].join("\n");
}

function nativeFeed(sku: string, avail: number, description = "KIT") {
  return buildNative231Po3New([
    {
      sku,
      description,
      stk: "0.0000",
      avail: `${avail}.0000`,
      pick: "0.0000",
      physical: "0.0000",
    },
  ]);
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`stock.preview.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  await ensureAutopartWarehouse();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("manual upload preview freshness", () => {
  it("fingerprints inventory baselines deterministically", () => {
    const rows = [
      { variantId: "b", qtyOnHand: 1, manualOverrideQty: null, updatedAt: "2026-11-06T10:00:00.000Z" },
      { variantId: "a", qtyOnHand: null, manualOverrideQty: null, updatedAt: null },
    ];
    const again = [
      { variantId: "a", qtyOnHand: null, manualOverrideQty: null, updatedAt: null },
      { variantId: "b", qtyOnHand: 1, manualOverrideQty: null, updatedAt: "2026-11-06T10:00:00.000Z" },
    ];
    expect(inventoryBaselineFingerprint(rows)).toBe(inventoryBaselineFingerprint(again));
    expect(
      inventoryBaselineFingerprint([
        { ...rows[1]!, qtyOnHand: 0 },
      ]),
    ).not.toBe(inventoryBaselineFingerprint([rows[1]!]));
  });

  it("rejects confirm when a scheduled sync changes inventory after preview", async () => {
    const sku = `PREVSYNC${stamp}`;
    const product = await saveProduct(adminId, {
      sku,
      name: `Preview sync ${sku}`,
      brand: "Power Maxed",
      category: "Braking",
      trade: 4,
      rrp: 8,
      packQty: 1,
      caseQty: 1,
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { status: "ACTIVE", isActive: true },
    });

    // Establish confirmed baseline Avail 5.
    await applyStockFeed({
      text: csv([`${sku},kit,5`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });

    const preview = await previewManualStockUpload(adminId, {
      filename: "231PO3NEW-preview.txt",
      text: nativeFeed(sku, 12),
    });
    expect(preview.wouldUpdate).toBe(1);
    expect(preview.inventoryBaselineHash).toMatch(/^[a-f0-9]{64}$/);

    // Intervening scheduled sync changes Autopart Avail before confirm.
    await applyStockFeed({
      text: csv([`${sku},kit,9`]),
      dryRun: false,
      trigger: "schedule",
      actorUserId: adminId,
    });

    await expect(
      confirmManualStockUpload(adminId, {
        previewId: preview.previewId,
        fileHash: preview.fileHash,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });

    // Fresh preview against the new baseline can still confirm.
    const fresh = await previewManualStockUpload(adminId, {
      filename: "231PO3NEW-preview-retry.txt",
      text: nativeFeed(sku, 12),
    });
    const applied = await confirmManualStockUpload(adminId, {
      previewId: fresh.previewId,
      fileHash: fresh.fileHash,
    });
    expect(applied.status).toBe("SUCCESS");

    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });
    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyOnHand).toBe(12);
  });

  it("assertPreviewInventoryBaselineFresh rejects when a matched SKU gains inventory after preview", async () => {
    const sku = `PREVNEW${stamp}`;
    await saveProduct(adminId, {
      sku,
      name: `Preview new ${sku}`,
      brand: "Power Maxed",
      category: "Braking",
      trade: 4,
      rrp: 8,
      packQty: 1,
      caseQty: 1,
    });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });
    // Ensure no inventory row (unconfirmed).
    await prisma.inventory.deleteMany({ where: { variantId: variant.id } });

    const preview = await previewManualStockUpload(adminId, {
      filename: "231PO3NEW-new.txt",
      text: nativeFeed(sku, 3),
    });
    expect(preview.newlyConfirmed).toBe(1);

    // Scheduled sync confirms the SKU before the operator confirms the preview.
    await applyStockFeed({
      text: csv([`${sku},kit,3`]),
      dryRun: false,
      trigger: "schedule",
      actorUserId: adminId,
    });

    await expect(
      assertPreviewInventoryBaselineFresh({
        previewCreatedAt: new Date(Date.now() - 60_000),
        summaryJson: {
          inventoryBaseline: preview.inventoryBaseline,
          inventoryBaselineHash: preview.inventoryBaselineHash,
        },
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
