/**
 * Read-only stock diagnostic for catalogue SKUs.
 *
 * Usage:
 *   bun run scripts/diagnose-sku-stock.ts PMEBIKK PMECARK PMECAVK
 *
 * Never writes. Safe against production when pointed at a read-only DATABASE_URL.
 */
import { PrismaClient } from "@prisma/client";
import { resolveBackorderPolicy } from "../src/domain/backorder";
import { getEffectiveSellableQuantity, skuMatchKey } from "../src/domain/stock";
import { getGlobalBackorderPolicy } from "../src/server/ordering/settings";

const prisma = new PrismaClient();
const skus = process.argv.slice(2).map((s) => s.trim().toUpperCase()).filter(Boolean);

if (!skus.length) {
  console.error("Usage: bun run scripts/diagnose-sku-stock.ts <SKU> [SKU...]");
  process.exit(2);
}

async function diagnose(sku: string) {
  const key = skuMatchKey(sku);
  const variants = await prisma.productVariant.findMany({
    where: { sku: { equals: sku, mode: "insensitive" } },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          status: true,
          isActive: true,
          isTradeVisible: true,
        },
      },
      inventory: true,
      autopartProduct: true,
    },
  });
  const masters = await prisma.autopartProduct.findMany({
    where: { OR: [{ matchKey: key }, { sku: { equals: sku, mode: "insensitive" } }] },
  });
  const global = await getGlobalBackorderPolicy();

  const openBackorderLines = variants.length
    ? await prisma.orderItem.findMany({
        where: {
          variantId: { in: variants.map((v) => v.id) },
          backorderQtyAtOrder: { gt: 0 },
          order: { status: { notIn: ["CANCELLED", "DELIVERED", "ADMINISTRATIVELY_CLOSED"] } },
        },
        select: {
          id: true,
          qty: true,
          backorderQtyAtOrder: true,
          availableQtyAtOrder: true,
          orderId: true,
          order: { select: { orderNumber: true, status: true, companyId: true } },
        },
        take: 20,
      })
    : [];

  console.log(`\n======== ${sku} ========`);
  if (!variants.length) {
    console.log("Catalogue ProductVariant: NOT FOUND in this database");
  }
  for (const v of variants) {
    const effective = resolveBackorderPolicy({
      globalPolicy: global,
      variantPolicy: v.backorderPolicy,
    });
    const inv = v.inventory[0] ?? null;
    const sellable = inv
      ? getEffectiveSellableQuantity({
          autopartAvail: inv.qtyOnHand,
          reservedQty: inv.qtyReserved,
          manualOverrideQty: inv.manualOverrideQty,
        })
      : null;
    console.log(
      JSON.stringify(
        {
          product: v.product,
          variantId: v.id,
          sku: v.sku,
          variantActive: v.isActive,
          backorderPolicy: v.backorderPolicy,
          effectiveBackorderPolicy: effective,
          inventoryExists: Boolean(inv),
          qtyOnHand: inv?.qtyOnHand ?? null,
          qtyReserved: inv?.qtyReserved ?? null,
          manualOverrideQty: inv?.manualOverrideQty ?? null,
          sellableQty: sellable,
          externalSyncedAt: inv?.externalSyncedAt?.toISOString() ?? null,
          stockConfirmed: Boolean(inv),
          linkedAutopartProductId: v.autopartProduct?.id ?? null,
        },
        null,
        2,
      ),
    );
  }

  console.log("AutopartProduct master rows:", masters.length);
  for (const m of masters) {
    console.log(
      JSON.stringify(
        {
          id: m.id,
          sku: m.sku,
          matchKey: m.matchKey,
          availQty: m.availQty,
          incomingQty: m.incomingQty,
          presentInLatestFeed: m.presentInLatestFeed,
          lastSeenAt: m.lastSeenAt?.toISOString() ?? null,
          catalogueVariantId: m.catalogueVariantId,
          sourceAvailRaw: m.sourceAvailRaw,
        },
        null,
        2,
      ),
    );
  }

  console.log("Open backorder order lines:", openBackorderLines.length);
  for (const line of openBackorderLines) {
    console.log(
      JSON.stringify(
        {
          orderId: line.orderId,
          orderNumber: line.order.orderNumber,
          orderStatus: line.order.status,
          companyId: line.order.companyId,
          qty: line.qty,
          availableQtyAtOrder: line.availableQtyAtOrder,
          backorderQtyAtOrder: line.backorderQtyAtOrder,
        },
        null,
        2,
      ),
    );
  }

  const hasInv = variants.some((v) => v.inventory.length > 0);
  const hasMaster = masters.length > 0;
  const linked = masters.some((m) => m.catalogueVariantId);
  const reason = !variants.length
    ? "SKU not in this database catalogue"
    : !hasInv && !hasMaster
      ? "No inventory and no Autopart master — wait for a trusted 231PO3NEW observation"
      : !hasInv && hasMaster && !linked
        ? "Autopart master exists but was not linked / inventory not initialised at product create time"
        : !hasInv && hasMaster && linked
          ? "Master linked but Inventory row missing — safe reconcile candidate if presentInLatestFeed"
          : "Inventory present";
  console.log("Diagnostic summary:", reason);
  console.log(
    "Safe reconcile (code path):",
    hasMaster &&
      variants.length === 1 &&
      !hasInv &&
      masters[0]?.presentInLatestFeed &&
      (!masters[0]?.catalogueVariantId || masters[0]?.catalogueVariantId === variants[0]?.id)
      ? "YES — would initialise Inventory from master Avail without touching orders"
      : "NO / not required",
  );
}

async function main() {
  for (const sku of skus) await diagnose(sku);
}

main()
  .catch((error) => {
    console.error("DIAG_ERROR", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
