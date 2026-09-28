import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  confirmBulkAutopartCreditImport,
  previewBulkAutopartCreditImport,
} from "@/server/companies/autopart-credit-bulk";
import {
  getPortalCreditSummary,
  verifyAutopartAccountAlias,
} from "@/server/companies/autopart-history";
import { evaluateHeldOrderCreditNow } from "@/server/orders/credit-control";
import { saveProduct } from "@/server/catalogue/service";
import { addToBasket } from "@/server/basket/service";
import { placeOrder } from "@/server/orders/service";

const prisma = new PrismaClient();

let adminId = "";
let buyerId = "";
let companyAId = "";
let companyBId = "";
let companyAliasId = "";
let addressAId = "";
let accountA = "";
let accountB = "";
let accountPrimary = "";
let aliasCode = "";
let variantId = "";
let fileSeq = 0;

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
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

async function seedStock(vid: string, qty: number) {
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "MAIN" },
    create: { code: "MAIN", name: "Main" },
    update: {},
  });
  await prisma.inventory.upsert({
    where: { variantId_warehouseId: { variantId: vid, warehouseId: warehouse.id } },
    create: {
      variantId: vid,
      warehouseId: warehouse.id,
      qtyOnHand: qty,
      qtyReserved: 0,
    },
    update: { qtyOnHand: qty, qtyReserved: 0 },
  });
}

