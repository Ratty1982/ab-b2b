import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { getProductWorkspace, getPublicProduct, listPublicProducts } from "@/server/catalogue/products";
import { AuthError } from "@/server/rbac/guards";
import {
  applyStockFeed,
  getVariantStock,
  pollImapNow,
  runManualStockSync,
  runScheduledStockSync,
} from "@/server/stock/service";
import { isWithinScheduledStockWindow } from "@/domain/stock-schedule";
import { releaseStockSyncLock, tryAcquireStockSyncLock } from "@/server/stock/lock";
import { getSellableQuantity } from "@/domain/stock";
import { parseAutopart231Po3New } from "@/domain/stock-parse";

const prisma = new PrismaClient();
let adminId = "";
let salesRepId = "";
let tradeUserId = "";

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
    user = await prisma.user.update({ where: { id: user.id }, data: { actorType } });
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
  adminId = await ensureUser("stock.admin@example.invalid", ["SUPER_ADMIN"]);
  salesRepId = await ensureUser("stock.sales@example.invalid", ["SALES_REPRESENTATIVE"]);
  tradeUserId = await ensureUser("stock.trade@example.invalid", [], "TRADE");
});

afterAll(async () => {
  await prisma.$disconnect();
});

function csv(rows: string[]) {
  return ["SKU,Description,Avail", ...rows].join("\n");
}

