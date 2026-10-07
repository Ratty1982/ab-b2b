import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma as appPrisma } from "@/infra/database/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
import { skuMatchKey } from "@/domain/stock";
import {
  AUTOPART_216V_EXPANDED_PROFILE,
  AUTOPART_216V_HEADER,
  AUTOPART_216V_PROFILE,
  buildAutopart216vExpandedFixture,
  buildAutopart216vFixture,
} from "@/domain/autopart-216v-fixture";
import { confirmAutopart216vImport } from "@/server/purchasing/backorder-import";
import {
  exportBackordersCsv,
  getBackorderLineDetail,
  getBackorderWorkspace,
  updateBackorderFeedSettings,
} from "@/server/purchasing/backorders";
import { process216vEmailBatch, pollBackorderMailboxNow } from "@/server/purchasing/backorder-poll";
import { getPurchasingSku } from "@/server/purchasing/service";
import { suggestedPurchaseQty } from "@/domain/purchasing-forecast";

const prisma = new PrismaClient();
const stamp = Date.now();

let adminId = "";
let accountsId = "";
let tradeId = "";
let mappedCompanyId = "";
let catalogueVariantId = "";
const catalogueSku = `BO-CAT-${stamp}`;
const externalSku = `BO-EXT-${stamp}`;
const historicSku = `BO-HIST-${stamp}`;
const unknownSku = `BO-UNK-${stamp}`;

