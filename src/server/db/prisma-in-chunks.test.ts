import { describe, expect, it, vi } from "vitest";
import {
  POSTGRES_MAX_BIND_PARAMS,
  SAFE_HISTORIC_DOCUMENT_UPSERT_CHUNK,
  SAFE_HISTORIC_LINE_UPSERT_CHUNK,
  SAFE_IN_LIST_CHUNK,
  assertSafeBindCount,
  chunkArray,
  findManyByInChunks,
} from "@/server/db/prisma-in-chunks";

describe("prisma-in-chunks", () => {
  it("chunkArray covers every element exactly once with no drops", () => {
    const ids = Array.from({ length: 70_000 }, (_, i) => `REF${i}`);
    const chunks = chunkArray(ids, SAFE_IN_LIST_CHUNK);
    expect(chunks.length).toBe(Math.ceil(70_000 / SAFE_IN_LIST_CHUNK));
    expect(chunks.every((c) => c.length <= SAFE_IN_LIST_CHUNK)).toBe(true);
    expect(chunks.flat()).toEqual(ids);
    expect(new Set(chunks.flat()).size).toBe(70_000);
  });

  it("chunkArray handles empty and oversized chunk size", () => {
    expect(chunkArray([], 100)).toEqual([]);
    expect(chunkArray([1, 2, 3], 10_000)).toEqual([[1, 2, 3]]);
  });

  it("IN-list chunk + companion companyId bind stays far below Postgres ceiling", () => {
    // RETAIL failure shape: companyId + documentReference IN (...32767) = 32768 binds
    const companionBinds = 1; // companyId
    const bindsPerChunk = SAFE_IN_LIST_CHUNK + companionBinds;
    expect(bindsPerChunk).toBeLessThan(POSTGRES_MAX_BIND_PARAMS);
    expect(bindsPerChunk).toBeLessThan(8_000); // substantial headroom
    assertSafeBindCount(bindsPerChunk, "document preload");
  });

  it("document/line upsert chunks stay under bind ceiling for realistic column counts", () => {
    const docCols = 13;
    const lineCols = 18;
    assertSafeBindCount(SAFE_HISTORIC_DOCUMENT_UPSERT_CHUNK * docCols, "doc upsert");
    assertSafeBindCount(SAFE_HISTORIC_LINE_UPSERT_CHUNK * lineCols, "line upsert");
    expect(SAFE_HISTORIC_DOCUMENT_UPSERT_CHUNK * docCols).toBeLessThan(5_000);
    expect(SAFE_HISTORIC_LINE_UPSERT_CHUNK * lineCols).toBeLessThan(5_000);
  });

  it("findManyByInChunks queries every id once and merges rows (70k scale)", async () => {
    const ids = Array.from({ length: 70_000 }, (_, i) => i);
    const seen: number[][] = [];
    const rows = await findManyByInChunks({
      ids,
      chunkSize: SAFE_IN_LIST_CHUNK,
      findChunk: async (chunk) => {
        seen.push(chunk);
        return chunk.map((id) => ({ id }));
      },
    });
    expect(seen.flat()).toEqual(ids);
    expect(rows.map((r) => r.id)).toEqual(ids);
    expect(Math.max(...seen.map((c) => c.length))).toBeLessThanOrEqual(SAFE_IN_LIST_CHUNK);
  });

  it("findManyByInChunks never issues an unsafe IN bind count at 100k+ ids", async () => {
    const ids = Array.from({ length: 100_500 }, (_, i) => `D${i}`);
    let maxBinds = 0;
    await findManyByInChunks({
      ids,
      chunkSize: SAFE_IN_LIST_CHUNK,
      findChunk: async (chunk) => {
        const binds = chunk.length + 1; // + companyId
        maxBinds = Math.max(maxBinds, binds);
        assertSafeBindCount(binds, "scale findMany");
        return [];
      },
    });
    expect(maxBinds).toBeLessThanOrEqual(SAFE_IN_LIST_CHUNK + 1);
    expect(maxBinds).toBeLessThan(POSTGRES_MAX_BIND_PARAMS);
  });

  it("assertSafeBindCount rejects values above the Postgres ceiling", () => {
    expect(() => assertSafeBindCount(32_768, "retail failure")).toThrow(/Unsafe/);
  });

  it("250k product-line write plan uses safe upsert chunks with no dropped rows", () => {
    const lineCount = 250_000;
    const chunks = chunkArray(
      Array.from({ length: lineCount }, (_, i) => i),
      SAFE_HISTORIC_LINE_UPSERT_CHUNK,
    );
    expect(chunks.flat().length).toBe(lineCount);
    for (const chunk of chunks) {
      assertSafeBindCount(chunk.length * 18, "line write plan");
    }
  });
});

describe("historic import bind-safety regression", () => {
  it("reproduces the RETAIL failure shape and proves chunking avoids it", async () => {
    // Exact production failure: 32_767 refs + companyId = 32_768 binds
    const refs = Array.from({ length: 32_767 }, (_, i) => `INV${i}`);
    const unsafeBinds = refs.length + 1;
    expect(unsafeBinds).toBe(32_768);
    expect(() => assertSafeBindCount(unsafeBinds, "unchunked findMany")).toThrow();

    const findChunk = vi.fn(async (chunk: string[]) => {
      assertSafeBindCount(chunk.length + 1, "chunked findMany");
      return chunk.map((documentReference) => ({ documentReference }));
    });
    const rows = await findManyByInChunks({
      ids: refs,
      chunkSize: SAFE_IN_LIST_CHUNK,
      findChunk,
    });
    expect(findChunk.mock.calls.length).toBe(Math.ceil(refs.length / SAFE_IN_LIST_CHUNK));
    expect(rows.length).toBe(refs.length);
  });
});
