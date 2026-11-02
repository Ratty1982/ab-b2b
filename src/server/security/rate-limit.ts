export type RateDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = { start: number; count: number };

/**
 * Fixed-window counter kept in this process.
 *
 * Isolated instances are used in tests. Request handling shares
 * `securityLimiter` for the life of that process. A restart clears it.
 * Two running copies do not share it, so each copy has its own allowance.
 *
 * `REDIS_URL` is an unused optional environment variable. Redis is not on
 * this path. A shared store would need a connect timeout and a defined
 * result when Redis is down or slow, so that sign-in does not wait on it
 * or fail open without a record. That design is not in this repository.
 */
export function createFixedWindowLimiter(now: () => number = Date.now, maxKeys = 5_000) {
  const buckets = new Map<string, Bucket>();

  function prune(current: number) {
    if (buckets.size <= maxKeys) return;
    for (const [key, bucket] of buckets) {
      if (current - bucket.start > 60 * 60 * 1000) buckets.delete(key);
      if (buckets.size <= maxKeys / 2) break;
    }
  }

  return {
    take(key: string, limit: number, windowMs: number): RateDecision {
      const t = now();
      prune(t);
      const current = buckets.get(key);
      if (!current || t - current.start >= windowMs) {
        buckets.set(key, { start: t, count: 1 });
        return { allowed: true, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
      }
      if (current.count >= limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((current.start + windowMs - t) / 1000));
        return { allowed: false, remaining: 0, retryAfterSeconds };
      }
      current.count += 1;
      return {
        allowed: true,
        remaining: Math.max(0, limit - current.count),
        retryAfterSeconds: 0,
      };
    },
    reset() {
      buckets.clear();
    },
  };
}

export type FixedWindowLimiter = ReturnType<typeof createFixedWindowLimiter>;

export const securityLimiter = createFixedWindowLimiter();
