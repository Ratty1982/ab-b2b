/**
 * Backorders show the current Autopart product condition without changing 216V movement.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { skuMatchKey } from "@/domain/stock";
import { AUTOPART_216V_HEADER } from "@/domain/autopart-216v-fixture";
import { confirmAutopart216vImport } from "@/server/purchasing/backorder-import";
import { exportBackordersCsv, getBackorderLineDetail, getBackorderWorkspace } from "@/server/purchasing/backorders";
import { applyStockFeed } from "@/server/stock/service";
import { buildNative231Po3New } from "@/server/stock/fixtures/native-231po3new";

const prisma = new PrismaClient();
const stamp = Date.now();
const tag = stamp.toString(36).slice(-6).toUpperCase();

let adminId = "";
const account = `CNDA${tag}`;

const codes = [
  { sku: `BO${tag}S`, code: "S", label: "Superseded" },
  { sku: `BO${tag}N`, code: "N", label: "Not Yet Available" },
  { sku: `BO${tag}O`, code: "O", label: "Obsolete" },
  { sku: `BO${tag}W`, code: "W", label: "While Stocks Last" },
  { sku: `BO${tag}D`, code: "D", label: "Delete" },
  { sku: `BO${tag}M`, code: "M", label: "Made to Order" },
  { sku: `BO${tag}X`, code: "X", label: "Unknown (X)" },
  { sku: `BO${tag}Z`, code: null, label: null },
] as const;

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: email.split("@")[0]!, status: "ACTIVE", actorType: "INTERNAL", emailVerified: true },
    });
  }
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  return user.id;
}

function csv216v(qty = 4, name = "Condition Customer") {
  const body = codes
    .map((row, index) =>
      [`ORD${tag}`, account, name, "", row.sku, `Backorder ${row.sku}`, "", `REF-${index}`, String(qty), "2.00", "8.00"]
        .map((cell) => `"${cell}"`)
        .join(","),
    )
    .join("\n");
  return `${AUTOPART_216V_HEADER}\n${body}\n`;
}

async function applyConditions(nextCodeForO?: string) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      return await applyStockFeed({
        text: buildNative231Po3New(
          codes.map((row) => ({
            sku: row.sku,
            description: `PART ${row.sku}`,
            stk: "1.0000",
            avail: "0.0000",
            pick: "0.0000",
            physical: "1.0000",
            cost: "1.10",
            incoming: "0.0000",
            condition: row.sku.endsWith("O") && nextCodeForO !== undefined ? nextCodeForO : (row.code ?? ""),
          })),
        ),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
      });
    } catch (error) {
      if (!(error instanceof AuthError) || error.code !== "CONFLICT" || attempt === 14) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("stock sync lock was not released");
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`bo.cond.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  await applyConditions();
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("backorder condition enrichment", () => {
  it("shows each condition label, filters them, and exports the code without changing 216V movement", async () => {
    const first = await confirmAutopart216vImport(adminId, {
      text: csv216v(4),
      filename: `216V-cond-${tag}-1.csv`,
      source: "MANUAL",
    });
    const firstLines = (
      await prisma.autopartBackorderLine.findMany({ where: { snapshotId: first.id } })
    ).filter((line) => line.partNumber.startsWith(`BO${tag}`));
    expect(firstLines).toHaveLength(codes.length);
    expect(firstLines.every((line) => line.changeStatus === "NEW")).toBe(true);
    const identityBefore = new Map(firstLines.map((line) => [line.partMatchKey, line.identityKey]));

    const workspace = await getBackorderWorkspace(adminId, { pageSize: 50 });
    for (const expected of codes) {
      const line = workspace.lines.rows.find((row) => row.sku === expected.sku);
      expect(line?.conditionCode ?? null).toBe(expected.code);
      expect(line?.conditionLabel ?? null).toBe(expected.label);
      expect(line?.status).toBe("NEW");
    }

    const obsolete = await getBackorderWorkspace(adminId, { condition: "O", pageSize: 50 });
    expect(obsolete.lines.rows.map((row) => row.sku)).toEqual([`BO${tag}O`]);
    expect(obsolete.lines.rows[0]?.conditionLabel).toBe("Obsolete");

    const none = await getBackorderWorkspace(adminId, { condition: "NONE", pageSize: 50 });
    expect(none.lines.rows.map((row) => row.sku)).toEqual([`BO${tag}Z`]);
    expect(none.lines.rows[0]?.conditionLabel).toBeNull();

    const has = await getBackorderWorkspace(adminId, { condition: "HAS", pageSize: 50 });
    expect(has.lines.rows.map((row) => row.sku).sort()).toEqual(
      codes.filter((row) => row.code).map((row) => row.sku).sort(),
    );

    const superseded = await getBackorderWorkspace(adminId, { condition: "S", status: "NEW", pageSize: 50 });
    expect(superseded.lines.rows).toHaveLength(1);
    expect(superseded.lines.rows[0]?.conditionLabel).toBe("Superseded");
    expect(superseded.lines.rows[0]?.status).toBe("NEW");

    const detail = await getBackorderLineDetail(adminId, obsolete.lines.rows[0]!.id);
    expect(detail.line.conditionLabel).toBe("Obsolete");
    expect(detail.line.identityKey).toBe(identityBefore.get(skuMatchKey(`BO${tag}O`)));

    const csv = await exportBackordersCsv(adminId, { condition: "O" });
    expect(csv.csv.split("\n")[0]).toContain("Condition Code,Condition");
    expect(csv.csv).toContain("O,Obsolete");
    const blankCsv = await exportBackordersCsv(adminId, { condition: "NONE" });
    const blankRow = blankCsv.csv.split("\n")[1] ?? "";
    expect(blankRow.endsWith(",")).toBe(true);
    expect(blankRow).not.toContain("Obsolete");

    await applyConditions("S");
    const second = await confirmAutopart216vImport(adminId, {
      text: csv216v(4, "Condition Customer Again"),
      filename: `216V-cond-${tag}-2.csv`,
      source: "MANUAL",
    });
    const secondLines = (
      await prisma.autopartBackorderLine.findMany({ where: { snapshotId: second.id } })
    ).filter((line) => line.partNumber.startsWith(`BO${tag}`));
    expect(secondLines).toHaveLength(codes.length);
    expect(secondLines.every((line) => line.changeStatus === "UNCHANGED")).toBe(true);
    for (const line of secondLines) {
      expect(line.identityKey).toBe(identityBefore.get(line.partMatchKey));
    }
    const after = await getBackorderWorkspace(adminId, { q: `BO${tag}O`, pageSize: 20 });
    const changed = after.lines.rows.find((row) => row.sku === `BO${tag}O`);
    expect(changed?.conditionCode).toBe("S");
    expect(changed?.conditionLabel).toBe("Superseded");
    expect(changed?.status).toBe("UNCHANGED");

    const clearedFirst = csv216v(4);
    await confirmAutopart216vImport(adminId, {
      text: clearedFirst.replace(`"BO${tag}Z"`, `"BO${tag}Z"`).split("\n").filter((line) => !line.includes(`BO${tag}Z`)).join("\n"),
      filename: `216V-cond-${tag}-3.csv`,
      source: "MANUAL",
    });
    const cleared = await getBackorderWorkspace(adminId, { movement: "CLEARED", pageSize: 50 });
    const clearedRow = cleared.movement?.rows.find((row) => row.sku === `BO${tag}Z`);
    expect(clearedRow?.status).toBe("CLEARED");
    expect(clearedRow?.conditionCode).toBeNull();
    const clearedCsv = await exportBackordersCsv(adminId, { movement: "CLEARED" });
    expect(clearedCsv.csv.split("\n")[0]).toContain("Current Condition Code,Current Product Condition");
  });
});
