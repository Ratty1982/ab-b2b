import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAutopart407p100 } from "@/domain/autopart-407p100";

const csv = readFileSync(
  resolve(import.meta.dirname, "fixtures/autopart-407p100-sample.csv"),
  "utf8",
);
const kv = readFileSync(
  resolve(import.meta.dirname, "fixtures/autopart-407p100-kv.txt"),
  "utf8",
);
const bulkCsv = readFileSync(
  resolve(import.meta.dirname, "fixtures/autopart-407p100-bulk-sample.csv"),
  "utf8",
);

describe("parseAutopart407p100", () => {
  it("parses CSV regression example", () => {
    const result = parseAutopart407p100(csv);
    expect(result.headerFound).toBe(true);
    expect(result.positions).toHaveLength(1);
    const p = result.positions[0]!;
    expect(p.accountCode).toBe("YORKMOT");
    expect(p.invoices).toBe("3494.75");
    expect(p.totalExposure).toBe("3494.75");
    expect(p.creditLimit).toBe("5000.00");
    expect(p.availableCreditRaw).toBe("1505.25");
    expect(p.availableCreditDisplay).toBe("1505.25");
    expect(p.overLimitBy).toBeNull();
  });

  it("parses real multi-row Customer / Cr Limit headers (YORKMOTO)", () => {
    const result = parseAutopart407p100(bulkCsv);
    expect(result.headerFound).toBe(true);
    const york = result.positions.find((p) => p.accountCode === "YORKMOTO")!;
    expect(york.customerName).toBe("YORK MOTOR FACTORS");
    expect(york.invoices).toBe("3494.75");
    expect(york.totalExposure).toBe("3494.75");
    expect(york.creditLimit).toBe("5000.00");
    expect(york.availableCreditRaw).toBe("1505.25");
    expect(result.invalidRows.length).toBeGreaterThanOrEqual(1);
  });

  it("uses Total as Used Credit when Picking is non-zero", () => {
    const text = `Customer,Invoices,Picking,DropShip,CrossDock,Suspends,UnConsol,Total,Cr Limit
PICKING1,3000.00,500.00,0,0,0,0,3500.00,5000.00
`;
    const p = parseAutopart407p100(text).positions[0]!;
    expect(p.invoices).toBe("3000.00");
    expect(p.picking).toBe("500.00");
    expect(p.totalExposure).toBe("3500.00");
    expect(p.availableCreditRaw).toBe("1500.00");
  });

  it("parses key/value summary format", () => {
    const result = parseAutopart407p100(kv);
    expect(result.positions[0]?.availableCreditRaw).toBe("1505.25");
  });

  it("handles over-limit exposure", () => {
    const text = `Account,Invoices,Picking,DropShip,CrossDock,Suspends,UnConsol,Total,Credit Limit
YORKMOT,£5400.00,£0,£0,£0,£0,£0,£5400.00,£5000.00
`;
    const p = parseAutopart407p100(text).positions[0]!;
    expect(p.availableCreditRaw).toBe("-400.00");
    expect(p.availableCreditDisplay).toBe("0.00");
    expect(p.overLimitBy).toBe("400.00");
  });

  it("handles reduced exposure update simulation", () => {
    const text = `Account,Invoices,Picking,DropShip,CrossDock,Suspends,UnConsol,Total,Credit Limit
YORKMOT,£2494.75,£0,£0,£0,£0,£0,£2494.75,£5000.00
`;
    expect(parseAutopart407p100(text).positions[0]?.availableCreditRaw).toBe("2505.25");
  });
});
