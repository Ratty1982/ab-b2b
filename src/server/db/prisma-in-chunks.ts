/**
 * Safe chunking for Prisma/Postgres `IN (...)` and multi-row writes.
 *
 * PostgreSQL rejects prepared statements with more than 32,767 bind variables.
 * Prisma maps each `in: [...]` element (and each column in INSERT VALUES) to a bind.
 *
 * Chunk sizes leave substantial headroom for companion WHERE params (e.g. companyId)
 * and Prisma/query-engine overhead. Do not use values near 32,000.
 */

/** PostgreSQL prepared-statement bind ceiling. */
export const POSTGRES_MAX_BIND_PARAMS = 32_767;

/**
 * Max identifiers per `column IN (...)` lookup when the query also binds
 * 1–4 other scalars (companyId, etc.). 4_000 + a few extras ≪ 32_767.
 */
export const SAFE_IN_LIST_CHUNK = 4_000;

/**
 * Historic document upsert: ~13 bound columns per VALUES row.
 * 200 × 13 = 2_600 binds per statement.
 */
export const SAFE_HISTORIC_DOCUMENT_UPSERT_CHUNK = 200;

/**
 * Historic line upsert: ~18 bound columns per VALUES row.
 * 150 × 18 = 2_700 binds per statement.
 */
export const SAFE_HISTORIC_LINE_UPSERT_CHUNK = 150;

/**
 * SKU resolve OR-equals clauses: each OR arm is one bind (+ mode).
 * Keep well under the ceiling when many SKUs are resolved.
 */
export const SAFE_SKU_EQUALS_CHUNK = 200;

export function chunkArray<T>(items: readonly T[], chunkSize: number): T[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size) as T[]);
  }
  return out;
}

/**
 * Load rows for a large `in` list by querying successive chunks and merging.
 * Guarantees every identifier is queried exactly once across chunks.
 */
export async function findManyByInChunks<TId, TRow>(args: {
  ids: readonly TId[];
  chunkSize?: number;
  findChunk: (chunk: TId[]) => Promise<TRow[]>;
}): Promise<TRow[]> {
  const chunks = chunkArray(args.ids, args.chunkSize ?? SAFE_IN_LIST_CHUNK);
  if (!chunks.length) return [];
  const rows: TRow[] = [];
  for (const chunk of chunks) {
    const part = await args.findChunk(chunk);
    rows.push(...part);
  }
  return rows;
}

/** Assert a planned bind count is safely below the Postgres ceiling (tests / guards). */
export function assertSafeBindCount(bindCount: number, context: string): void {
  if (bindCount > POSTGRES_MAX_BIND_PARAMS) {
    throw new Error(
      `Unsafe Prisma/Postgres bind count ${bindCount} in ${context} (max ${POSTGRES_MAX_BIND_PARAMS})`,
    );
  }
}
