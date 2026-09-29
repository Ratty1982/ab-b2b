import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseAutopart407p100,
  selectCompanyRowFrom407p100,
} from "@/domain/autopart-407p100";

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
const multiCsv = readFileSync(
  resolve(import.meta.dirname, "fixtures/autopart-407p100-multi-customer.csv"),
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

  it("parses multi-customer report and keeps all valid rows", () => {
    const result = parseAutopart407p100(multiCsv);
    expect(result.headerFound).toBe(true);
    expect(result.diagnostics.validRows).toBe(4);
    expect(result.diagnostics.invalidRows).toBe(1);
    expect(result.detectedAccounts).toEqual([
      "OTHER001",
      "OTHER002",
      "OTHER003",
      "YORKMOTO",
    ]);
    const york = result.positions.find((p) => p.accountCode === "YORKMOTO")!;
    expect(york.customerName).toBe("YORK MOTOR FACTORS");
    expect(york.totalExposure).toBe("3494.75");
    expect(york.creditLimit).toBe("5000.00");
    expect(york.availableCreditRaw).toBe("1505.25");
  });
});

describe("selectCompanyRowFrom407p100", () => {
  const multi = parseAutopart407p100(multiCsv);

  it("matches exact verified account and ignores unrelated customers", () => {
    const sel = selectCompanyRowFrom407p100({
      positions: multi.positions,
      verifiedAccount: "YORKMOTO",
      acceptedAccounts: new Set(["YORKMOTO"]),
    });
    expect(sel.status).toBe("MATCHED");
    if (sel.status !== "MATCHED") return;
    expect(sel.matchedVia).toBe("VERIFIED");
    expect(sel.position.accountCode).toBe("YORKMOTO");
    expect(sel.position.totalExposure).toBe("3494.75");
    expect(sel.position.creditLimit).toBe("5000.00");
    expect(sel.position.availableCreditRaw).toBe("1505.25");
    expect(sel.identicalDuplicatesDiscarded).toBe(0);
  });

  it("returns NOT_FOUND when verified account is absent", () => {
    const text = `Customer,customer name,Invoices,Picking,DropShip,CrossDock,Suspends,UnConsol,Total,Cr Limit
OTHER001,OTHER ONE LTD,100.00,0,0,0,0,0,100.00,1000.00
OTHER002,OTHER TWO LTD,200.00,0,0,0,0,0,200.00,2000.00
`;
    const parsed = parseAutopart407p100(text);
    const sel = selectCompanyRowFrom407p100({
      positions: parsed.positions,
      verifiedAccount: "YORKMOTO",
      acceptedAccounts: new Set(["YORKMOTO"]),
    });
    expect(sel.status).toBe("NOT_FOUND");
  });

  it("matches explicit verified alias only (no truncation)", () => {
    const text = `Customer,customer name,Invoices,Picking,DropShip,CrossDock,Suspends,UnConsol,Total,Cr Limit
YORKOLD,YORK MOTOR FACTORS OLD,3494.75,0,0,0,0,0,3494.75,5000.00
OTHER001,OTHER ONE LTD,100.00,0,0,0,0,0,100.00,1000.00
`;
    const parsed = parseAutopart407p100(text);
    const sel = selectCompanyRowFrom407p100({
      positions: parsed.positions,
      verifiedAccount: "YORKMOTO",
      acceptedAccounts: new Set(["YORKMOTO", "YORKOLD"]),
    });
    expect(sel.status).toBe("MATCHED");
    if (sel.status !== "MATCHED") return;
    expect(sel.matchedVia).toBe("ALIAS");
    expect(sel.matchedAccount).toBe("YORKOLD");
    expect(sel.position.availableCreditRaw).toBe("1505.25");

    // Truncated YORKMOT must not match YORKMOTO without alias
    const truncated = parseAutopart407p100(`Customer,Invoices,Total,Cr Limit
YORKMOT,3494.75,3494.75,5000.00
`);
    const noTrunc = selectCompanyRowFrom407p100({
      positions: truncated.positions,
      verifiedAccount: "YORKMOTO",
      acceptedAccounts: new Set(["YORKMOTO"]),
    });
    expect(noTrunc.status).toBe("NOT_FOUND");
  });

  it("dedupes identical duplicate target rows", () => {
    const text = `Customer,customer name,Invoices,Picking,DropShip,CrossDock,Suspends,UnConsol,Total,Cr Limit
YORKMOTO,YORK MOTOR FACTORS,3494.75,0,0,0,0,0,3494.75,5000.00
OTHER001,OTHER ONE LTD,100.00,0,0,0,0,0,100.00,1000.00
YORKMOTO,YORK MOTOR FACTORS,3494.75,0,0,0,0,0,3494.75,5000.00
`;
    const parsed = parseAutopart407p100(text);
    expect(parsed.diagnostics.duplicateAccountCodes).toContain("YORKMOTO");
    const sel = selectCompanyRowFrom407p100({
      positions: parsed.positions,
      verifiedAccount: "YORKMOTO",
      acceptedAccounts: new Set(["YORKMOTO"]),
    });
    expect(sel.status).toBe("MATCHED");
    if (sel.status !== "MATCHED") return;
    expect(sel.identicalDuplicatesDiscarded).toBe(1);
    expect(sel.position.totalExposure).toBe("3494.75");
  });

  it("blocks conflicting duplicate target rows without summing", () => {
    const text = `Customer,customer name,Invoices,Picking,DropShip,CrossDock,Suspends,UnConsol,Total,Cr Limit
YORKMOTO,YORK MOTOR FACTORS,3494.75,0,0,0,0,0,3494.75,5000.00
YORKMOTO,YORK MOTOR FACTORS,4000.00,0,0,0,0,0,4000.00,5000.00
`;
    const parsed = parseAutopart407p100(text);
    const sel = selectCompanyRowFrom407p100({
      positions: parsed.positions,
      verifiedAccount: "YORKMOTO",
      acceptedAccounts: new Set(["YORKMOTO"]),
    });
    expect(sel.status).toBe("CONFLICTING_DUPLICATES");
    if (sel.status !== "CONFLICTING_DUPLICATES") return;
    expect(sel.positions).toHaveLength(2);
    const totals = sel.positions.map((p) => p.totalExposure).sort();
    expect(totals).toEqual(["3494.75", "4000.00"]);
  });
});
