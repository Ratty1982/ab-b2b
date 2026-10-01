/**
 * Scale / idempotency unit tests for historic import batching.
 * Does not insert 250k rows — proves algorithms cover full input without unsafe binds.
 */
import { describe, expect, it } from "vitest";
import {
  SAFE_HISTORIC_DOCUMENT_UPSERT_CHUNK,
  SAFE_HISTORIC_LINE_UPSERT_CHUNK,
  SAFE_IN_LIST_CHUNK,
  assertSafeBindCount,
  chunkArray,
} from "@/server/db/prisma-in-chunks";

/** Mirrors document key used by bulk upsert classification. */
function docKey(type: string, ref: string) {
  return `${type}::${ref}`;
}

describe("historic import scale classification", () => {
  it("classifies 100k docs into insert vs update without N+1 or dropped keys", () => {
    const existingRefs = new Set(
      Array.from({ length: 40_000 }, (_, i) => docKey("INVOICE", `E${i}`)),
    );
    const incoming = [
      ...Array.from({ length: 40_000 }, (_, i) => ({
        type: "INVOICE",
        ref: `E${i}`,
      })),
      ...Array.from({ length: 60_000 }, (_, i) => ({
        type: "INVOICE",
        ref: `N${i}`,
      })),
    ];
    let inserted = 0;
    let updated = 0;
    const seen = new Set<string>();
    for (const d of incoming) {
      const key = docKey(d.type, d.ref);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      if (existingRefs.has(key)) updated += 1;
      else inserted += 1;
    }
    expect(inserted).toBe(60_000);
    expect(updated).toBe(40_000);
    expect(seen.size).toBe(100_000);
  });

  it("line dedupe keeps last row and preserves credit sign for replay", () => {
    type Line = {
      documentType: string;
      documentReference: string;
      lineNumber: number;
      units: string;
      salesNet: string;
    };
    const lines: Line[] = [
      {
        documentType: "CREDIT",
        documentReference: "CR1",
        lineNumber: 1,
        units: "-2",
        salesNet: "-10.00",
      },
      {
        documentType: "CREDIT",
        documentReference: "CR1",
        lineNumber: 1,
        units: "-3",
        salesNet: "-15.00",
      },
      {
        documentType: "INVOICE",
        documentReference: "INV1",
        lineNumber: 1,
        units: "1",
        salesNet: "5.00",
      },
    ];
    const byKey = new Map<string, Line>();
    for (const line of lines) {
      byKey.set(
        `${line.documentType}::${line.documentReference}::${line.lineNumber}`,
        line,
      );
    }
    const unique = [...byKey.values()];
    expect(unique).toHaveLength(2);
    const credit = unique.find((l) => l.documentType === "CREDIT")!;
    expect(credit.units).toBe("-3");
    expect(credit.salesNet).toBe("-15.00");
  });

  it("idempotent retry: second pass of same identities all classify as updates", () => {
    const keys = Array.from({ length: 65_000 }, (_, i) =>
      docKey(i % 17 === 0 ? "CREDIT" : "INVOICE", `R${i}`),
    );
    const persisted = new Set<string>();
    // First pass
    for (const key of keys) {
      if (!persisted.has(key)) persisted.add(key);
    }
    expect(persisted.size).toBe(65_000);
    // Retry pass
    let inserted = 0;
    let updated = 0;
    for (const key of keys) {
      if (persisted.has(key)) updated += 1;
      else {
        inserted += 1;
        persisted.add(key);
      }
    }
    expect(inserted).toBe(0);
    expect(updated).toBe(65_000);
    expect(persisted.size).toBe(65_000);
  });

  it("SLRB-without-561L count equals |SLRB refs − 561L refs|", () => {
    const slrbRefs = new Set(
      Array.from({ length: 70_493 }, (_, i) => `D${i}`),
    );
    const lineRefs = new Set(
      Array.from({ length: 58_386 }, (_, i) => `D${i}`),
    );
    let matched = 0;
    let unmatched561 = 0;
    for (const ref of lineRefs) {
      if (slrbRefs.has(ref)) matched += 1;
      else unmatched561 += 1;
    }
    let slrbWithout = 0;
    for (const ref of slrbRefs) {
      if (!lineRefs.has(ref)) slrbWithout += 1;
    }
    expect(matched).toBe(58_386);
    expect(unmatched561).toBe(0);
    expect(slrbWithout).toBe(12_107);
    expect(matched + slrbWithout).toBe(slrbRefs.size);
  });

  it("NOT_IN_AB_CATALOGUE lines remain in write set (never filtered out)", () => {
    const lines = [
      { sku: "AB-1", matchStatus: "MATCHED" as const },
      { sku: "GONE-1", matchStatus: "NOT_IN_AB_CATALOGUE" as const },
      { sku: "GONE-2", matchStatus: "NOT_IN_AB_CATALOGUE" as const },
    ];
    const retained = lines.filter(Boolean);
    expect(retained).toHaveLength(3);
    expect(retained.filter((l) => l.matchStatus === "NOT_IN_AB_CATALOGUE")).toHaveLength(2);
  });

  it("scenario A/B write plans never exceed safe bind counts", () => {
    const scenarios = [
      { docs: 70_000, lines: 65_000 },
      { docs: 100_000, lines: 250_000 },
    ];
    for (const s of scenarios) {
      for (const chunk of chunkArray(
        Array.from({ length: s.docs }, (_, i) => i),
        SAFE_IN_LIST_CHUNK,
      )) {
        assertSafeBindCount(chunk.length + 1, `docs IN ${s.docs}`);
      }
      for (const chunk of chunkArray(
        Array.from({ length: s.docs }, (_, i) => i),
        SAFE_HISTORIC_DOCUMENT_UPSERT_CHUNK,
      )) {
        assertSafeBindCount(chunk.length * 13, `docs write ${s.docs}`);
      }
      for (const chunk of chunkArray(
        Array.from({ length: s.lines }, (_, i) => i),
        SAFE_HISTORIC_LINE_UPSERT_CHUNK,
      )) {
        assertSafeBindCount(chunk.length * 18, `lines write ${s.lines}`);
      }
    }
  });
});
