import type { Prisma } from "@prisma/client";

/**
 * Race-safe Automotive Brands order number allocator.
 * Uses SELECT FOR UPDATE via UPDATE … RETURNING on OrderNumberSequence.
 * Format: AB-000001 (6-digit zero-padded).
 * Retired order numbers and numbers already on an order are skipped and never reused.
 */
export async function allocateOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  await tx.$executeRaw`
    INSERT INTO "OrderNumberSequence" ("id", "nextValue")
    VALUES ('default', 1)
    ON CONFLICT ("id") DO NOTHING
  `;

  const maxSkips = 1000;
  for (let attempt = 0; attempt < maxSkips; attempt += 1) {
    const rows = await tx.$queryRaw<Array<{ allocated: number }>>`
      UPDATE "OrderNumberSequence"
      SET "nextValue" = "nextValue" + 1
      WHERE "id" = 'default'
      RETURNING ("nextValue" - 1) AS "allocated"
    `;

    const allocated = rows[0]?.allocated;
    if (allocated == null || !Number.isInteger(allocated) || allocated < 1) {
      throw new Error("Order number sequence is unavailable");
    }

    const orderNumber = `AB-${String(allocated).padStart(6, "0")}`;
    const [retired, existing] = await Promise.all([
      tx.retiredOrderNumber.findUnique({
        where: { orderNumber },
        select: { orderNumber: true },
      }),
      tx.order.findUnique({
        where: { orderNumber },
        select: { id: true },
      }),
    ]);
    if (!retired && !existing) return orderNumber;
  }

  throw new Error("Order number sequence could not allocate a free number");
}
