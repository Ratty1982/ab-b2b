/**
 * Wait until PostgreSQL accepts a Prisma query.
 * Exit 0 when ready; exit 1 on timeout / non-retriable failure.
 *
 * Usage: node scripts/wait-for-db.mjs
 * Env: DATABASE_URL (required), DB_WAIT_ATTEMPTS (default 30), DB_WAIT_MS (default 2000)
 */
import { PrismaClient } from "@prisma/client";

const maxAttempts = Number(process.env["DB_WAIT_ATTEMPTS"] ?? 30);
const delayMs = Number(process.env["DB_WAIT_MS"] ?? 2000);

if (!process.env["DATABASE_URL"]) {
  console.error("[ab:wait-for-db] DATABASE_URL is not set");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransient(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";

  // Prisma / pg connection failures while Postgres is starting
  if (code === "P1001" || code === "P1002" || code === "P1017") return true;
  if (/can't reach database|connection refused|ECONNREFUSED|ETIMEDOUT|ECONNRESET|server has closed|not yet accepting/i.test(message)) {
    return true;
  }
  return false;
}

async function attemptOnce() {
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    await attemptOnce();
    console.log(`[ab:wait-for-db] Database ready (attempt ${attempt})`);
    process.exit(0);
  } catch (error) {
    if (!isTransient(error) || attempt === maxAttempts) {
      console.error(
        "[ab:wait-for-db] Database check failed:",
        error instanceof Error ? error.message : error,
      );
      process.exit(1);
    }
    console.log(
      `[ab:wait-for-db] Database not ready (attempt ${attempt}/${maxAttempts}); retrying in ${delayMs}ms…`,
    );
    await sleep(delayMs);
  }
}
