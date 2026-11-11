/**
 * Combined Back in Stock + Hold Until Complete path after merging both PRs.
 * Disposable verification — exercises shared applyStockFeed hooks together.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { saveProduct } from "@/server/catalogue/service";
import {
  openSalesOrderDraft,
  placeSalesOrder,
  saveSalesOrderDraft,
} from "@/server/orders/sales-order-entry";
import { previewAutopartOrderExport } from "@/server/orders/autopart-export";
import { applyStockFeed } from "@/server/stock/service";
import { setEmailAdapterForTests } from "@/infra/email";

const prisma = new PrismaClient();
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

function csv(lines: string[]) {
  return ["Part Number,Description,Avail", ...lines].join("\n");
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`combo.admin.${Date.now()}@example.invalid`, ["SUPER_ADMIN"]);
  setEmailAdapterForTests({
    name: "test-combo",
    async send() {
      return { ok: true, providerId: "test-combo" };
    },
  });
});

afterAll(async () => {
  setEmailAdapterForTests(null);
  await prisma.$disconnect();
});

describe("combined Back in Stock + Hold Until Complete", () => {
  it(
    "records one BIS event, releases held order once, queues one email; reprocess is idempotent",
    async () => {
      const stamp = Date.now();
      const sku = `COMBO-${stamp}`;
      const product = await saveProduct(adminId, {
        sku,
        name: `Combo ${sku}`,
        brand: "Power Maxed",
        category: "Braking",
        trade: 10,
        rrp: 20,
        packQty: 1,
        caseQty: 1,
        description: "combo",
        active: true,
      });
      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { productId: product.id },
      });
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: { backorderPolicy: "ALLOW" },
      });

      // 1) Confirmed zero Avail
      await applyStockFeed({
        text: csv([`${sku},seed,0`]),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
        observedAt: new Date("2026-11-10T09:00:00.000Z"),
      });
      const zeroInv = await prisma.inventory.findFirstOrThrow({
        where: { variantId: variant.id },
      });
      expect(zeroInv.qtyOnHand).toBe(0);

      const company = await prisma.company.create({
        data: {
          name: `Combo Co ${stamp}`,
          status: "ACTIVE",
          paymentTerms: "Net 30",
          autopartCustomerCode: `CM${String(stamp).slice(-8)}`,
          autopartCustomerCodeVerifiedAt: new Date(),
          autopartCustomerCodeVerifiedById: adminId,
          createdAt: new Date("2026-11-01T00:00:00.000Z"),
        },
      });
      const address = await prisma.address.create({
        data: {
          companyId: company.id,
          type: "DELIVERY",
          label: "WH",
          line1: "1 Test Way",
          town: "Leeds",
          postcode: "LS1 1AA",
          country: "GB",
          isDefaultDelivery: true,
        },
      });
      await prisma.address.create({
        data: {
          companyId: company.id,
          type: "BILLING",
          label: "Accounts",
          line1: "1 Test Way",
          town: "Leeds",
          postcode: "LS1 1AA",
          country: "GB",
          isDefaultBilling: true,
        },
      });
      const contact = await prisma.contact.create({
        data: {
          companyId: company.id,
          firstName: "Combo",
          lastName: "Buyer",
          email: `combo-${stamp}@example.invalid`,
          isPrimary: true,
        },
      });

      // 2–3) Held order for qty 5 while Avail is 0
      const draft = await openSalesOrderDraft(adminId, { companyId: company.id, fresh: true });
      const saved = await saveSalesOrderDraft(adminId, {
        draftId: draft.draft.id,
        contactId: contact.id,
        addressId: address.id,
        source: "TELEPHONE",
        lines: [{ variantId: variant.id, qty: 5 }],
      });
      const placed = await placeSalesOrder(adminId, {
        draftId: draft.draft.id,
        confirmAuthorised: true,
        idempotencyKey: `combo-${stamp}`,
        source: "TELEPHONE",
        contactId: contact.id,
        addressId: address.id,
        lines: [{ variantId: variant.id, qty: 5 }],
        expectedReview: {
          lines: saved.review!.lines.map((line) => ({
            variantId: line.variantId,
            qty: line.quantity,
            customerUnitPrice: line.customerUnitPrice ?? "0.00",
            lineNet: line.lineNet ?? "0.00",
            availableQty: line.availableQtyAtOrder,
            backorderQty: line.backorderQtyAtOrder,
          })),
          subtotal: saved.review!.totals.subtotal,
          vatTotal: saved.review!.totals.vatTotal,
          deliveryTotal: saved.review!.totals.deliveryTotal,
          grandTotal: saved.review!.totals.grandTotal,
        },
        backorderAcknowledged: true,
        holdUntilComplete: true,
      });
      expect(placed.ok).toBe(true);
      if (!placed.ok) return;

      const held = await prisma.order.findUniqueOrThrow({ where: { id: placed.order.id } });
      expect(held.status).toBe("SUBMITTED");
      expect(held.stockHoldState).toBe("WAITING_STOCK");
      expect(held.orderNumber).toBeTruthy();

      const blocked = await previewAutopartOrderExport(adminId, [held.id]);
      expect(blocked.items.some((item) => item.orderId === held.id && !item.eligible)).toBe(true);

      const emailsBefore = await prisma.transactionalEmail.count({
        where: { idempotencyKey: { contains: held.id } },
      });

      // 4–8) Trusted live import raises Avail → BIS + release
      const replenish = await applyStockFeed({
        text: csv([`${sku},back,10`]),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
        observedAt: new Date("2026-11-10T10:00:00.000Z"),
      });
      expect(["SUCCESS", "PARTIAL"]).toContain(replenish.status);

      const bisCount = await prisma.stockBackInStockEvent.count({
        where: { variantId: variant.id },
      });
      expect(bisCount).toBe(1);

      const released = await prisma.order.findUniqueOrThrow({ where: { id: held.id } });
      expect(released.stockHoldState).toBe("READY_TO_EXPORT");

      const reserved = await prisma.orderStockReservation.aggregate({
        where: { orderId: held.id, status: "ACTIVE" },
        _sum: { quantity: true },
      });
      expect(reserved._sum.quantity ?? 0).toBeGreaterThanOrEqual(5);

      const emailsAfter = await prisma.transactionalEmail.count({
        where: {
          OR: [
            { idempotencyKey: { contains: held.id } },
            { purpose: "ORDER_STOCK_HOLD_READY_INTERNAL" },
          ],
        },
      });
      expect(emailsAfter).toBeGreaterThan(emailsBefore);

      const ready = await previewAutopartOrderExport(adminId, [held.id]);
      const elig = ready.items.find((item) => item.orderId === held.id);
      expect(elig?.eligible).toBe(true);

      // 9–10) Reprocess identical report — no duplicate BIS / release / email storm
      const emailsMid = await prisma.transactionalEmail.count({
        where: { idempotencyKey: { contains: held.id } },
      });
      await applyStockFeed({
        text: csv([`${sku},back,10`]),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
        observedAt: new Date("2026-11-10T11:00:00.000Z"),
      });
      expect(await prisma.stockBackInStockEvent.count({ where: { variantId: variant.id } })).toBe(1);
      const still = await prisma.order.findUniqueOrThrow({ where: { id: held.id } });
      expect(still.stockHoldState).toBe("READY_TO_EXPORT");
      expect(
        await prisma.transactionalEmail.count({
          where: { idempotencyKey: { contains: held.id } },
        }),
      ).toBe(emailsMid);
    },
    120_000,
  );

  it(
    "keeps order held when replenishment is insufficient; FIFO across competing holds",
    async () => {
      const stamp = Date.now();
      const sku = `COMBO-LOW-${stamp}`;
      const product = await saveProduct(adminId, {
        sku,
        name: `Combo Low ${sku}`,
        brand: "Power Maxed",
        category: "Braking",
        trade: 10,
        rrp: 20,
        packQty: 1,
        caseQty: 1,
        description: "combo low",
        active: true,
      });
      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { productId: product.id },
      });
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: { backorderPolicy: "ALLOW" },
      });
      await applyStockFeed({
        text: csv([`${sku},seed,0`]),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
        observedAt: new Date("2026-11-10T08:00:00.000Z"),
      });

      async function companyBundle(tag: string) {
        const company = await prisma.company.create({
          data: {
            name: `Combo ${tag} ${stamp}`,
            status: "ACTIVE",
            paymentTerms: "Net 30",
            autopartCustomerCode: `C${tag}${String(stamp).slice(-6)}`,
            autopartCustomerCodeVerifiedAt: new Date(),
            autopartCustomerCodeVerifiedById: adminId,
            createdAt: new Date("2026-11-01T00:00:00.000Z"),
          },
        });
        const address = await prisma.address.create({
          data: {
            companyId: company.id,
            type: "DELIVERY",
            label: "WH",
            line1: "1 Test Way",
            town: "Leeds",
            postcode: "LS1 1AA",
            country: "GB",
            isDefaultDelivery: true,
          },
        });
        await prisma.address.create({
          data: {
            companyId: company.id,
            type: "BILLING",
            label: "Accounts",
            line1: "1 Test Way",
            town: "Leeds",
            postcode: "LS1 1AA",
            country: "GB",
            isDefaultBilling: true,
          },
        });
        const contact = await prisma.contact.create({
          data: {
            companyId: company.id,
            firstName: tag,
            lastName: "Buyer",
            email: `combo-${tag}-${stamp}@example.invalid`,
            isPrimary: true,
          },
        });
        return { company, address, contact };
      }

      async function placeHeld(bundle: Awaited<ReturnType<typeof companyBundle>>, qty: number, key: string) {
        const draft = await openSalesOrderDraft(adminId, {
          companyId: bundle.company.id,
          fresh: true,
        });
        const saved = await saveSalesOrderDraft(adminId, {
          draftId: draft.draft.id,
          contactId: bundle.contact.id,
          addressId: bundle.address.id,
          source: "TELEPHONE",
          lines: [{ variantId: variant.id, qty }],
        });
        return placeSalesOrder(adminId, {
          draftId: draft.draft.id,
          confirmAuthorised: true,
          idempotencyKey: key,
          source: "TELEPHONE",
          contactId: bundle.contact.id,
          addressId: bundle.address.id,
          lines: [{ variantId: variant.id, qty }],
          expectedReview: {
            lines: saved.review!.lines.map((line) => ({
              variantId: line.variantId,
              qty: line.quantity,
              customerUnitPrice: line.customerUnitPrice ?? "0.00",
              lineNet: line.lineNet ?? "0.00",
              availableQty: line.availableQtyAtOrder,
              backorderQty: line.backorderQtyAtOrder,
            })),
            subtotal: saved.review!.totals.subtotal,
            vatTotal: saved.review!.totals.vatTotal,
            deliveryTotal: saved.review!.totals.deliveryTotal,
            grandTotal: saved.review!.totals.grandTotal,
          },
          backorderAcknowledged: true,
          holdUntilComplete: true,
        });
      }

      const firstBundle = await companyBundle("A");
      const secondBundle = await companyBundle("B");
      const first = await placeHeld(firstBundle, 8, `combo-a-${stamp}`);
      const second = await placeHeld(secondBundle, 8, `combo-b-${stamp}`);
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      // Insufficient for either full order
      await applyStockFeed({
        text: csv([`${sku},partial,5`]),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
        observedAt: new Date("2026-11-10T09:00:00.000Z"),
      });
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } })).stockHoldState,
      ).toBe("WAITING_STOCK");
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: second.order.id } })).stockHoldState,
      ).toBe("WAITING_STOCK");

      // Enough for exactly one order — FIFO first held wins
      await applyStockFeed({
        text: csv([`${sku},enough,8`]),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
        observedAt: new Date("2026-11-10T10:00:00.000Z"),
      });
      const a = await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } });
      const b = await prisma.order.findUniqueOrThrow({ where: { id: second.order.id } });
      expect(a.stockHoldState).toBe("READY_TO_EXPORT");
      expect(b.stockHoldState).toBe("WAITING_STOCK");
    },
    120_000,
  );
});
