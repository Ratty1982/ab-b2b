import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { planCustomerDataReset } from "@/server/maintenance/customer-data-reset";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("customer data reset dry-run", () => {
  it("counts preserved and historical rows without deleting them", async () => {
    const beforeAccounts = await prisma.autopartAccount.count();
    const beforeLines = await prisma.autopartSalesLine.count();
    const beforeOrders = await prisma.order.count();
    const plan = await planCustomerDataReset(prisma);
    const afterAccounts = await prisma.autopartAccount.count();
    const afterLines = await prisma.autopartSalesLine.count();
    const afterOrders = await prisma.order.count();

    expect(afterAccounts).toBe(beforeAccounts);
    expect(afterLines).toBe(beforeLines);
    expect(afterOrders).toBe(beforeOrders);
    expect(plan.mode).toBe("dry-run");
    expect(plan.counts.preserved.AutopartAccount).toBe(beforeAccounts);
    expect(plan.preserved.some((item) => item.name === "AutopartAccount")).toBe(true);
    expect(plan.notReset.some((item) => item.name.startsWith("Ongoing"))).toBe(true);
    expect(plan.checklist.length).toBeGreaterThan(5);
    expect(plan.orders.every((order) => typeof order.summary === "string")).toBe(true);
  });
});
