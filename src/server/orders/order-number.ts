import type { Prisma } from "@prisma/client";

/**
 * Race-safe Automotive Brands order number allocator.
 * Uses SELECT FOR UPDATE via UPDATE … RETURNING on OrderNumberSequence.
 * Format: AB-000001 (6-digit zero-padded).
 */
export async function allocateOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  await tx.$executeRaw`
    INSERT INTO "OrderNumberSequence" ("id", "nextValue")
    VALUES ('default', 1)
    ON CONFLICT ("id") DO NOTHING
  `;

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

  return `AB-${String(allocated).padStart(6, "0")}`;
}