describe("Phase 5 Autopart inventory integration", () => {
  it("parses the fixture file including invalid and duplicate rows", () => {
    const text = readFileSync(new URL("./stock/fixtures/231po3new-sample.csv", import.meta.url), "utf8");
    const parsed = parseAutopart231Po3New(text);
    if ("code" in parsed) throw new Error(parsed.message);
    expect(parsed.rows.length).toBeGreaterThan(8);
    const missing = parseAutopart231Po3New(
      readFileSync(new URL("./stock/fixtures/missing-avail-header.csv", import.meta.url), "utf8"),
    );
    expect("code" in missing && missing.code).toBe("MISSING_AVAIL_HEADER");
  });

  it("imports Avail bands, skips unknown/duplicates, and keeps public DTOs quantity-free", async () => {
    const stamp = Date.now();
    const make = async (sku: string, caseQty = 1) => {
      const product = await saveProduct(adminId, {
        sku,
        name: `Stock ${sku}`,
        brand: "Power Maxed",
        category: "Braking",
        trade: 4,
        rrp: 8,
        packQty: 1,
        caseQty,
      });
      await prisma.product.update({
        where: { id: product.id },
        data: { status: "ACTIVE", isActive: true, isTradeVisible: true },
      });
      return product;
    };

    const skus = {
      hi: `ST5H-${stamp}`,
      in: `ST5I-${stamp}`,
      low: `ST5L-${stamp}`,
      one: `ST5O-${stamp}`,
      zero: `ST5Z-${stamp}`,
      neg: `ST5N-${stamp}`,
      case: `ST5C-${stamp}`,
    };
    await make(skus.hi);
    await make(skus.in);
    await make(skus.low);
    await make(skus.one);
    await make(skus.zero);
    await make(skus.neg);
    await make(skus.case, 2);

    const live = await applyStockFeed({
      text: csv([
        `${skus.hi},hi,100`,
        `${skus.in},in,21`,
        `${skus.low},low,20`,
        `${skus.one},one,1`,
        `${skus.zero},zero,0`,
        `${skus.neg},neg,-7`,
        `${skus.case},case,11`,
        `UNKNOWN-${stamp},nope,40`,
        `${skus.hi},dup,3`,
      ]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    expect(live.status).toBe("PARTIAL");
    expect(live.unmatched).toBeGreaterThanOrEqual(1);
    expect(live.duplicates).toBeGreaterThanOrEqual(2);

    const variantHi = await prisma.productVariant.findUniqueOrThrow({ where: { sku: skus.hi } });
    const inventoryHi = await prisma.inventory.findFirst({ where: { variantId: variantHi.id } });
    expect(inventoryHi).toBeFalsy();

    const variantIn = await prisma.productVariant.findUniqueOrThrow({ where: { sku: skus.in } });
    const stockIn = await getVariantStock(variantIn.id);
    expect(stockIn?.sellableQty).toBe(21);
    expect(stockIn?.availability).toBe("in");
    expect(getSellableQuantity(stockIn!)).toBe(21);

    const variantLow = await prisma.productVariant.findUniqueOrThrow({ where: { sku: skus.low } });
    expect((await getVariantStock(variantLow.id))?.availability).toBe("low");

    const variantOne = await prisma.productVariant.findUniqueOrThrow({ where: { sku: skus.one } });
    expect((await getVariantStock(variantOne.id))?.availability).toBe("low");

    const variantZero = await prisma.productVariant.findUniqueOrThrow({ where: { sku: skus.zero } });
    expect((await getVariantStock(variantZero.id))?.availability).toBe("out");

    const variantNeg = await prisma.productVariant.findUniqueOrThrow({ where: { sku: skus.neg } });
    const stockNeg = await getVariantStock(variantNeg.id);
    expect(stockNeg?.sellableQty).toBe(0);
    expect(stockNeg?.sourceAvailRaw).toBe("-7");
    expect(stockNeg?.availability).toBe("out");

    const variantCase = await prisma.productVariant.findUniqueOrThrow({ where: { sku: skus.case } });
    expect((await getVariantStock(variantCase.id))?.sellableQty).toBe(11);

    expect(await prisma.product.findFirst({ where: { variants: { some: { sku: `UNKNOWN-${stamp}` } } } })).toBeNull();

    const pub = await listPublicProducts({ userId: null, q: skus.in });
    const card = pub.items.find((item) => item.sku === skus.in);
    expect(card?.availability).toBe("in");
    expect(card).not.toHaveProperty("stockQty");
    expect(card).not.toHaveProperty("qtyOnHand");
    expect(JSON.stringify(card)).not.toMatch(/qtyOnHand|stockQty|"avail"\s*:/);

    const customer = await getPublicProduct(tradeUserId, skus.low);
    expect(customer?.card.availability).toBe("low");
    expect(customer?.card).not.toHaveProperty("qtyOnHand");
    expect(customer?.card).not.toHaveProperty("stockQty");
    expect(JSON.stringify(customer?.card)).not.toMatch(/qtyOnHand|stockQty/);

    const related = await getPublicProduct(null, skus.one);
    expect(related?.card.availability).toBe("low");
    for (const item of related?.related ?? []) {
      expect(item).not.toHaveProperty("stockQty");
      expect(item).not.toHaveProperty("qtyOnHand");
    }

    const workspace = await getProductWorkspace(adminId, (await prisma.product.findFirstOrThrow({
      where: { variants: { some: { sku: skus.in } } },
    })).id);
    expect(workspace.inventory[0]?.sellableQty).toBe(21);
    expect(workspace.inventory[0]?.source).toBe("231PO3NEW");

    await expect(getProductWorkspace(tradeUserId, workspace.id)).rejects.toBeInstanceOf(AuthError);
  });

  it("dry run does not mutate inventory and failed files preserve previous qty", async () => {
    const sku = `ST5D-${Date.now()}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Dry run fixture",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3,
      rrp: 6,
      packQty: 1,
      caseQty: 1,
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { status: "ACTIVE", isActive: true, isTradeVisible: true },
    });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });

    await applyStockFeed({
      text: csv([`${sku},first,8`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    const before = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(before.qtyOnHand).toBe(8);

    const dry = await applyStockFeed({
      text: csv([`${sku},next,99`]),
      dryRun: true,
      trigger: "manual",
      actorUserId: adminId,
    });
    expect(dry.status).toBe("SUCCESS");
    expect(dry.updated).toBe(0);
    expect(dry.wouldUpdate).toBe(1);
    const afterDry = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(afterDry.qtyOnHand).toBe(8);

    const failed = await applyStockFeed({
      text: "SKU,Description\nX,no avail",
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    expect(failed.status).toBe("FAILED");
    const afterFail = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(afterFail.qtyOnHand).toBe(8);

    const invalidRow = await applyStockFeed({
      text: csv([`${sku},bad,n/a`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    expect(invalidRow.invalid).toBe(1);
    const afterInvalid = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(afterInvalid.qtyOnHand).toBe(8);
  });

  it("enforces sync permission and concurrent lock", async () => {
    await expect(runManualStockSync(salesRepId, { dryRun: true, csv: csv(["X,x,1"]) })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(runManualStockSync(tradeUserId, { dryRun: true, csv: csv(["X,x,1"]) })).rejects.toBeInstanceOf(
      AuthError,
    );

    const holder = "test-lock-holder";
    const locked = await tryAcquireStockSyncLock(holder);
    expect(locked).toBe(true);
    await expect(
      applyStockFeed({ text: csv(["Y,y,1"]), dryRun: true, trigger: "manual", actorUserId: adminId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await releaseStockSyncLock(holder);
  });

  it("does not treat missing feed rows as zero stock", async () => {
    const sku = `ST5M-${Date.now()}`;
    await saveProduct(adminId, {
      sku,
      name: "Retain fixture",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3,
      rrp: 6,
      packQty: 1,
      caseQty: 1,
    });
    await applyStockFeed({
      text: csv([`${sku},keep,15`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    await applyStockFeed({
      text: csv([`OTHER-${Date.now()},other,4`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });
    const inv = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(inv.qtyOnHand).toBe(15);
  });

  it("imports a native 231PO3NEW Avail feed from email dry-run without consuming or mutating", async () => {
    const { importFromImap } = await import("@/server/stock/poll");
    const { buildNative231Po3New } = await import("@/server/stock/fixtures/native-231po3new");
    const { getImapSettings, saveImapSettings } = await import("@/server/stock/service");
    const sku = `ST5E-${Date.now()}`;
    await saveProduct(adminId, {
      sku,
      name: "Email fixture",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3,
      rrp: 6,
      packQty: 1,
      caseQty: 1,
    });
    await applyStockFeed({
      text: csv([`${sku},seed,12`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });
    const native = buildNative231Po3New([
      { sku, description: "EMAIL ROW", stk: "99.0000", avail: "7.0000", pick: "1.0000", physical: "99.0000" },
    ]);
    const email = {
      uid: `uid-${sku}`,
      messageId: `<mid-${sku}@example.invalid>`,
      from: "reports@example.com",
      subject: "231PO3NEW",
      receivedAt: new Date(),
      attachments: [{ filename: "231PO3NEW.txt", content: Buffer.from(native) }],
    };
    const dry = await importFromImap({
      dryRun: true,
      trigger: "manual",
      actorUserId: adminId,
      emails: [email],
    });
    expect(dry.status === "SUCCESS" || dry.status === "PARTIAL").toBe(true);
    expect(dry.updated).toBe(0);
    const afterDry = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(afterDry.qtyOnHand).toBe(12);
    const dryReceipt = await prisma.stockEmailReceipt.findFirst({ where: { emailUid: email.uid } });
    expect(dryReceipt?.consumed).not.toBe(true);

    const live = await importFromImap({
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      emails: [email],
    });
    expect(live.status === "SUCCESS" || live.status === "PARTIAL").toBe(true);
    const afterLive = await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } });
    expect(afterLive.qtyOnHand).toBe(7);

    const again = await importFromImap({
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      emails: [email],
    });
    expect(again.rowsRead).toBe(0);

    const noMail = await importFromImap({
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
      emails: [],
    });
    expect(noMail.rowsRead).toBe(0);
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(7);

    const nativeFail = await applyStockFeed({
      text: "AUTOPART SYSTEM (231PO3NEW)\nthis is not a stock report",
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    expect(nativeFail.status).toBe("FAILED");
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(7);

    await expect(saveImapSettings(adminId, { imapPort: 0 })).rejects.toBeInstanceOf(AuthError);

    await saveImapSettings(adminId, { imapHost: "imap.example.invalid", imapUsername: "ops", imapPassword: "hidden-pass" });
    const pub = await getImapSettings(adminId);
    expect(pub).not.toHaveProperty("imapPassword");
    expect(JSON.stringify(pub)).not.toContain("hidden-pass");
    expect(pub.hasImapPassword).toBe(true);

    await expect(getImapSettings(tradeUserId)).rejects.toBeInstanceOf(AuthError);
  });

  it("scheduled sync skips outside Europe/London windows without mutating stock", async () => {
    const sku = `ST5W-${Date.now().toString(36).slice(-7)}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Window skip",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3,
      rrp: 6,
      packQty: 1,
      caseQty: 1,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await applyStockFeed({
      text: csv([`${variant.sku},seed,11`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    const outside = new Date("2026-01-15T10:07:00.000Z");
    expect(isWithinScheduledStockWindow(outside)).toBe(false);
    const skipped = await runScheduledStockSync({ dryRun: false, now: outside });
    expect(skipped.skipped).toBe(true);
    expect(skipped.rowsRead).toBe(0);
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(11);

    const manual = await pollImapNow(adminId, true);
    expect(manual.dryRun).toBe(true);
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(11);
  });
});
