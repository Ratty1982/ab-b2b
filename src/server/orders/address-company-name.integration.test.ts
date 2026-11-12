/**
 * Address company names survive setup, order snapshots, and Autopart export.
 * Already exported orders are not rewritten.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { resolveDeliverySnapshot } from "@/server/orders/service";
import {
  exportAutopartOrdersCsv,
  previewAutopartOrderExport,
} from "@/server/orders/autopart-export";
import { updateAddress } from "@/server/companies/service";

const prisma = new PrismaClient();
let adminId = "";

async function ensureUser(email: string) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: "Address company admin",
        status: "ACTIVE",
        actorType: "INTERNAL",
        emailVerified: true,
      },
    });
  }
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: role.id } },
    create: { userId: user.id, roleId: role.id },
    update: {},
  });
  return user.id;
}

function csvField(line: string, index: number): string {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields[index] ?? "";
}

function shippingCells(csv: string, orderNumber: string) {
  const line = csv.split("\n").find((row) => row.includes(orderNumber));
  expect(line).toBeTruthy();
  return {
    name: csvField(line!, 2),
    line1: csvField(line!, 3),
    line2: csvField(line!, 4),
  };
}

async function createOrder(input: {
  orderNumber: string;
  companyId: string;
  companyCode: string;
  deliveryAddress: Prisma.InputJsonValue;
  contactName: string;
  exported?: boolean;
  hold?: boolean;
}) {
  return prisma.order.create({
    data: {
      orderNumber: input.orderNumber,
      companyId: input.companyId,
      status: "SUBMITTED",
      subtotal: "10.00",
      vatTotal: "2.00",
      deliveryTotal: "0.00",
      grandTotal: "12.00",
      placedAt: new Date("2026-11-12T09:00:00.000Z"),
      paymentTermsSnapshot: "30 Days",
      autopartCustomerCodeSnapshot: input.companyCode,
      autopartAccountLinked: true,
      deliveryAddress: input.deliveryAddress,
      contactSnapshot: {
        name: input.contactName,
        email: "buyer@example.test",
        phone: "01130000000",
      },
      ...(input.exported
        ? {
            autopartExportStatus: "EXPORTED" as const,
            autopartExportedAt: new Date("2026-11-01T09:00:00.000Z"),
            autopartExportCount: 1,
          }
        : {}),
      ...(input.hold
        ? {
            stockHoldState: "WAITING_STOCK" as const,
            stockReleasePolicy: "HOLD_UNTIL_COMPLETE" as const,
          }
        : {}),
      items: {
        create: [
          {
            sku: "PMML500SC40",
            name: "Seal",
            qty: 1,
            unitPrice: "10.00",
            customerUnitPrice: "10.00",
            vatRate: 20,
            lineTotal: "10.00",
            lineVat: "2.00",
            lineGross: "12.00",
          },
        ],
      },
    },
  });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`address-company-${Date.now()}@example.invalid`);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("address company name on orders and Autopart export", () => {
  it("snapshots each delivery company name and exports it without rewriting exported orders", async () => {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const registered = `Acme Factors ${stamp}`;
    const company = await prisma.company.create({
      data: {
        name: registered,
        status: "ACTIVE",
        autopartCustomerCode: `AC${stamp}`,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });
    const billing = await prisma.address.create({
      data: {
        companyId: company.id,
        type: "BILLING",
        line1: "1 Accounts Way",
        town: "Leeds",
        postcode: "LS1 1AA",
        country: "GB",
        companyName: registered,
        contactName: "Accounts",
        isDefaultBilling: true,
      },
    });
    const leeds = await prisma.address.create({
      data: {
        companyId: company.id,
        type: "DELIVERY",
        label: "Leeds",
        line1: "2 Warehouse Road",
        town: "Leeds",
        postcode: "LS2 2WW",
        country: "GB",
        companyName: "Acme Leeds Depot",
        contactName: "Goods In",
        isDefaultDelivery: true,
      },
    });
    const manchester = await prisma.address.create({
      data: {
        companyId: company.id,
        type: "DELIVERY",
        label: "Manchester",
        line1: "3 Depot Lane",
        town: "Manchester",
        postcode: "M1 1DD",
        country: "GB",
        companyName: "Acme Manchester Depot",
        contactName: "Night Gate",
      },
    });

    const leedsSnapshot = await resolveDeliverySnapshot(company.id, { addressId: leeds.id });
    const manchesterSnapshot = await resolveDeliverySnapshot(company.id, {
      addressId: manchester.id,
    });
    expect(leedsSnapshot.companyName).toBe("Acme Leeds Depot");
    expect(leedsSnapshot.contactName).toBe("Goods In");
    expect(leedsSnapshot.line1).toBe("2 Warehouse Road");
    expect(manchesterSnapshot.companyName).toBe("Acme Manchester Depot");
    expect(manchesterSnapshot.line1).toBe("3 Depot Lane");
    expect(billing.companyName).toBe(registered);

    const blank = await prisma.address.create({
      data: {
        companyId: company.id,
        type: "DELIVERY",
        line1: "4 Historic Street",
        town: "York",
        postcode: "YO1 1YY",
        country: "GB",
        contactName: "Old Contact",
      },
    });
    const blankSnapshot = await resolveDeliverySnapshot(company.id, { addressId: blank.id });
    expect(blankSnapshot.companyName).toBeNull();
    expect(blankSnapshot.contactName).toBe("Old Contact");

    const fresh = await createOrder({
      orderNumber: `AB-CO-${stamp}`,
      companyId: company.id,
      companyCode: `AC${stamp}`,
      deliveryAddress: leedsSnapshot,
      contactName: "Pat Buyer",
    });
    const exported = await exportAutopartOrdersCsv(adminId, [fresh.id]);
    const freshCells = shippingCells(exported.csv, fresh.orderNumber);
    expect(freshCells.name).toBe("Acme Leeds Depot");
    expect(freshCells.line1).toBe("2 Warehouse Road");
    expect(freshCells.line2).toBe("");
    expect(exported.csv).not.toContain("Pat Buyer");
    expect(exported.csv).not.toContain("Acme Leeds Depot, 2 Warehouse Road");

    const missing = await createOrder({
      orderNumber: `AB-FB-${stamp}`,
      companyId: company.id,
      companyCode: `AC${stamp}`,
      deliveryAddress: {
        line1: "4 Historic Street",
        town: "York",
        postcode: "YO1 1YY",
        country: "GB",
        contactName: "Old Contact",
      },
      contactName: "Old Contact",
    });
    const fallback = await exportAutopartOrdersCsv(adminId, [missing.id]);
    expect(shippingCells(fallback.csv, missing.orderNumber).name).toBe(registered);
    expect(shippingCells(fallback.csv, missing.orderNumber).line1).toBe("4 Historic Street");
    const stamped = await prisma.order.findUniqueOrThrow({ where: { id: missing.id } });
    expect((stamped.deliveryAddress as { companyName?: string }).companyName).toBe(registered);
    const again = await exportAutopartOrdersCsv(adminId, [missing.id], { confirmReexport: true });
    expect(shippingCells(again.csv, missing.orderNumber).name).toBe(registered);

    const historical = await createOrder({
      orderNumber: `AB-OLD-${stamp}`,
      companyId: company.id,
      companyCode: `AC${stamp}`,
      deliveryAddress: {
        line1: "9 Already Exported Road",
        town: "Leeds",
        postcode: "LS9 9ZZ",
        country: "GB",
        contactName: "Historical Buyer",
      },
      contactName: "Historical Buyer",
      exported: true,
    });
    const reexport = await exportAutopartOrdersCsv(adminId, [historical.id], {
      confirmReexport: true,
    });
    expect(shippingCells(reexport.csv, historical.orderNumber).name).toBe("Historical Buyer");
    expect(shippingCells(reexport.csv, historical.orderNumber).line1).toBe("9 Already Exported Road");
    const unchanged = await prisma.order.findUniqueOrThrow({ where: { id: historical.id } });
    expect((unchanged.deliveryAddress as { companyName?: string | null }).companyName ?? null).toBeNull();

    const held = await createOrder({
      orderNumber: `AB-HOLD-${stamp}`,
      companyId: company.id,
      companyCode: `AC${stamp}`,
      deliveryAddress: manchesterSnapshot,
      contactName: "Pat Buyer",
      hold: true,
    });
    const preview = await previewAutopartOrderExport(adminId, [held.id]);
    expect(preview.items[0]?.reason).toBe("WAITING_STOCK");
    await expect(exportAutopartOrdersCsv(adminId, [held.id])).rejects.toThrow(/held|hold/i);

    await updateAddress(adminId, {
      id: leeds.id,
      companyId: company.id,
      line1: "2 Warehouse Road",
    });
    const kept = await prisma.address.findUniqueOrThrow({ where: { id: leeds.id } });
    expect(kept.companyName).toBe("Acme Leeds Depot");
    const orderAfterEdit = await prisma.order.findUniqueOrThrow({ where: { id: fresh.id } });
    expect((orderAfterEdit.deliveryAddress as { companyName?: string }).companyName).toBe(
      "Acme Leeds Depot",
    );

    await prisma.order.deleteMany({ where: { companyId: company.id } });
    await prisma.address.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  });
});
