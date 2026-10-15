/**
 * Concurrent historical-import lock. Two Prisma clients are two database connections.
 * A child process is a second application process. Requires TEST_DATABASE_URL.
 */
import "@/server/testing/use-protect-integration-database";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  claimHistoricImport,
  finishHistoricImport,
  heartbeatHistoricImport,
  recoverAbandonedHistoricImports,
  releaseHistoricImportProcess,
  reserveHistoricImportProcess,
} from "@/server/companies/historic-import-lock";

const left = new PrismaClient();
const right = new PrismaClient();
const createdUserIds: string[] = [];
let adminId = "";

async function makeImport(db: PrismaClient, status: "PREVIEWED" | "PROCESSING" = "PREVIEWED") {
  return db.autopartHistoryAllImport.create({
    data: { status, fileHash561l: randomUUID(), createdById: adminId },
  });
}

async function releaseGlobalLock() {
  await left.$executeRaw`
    UPDATE "AutopartHistoryImportLock"
    SET "fence" = "fence" + 1,
        "owner" = NULL,
        "importId" = NULL,
        "heartbeatAt" = NULL
    WHERE "id" = 1
  `;
  await left.autopartHistoryAllImport.updateMany({
    where: { createdById: adminId, status: "PROCESSING" },
    data: { status: "FAILED", lockOwner: null, lockFence: null },
  });
}

function claimInOtherProcess(importId: string): Promise<{ status: string; fence: string | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["src/server/companies/historic-import-lock-worker.ts", importId], {
      cwd: "/workspace",
      env: process.env,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err || out || `lock worker exited ${code}`));
        return;
      }
      const line = out.trim().split("\n").filter(Boolean).at(-1);
      if (!line) {
        reject(new Error("lock worker produced no result"));
        return;
      }
      resolve(JSON.parse(line) as { status: string; fence: string | null });
    });
  });
}

beforeAll(async () => {
  await bootstrapRbac(left);
  const user = await left.user.create({
    data: {
      email: `hist-lock.${Date.now()}@example.invalid`,
      name: "Historic lock",
      status: "ACTIVE",
      actorType: "INTERNAL",
      emailVerified: true,
    },
  });
  createdUserIds.push(user.id);
  adminId = user.id;
});

afterEach(async () => {
  await releaseGlobalLock();
});

afterAll(async () => {
  try {
    await left.autopartHistoryAllImport.deleteMany({ where: { createdById: { in: createdUserIds } } });
    await left.user.deleteMany({ where: { id: { in: createdUserIds } } });
  } finally {
    await left.$disconnect();
    await right.$disconnect();
  }
});

