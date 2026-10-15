/**
 * One database row owns the historical ALL import.
 * A claim locks that row, increments a fence, and stores the fence on the import.
 * Heartbeats, batch writes, and completion must present the same owner and fence.
 * An expired worker can be replaced while it is still running. Its old fence then
 * cannot write or mark the replacement job complete.
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import { Prisma, PrismaClient } from "@prisma/client";
import { importLockIsAbandoned } from "@/domain/historic-runtime";
import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";

const PROCESS_LOCK_OWNER = `${os.hostname()}:${process.pid}:${randomUUID()}`;
let activeImportId: string | null = null;

export class HistoricImportFenced extends Error {
  readonly code = "IMPORT_FENCED";

  constructor() {
    super("This import lost the lock. It cannot keep writing or mark another import complete.");
    this.name = "HistoricImportFenced";
  }
}

export type HistoricClaimResult =
  | { status: "claimed"; fence: bigint }
  | { status: "busy" }
  | { status: "missing" }
  | { status: "committed" };

type LockRow = {
  fence: bigint;
  owner: string | null;
  importId: string | null;
  heartbeatAt: Date | null;
};

const ABANDONED_SUMMARY: Prisma.InputJsonValue = {
  recoverable: true,
  interrupted: true,
  message:
    "The import stopped before it finished. Replay the stored files. Incomplete history was not marked successful.",
};

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function lockIsFresh(lock: LockRow, now = Date.now()): boolean {
  if (!lock.importId || !lock.owner) return false;
  return !importLockIsAbandoned(lock.owner, lock.heartbeatAt, now, {
    hostname: os.hostname(),
    pidAlive,
  });
}

export function reserveHistoricImportProcess(importId: string): void {
  if (activeImportId) {
    throw new AuthError("Another historical import is already running", "IMPORT_IN_PROGRESS", 409);
  }
  activeImportId = importId;
}

export function continueHistoricImportProcess(importId: string): void {
  if (activeImportId !== importId) {
    throw new AuthError("Another historical import is already running", "IMPORT_IN_PROGRESS", 409);
  }
}

export function releaseHistoricImportProcess(importId: string): void {
  if (activeImportId === importId) activeImportId = null;
}

async function ensureLockRow(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "AutopartHistoryImportLock" ("id", "fence")
    VALUES (1, 0)
    ON CONFLICT ("id") DO NOTHING
  `;
}

async function readLock(tx: Prisma.TransactionClient): Promise<LockRow> {
  const rows = await tx.$queryRaw<LockRow[]>`
    SELECT "fence", "owner", "importId", "heartbeatAt"
    FROM "AutopartHistoryImportLock"
    WHERE "id" = 1
    FOR UPDATE
  `;
  const lock = rows[0];
  if (!lock) throw new Error("Historical import lock row is missing");
  return {
    fence: BigInt(lock.fence),
    owner: lock.owner,
    importId: lock.importId,
    heartbeatAt: lock.heartbeatAt,
  };
}

async function failProcessingImport(tx: Prisma.TransactionClient, importId: string): Promise<boolean> {
  const updated = await tx.autopartHistoryAllImport.updateMany({
    where: { id: importId, status: "PROCESSING" },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      lockOwner: null,
      lockFence: null,
      summary: ABANDONED_SUMMARY,
    },
  });
  if (!updated.count) return false;
  await tx.autopartCustomerImportRun.updateMany({
    where: {
      status: "PROCESSING",
      type: "HISTORY_561L_SLRB",
      diagnostics: { path: ["allImportId"], equals: importId },
    },
    data: { status: "FAILED", completedAt: new Date() },
  });
  return true;
}

export async function recoverAbandonedHistoricImports(db: PrismaClient = prisma): Promise<number> {
  return db.$transaction(async (tx) => {
    await ensureLockRow(tx);
    const lock = await readLock(tx);
    const holderFresh = lockIsFresh(lock);
    const processing = await tx.autopartHistoryAllImport.findMany({
      where: { status: "PROCESSING" },
      select: { id: true },
    });
    let failed = 0;
    for (const row of processing) {
      if (holderFresh && row.id === lock.importId) continue;
      if (await failProcessingImport(tx, row.id)) failed += 1;
    }
    if (!holderFresh && (lock.importId || lock.owner)) {
      await tx.$executeRaw`
        UPDATE "AutopartHistoryImportLock"
        SET "fence" = "fence" + 1,
            "owner" = NULL,
            "importId" = NULL,
            "heartbeatAt" = NULL
        WHERE "id" = 1
          AND "fence" = ${lock.fence}
      `;
    }
    return failed;
  }, { timeout: 20_000 });
}

export async function claimHistoricImport(
  importId: string,
  db: PrismaClient = prisma,
): Promise<HistoricClaimResult> {
  return db.$transaction(async (tx) => {
    await ensureLockRow(tx);
    const lock = await readLock(tx);
    const target = await tx.autopartHistoryAllImport.findUnique({
      where: { id: importId },
      select: { status: true },
    });
    if (!target) return { status: "missing" };
    if (target.status === "COMMITTED") return { status: "committed" };
    if (lockIsFresh(lock)) return { status: "busy" };
    if (target.status !== "PREVIEWED" && target.status !== "FAILED" && target.status !== "PROCESSING") {
      return { status: "busy" };
    }

    const processing = await tx.autopartHistoryAllImport.findMany({
      where: { status: "PROCESSING", id: { not: importId } },
      select: { id: true },
    });
    for (const row of processing) await failProcessingImport(tx, row.id);

    const nextFence = lock.fence + 1n;
    const moved = await tx.$executeRaw`
      UPDATE "AutopartHistoryImportLock"
      SET "fence" = ${nextFence},
          "owner" = ${PROCESS_LOCK_OWNER},
          "importId" = ${importId},
          "heartbeatAt" = NOW()
      WHERE "id" = 1
        AND "fence" = ${lock.fence}
    `;
    if (Number(moved) !== 1) throw new Error("Historical import lock moved during claim");
    const claimed = await tx.autopartHistoryAllImport.updateMany({
      where: { id: importId, status: { in: ["PREVIEWED", "FAILED", "PROCESSING"] } },
      data: {
        status: "PROCESSING",
        lockOwner: PROCESS_LOCK_OWNER,
        lockFence: nextFence,
        heartbeatAt: new Date(),
        completedAt: null,
      },
    });
    if (claimed.count !== 1) throw new Error("Historical import row was not claimed");
    return { status: "claimed", fence: nextFence };
  }, { timeout: 20_000 });
}

async function lockOwnedRow(
  tx: Prisma.TransactionClient,
  importId: string,
  fence: bigint,
): Promise<boolean> {
  const held = await tx.$queryRaw<Array<{ fence: bigint }>>`
    SELECT "fence"
    FROM "AutopartHistoryImportLock"
    WHERE "id" = 1
      AND "fence" = ${fence}
      AND "owner" = ${PROCESS_LOCK_OWNER}
      AND "importId" = ${importId}
    FOR UPDATE
  `;
  return held.length === 1;
}

export async function updateOwnedHistoricImport(
  importId: string,
  fence: bigint,
  data: Prisma.AutopartHistoryAllImportUpdateManyMutationInput,
  db: PrismaClient = prisma,
): Promise<void> {
  await db.$transaction(async (tx) => {
    if (!(await lockOwnedRow(tx, importId, fence))) throw new HistoricImportFenced();
    const row = await tx.autopartHistoryAllImport.updateMany({
      where: { id: importId, lockFence: fence, lockOwner: PROCESS_LOCK_OWNER, status: "PROCESSING" },
      data: { ...data, heartbeatAt: new Date() },
    });
    if (row.count !== 1) throw new HistoricImportFenced();
    await tx.$executeRaw`
      UPDATE "AutopartHistoryImportLock"
      SET "heartbeatAt" = NOW()
      WHERE "id" = 1
        AND "fence" = ${fence}
        AND "owner" = ${PROCESS_LOCK_OWNER}
        AND "importId" = ${importId}
    `;
  });
}

export async function heartbeatHistoricImport(
  importId: string,
  fence: bigint,
  db: PrismaClient = prisma,
): Promise<boolean> {
  try {
    await updateOwnedHistoricImport(importId, fence, {}, db);
    return true;
  } catch (error) {
    if (error instanceof HistoricImportFenced) return false;
    throw error;
  }
}

export async function withHistoricImportFence<T>(
  importId: string,
  fence: bigint,
  write: () => Promise<T>,
  db: PrismaClient = prisma,
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      if (!(await lockOwnedRow(tx, importId, fence))) throw new HistoricImportFenced();
      const beat = await tx.autopartHistoryAllImport.updateMany({
        where: { id: importId, lockFence: fence, lockOwner: PROCESS_LOCK_OWNER, status: "PROCESSING" },
        data: { heartbeatAt: new Date() },
      });
      if (beat.count !== 1) throw new HistoricImportFenced();
      await tx.$executeRaw`
        UPDATE "AutopartHistoryImportLock"
        SET "heartbeatAt" = NOW()
        WHERE "id" = 1 AND "fence" = ${fence}
      `;
      return write();
    },
    { timeout: 60_000 },
  );
}

export async function finishHistoricImport(
  importId: string,
  fence: bigint,
  data: Prisma.AutopartHistoryAllImportUpdateManyMutationInput,
  db: PrismaClient = prisma,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    if (!(await lockOwnedRow(tx, importId, fence))) return false;
    const row = await tx.autopartHistoryAllImport.updateMany({
      where: { id: importId, lockFence: fence, lockOwner: PROCESS_LOCK_OWNER, status: "PROCESSING" },
      data: { ...data, lockOwner: null, lockFence: null },
    });
    if (row.count !== 1) return false;
    const released = await tx.autopartHistoryImportLock.updateMany({
      where: { id: 1, fence, owner: PROCESS_LOCK_OWNER, importId },
      data: { owner: null, importId: null, heartbeatAt: null },
    });
    if (released.count !== 1) throw new HistoricImportFenced();
    return true;
  }, { timeout: 20_000 });
}

export async function readOwnedFence(importId: string, db: PrismaClient = prisma): Promise<bigint> {
  const row = await db.autopartHistoryAllImport.findUnique({
    where: { id: importId },
    select: { lockFence: true, lockOwner: true, status: true },
  });
  if (!row || row.status !== "PROCESSING" || row.lockOwner !== PROCESS_LOCK_OWNER || row.lockFence == null) {
    throw new HistoricImportFenced();
  }
  return row.lockFence;
}

const SIDE_WRITE_TIMEOUT_MS = 600_000;
const SIDE_WRITE_MAX_WAIT_MS = 70_000;

/**
 * Holds the singleton import row for the whole side write.
 * A fresh ALL-file import refuses the write. The row lock stops that import
 * from claiming or flushing sales rows until this transaction ends.
 */
export async function assertHistoricSideWriteAvailable(tx: Prisma.TransactionClient): Promise<void> {
  await ensureLockRow(tx);
  const lock = await readLock(tx);
  if (lockIsFresh(lock)) {
    throw new AuthError(
      "A historical ALL-file import is in progress. Promotion and retirement wait until it finishes.",
      "IMPORT_IN_PROGRESS",
      409,
    );
  }
}

export async function runHistoricSideWrite<T>(
  write: (tx: Prisma.TransactionClient) => Promise<T>,
  db: PrismaClient = prisma,
): Promise<T> {
  try {
    return await db.$transaction(
      async (tx) => {
        await assertHistoricSideWriteAvailable(tx);
        return write(tx);
      },
      { timeout: SIDE_WRITE_TIMEOUT_MS, maxWait: SIDE_WRITE_MAX_WAIT_MS },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
      throw new AuthError(
        "A historical ALL-file import is in progress. Promotion and retirement wait until it finishes.",
        "IMPORT_IN_PROGRESS",
        409,
      );
    }
    throw error;
  }
}
