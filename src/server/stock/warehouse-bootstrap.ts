/**
 * Autopart/Studley warehouse upsert — Prisma + domain constants only.
 * Kept out of stock/service.ts so production bootstrap bundling does not pull
 * the Autopart sync / IMAP / purchasing graph (and TanStack Start virtual entries).
 */
import type { PrismaClient } from "@prisma/client";
import { AUTOPART_WAREHOUSE_CODE, AUTOPART_WAREHOUSE_NAME } from "@/domain/stock";

export async function ensureAutopartWarehouse(prisma: PrismaClient) {
  return prisma.warehouse.upsert({
    where: { code: AUTOPART_WAREHOUSE_CODE },
    create: { code: AUTOPART_WAREHOUSE_CODE, name: AUTOPART_WAREHOUSE_NAME, isDefault: true },
    update: { name: AUTOPART_WAREHOUSE_NAME },
  });
}