function csv216v(
  rows: Array<{
    order: string;
    account: string;
    name: string;
    part: string;
    desc: string;
    ref: string;
    qty: number;
    unit: string;
    value: string;
  }>,
): string {
  const body = rows
    .map((r) =>
      [r.order, r.account, r.name, "", r.part, r.desc, "", r.ref, String(r.qty), r.unit, r.value]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(","),
    )
    .join("\n");
  return `${AUTOPART_216V_HEADER}\n${body}\n`;
}

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: email.split("@")[0]!, status: "ACTIVE", actorType, emailVerified: true },
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
  adminId = await ensureUser(`bo.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  accountsId = await ensureUser(`bo.acc.${stamp}@example.invalid`, ["ACCOUNTS"]);
  tradeId = await ensureUser(`bo.trade.${stamp}@example.invalid`, [], "TRADE");

  const company = await prisma.company.create({
    data: { name: `Backorder Co ${stamp}`, status: "ACTIVE", autopartCustomerCode: `BOACC${stamp}` },
  });
  mappedCompanyId = company.id;

  const product = await saveProduct(adminId, {
    sku: catalogueSku,
    name: `Backorder Catalogue ${stamp}`,
    brand: "Power Maxed",
    category: "Cleaning",
    trade: 4,
    rrp: 8,
    packQty: 1,
    caseQty: 1,
  });
  await prisma.product.update({ where: { id: product.id }, data: { status: "ACTIVE", isActive: true } });
  const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: catalogueSku } });
  catalogueVariantId = variant.id;

  const now = new Date();
  await prisma.autopartProduct.createMany({
    data: [
      {
        sku: catalogueSku,
        matchKey: skuMatchKey(catalogueSku),
        description: "Catalogue cleaner",
        availQty: 20,
        incomingQty: 0,
        physicalQty: 20,
        presentInLatestFeed: true,
        catalogueVariantId,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      {
        sku: externalSku,
        matchKey: skuMatchKey(externalSku),
        description: "External torch",
        availQty: 0,
        incomingQty: 20,
        physicalQty: 0,
        presentInLatestFeed: true,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      {
        sku: historicSku,
        matchKey: skuMatchKey(historicSku),
        description: "Historic only SKU",
        availQty: 0,
        incomingQty: 0,
        presentInLatestFeed: false,
        firstSeenAt: now,
        lastSeenAt: now,
      },
    ],
  });
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("216V import snapshots", () => {
  it("parses the production-shaped fixture into one snapshot with expected totals", async () => {
    const text = buildAutopart216vFixture();
    const hash = createHash("sha256").update(text).digest("hex");
    await prisma.autopartBackorderSnapshot.deleteMany({ where: { fileHash: hash } });
    const first = await confirmAutopart216vImport(adminId, { text, filename: "216V.CSV", source: "MANUAL" });
    expect(first.duplicate).toBe(false);
    const again = await confirmAutopart216vImport(adminId, { text, filename: "216V.csv", source: "MANUAL" });
    expect(again.duplicate).toBe(true);
    expect(again.id).toBe(first.id);
    const snap = await prisma.autopartBackorderSnapshot.findUniqueOrThrow({ where: { id: first.id } });
    expect(snap.outstandingLineCount).toBe(AUTOPART_216V_PROFILE.lines);
    expect(snap.orderCount).toBe(AUTOPART_216V_PROFILE.orders);
    expect(snap.accountCount).toBe(AUTOPART_216V_PROFILE.accounts);
    expect(snap.skuCount).toBe(AUTOPART_216V_PROFILE.skus);
    expect(Number(snap.outstandingQty)).toBe(AUTOPART_216V_PROFILE.units);
    expect(Number(snap.outstandingValue).toFixed(2)).toBe(AUTOPART_216V_PROFILE.outstandingValue);
    expect(await prisma.company.count({ where: { name: { contains: "A2 Motorparts Crew" } } })).toBe(0);
  });

  it("classifies NEW / UNCHANGED / REDUCED / INCREASED / CLEARED across snapshots", async () => {
    const keep = {
      order: `SB${stamp}A`,
      account: "UNMAPPEDX",
      name: "Unmapped Factors",
      part: unknownSku,
      desc: "Unknown historic wax",
      ref: "REF-KEEP",
      qty: 12,
      unit: "2.00",
      value: "24.00",
    };
    const drop = {
      order: `SB${stamp}B`,
      account: "UNMAPPEDX",
      name: "Unmapped Factors",
      part: unknownSku,
      desc: "Unknown historic wax",
      ref: "REF-DROP",
      qty: 4,
      unit: "2.00",
      value: "8.00",
    };
    const first = csv216v([keep, drop]);
    await confirmAutopart216vImport(adminId, { text: first, filename: `216V-${stamp}-1.csv`, source: "MANUAL" });
    const second = csv216v([
      { ...keep, qty: 6, value: "12.00" },
      {
        order: `SB${stamp}C`,
        account: "UNMAPPEDX",
        name: "Unmapped Factors",
        part: unknownSku,
        desc: "Unknown historic wax",
        ref: "REF-NEW",
        qty: 2,
        unit: "2.00",
        value: "4.00",
      },
    ]);
    const thirdText = csv216v([
      { ...keep, qty: 8, value: "16.00" },
      {
        order: `SB${stamp}C`,
        account: "UNMAPPEDX",
        name: "Unmapped Factors",
        part: unknownSku,
        desc: "Unknown historic wax",
        ref: "REF-NEW",
        qty: 2,
        unit: "2.00",
        value: "4.00",
      },
    ]);
    await confirmAutopart216vImport(adminId, { text: second, filename: `216V-${stamp}-2.csv`, source: "MANUAL" });
    const reduced = await prisma.autopartBackorderSnapshot.findFirstOrThrow({
      where: { filename: `216V-${stamp}-2.csv` },
      include: { lines: true },
    });
    expect(reduced.lines.find((l) => l.customerOrderRef === "REF-KEEP")?.changeStatus).toBe("QUANTITY_REDUCED");
    expect(reduced.lines.find((l) => l.customerOrderRef === "REF-DROP")?.changeStatus).toBe("CLEARED");
    expect(reduced.lines.find((l) => l.customerOrderRef === "REF-NEW")?.changeStatus).toBe("NEW");
    expect(reduced.outstandingLineCount).toBe(2);

    await confirmAutopart216vImport(adminId, { text: thirdText, filename: `216V-${stamp}-3.csv`, source: "MANUAL" });
    const increased = await prisma.autopartBackorderSnapshot.findFirstOrThrow({
      where: { filename: `216V-${stamp}-3.csv` },
      include: { lines: true },
    });
    expect(increased.lines.find((l) => l.customerOrderRef === "REF-KEEP")?.changeStatus).toBe("QUANTITY_INCREASED");
    expect(increased.lines.find((l) => l.customerOrderRef === "REF-NEW")?.changeStatus).toBe("UNCHANGED");

    const companiesBefore = await prisma.company.count();
    await expect(
      confirmAutopart216vImport(adminId, { text: "not a 216v file", filename: "notes.csv", source: "MANUAL" }),
    ).rejects.toBeInstanceOf(AuthError);
    const afterFail = await prisma.autopartBackorderSnapshot.findFirstOrThrow({
      where: { filename: `216V-${stamp}-3.csv` },
    });
    expect(afterFail.outstandingLineCount).toBe(2);
    expect(await prisma.company.count()).toBe(companiesBefore);
  });

  it("does not clear previous backorders when a daily report is missing", async () => {
    const latest = await prisma.autopartBackorderSnapshot.findFirstOrThrow({
      where: { filename: `216V-${stamp}-3.csv` },
    });
    const workspace = await getBackorderWorkspace(adminId, { q: unknownSku });
    expect(workspace.current?.snapshotId).toBe(latest.id);
    expect(workspace.changeCounts.CLEARED).toBe(0);
  });

  it("clears outstanding lines only from a strongly identified empty 216V", async () => {
    const empty = `${AUTOPART_216V_HEADER}\n`;
    await prisma.autopartBackorderSnapshot.deleteMany({
      where: { fileHash: createHash("sha256").update(empty).digest("hex") },
    });
    const result = await confirmAutopart216vImport(adminId, {
      text: empty,
      filename: `216V-${stamp}-empty.csv`,
      source: "MANUAL",
    });
    expect(result.emptyValid).toBe(true);
    const snap = await prisma.autopartBackorderSnapshot.findUniqueOrThrow({
      where: { id: result.id },
      include: { lines: true },
    });
    expect(snap.emptyValid).toBe(true);
    expect(snap.outstandingLineCount).toBe(0);
    expect(snap.lines.every((l) => l.changeStatus === "CLEARED")).toBe(true);
    await expect(
      confirmAutopart216vImport(adminId, { text: "Order No,Part Number\n", filename: "empty.csv", source: "MANUAL" }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("216V matching, cover, RBAC, export", () => {
  it("retains unmapped customers, links mapped companies, and matches product kinds", async () => {
    const sharedSku = `BO-SHARE-${stamp}`;
    await prisma.autopartProduct.create({
      data: {
        sku: sharedSku,
        matchKey: skuMatchKey(sharedSku),
        description: "Shared SKU",
        availQty: 10,
        incomingQty: 0,
        physicalQty: 10,
        presentInLatestFeed: true,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    const live = csv216v([
      {
        order: `SB${stamp}M`,
        account: `BOACC${stamp}`,
        name: "Mapped Name Snapshot",
        part: catalogueSku,
        desc: "Catalogue cleaner",
        ref: "MAP-1",
        qty: 6,
        unit: "1.50",
        value: "9.00",
      },
      {
        order: `SB${stamp}U`,
        account: "NOCOMPANY",
        name: "No Company Ltd",
        part: externalSku,
        desc: "External torch",
        ref: "EXT-1",
        qty: 12,
        unit: "3.00",
        value: "36.00",
      },
      {
        order: `SB${stamp}H`,
        account: "NOCOMPANY",
        name: "No Company Ltd",
        part: historicSku,
        desc: "Historic only SKU",
        ref: "HIST-1",
        qty: 1,
        unit: "4.00",
        value: "4.00",
      },
      {
        order: `SB${stamp}S1`,
        account: "NOCOMPANY",
        name: "No Company Ltd",
        part: sharedSku,
        desc: "Shared SKU",
        ref: "A",
        qty: 8,
        unit: "1.00",
        value: "8.00",
      },
      {
        order: `SB${stamp}S2`,
        account: `BOACC${stamp}`,
        name: "Mapped Name Snapshot",
        part: sharedSku,
        desc: "Shared SKU",
        ref: "B",
        qty: 8,
        unit: "1.00",
        value: "8.00",
      },
    ]);
    await confirmAutopart216vImport(adminId, { text: live, filename: `216V-${stamp}-cover.csv`, source: "MANUAL" });
    const workspace = await getBackorderWorkspace(adminId, { q: String(stamp) });
    const mapped = workspace.lines.rows.find((r) => r.orderNumber === `SB${stamp}M`);
    const unmapped = workspace.lines.rows.find((r) => r.orderNumber === `SB${stamp}U`);
    const historic = workspace.lines.rows.find((r) => r.orderNumber === `SB${stamp}H`);
    const shareA = workspace.lines.rows.find((r) => r.orderNumber === `SB${stamp}S1`);
    const shareB = workspace.lines.rows.find((r) => r.orderNumber === `SB${stamp}S2`);
    expect(mapped?.companyId).toBe(mappedCompanyId);
    expect(unmapped?.unmapped).toBe(true);
    expect(unmapped?.companyId).toBeNull();
    expect(mapped?.position).toBe("STOCK_AVAILABLE");
    expect(unmapped?.position).toBe("INCOMING_COVERS");
    expect(unmapped?.incomingHasEta).toBe(false);
    expect(historic?.position).toBe("PRODUCT_NOT_IN_CURRENT_STOCK_FEED");
    expect(shareA?.position).toBe("PART_STOCK_AVAILABLE");
    expect(shareB?.position).toBe("PART_STOCK_AVAILABLE");
    expect(shareA?.coverSummary).toMatch(/10 available against 16/);
    expect(mapped?.productKind).toBe("CATALOGUE");
    expect(unmapped?.productKind).toBe("EXTERNAL");
    expect(historic?.productKind).toBe("HISTORIC_ONLY");
    expect(await prisma.autopartProductCostPosition.findUnique({ where: { sku: catalogueSku } })).toBeNull();

    const skuView = await getBackorderWorkspace(adminId, { view: "sku", q: sharedSku });
    expect(skuView.skus.rows[0]?.outstandingQty).toBe(16);
    expect(skuView.skus.rows[0]?.position).toBe("PART_STOCK_AVAILABLE");
    expect(skuView.skus.rows[0]?.oldestAgeLabel).toMatch(/Seen for/);
    expect(skuView.viewCounts.attention).toBe(skuView.attentionSummary.unique);

    const enabled = await updateBackorderFeedSettings(adminId, { enabled: true });
    expect(enabled.enabled).toBe(true);
    const disabled = await updateBackorderFeedSettings(adminId, { enabled: false });
    expect(disabled.enabled).toBe(false);

    const detail = await getBackorderLineDetail(adminId, mapped!.id);
    expect(detail.timeline.length).toBeGreaterThanOrEqual(1);
    expect(detail.line.ageLabel).toMatch(/Seen for/);
    expect(detail.stockDisclaimer).toMatch(/not a reservation/i);

    const csv = await exportBackordersCsv(adminId, { q: catalogueSku });
    expect(csv.csv).toContain("Status");
    expect(csv.csv).toContain(catalogueSku);
    expect(csv.csv).not.toMatch(/Latest Cost/i);

    await expect(getBackorderWorkspace(tradeId, {})).rejects.toBeInstanceOf(AuthError);
    const accounts = await getBackorderWorkspace(accountsId, { q: String(stamp) });
    expect(accounts.canManage).toBe(false);
    expect(accounts.lines.rows.length).toBeGreaterThan(0);
    expect(accounts.freshness.source).toBe("MANUAL");
    expect(accounts.freshness.sourceLabel).toBe("Manual upload");
    expect(accounts.viewCounts.lines).toBe(accounts.lines.total);
    expect(accounts.viewCounts.attention).toBe(accounts.attentionSummary.unique);
    expect(accounts.skus.total).toBe(accounts.viewCounts.skus);
    expect(accounts.customerGroups.total).toBe(accounts.viewCounts.customers);
    const csvView = await exportBackordersCsv(accountsId, { q: catalogueSku });
    expect(csvView.csv).toContain(catalogueSku);
    await expect(updateBackorderFeedSettings(accountsId, { enabled: true })).rejects.toBeInstanceOf(AuthError);
    await expect(
      confirmAutopart216vImport(accountsId, { text: live, filename: "216V-denied.csv", source: "MANUAL" }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(pollBackorderMailboxNow(accountsId)).rejects.toBeInstanceOf(AuthError);
  });

  it("does not N+1 AutopartProduct or Company per backorder line", async () => {
    const findProduct = vi.spyOn(appPrisma.autopartProduct, "findUnique");
    const findCompany = vi.spyOn(appPrisma.company, "findUnique");
    const findProductFirst = vi.spyOn(appPrisma.autopartProduct, "findFirst");
    const findCompanyFirst = vi.spyOn(appPrisma.company, "findFirst");
    await getBackorderWorkspace(adminId, { pageSize: 50 });
    expect(findProduct).not.toHaveBeenCalled();
    expect(findCompany).not.toHaveBeenCalled();
    expect(findProductFirst).not.toHaveBeenCalled();
    expect(findCompanyFirst).not.toHaveBeenCalled();
    findProduct.mockRestore();
    findCompany.mockRestore();
    findProductFirst.mockRestore();
    findCompanyFirst.mockRestore();
  });

  it("does not change purchasing forecast maths when backorders exist", async () => {
    const sku = await getPurchasingSku(adminId, catalogueSku);
    const expected = suggestedPurchaseQty({
      availableQty: sku.forecast.availableQty,
      incomingQty: sku.forecast.incomingQty,
      recommendedWeekly: sku.forecast.recommendedWeekly,
      targetCoverWeeks: sku.forecast.targetCoverWeeks,
      safetyStockQty: sku.forecast.safetyStockQty,
      minimumOrderQty: sku.forecast.purchasing.minimumOrderQty,
      orderMultiple: sku.forecast.purchasing.orderMultiple,
    });
    expect(sku.forecast.purchase.suggestedQty).toBe(expected.suggestedQty);
    expect(sku.customerBackorderUnits).toBe(6);
    expect(sku.customerBackorderNote).toMatch(/Customer Backorders: 6/);
  });

  it("dedupes the same 216V attachment by file hash in the email batch", async () => {
    const text = csv216v([
      {
        order: `SB${stamp}E`,
        account: "NOCOMPANY",
        name: "No Company Ltd",
        part: unknownSku,
        desc: "Email row",
        ref: "EMAIL-1",
        qty: 3,
        unit: "1.00",
        value: "3.00",
      },
    ]);
    const email = {
      uid: `uid-${stamp}`,
      messageId: `<216v-${stamp}@example.invalid>`,
      from: "autopart@example.invalid",
      subject: "216V",
      receivedAt: new Date(),
      attachments: [{ filename: "216V.CSV", content: Buffer.from(text), contentType: "text/csv" }],
    };
    const first = await process216vEmailBatch({ emails: [email], actorUserId: adminId, source: "EMAIL" });
    const second = await process216vEmailBatch({ emails: [email], actorUserId: adminId, source: "EMAIL" });
    expect(first.processed + first.duplicatesIgnored).toBeGreaterThanOrEqual(1);
    expect(second.duplicatesIgnored).toBeGreaterThanOrEqual(1);
    expect(second.processed).toBe(0);
    const emailed = await getBackorderWorkspace(adminId, { q: unknownSku });
    expect(emailed.freshness.source).toBe("EMAIL");
    expect(emailed.freshness.sourceLabel).toBe("Mailbox poll");
  });
});

describe("216V expanded-field identity continuity", () => {
  const expStamp = `${stamp}x`;
  const orderKeep = `SB${String(expStamp).slice(-7)}K`;
  const orderGone = `SB${String(expStamp).slice(-7)}G`;
  const orderNew = `SB${String(expStamp).slice(-7)}N`;
  const sku = `BO-EXP-${stamp}`;

  it("imports the expanded fixture profile and accepts changed content as a new snapshot", async () => {
    const text = buildAutopart216vExpandedFixture();
    const hash = createHash("sha256").update(text).digest("hex");
    await prisma.autopartBackorderSnapshot.deleteMany({ where: { fileHash: hash } });
    const first = await confirmAutopart216vImport(adminId, {
      text,
      filename: `216V-expanded-${expStamp}.csv`,
      source: "MANUAL",
    });
    expect(first.duplicate).toBe(false);
    const snap = await prisma.autopartBackorderSnapshot.findUniqueOrThrow({ where: { id: first.id } });
    expect(snap.outstandingLineCount).toBe(AUTOPART_216V_EXPANDED_PROFILE.lines);
    expect(snap.orderCount).toBe(AUTOPART_216V_EXPANDED_PROFILE.orders);
    expect(snap.accountCount).toBe(AUTOPART_216V_EXPANDED_PROFILE.accounts);
    expect(snap.skuCount).toBe(AUTOPART_216V_EXPANDED_PROFILE.skus);
    expect(Number(snap.outstandingQty)).toBe(AUTOPART_216V_EXPANDED_PROFILE.units);
    expect(Number(snap.outstandingValue).toFixed(2)).toBe(AUTOPART_216V_EXPANDED_PROFILE.outstandingValue);
    const again = await confirmAutopart216vImport(adminId, {
      text,
      filename: `216V-expanded-${expStamp}.csv`,
      source: "MANUAL",
    });
    expect(again.duplicate).toBe(true);
  });

  it("preserves identity across truncated→expanded text and applies movement rules", async () => {
    const truncated = csv216v([
      {
        order: orderKeep,
        account: "AUTOADDIT",
        name: "AUTO ADDITIVES WOR",
        part: sku,
        desc: "Steel Seal",
        ref: "ADDITIV",
        qty: 10,
        unit: "2.00",
        value: "20.00",
      },
      {
        order: orderGone,
        account: "AUTOADDIT",
        name: "AUTO ADDITIVES WOR",
        part: sku,
        desc: "Steel Seal",
        ref: "GONE-REF",
        qty: 2,
        unit: "2.00",
        value: "4.00",
      },
    ]);
    await confirmAutopart216vImport(adminId, {
      text: truncated,
      filename: `216V-trunc-${expStamp}.csv`,
      source: "MANUAL",
    });
    const firstSnap = await prisma.autopartBackorderSnapshot.findFirstOrThrow({
      where: { filename: `216V-trunc-${expStamp}.csv` },
      include: { lines: true },
    });
    const keepLine = firstSnap.lines.find((l) => l.orderNumber === orderKeep)!;
    expect(keepLine.changeStatus).toBe("NEW");
    const firstSeen = keepLine.firstSeenAt;
    const continuedKey = keepLine.identityKey;

    const expandedSameQty = csv216v([
      {
        order: orderKeep,
        account: "AUTOADDIT",
        name: "AUTO ADDITIVES WORLDWIDE",
        part: sku,
        desc: "Steel Seal India Formula",
        ref: "ADDITIVELAUNCHSTOCK",
        qty: 10,
        unit: "2.00",
        value: "20.00",
      },
      {
        order: orderNew,
        account: "AUTOADDIT",
        name: "AUTO ADDITIVES WORLDWIDE",
        part: sku,
        desc: "Steel Seal India Formula",
        ref: "BRANDNEWREF",
        qty: 1,
        unit: "2.00",
        value: "2.00",
      },
    ]);
    await confirmAutopart216vImport(adminId, {
      text: expandedSameQty,
      filename: `216V-exp-same-${expStamp}.csv`,
      source: "MANUAL",
    });
    const sameSnap = await prisma.autopartBackorderSnapshot.findFirstOrThrow({
      where: { filename: `216V-exp-same-${expStamp}.csv` },
      include: { lines: true },
    });
    const sameKeep = sameSnap.lines.find((l) => l.orderNumber === orderKeep)!;
    expect(sameKeep.changeStatus).toBe("UNCHANGED");
    expect(sameKeep.identityKey).toBe(continuedKey);
    expect(sameKeep.firstSeenAt.toISOString()).toBe(firstSeen.toISOString());
    expect(sameKeep.customerNameSnapshot).toBe("AUTO ADDITIVES WORLDWIDE");
    expect(sameKeep.customerOrderRef).toBe("ADDITIVELAUNCHSTOCK");
    expect(sameKeep.descriptionSnapshot).toBe("Steel Seal India Formula");
    expect(sameSnap.lines.find((l) => l.orderNumber === orderGone)?.changeStatus).toBe("CLEARED");
    expect(sameSnap.lines.find((l) => l.orderNumber === orderNew)?.changeStatus).toBe("NEW");
    expect(sameSnap.lines.filter((l) => l.changeStatus === "NEW")).toHaveLength(1);

    const reduced = csv216v([
      {
        order: orderKeep,
        account: "AUTOADDIT",
        name: "AUTO ADDITIVES WORLDWIDE",
        part: sku,
        desc: "Steel Seal India Formula",
        ref: "ADDITIVELAUNCHSTOCK",
        qty: 6,
        unit: "2.00",
        value: "12.00",
      },
      {
        order: orderNew,
        account: "AUTOADDIT",
        name: "AUTO ADDITIVES WORLDWIDE",
        part: sku,
        desc: "Steel Seal India Formula",
        ref: "BRANDNEWREF",
        qty: 1,
        unit: "2.00",
        value: "2.00",
      },
    ]);
    await confirmAutopart216vImport(adminId, {
      text: reduced,
      filename: `216V-exp-red-${expStamp}.csv`,
      source: "MANUAL",
    });
    const redSnap = await prisma.autopartBackorderSnapshot.findFirstOrThrow({
      where: { filename: `216V-exp-red-${expStamp}.csv` },
      include: { lines: true },
    });
    expect(redSnap.lines.find((l) => l.orderNumber === orderKeep)?.changeStatus).toBe("QUANTITY_REDUCED");
    expect(redSnap.lines.find((l) => l.orderNumber === orderKeep)?.firstSeenAt.toISOString()).toBe(
      firstSeen.toISOString(),
    );

    const increased = csv216v([
      {
        order: orderKeep,
        account: "AUTOADDIT",
        name: "AUTO ADDITIVES WORLDWIDE",
        part: sku,
        desc: "Steel Seal India Formula",
        ref: "ADDITIVELAUNCHSTOCK",
        qty: 9,
        unit: "2.00",
        value: "18.00",
      },
      {
        order: orderNew,
        account: "AUTOADDIT",
        name: "AUTO ADDITIVES WORLDWIDE",
        part: sku,
        desc: "Steel Seal India Formula",
        ref: "BRANDNEWREF",
        qty: 1,
        unit: "2.00",
        value: "2.00",
      },
    ]);
    await confirmAutopart216vImport(adminId, {
      text: increased,
      filename: `216V-exp-inc-${expStamp}.csv`,
      source: "MANUAL",
    });
    const incSnap = await prisma.autopartBackorderSnapshot.findFirstOrThrow({
      where: { filename: `216V-exp-inc-${expStamp}.csv` },
      include: { lines: true },
    });
    expect(incSnap.lines.find((l) => l.orderNumber === orderKeep)?.changeStatus).toBe("QUANTITY_INCREASED");
    expect(incSnap.lines.find((l) => l.orderNumber === orderNew)?.changeStatus).toBe("UNCHANGED");
  });

  it("matches duplicate-base prefix-compatible refs and leaves ambiguous groups unmatched", async () => {
    const orderDup = `SB${String(expStamp).slice(-7)}D`;
    const skuDup = `BO-DUP-${stamp}`;
    const first = csv216v([
      {
        order: orderDup,
        account: "DUPACC01",
        name: "Dup Customer",
        part: skuDup,
        desc: "Desc A",
        ref: "ABC123",
        qty: 4,
        unit: "1.00",
        value: "4.00",
      },
      {
        order: orderDup,
        account: "DUPACC01",
        name: "Dup Customer",
        part: skuDup,
        desc: "Desc B",
        ref: "OTHER",
        qty: 5,
        unit: "1.00",
        value: "5.00",
      },
    ]);
    await confirmAutopart216vImport(adminId, {
      text: first,
      filename: `216V-dup-a-${expStamp}.csv`,
      source: "MANUAL",
    });

    const prefixSafe = csv216v([
      {
        order: orderDup,
        account: "DUPACC01",
        name: "Dup Customer Expanded",
        part: skuDup,
        desc: "Desc A Expanded",
        ref: "ABC123FULLREFERENCE",
        qty: 4,
        unit: "1.00",
        value: "4.00",
      },
      {
        order: orderDup,
        account: "DUPACC01",
        name: "Dup Customer Expanded",
        part: skuDup,
        desc: "Desc B Expanded",
        ref: "OTHER",
        qty: 5,
        unit: "1.00",
        value: "5.00",
      },
    ]);
    await confirmAutopart216vImport(adminId, {
      text: prefixSafe,
      filename: `216V-dup-b-${expStamp}.csv`,
      source: "MANUAL",
    });
    const safeSnap = await prisma.autopartBackorderSnapshot.findFirstOrThrow({
      where: { filename: `216V-dup-b-${expStamp}.csv` },
      include: { lines: true },
    });
    expect(safeSnap.lines.filter((l) => l.changeStatus === "UNCHANGED")).toHaveLength(2);
    expect(safeSnap.lines.filter((l) => l.changeStatus === "NEW" || l.changeStatus === "CLEARED")).toHaveLength(0);
    expect(safeSnap.lines.find((l) => l.customerOrderRef === "ABC123FULLREFERENCE")).toBeTruthy();

    const orderAmb = `SB${String(expStamp).slice(-7)}A`;
    const ambFirst = csv216v([
      {
        order: orderAmb,
        account: "AMBACC01",
        name: "Amb Customer",
        part: skuDup,
        desc: "A",
        ref: "AB",
        qty: 1,
        unit: "1.00",
        value: "1.00",
      },
      {
        order: orderAmb,
        account: "AMBACC01",
        name: "Amb Customer",
        part: skuDup,
        desc: "B",
        ref: "ABC",
        qty: 2,
        unit: "1.00",
        value: "2.00",
      },
    ]);
    await confirmAutopart216vImport(adminId, {
      text: ambFirst,
      filename: `216V-amb-a-${expStamp}.csv`,
      source: "MANUAL",
    });
    const ambSecond = csv216v([
      {
        order: orderAmb,
        account: "AMBACC01",
        name: "Amb Customer",
        part: skuDup,
        desc: "C",
        ref: "ABCFULL",
        qty: 3,
        unit: "1.00",
        value: "3.00",
      },
    ]);
    await confirmAutopart216vImport(adminId, {
      text: ambSecond,
      filename: `216V-amb-b-${expStamp}.csv`,
      source: "MANUAL",
    });
    const ambSnap = await prisma.autopartBackorderSnapshot.findFirstOrThrow({
      where: { filename: `216V-amb-b-${expStamp}.csv` },
      include: { lines: true },
    });
    expect(ambSnap.lines.filter((l) => l.changeStatus === "CLEARED")).toHaveLength(2);
    expect(ambSnap.lines.filter((l) => l.changeStatus === "NEW")).toHaveLength(1);
    const diagnostics = ambSnap.diagnostics as { identityAmbiguities?: string[] } | null;
    expect(diagnostics?.identityAmbiguities?.length).toBeGreaterThan(0);
  });
});

describe("216V movement drill-down", () => {
  const mv = String(stamp).slice(-7);
  const sku = `BO-MV-${stamp}`;
  const base = { account: "MVACC01", name: "Movement Customer", part: sku, desc: "Movement part" };
  const up = { ...base, order: `MV${mv}U`, ref: "UP" };
  const down = { ...base, order: `MV${mv}D`, ref: "DOWN" };
  const same = { ...base, order: `MV${mv}S`, ref: "SAME" };
  const gone1 = { ...base, order: `MV${mv}G1`, ref: "GONE1" };
  const gone2 = { ...base, order: `MV${mv}G2`, ref: "GONE2" };
  const new1 = { ...base, order: `MV${mv}N1`, ref: "NEW1" };
  const new2 = { ...base, order: `MV${mv}N2`, ref: "NEW2" };
  const row = (r: typeof up, qty: number, unit = "2.00") => ({
    ...r,
    qty,
    unit,
    value: (qty * Number(unit)).toFixed(2),
  });
  let previousId = "";

  it("drills into NEW / INCREASED / REDUCED / CLEARED for the transition into the current snapshot", async () => {
    const previous = await confirmAutopart216vImport(adminId, {
      text: csv216v([row(up, 4), row(down, 7), row(same, 1), row(gone1, 3, "2.50"), row(gone2, 5)]),
      filename: `216V-mv-a-${stamp}.csv`,
      source: "MANUAL",
    });
    previousId = previous.id;
    await expect(
      confirmAutopart216vImport(adminId, { text: "not a 216v file", filename: "bad.csv", source: "MANUAL" }),
    ).rejects.toBeInstanceOf(AuthError);
    await confirmAutopart216vImport(adminId, {
      text: csv216v([row(up, 7), row(down, 4), row(same, 1), row(new1, 2), row(new2, 1)]),
      filename: `216V-mv-b-${stamp}.csv`,
      source: "MANUAL",
    });

    const current = await getBackorderWorkspace(adminId, {});
    expect(current.movement).toBeNull();
    expect(current.current?.newToday).toBe(2);
    expect(current.current?.increasedSincePrevious).toBe(1);
    expect(current.current?.reducedSincePrevious).toBe(1);
    expect(current.current?.clearedSincePrevious).toBe(2);
    expect(current.lines.total).toBe(5);
    expect(current.current?.outstandingLines).toBe(5);
    const outstandingIds = new Set(current.lines.rows.map((r) => r.id));

    const fresh = await getBackorderWorkspace(adminId, { movement: "NEW" });
    expect(fresh.movement?.total).toBe(current.current?.newToday);
    expect(fresh.movement?.kpiCount).toBe(current.current?.newToday);
    expect(fresh.movement?.rows.map((r) => r.orderNumber).sort()).toEqual([new1.order, new2.order].sort());
    expect(fresh.movement?.rows.every((r) => r.status === "NEW" && r.currentlyOutstanding)).toBe(true);
    expect(fresh.movement?.rows.find((r) => r.orderNumber === new1.order)?.currentQty).toBe(2);
    expect(fresh.movement?.rows.every((r) => r.position !== null)).toBe(true);
    expect(fresh.movement?.previousSnapshot?.id).toBe(previousId);

    const increased = await getBackorderWorkspace(adminId, { movement: "INCREASED" });
    expect(increased.movement?.total).toBe(current.current?.increasedSincePrevious);
    const inc = increased.movement!.rows[0]!;
    expect(inc.orderNumber).toBe(up.order);
    expect([inc.previousQty, inc.currentQty, inc.changeQty]).toEqual([4, 7, 3]);
    expect(inc.previousValue).toBe("8.00");
    expect(inc.currentValue).toBe("14.00");

    const reduced = await getBackorderWorkspace(adminId, { movement: "REDUCED" });
    expect(reduced.movement?.total).toBe(current.current?.reducedSincePrevious);
    const red = reduced.movement!.rows[0]!;
    expect(red.orderNumber).toBe(down.order);
    expect([red.previousQty, red.currentQty, red.changeQty]).toEqual([7, 4, -3]);

    const cleared = await getBackorderWorkspace(adminId, { movement: "CLEARED" });
    expect(cleared.movement?.total).toBe(current.current?.clearedSincePrevious);
    expect(cleared.movement?.rows.map((r) => r.orderNumber).sort()).toEqual([gone1.order, gone2.order].sort());
    for (const r of cleared.movement!.rows) {
      expect(r.status).toBe("CLEARED");
      expect(r.currentlyOutstanding).toBe(false);
      expect(r.currentQty).toBeNull();
      expect(r.currentValue).toBeNull();
      expect(r.position).toBeNull();
      expect(r.clearedAt).toBeTruthy();
      expect(outstandingIds.has(r.id)).toBe(false);
    }
    const g1 = cleared.movement!.rows.find((r) => r.orderNumber === gone1.order)!;
    expect(g1.previousQty).toBe(3);
    expect(g1.unitValue).toBe("2.50");
    expect(g1.previousValue).toBe("7.50");
    expect(g1.customerOrderRef).toBe("GONE1");
    expect(cleared.lines.total).toBe(5);
    expect(cleared.current?.outstandingUnits).toBe(15);
    await expect(getBackorderLineDetail(adminId, g1.id)).rejects.toBeInstanceOf(AuthError);

    const csv = await exportBackordersCsv(adminId, { movement: "CLEARED" });
    expect(csv.filename).toBe("autopart-216v-backorders-cleared.csv");
    const csvLines = csv.csv.split("\n");
    expect(csvLines[0]).toContain("Previous Qty");
    expect(csvLines[0]).toContain("Current Condition Code,Current Product Condition");
    expect(csvLines).toHaveLength(3);
    expect(csvLines.find((l) => l.includes(gone1.order))).toMatch(/^Cleared,CLEARED,.*,3,,,2\.50,7\.50,/);
    const standard = await exportBackordersCsv(adminId, {});
    expect(standard.csv.split("\n")[0]).toBe(
      "Status,First Seen,Order No,Customer Account,Customer,Customer Order Ref,SKU,Description,Outstanding Qty,Unit Value,Outstanding Value,Avail,Incoming,Stock Position,Product Type,Condition Code,Condition",
    );
    expect(standard.csv).not.toContain(gone1.order);
  });

  it("applies compatible filters and ignores current-state filters for cleared history", async () => {
    const searched = await getBackorderWorkspace(adminId, { movement: "NEW", q: new1.order });
    expect(searched.movement?.total).toBe(1);
    expect(searched.movement?.kpiCount).toBe(2);
    const statusIgnored = await getBackorderWorkspace(adminId, { movement: "NEW", status: "UNCHANGED" });
    expect(statusIgnored.movement?.total).toBe(2);
    expect(statusIgnored.movement?.ignoredFilters).toEqual(["status"]);
    const clearedWithStock = await getBackorderWorkspace(adminId, {
      movement: "CLEARED",
      position: "STOCK_AVAILABLE",
      ageDays: 7,
    });
    expect(clearedWithStock.movement?.total).toBe(2);
    expect(clearedWithStock.movement?.ignoredFilters).toEqual(["position", "ageDays"]);
    const clearedSearch = await getBackorderWorkspace(adminId, { movement: "CLEARED", q: "GONE2" });
    expect(clearedSearch.movement?.rows.map((r) => r.orderNumber)).toEqual([gone2.order]);
    const back = await getBackorderWorkspace(adminId, { q: String(mv) });
    expect(back.movement).toBeNull();
    expect(back.lines.total).toBe(5);
  });

  it("returns zero-count movements as empty results when nothing moved", async () => {
    await confirmAutopart216vImport(adminId, {
      text: csv216v([
        { ...row(up, 7), desc: "Movement part renamed", name: "Movement Customer Renamed" },
        row(down, 4),
        row(same, 1),
        row(new1, 2),
        row(new2, 1),
      ]),
      filename: `216V-mv-c-${stamp}.csv`,
      source: "MANUAL",
    });
    for (const movement of ["NEW", "INCREASED", "REDUCED", "CLEARED"] as const) {
      const ws = await getBackorderWorkspace(adminId, { movement });
      expect(ws.movement?.total).toBe(0);
      expect(ws.movement?.kpiCount).toBe(0);
      expect(ws.movement?.rows).toEqual([]);
    }
    const ws = await getBackorderWorkspace(adminId, {});
    expect(ws.current?.newToday).toBe(0);
    expect(ws.current?.clearedSincePrevious).toBe(0);
    expect(ws.lines.total).toBe(5);
  });
});

