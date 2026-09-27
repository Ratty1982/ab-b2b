import type { Prisma } from "@prisma/client";

/**
 * Race-safe Automotive Brands quote number allocator.
 * Format: QT-000001 (6-digit zero-padded).
 */
export async function allocateQuoteNumber(tx: Prisma.TransactionClient): Promise<string> {
  await tx.$executeRaw`
    INSERT INTO "QuoteNumberSequence" ("id", "nextValue")
    VALUES ('default', 1)
    ON CONFLICT ("id") DO NOTHING
  `;

  const rows = await tx.$queryRaw<Array<{ allocated: number }>>`
    UPDATE "QuoteNumberSequence"
    SET "nextValue" = "nextValue" + 1
    WHERE "id" = 'default'
    RETURNING ("nextValue" - 1) AS "allocated"
  `;

  const allocated = rows[0]?.allocated;
  if (allocated == null || !Number.isInteger(allocated) || allocated < 1) {
    throw new Error("Quote number sequence is unavailable");
  }

  return `QT-${String(allocated).padStart(6, "0")}`;
}
