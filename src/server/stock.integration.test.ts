import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import { getProductWorkspace, getPublicProduct, listPublicProducts } from "@/server/catalogue/products";
import { AuthError } from "@/server/rbac/guards";
import {
  applyStockFeed,
  getStockSyncRun,
  getVariantStock,
  listStockSyncChanges,
  listUnmatchedStockSkus,
  pollImapNow,
  runManualStockSync,
  runScheduledStockSync,
} from "@/server/stock/service";
import { dueStockWindow, isDueStockWindow } from "@/domain/stock-schedule";
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
    expect(live.errorSummary).toMatch(/need attention/);
    const issues = await prisma.stockSyncIssue.findMany({ where: { runId: live.runId } });
    expect(issues.some((row) => row.kind === "UNMATCHED")).toBe(false);
    expect(issues.some((row) => row.kind === "DUPLICATE")).toBe(true);

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
    expect(invalidRow.status).toBe("PARTIAL");
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

  it("scheduled sync catch-up keeps 09:00 due at 10:07 without mutating stock when no email exists", async () => {
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
    const beforeNine = new Date("2026-01-15T08:59:00.000Z");
    expect(isDueStockWindow(beforeNine, 9)).toBe(false);
    expect(dueStockWindow(beforeNine).hour).toBe(18);

    const midMorning = new Date("2026-01-15T10:07:00.000Z");
    expect(dueStockWindow(midMorning).hour).toBe(9);
    const waiting = await runScheduledStockSync({ dryRun: false, now: midMorning, emails: [] });
    expect(waiting.status).toBe("WAITING_FOR_EMAIL");
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(11);

    const manual = await pollImapNow(adminId, true);
    expect(manual.dryRun).toBe(true);
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(11);
  });

  it("treats valid Autopart SKUs missing from AB as not-in-catalogue SUCCESS, not invalid", async () => {
    const stamp = Date.now();
    const matchedSku = `ST5K-${stamp}`;
    const absentSku = `ABSENT-${stamp}`;
    await saveProduct(adminId, {
      sku: matchedSku,
      name: "Matched fixture",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3,
      rrp: 6,
      packQty: 1,
      caseQty: 1,
    });
    const first = await applyStockFeed({
      text: csv([`${matchedSku},keep,42`, `${absentSku},master only,17`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    expect(first.status).toBe("SUCCESS");
    expect(first.matched).toBe(1);
    expect(first.updated).toBe(1);
    expect(first.unmatched).toBe(1);
    expect(first.invalid).toBe(0);
    expect(first.errorSummary).toBeNull();
    expect(first.summary).toContain("Not in AB catalogue: 1");
    expect(await prisma.stockSyncChange.count({ where: { runId: first.runId, skuSnapshot: absentSku } })).toBe(0);
    const detail = await getStockSyncRun(adminId, first.runId);
    expect(detail.issues).toHaveLength(0);
    expect(await prisma.productVariant.findUnique({ where: { sku: absentSku } })).toBeNull();
    expect(await prisma.inventory.count({ where: { variant: { sku: absentSku } } })).toBe(0);

    const listed = await listUnmatchedStockSkus(adminId, { q: absentSku });
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.sku).toBe(absentSku);
    expect(listed.items[0]?.avail).toBe("17");
    const firstSeen = listed.items[0]?.firstSeenAt;

    const again = await applyStockFeed({
      text: csv([`${matchedSku},keep,42`, `${absentSku},master only,19`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    expect(again.status).toBe("SUCCESS");
    expect(await prisma.stockFeedUnmatched.count({ where: { sku: absentSku } })).toBe(1);
    const afterUpsert = await prisma.stockFeedUnmatched.findUniqueOrThrow({ where: { sku: absentSku } });
    expect(afterUpsert.lastAvailRaw).toBe("19");
    expect(afterUpsert.occurrenceCount).toBe(2);
    expect(afterUpsert.firstSeenAt.toISOString()).toBe(firstSeen);

    await saveProduct(adminId, {
      sku: absentSku,
      name: "Later catalogued",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3,
      rrp: 6,
      packQty: 1,
      caseQty: 1,
    });
    const rematch = await applyStockFeed({
      text: csv([`${matchedSku},keep,42`, `${absentSku},now in AB,19`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    expect(rematch.status).toBe("SUCCESS");
    expect(rematch.matched).toBe(2);
    expect(rematch.unmatched).toBe(0);
    const laterVariant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: absentSku } });
    const laterInv = await prisma.inventory.findFirstOrThrow({ where: { variantId: laterVariant.id } });
    expect(laterInv.qtyOnHand).toBe(19);
    expect(await prisma.stockFeedUnmatched.findUnique({ where: { sku: absentSku } })).toBeNull();

    const pub = await listPublicProducts({ userId: null, q: absentSku });
    const card = pub.items.find((item) => item.sku === absentSku);
    expect(card).not.toHaveProperty("qtyOnHand");
    expect(JSON.stringify(card)).not.toMatch(/qtyOnHand|stockQty/);
  });

  it("can SUCCESS with 10,000+ unmatched valid Autopart rows and no AB product creation", async () => {
    const stamp = Date.now().toString(36);
    const known = `ST5B-${stamp}`;
    await saveProduct(adminId, {
      sku: known,
      name: "Bulk match",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3,
      rrp: 6,
      packQty: 1,
      caseQty: 1,
    });
    const rows = [`${known},known,8`];
    for (let i = 0; i < 10000; i += 1) {
      rows.push(`U${stamp}${i.toString(36)},bulk,${(i % 50) + 1}`);
    }
    const live = await applyStockFeed({
      text: csv(rows),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    expect(live.status).toBe("SUCCESS");
    expect(live.matched).toBe(1);
    expect(live.unmatched).toBe(10000);
    expect(live.invalid).toBe(0);
    expect(live.errorSummary).toBeNull();
    expect(await prisma.productVariant.count({ where: { sku: { startsWith: `U${stamp}` } } })).toBe(0);
    expect(await prisma.inventory.count({ where: { variant: { sku: { startsWith: `U${stamp}` } } } })).toBe(0);
    const unmatchedCount = await prisma.stockFeedUnmatched.count({ where: { sku: { startsWith: `U${stamp}` } } });
    expect(unmatchedCount).toBe(10000);
    const issues = await prisma.stockSyncIssue.count({ where: { runId: live.runId, kind: "UNMATCHED" } });
    expect(issues).toBe(0);
    expect(await prisma.stockSyncChange.count({ where: { runId: live.runId } })).toBe(1);
  }, 120_000);

  it("persists live old→new quantity history and availability bands without writing unchanged or dry-run rows", async () => {
    const stamp = Date.now();
    const make = async (sku: string, name: string) => {
      const product = await saveProduct(adminId, {
        sku,
        name,
        brand: "Power Maxed",
        category: "Braking",
        trade: 4,
        rrp: 8,
        packQty: 1,
        caseQty: 1,
      });
      return product;
    };
    const skus = {
      same: `CH36-${stamp}`,
      up: `CH8-${stamp}`,
      low: `CH20-${stamp}`,
      out: `CH5-${stamp}`,
      fromZero: `CH0-${stamp}`,
      trim: `CH35-${stamp}`,
    };
    const productUp = await make(skus.up, "Power Maxed Window & Glass Cleaner 5 Litre");
    await make(skus.same, "Unchanged band");
    await make(skus.low, "Drop to low");
    await make(skus.out, "Drop to out");
    await make(skus.fromZero, "From empty");
    await make(skus.trim, "Stay in stock");

    await applyStockFeed({
      text: csv([
        `${skus.same},a,36`,
        `${skus.up},b,8`,
        `${skus.low},c,36`,
        `${skus.out},d,5`,
        `${skus.fromZero},e,0`,
        `${skus.trim},f,36`,
      ]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });

    const dry = await applyStockFeed({
      text: csv([`${skus.up},b,36`]),
      dryRun: true,
      trigger: "manual",
      actorUserId: adminId,
    });
    expect(dry.status).toBe("SUCCESS");
    expect(dry.updated).toBe(0);
    expect(dry.wouldUpdate).toBe(1);
    expect(dry.wouldChanges?.[0]).toMatchObject({ previousQty: 8, newQty: 36, quantityChange: 28, availabilityChange: "LOW STOCK → IN STOCK" });
    expect(await prisma.stockSyncChange.count({ where: { runId: dry.runId } })).toBe(0);
    expect((await prisma.inventory.findFirstOrThrow({ where: { variant: { sku: skus.up } } })).qtyOnHand).toBe(8);

    const live = await applyStockFeed({
      text: csv([
        `${skus.same},a,36`,
        `${skus.up},b,36`,
        `${skus.low},c,20`,
        `${skus.out},d,0`,
        `${skus.fromZero},e,50`,
        `${skus.trim},f,35`,
        `GHOST-${stamp},nope,9`,
      ]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    expect(live.status).toBe("SUCCESS");
    expect(live.updated).toBe(5);
    expect(live.unchanged).toBe(1);
    expect(live.unmatched).toBe(1);

    const changes = await listStockSyncChanges(adminId, { runId: live.runId, pageSize: 50 });
    expect(changes.total).toBe(5);
    expect(changes.items.some((row) => row.sku === skus.same)).toBe(false);
    const bySku = Object.fromEntries(changes.items.map((row) => [row.sku, row]));
    expect(bySku[skus.up]).toMatchObject({
      previousQty: 8,
      newQty: 36,
      quantityChange: 28,
      availabilityChange: "LOW STOCK → IN STOCK",
      productName: "Power Maxed Window & Glass Cleaner 5 Litre",
      productId: productUp.id,
    });
    expect(bySku[skus.low]).toMatchObject({ previousQty: 36, newQty: 20, availabilityChange: "IN STOCK → LOW STOCK" });
    expect(bySku[skus.out]).toMatchObject({ previousQty: 5, newQty: 0, availabilityChange: "LOW STOCK → OUT OF STOCK" });
    expect(bySku[skus.fromZero]).toMatchObject({ previousQty: 0, newQty: 50, availabilityChange: "OUT OF STOCK → IN STOCK" });
    expect(bySku[skus.trim]).toMatchObject({ previousQty: 36, newQty: 35, availabilityChange: "IN STOCK" });
    expect(changes.items.some((row) => row.sku === `GHOST-${stamp}`)).toBe(false);

    const detail = await getStockSyncRun(adminId, live.runId);
    expect(detail.changeStats).toMatchObject({
      total: 5,
      increased: 2,
      decreased: 3,
      becameInStock: 2,
      becameLowStock: 1,
      becameOutOfStock: 1,
    });

    const pub = await listPublicProducts({ userId: null, q: skus.up });
    const card = pub.items.find((item) => item.sku === skus.up);
    expect(JSON.stringify(card)).not.toMatch(/previousQty|newQty|quantityChange|qtyOnHand|stockQty/);

    await expect(getStockSyncRun(tradeUserId, live.runId)).rejects.toBeInstanceOf(AuthError);
    await expect(listStockSyncChanges(tradeUserId, { runId: live.runId })).rejects.toBeInstanceOf(AuthError);

    const warehouse = await prisma.warehouse.findFirstOrThrow({ where: { code: "AUTOPART" } });
    await expect(
      prisma.$transaction([
        prisma.inventory.upsert({
          where: { variantId_warehouseId: { variantId: "missing-variant", warehouseId: warehouse.id } },
          create: {
            variantId: "missing-variant",
            warehouseId: warehouse.id,
            qtyOnHand: 50,
            qtyReserved: 0,
            status: "IN_STOCK",
          },
          update: { qtyOnHand: 50 },
        }),
        prisma.stockSyncChange.createMany({
          data: [
            {
              runId: live.runId,
              skuSnapshot: `FAIL-${stamp}`,
              productNameSnapshot: "must not persist",
              previousQty: 36,
              newQty: 50,
              previousAvailability: "in",
              newAvailability: "in",
            },
          ],
        }),
      ]),
    ).rejects.toThrow();
    expect(await prisma.stockSyncChange.count({ where: { skuSnapshot: `FAIL-${stamp}` } })).toBe(0);
  });

  it("runs a due 09:00 window once, catch-up at 09:02, and does not repeat after restart", async () => {
    await prisma.stockScheduleWindow.deleteMany({ where: { key: "2026-02-10T09:00" } });
    const sku = `SCH9-${Date.now().toString(36).slice(-6)}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Scheduled 09",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3,
      rrp: 6,
      packQty: 1,
      caseQty: 1,
    });
    const { buildNative231Po3New } = await import("@/server/stock/fixtures/native-231po3new");
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    const native = buildNative231Po3New([
      { sku: variant.sku, description: "SCHED", stk: "40.0000", avail: "36.0000", pick: "1.0000", physical: "40.0000" },
    ]);
    const email = {
      uid: `uid-${sku}`,
      messageId: `<${sku}@example.invalid>`,
      from: "reports@example.com",
      subject: "231PO3NEW",
      receivedAt: new Date("2026-02-10T09:01:00.000Z"),
      attachments: [{ filename: "231PO3NEW.txt", content: Buffer.from(native) }],
    };
    const atNine = new Date("2026-02-10T09:00:00.000Z");
    const first = await runScheduledStockSync({ dryRun: false, trigger: "schedule", now: atNine, emails: [email] });
    expect(first.status).toBe("SUCCESS");
    expect(first.windowKey).toBe("2026-02-10T09:00");
    expect(first.windowStatus).toBe("COMPLETE");
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(36);
    expect(await prisma.stockSyncChange.count({ where: { runId: first.runId! } })).toBe(1);

    const at902 = await runScheduledStockSync({
      dryRun: false,
      trigger: "schedule",
      now: new Date("2026-02-10T09:02:00.000Z"),
      emails: [email],
    });
    expect(at902.status).toBe("SKIPPED");
    expect(at902.windowStatus).toBe("COMPLETE");
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(36);
  });

  it("waits for a late 12:00 email then completes that window once", async () => {
    await prisma.stockScheduleWindow.deleteMany({ where: { key: "2026-02-11T12:00" } });
    const sku = `SCH12-${Date.now().toString(36).slice(-6)}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Scheduled 12",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3,
      rrp: 6,
      packQty: 1,
      caseQty: 1,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await applyStockFeed({
      text: csv([`${variant.sku},seed,5`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    const { buildNative231Po3New } = await import("@/server/stock/fixtures/native-231po3new");
    const native = buildNative231Po3New([
      { sku: variant.sku, description: "LATE", stk: "20.0000", avail: "8.0000", pick: "1.0000", physical: "20.0000" },
    ]);
    const noon = new Date("2026-02-11T12:00:00.000Z");
    const scheduledRunsBefore = await prisma.stockSyncRun.count({ where: { trigger: "schedule" } });
    const waiting = await runScheduledStockSync({ dryRun: false, trigger: "schedule", now: noon, emails: [] });
    expect(waiting.status).toBe("WAITING_FOR_EMAIL");
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(5);
    expect(await prisma.stockSyncRun.count({ where: { trigger: "schedule" } })).toBe(scheduledRunsBefore);

    const email = {
      uid: `uid-${sku}`,
      messageId: `<${sku}@example.invalid>`,
      from: "reports@example.com",
      subject: "231PO3NEW",
      receivedAt: new Date("2026-02-11T12:07:00.000Z"),
      attachments: [{ filename: "231PO3NEW.txt", content: Buffer.from(native) }],
    };
    const late = await runScheduledStockSync({
      dryRun: false,
      trigger: "schedule",
      now: new Date("2026-02-11T12:07:00.000Z"),
      emails: [email],
    });
    expect(late.status).toBe("SUCCESS");
    expect(late.windowStatus).toBe("COMPLETE");
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(8);

    const again = await runScheduledStockSync({
      dryRun: false,
      trigger: "schedule",
      now: new Date("2026-02-11T12:20:00.000Z"),
      emails: [email],
    });
    expect(again.status).toBe("SKIPPED");
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(8);
  });

  it("allows only one of two concurrent scheduled workers to import a window", async () => {
    await prisma.stockScheduleWindow.deleteMany({ where: { key: "2026-02-12T15:00" } });
    const sku = `SCHD-${Date.now().toString(36).slice(-6)}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Dual worker",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3,
      rrp: 6,
      packQty: 1,
      caseQty: 1,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    const { buildNative231Po3New } = await import("@/server/stock/fixtures/native-231po3new");
    const native = buildNative231Po3New([
      { sku: variant.sku, description: "DUAL", stk: "10.0000", avail: "21.0000", pick: "1.0000", physical: "10.0000" },
    ]);
    const email = {
      uid: `uid-${sku}`,
      messageId: `<${sku}@example.invalid>`,
      from: "reports@example.com",
      subject: "231PO3NEW",
      receivedAt: new Date("2026-02-12T15:00:00.000Z"),
      attachments: [{ filename: "231PO3NEW.txt", content: Buffer.from(native) }],
    };
    const now = new Date("2026-02-12T15:00:00.000Z");
    const [a, b] = await Promise.all([
      runScheduledStockSync({ dryRun: false, trigger: "schedule", now, emails: [email] }),
      runScheduledStockSync({ dryRun: false, trigger: "schedule", now, emails: [email] }),
    ]);
    const statuses = [a.status, b.status];
    expect(statuses).toContain("SUCCESS");
    expect(statuses.some((status) => status === "SKIPPED" || status === "WAITING_FOR_EMAIL" || status === "SUCCESS")).toBe(true);
    const successCount = [a, b].filter((row) => row.status === "SUCCESS").length;
    expect(successCount).toBe(1);
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(21);
  });

  it("retains inventory when scheduled IMAP/parser work fails and does not emit a waiting-for-email failure", async () => {
    await prisma.stockScheduleWindow.deleteMany({ where: { key: { in: ["2026-02-13T18:00", "2026-02-14T09:00"] } } });
    const sku = `SCHF-${Date.now().toString(36).slice(-6)}`;
    const product = await saveProduct(adminId, {
      sku,
      name: "Fail retain",
      brand: "Power Maxed",
      category: "Braking",
      trade: 3,
      rrp: 6,
      packQty: 1,
      caseQty: 1,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { productId: product.id } });
    await applyStockFeed({
      text: csv([`${variant.sku},seed,14`]),
      dryRun: false,
      trigger: "manual",
      actorUserId: adminId,
    });
    const missingImap = await runScheduledStockSync({
      dryRun: false,
      trigger: "schedule",
      now: new Date("2026-02-13T18:00:00.000Z"),
    });
    expect(missingImap.status).toBe("FAILED");
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(14);

    const bad = {
      uid: `uid-bad-${sku}`,
      messageId: `<bad-${sku}@example.invalid>`,
      from: "reports@example.com",
      subject: "231PO3NEW",
      receivedAt: new Date("2026-02-14T09:00:00.000Z"),
      attachments: [
        {
          filename: "231PO3NEW.txt",
          content: Buffer.from("AUTOPART SYSTEM STOCK USAGES / REORDER INFORMATION (231PO3NEW)\nthis is not a stock report"),
        },
      ],
    };
    const parsed = await runScheduledStockSync({
      dryRun: false,
      trigger: "schedule",
      now: new Date("2026-02-14T09:00:00.000Z"),
      emails: [bad],
    });
    expect(parsed.status).toBe("FAILED");
    expect(parsed.errorSummary ?? "").toMatch(/231PO3NEW was detected|Avail column could not be parsed/i);
    expect((await prisma.inventory.findFirstOrThrow({ where: { variantId: variant.id } })).qtyOnHand).toBe(14);
  });
});
