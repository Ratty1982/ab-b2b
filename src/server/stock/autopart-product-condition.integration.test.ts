/**
 * 231PO3NEW C column is current product master data on AutopartProduct.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import { saveProduct } from "@/server/catalogue/service";
import { getPublicProduct, listPublicProducts } from "@/server/catalogue/products";
import { applyStockFeed } from "@/server/stock/service";
import { buildNative231Po3New, type Native231Po3NewRow } from "@/server/stock/fixtures/native-231po3new";
import { skuMatchKey } from "@/domain/stock";
import { loadIntelligenceByMatchKeys } from "@/server/stock/autopart-products";

const prisma = new PrismaClient();
const stamp = Date.now();
const tag = stamp.toString(36).slice(-6).toUpperCase();

let adminId = "";
const catalogueSku = `CND${tag}`;

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

function feedRow(sku: string, condition: string | undefined, avail = "4.0000", incoming = "8.0000"): Native231Po3NewRow {
  return {
    sku,
    description: `PART ${sku}`,
    stk: "5.0000",
    avail,
    pick: "0.0000",
    physical: "5.0000",
    cost: "3.25",
    incoming,
    ...(condition !== undefined ? { condition } : {}),
  };
}

async function apply(rows: Native231Po3NewRow[]) {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      return await applyStockFeed({
        text: buildNative231Po3New(rows),
        dryRun: false,
        trigger: "manual",
        actorUserId: adminId,
      });
    } catch (error) {
      if (!(error instanceof AuthError) || error.code !== "CONFLICT" || attempt === 14) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("stock sync lock was not released");
}

async function product(sku: string) {
  return prisma.autopartProduct.findUniqueOrThrow({ where: { matchKey: skuMatchKey(sku) } });
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`cond.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  await saveProduct(adminId, {
    sku: catalogueSku,
    name: "Condition Catalogue Item",
    brand: "Power Maxed",
    category: "Cleaning",
    trade: 4,
    rrp: 8,
    packQty: 1,
    caseQty: 1,
  });
  await prisma.product.updateMany({
    where: { variants: { some: { sku: catalogueSku } } },
    data: { status: "ACTIVE", isActive: true, isTradeVisible: true },
  });
}, 60_000);

afterAll(async () => {
  await prisma.$disconnect();
});

describe("231PO3NEW condition import", () => {
  it("replaces the current condition, including clearing a stale code when C is blank", async () => {
    const sku = `CNDA${tag}`;
    const blankFirst = await apply([feedRow(sku, undefined)]);
    expect(blankFirst.status).toBe("SUCCESS");
    expect((await product(sku)).conditionCode).toBeNull();

    const toObsolete = await apply([feedRow(sku, "O", "6.0000", "10.0000")]);
    expect(toObsolete.status).toBe("SUCCESS");
    let row = await product(sku);
    expect(row.conditionCode).toBe("O");
    expect(row.availQty).toBe(6);
    expect(row.incomingQty).toBe(10);
    expect(String(row.latestCost)).toBe("3.25");

    const cleared = await apply([feedRow(sku, "", "6.0000", "10.0000")]);
    expect(cleared.status).toBe("SUCCESS");
    row = await product(sku);
    expect(row.conditionCode).toBeNull();
    expect(row.availQty).toBe(6);
    expect(row.incomingQty).toBe(10);

    const toWhile = await apply([feedRow(sku, "W")]);
    expect((await product(sku)).conditionCode).toBe("W");
    const toSuperseded = await apply([feedRow(sku, "S")]);
    expect(toSuperseded.status).toBe("SUCCESS");
    expect((await product(sku)).conditionCode).toBe("S");

    const stillBlank = await apply([feedRow(`${sku}B`, "")]);
    expect(stillBlank.status).toBe("SUCCESS");
    expect((await product(`${sku}B`)).conditionCode).toBeNull();
  });

  it("stores an unknown code, warns, and still imports Avail and P/Ord Qty", async () => {
    const sku = `CNDX${tag}`;
    const result = await apply([feedRow(sku, "X", "3.0000", "7.0000")]);
    expect(result.status).not.toBe("FAILED");
    expect(result.status).toBe("PARTIAL");
    const row = await product(sku);
    expect(row.conditionCode).toBe("X");
    expect(row.availQty).toBe(3);
    expect(row.incomingQty).toBe(7);
    const issues = await prisma.stockSyncIssue.findMany({ where: { runId: result.runId } });
    const warning = issues.find((issue) => issue.message.includes(`"${sku}"`) || issue.sku === sku);
    expect(warning?.severity).toBe("WARNING");
    expect(warning?.message).toContain("X");
    expect(warning?.message).toContain(sku);
    expect(issues.some((issue) => issue.severity === "FATAL" || issue.kind === "PARSE")).toBe(false);
  });

  it("leaves duplicate SKU conflicts unchanged, including the previous condition", async () => {
    const sku = `CNDD${tag}`;
    await apply([feedRow(sku, "O", "9.0000", "2.0000")]);
    const before = await product(sku);
    const dup = await apply([
      feedRow(sku, "S", "1.0000", "4.0000"),
      feedRow(sku, "D", "2.0000", "5.0000"),
    ]);
    expect(dup.duplicates).toBe(2);
    expect(dup.status).toBe("SUCCESS");
    const after = await product(sku);
    expect(after.conditionCode).toBe("O");
    expect(after.availQty).toBe(before.availQty);
    expect(after.incomingQty).toBe(before.incomingQty);
  });

  it("exposes condition on internal intelligence and hides it from the public catalogue", async () => {
    const result = await apply([feedRow(catalogueSku, "O", "11.0000", "0.0000")]);
    expect(result.status).toBe("SUCCESS");
    const intel = await loadIntelligenceByMatchKeys([catalogueSku]);
    expect(intel.get(catalogueSku)?.conditionCode).toBe("O");
    expect(intel.get(catalogueSku)?.conditionLabel).toBe("Obsolete");

    const pub = await getPublicProduct(null, catalogueSku);
    expect(pub).toBeTruthy();
    expect(hasKey(pub, "conditionCode")).toBe(false);
    expect(hasKey(pub, "conditionLabel")).toBe(false);
    const listed = await listPublicProducts({ userId: null, q: catalogueSku, page: 1 });
    expect(hasKey(listed, "conditionCode")).toBe(false);
    expect(hasKey(listed, "conditionLabel")).toBe(false);
  });
});

function hasKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasKey(item, key));
  return Object.entries(value).some(([name, item]) => name === key || hasKey(item, key));
}
