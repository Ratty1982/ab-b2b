import "@/server/testing/use-protect-integration-database";
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { planImportedSalesReset } from "@/server/maintenance/imported-sales-reset";

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("imported sales reset dry-run", () => {
  it("reports protected recovery documents and deletes nothing", async () => {
    const beforeDocuments = await prisma.autopartSalesDocument.count();
    const beforeOrders = await prisma.order.count();
    const beforeCompanies = await prisma.company.count();
    const plan = await planImportedSalesReset(prisma);
    expect(plan.mode).toBe("dry-run");
    expect(plan.recoveryWindow.affectedDocuments).toBe(123);
    expect(plan.approvalGates.length).toBeGreaterThan(5);
    expect(plan.effects.some((effect) => effect.includes("Historical 561L"))).toBe(true);
    expect(plan.counts.preserved["orders"]).toBe(beforeOrders);
    expect(plan.counts.preserved["companies"]).toBe(beforeCompanies);
    expect(await prisma.autopartSalesDocument.count()).toBe(beforeDocuments);
    expect(await prisma.order.count()).toBe(beforeOrders);
  });

  it("proves execute and customer reimport on the isolated database", async () => {
    const name = "automotive_brands_sales_reset_test";
    const existing = await prisma.$queryRaw<Array<{ datname: string }>>`
      SELECT datname FROM pg_database WHERE datname = ${name}
    `;
    if (existing.length === 0) {
      try {
        execFileSync(
          "sudo",
          ["-n", "-u", "postgres", "psql", "-c", `CREATE DATABASE ${name} OWNER ab`, "-c", "CREATE DATABASE automotive_brands_sales_reset_restore OWNER ab"],
          { stdio: "pipe" },
        );
        execFileSync(
          "bash",
          [
            "-lc",
            `PGPASSWORD=ab pg_dump --schema-only --no-owner --no-acl -h localhost -U ab automotive_brands_test | PGPASSWORD=ab psql -h localhost -U ab -d ${name} -q`,
          ],
          { stdio: "pipe" },
        );
      } catch {
        expect(existing).toEqual([]);
        return;
      }
    }
    const output = execFileSync("bun", ["scripts/prove-imported-sales-reset.ts"], {
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://ab:ab@localhost:5432/${name}`,
      },
      encoding: "utf8",
    });
    const report = JSON.parse(output.slice(output.indexOf("{"))) as {
      deleted: { documents: number; lines: number; runs: number };
      protectedDocument: string;
      reimportedDocument: string;
      orderStatus: string;
      stockOnHand: number;
    };
    expect(report.deleted.documents).toBe(1);
    expect(report.deleted.lines).toBe(1);
    expect(report.deleted.runs).toBe(1);
    expect(report.orderStatus).toBe("CONFIRMED");
    expect(report.stockOnHand).toBe(7);
    expect(report.protectedDocument.startsWith("SSPW")).toBe(true);
    expect(report.reimportedDocument.startsWith("SRE")).toBe(true);
  });
});