function csvFor(
  accounts: Record<
    string,
    { invoices: string; picking?: string; total: string; limit: string; name?: string }
  >,
  uniqueTag?: string,
) {
  const lines = [
    "Customer,Customer Name,Invoices,Picking,DropShip,CrossDock,Suspends,UnConsol,Total,Cr Limit",
  ];
  for (const [acct, r] of Object.entries(accounts)) {
    lines.push(
      [
        acct,
        r.name ?? acct,
        r.invoices,
        r.picking ?? "0.00",
        "0.00",
        "0.00",
        "0.00",
        "0.00",
        r.total,
        r.limit,
      ].join(","),
    );
  }
  if (uniqueTag) {
    // Unique NOT_IN_AB row so file hashes differ without affecting matched updates.
    lines.push(`${uniqueTag},HASH PAD,1.00,0,0,0,0,0,1.00,10.00`);
  }
  return `${lines.join("\n")}\n`;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("bulk407.admin@example.invalid", ["SUPER_ADMIN"]);
  const stamp = Date.now();
  accountA = `BA${String(stamp).slice(-8)}`;
  accountB = `BB${String(stamp).slice(-8)}`;
  accountPrimary = `BP${String(stamp).slice(-8)}`;
  aliasCode = `AL${String(stamp).slice(-8)}`;

  const companyA = await prisma.company.create({
    data: {
      name: `Bulk A ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      autopartCustomerCode: accountA,
      autopartCustomerCodeVerifiedAt: new Date(),
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  companyAId = companyA.id;
  const addressA = await prisma.address.create({
    data: {
      companyId: companyAId,
      label: "Main",
      line1: "1 Test Street",
      town: "York",
      postcode: "YO1 1AA",
      country: "GB",
      isDefaultDelivery: true,
    },
  });
  addressAId = addressA.id;

  const companyB = await prisma.company.create({
    data: {
      name: `Bulk B ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      autopartCustomerCode: accountB,
      autopartCustomerCodeVerifiedAt: new Date(),
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  companyBId = companyB.id;

  const companyAlias = await prisma.company.create({
    data: {
      name: `Bulk Alias ${stamp}`,
      status: "ACTIVE",
      paymentTerms: "30 Days",
      autopartCustomerCode: accountPrimary,
      autopartCustomerCodeVerifiedAt: new Date(),
      autopartCustomerCodeVerifiedById: adminId,
    },
  });
  companyAliasId = companyAlias.id;
  await verifyAutopartAccountAlias(adminId, {
    companyId: companyAliasId,
    alias: aliasCode,
    note: "report alias",
  });

  buyerId = await ensureUser(`bulk407.buyer.${stamp}@example.invalid`, [], "TRADE");
  await prisma.companyUser.create({
    data: {
      companyId: companyAId,
      userId: buyerId,
      role: "TRADE_BUYER",
      status: "ACTIVE",
      isDefault: true,
    },
  });

  const product = await saveProduct(adminId, {
    sku: `B407-${stamp}`,
    name: "Bulk Credit Test Part",
    brand: "Power Maxed",
    category: "Engine",
    trade: 100,
    rrp: 150,
    packQty: 1,
    caseQty: 1,
    description: "bulk credit test",
    active: true,
  });
  variantId = product.variantId;
  await seedStock(variantId, 10000);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("bulk 407P100 credit import", () => {
  it("classifies matched, alias, not-in-AB, invalid, and duplicate rows", async () => {
    const file = [
      "Customer,Customer Name,Invoices,Picking,DropShip,CrossDock,Suspends,UnConsol,Total,Cr Limit",
      `${accountA},Company A,3494.75,0,0,0,0,0,3494.75,5000.00`,
      `${accountB},Company B,100.00,0,0,0,0,0,100.00,1000.00`,
      `${aliasCode},Alias Co,1000.00,0,0,0,0,0,1000.00,2000.00`,
      `ZZZNOMATCH,Not In AB,50.00,0,0,0,0,0,50.00,100.00`,
      `BADROW,Bad,xxx,0,0,0,0,0,bad,5000`,
      `${accountA},Duplicate A,10,0,0,0,0,0,10,5000`,
    ].join("\n");

    const preview = await previewBulkAutopartCreditImport(adminId, {
      file407: file,
      filename: "bulk.csv",
    });

    expect(preview.summary.matchedAlias).toBe(1);
    expect(preview.summary.notInAb).toBe(1);
    expect(preview.summary.invalid).toBeGreaterThanOrEqual(1);
    expect(preview.summary.duplicates).toBe(2);

    expect(preview.rows.find((r) => r.autopartAccount === accountB)?.matchStatus).toBe("MATCHED");
    expect(preview.rows.find((r) => r.autopartAccount === aliasCode)?.matchStatus).toBe(
      "MATCHED_ALIAS",
    );
    expect(preview.rows.find((r) => r.autopartAccount === "ZZZNOMATCH")?.matchStatus).toBe(
      "NOT_IN_AB",
    );
    expect(
      preview.rows.filter((r) => r.matchStatus === "DUPLICATE").every((r) => r.autopartAccount === accountA),
    ).toBe(true);

    expect(preview.canCommit).toBe(true);
    expect(preview.rows.find((r) => r.autopartAccount === accountB)?.wouldUpdate).toBe(true);
    expect(preview.rows.find((r) => r.autopartAccount === aliasCode)?.wouldUpdate).toBe(true);
    expect(preview.rows.filter((r) => r.autopartAccount === accountA).every((r) => !r.wouldUpdate)).toBe(
      true,
    );
  });

  it("imports YORKMOTO-style totals, payment delta, operational exposure, over-limit", async () => {
    fileSeq += 1;
    const initial = csvFor(
      {
        [accountA]: {
          name: "YORK MOTOR FACTORS",
          invoices: "3494.75",
          total: "3494.75",
          limit: "5000.00",
        },
        [accountB]: {
          name: "Operational",
          invoices: "3000.00",
          picking: "500.00",
          total: "3500.00",
          limit: "5000.00",
        },
        OVERLIMX: {
          name: "Over",
          invoices: "5400.00",
          total: "5400.00",
          limit: "5000.00",
        },
      },
      `PAD${fileSeq}A`,
    );

    const preview = await previewBulkAutopartCreditImport(adminId, {
      file407: initial,
      filename: "407-initial.csv",
    });
    const rowA = preview.rows.find((r) => r.autopartAccount === accountA)!;
    expect(rowA.usedCredit).toBe("3494.75");
    expect(rowA.availableCredit).toBe("1505.25");
    const rowB = preview.rows.find((r) => r.autopartAccount === accountB)!;
    expect(rowB.usedCredit).toBe("3500.00");
    expect(rowB.availableCredit).toBe("1500.00");
    const over = preview.rows.find((r) => r.autopartAccount === "OVERLIMX")!;
    expect(over.matchStatus).toBe("NOT_IN_AB");
    expect(over.availableCredit).toBe("-400.00");

    const confirmed = await confirmBulkAutopartCreditImport(adminId, {
      file407: initial,
      filename: "407-initial.csv",
    });
    expect(confirmed.summary.updated).toBeGreaterThanOrEqual(2);

    const posA = await prisma.autopartCreditPosition.findUniqueOrThrow({
      where: { companyId: companyAId },
    });
    expect(Number(posA.availableCreditRaw)).toBeCloseTo(1505.25, 2);

    const portal = await getPortalCreditSummary(buyerId);
    expect(portal.available).toBe(true);
    if (portal.available) {
      expect(portal.usedCredit).toBe("3494.75");
      expect(portal.availableCreditRaw).toBe("1505.25");
    }

    fileSeq += 1;
    const paid = csvFor(
      {
        [accountA]: {
          invoices: "2494.75",
          total: "2494.75",
          limit: "5000.00",
        },
        [accountB]: {
          invoices: "3000.00",
          picking: "500.00",
          total: "3500.00",
          limit: "5000.00",
        },
      },
      `PAD${fileSeq}B`,
    );
    const paidPreview = await previewBulkAutopartCreditImport(adminId, {
      file407: paid,
      filename: "407-paid.csv",
    });
    const delta = paidPreview.rows.find((r) => r.autopartAccount === accountA)!;
    expect(delta.deltas?.usedCredit).toBe("-1000.00");
    expect(delta.deltas?.availableCredit).toBe("+1000.00");
    expect(delta.after?.availableCredit).toBe("2505.25");

    await confirmBulkAutopartCreditImport(adminId, {
      file407: paid,
      filename: "407-paid.csv",
    });
    const posPaid = await prisma.autopartCreditPosition.findUniqueOrThrow({
      where: { companyId: companyAId },
    });
    expect(Number(posPaid.availableCreditRaw)).toBeCloseTo(2505.25, 2);

    const portal2 = await getPortalCreditSummary(buyerId);
    if (portal2.available) {
      expect(portal2.availableCreditRaw).toBe("2505.25");
    }

    const again = await previewBulkAutopartCreditImport(adminId, {
      file407: paid,
      filename: "407-paid.csv",
    });
    expect(again.alreadyImported).toBe(true);
    expect(again.canCommit).toBe(false);
    await expect(
      confirmBulkAutopartCreditImport(adminId, { file407: paid, filename: "407-paid.csv" }),
    ).rejects.toBeInstanceOf(AuthError);

    expect(await prisma.autopartCreditPosition.count({ where: { companyId: companyAId } })).toBe(1);
  });

  it("does not auto-release HOLD; derives credit now available", async () => {
    fileSeq += 1;
    const tight = csvFor(
      { [accountA]: { invoices: "4500.00", total: "4500.00", limit: "5000.00" } },
      `PAD${fileSeq}C`,
    );
    await confirmBulkAutopartCreditImport(adminId, {
      file407: tight,
      filename: `hold-setup-${fileSeq}.csv`,
    });

    await addToBasket(buyerId, { variantId, quantity: 10 });
    const placed = await placeOrder(buyerId, {
      idempotencyKey: `bulk-hold-${Date.now()}`,
      addressId: addressAId,
      expectedLinePrices: [{ variantId, customerUnitPrice: "100.00" }],
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
    expect(order.creditStatus).toBe("HOLD");

    fileSeq += 1;
    const loose = csvFor(
      { [accountA]: { invoices: "2000.00", total: "2000.00", limit: "5000.00" } },
      `PAD${fileSeq}D`,
    );
    const confirm = await confirmBulkAutopartCreditImport(adminId, {
      file407: loose,
      filename: `release-check-${fileSeq}.csv`,
    });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.creditStatus).toBe("HOLD");
    expect(after.autopartExportStatus).not.toBe("EXPORTED");

    const hint = await evaluateHeldOrderCreditNow({
      orderId: after.id,
      orderNumber: after.orderNumber,
      companyId: companyAId,
      grandTotal: after.grandTotal,
      paymentTerms: after.paymentTermsSnapshot,
      hasVerifiedAutopartAccount: true,
      currentCreditStatus: "HOLD",
    });
    expect(hint.creditNowAvailable).toBe(true);
    expect(hint.wouldApprove).toBe(true);
    expect(confirm.heldOrderHints.some((h) => h.orderId === order.id && h.creditNowAvailable)).toBe(
      true,
    );
  });

  it("REVIEW_REQUIRED stays until staff release after credit becomes available", async () => {
    const stamp = Date.now();
    const code = `RV${String(stamp).slice(-8)}`;
    const company = await prisma.company.create({
      data: {
        name: `Review Co ${stamp}`,
        status: "ACTIVE",
        paymentTerms: "30 Days",
        autopartCustomerCode: code,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });
    const address = await prisma.address.create({
      data: {
        companyId: company.id,
        label: "Main",
        line1: "2 Test",
        town: "York",
        postcode: "YO1 1BB",
        country: "GB",
        isDefaultDelivery: true,
      },
    });
    const buyer = await ensureUser(`bulk407.review.${stamp}@example.invalid`, [], "TRADE");
    await prisma.companyUser.create({
      data: {
        companyId: company.id,
        userId: buyer,
        role: "TRADE_BUYER",
        status: "ACTIVE",
        isDefault: true,
      },
    });

    await addToBasket(buyer, { variantId, quantity: 2 });
    const placed = await placeOrder(buyer, {
      idempotencyKey: `bulk-rev-${stamp}`,
      addressId: address.id,
      expectedLinePrices: [{ variantId, customerUnitPrice: "100.00" }],
    });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.order.creditStatus).toBe("REVIEW_REQUIRED");

    fileSeq += 1;
    const file = csvFor(
      { [code]: { invoices: "100.00", total: "100.00", limit: "10000.00" } },
      `PAD${fileSeq}E`,
    );
    await confirmBulkAutopartCreditImport(adminId, {
      file407: file,
      filename: `rev-${stamp}.csv`,
    });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
    expect(order.creditStatus).toBe("REVIEW_REQUIRED");

    const hint = await evaluateHeldOrderCreditNow({
      orderId: order.id,
      orderNumber: order.orderNumber,
      companyId: company.id,
      grandTotal: order.grandTotal,
      paymentTerms: "30 Days",
      hasVerifiedAutopartAccount: true,
      currentCreditStatus: "REVIEW_REQUIRED",
    });
    expect(hint.creditNowAvailable).toBe(true);
    expect(hint.message?.toLowerCase()).toContain("review and release");
  });
});