describe("historical import lock", () => {
  it("rejects a second start of the same import in this process", () => {
    const importId = "process-lock-same";
    reserveHistoricImportProcess(importId);
    try {
      expect(() => reserveHistoricImportProcess(importId)).toThrow(AuthError);
      expect(() => reserveHistoricImportProcess("process-lock-other")).toThrow(AuthError);
    } finally {
      releaseHistoricImportProcess(importId);
    }
    reserveHistoricImportProcess(importId);
    releaseHistoricImportProcess(importId);
  });

  it("lets only one of two simultaneous different imports claim the lock", async () => {
    const first = await makeImport(left);
    const second = await makeImport(right);
    const [claimedA, claimedB] = await Promise.all([
      claimHistoricImport(first.id, left),
      claimHistoricImport(second.id, right),
    ]);
    const results = [claimedA, claimedB];
    expect(results.filter((result) => result.status === "claimed")).toHaveLength(1);
    expect(results.filter((result) => result.status === "busy")).toHaveLength(1);
    const winner = results.find((result) => result.status === "claimed");
    const loserId = winner === claimedA ? second.id : first.id;
    expect((await right.autopartHistoryAllImport.findUniqueOrThrow({ where: { id: loserId } })).status).not.toBe(
      "COMMITTED",
    );
  });

  it("lets only one of two simultaneous requests claim the same import", async () => {
    const row = await makeImport(left);
    const [claimedA, claimedB] = await Promise.all([
      claimHistoricImport(row.id, left),
      claimHistoricImport(row.id, right),
    ]);
    expect([claimedA, claimedB].filter((result) => result.status === "claimed")).toHaveLength(1);
    expect([claimedA, claimedB].filter((result) => result.status === "busy")).toHaveLength(1);
    expect((await left.autopartHistoryAllImport.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PROCESSING");
  });

  it("refuses the lock to a separate application process", async () => {
    const held = await makeImport(left);
    const other = await makeImport(left);
    const claim = await claimHistoricImport(held.id, left);
    expect(claim.status).toBe("claimed");
    const external = await claimInOtherProcess(other.id);
    expect(external.status).toBe("busy");
    expect((await left.autopartHistoryAllImport.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("PREVIEWED");
  });

  it("recovers a crashed owner and stops the old fence finishing the replacement", async () => {
    const abandoned = await makeImport(left, "PROCESSING");
    const replacement = await makeImport(left);
    const deadOwner = `${os.hostname()}:2147483646:${randomUUID()}`;
    await left.autopartHistoryImportLock.update({
      where: { id: 1 },
      data: { owner: deadOwner, importId: abandoned.id, heartbeatAt: new Date(), fence: { increment: 1 } },
    });
    const lock = await left.autopartHistoryImportLock.findUniqueOrThrow({ where: { id: 1 } });
    await left.autopartHistoryAllImport.update({
      where: { id: abandoned.id },
      data: { lockOwner: deadOwner, lockFence: lock.fence, heartbeatAt: new Date() },
    });
    expect(await recoverAbandonedHistoricImports(right)).toBeGreaterThan(0);
    expect((await left.autopartHistoryAllImport.findUniqueOrThrow({ where: { id: abandoned.id } })).status).toBe("FAILED");
    const next = await claimHistoricImport(replacement.id, right);
    expect(next.status).toBe("claimed");
    if (next.status !== "claimed") return;
    expect(await finishHistoricImport(abandoned.id, lock.fence, { status: "COMMITTED" }, left)).toBe(false);
    expect(await finishHistoricImport(replacement.id, lock.fence, { status: "COMMITTED" }, left)).toBe(false);
    const replaced = await right.autopartHistoryAllImport.findUniqueOrThrow({ where: { id: replacement.id } });
    expect(replaced.status).toBe("PROCESSING");
    expect(replaced.lockFence).toBe(next.fence);
  });

  it("fences a worker whose heartbeat expired while that worker is still alive", async () => {
    const original = await makeImport(left);
    const replacement = await makeImport(right);
    const first = await claimHistoricImport(original.id, left);
    expect(first.status).toBe("claimed");
    if (first.status !== "claimed") return;
    await left.autopartHistoryImportLock.update({
      where: { id: 1 },
      data: { heartbeatAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    await left.autopartHistoryAllImport.update({
      where: { id: original.id },
      data: { heartbeatAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    const second = await claimHistoricImport(replacement.id, right);
    expect(second.status).toBe("claimed");
    if (second.status !== "claimed") return;
    expect(second.fence).not.toBe(first.fence);
    expect(await heartbeatHistoricImport(original.id, first.fence, left)).toBe(false);
    expect(await finishHistoricImport(original.id, first.fence, { status: "COMMITTED" }, left)).toBe(false);
    expect(await finishHistoricImport(replacement.id, first.fence, { status: "COMMITTED" }, left)).toBe(false);
    const replaced = await right.autopartHistoryAllImport.findUniqueOrThrow({ where: { id: replacement.id } });
    expect(replaced.status).toBe("PROCESSING");
    expect(replaced.lockFence).toBe(second.fence);
    expect((await left.autopartHistoryAllImport.findUniqueOrThrow({ where: { id: original.id } })).status).not.toBe(
      "COMMITTED",
    );
  });
});
