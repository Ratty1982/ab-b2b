import { describe, expect, it } from "vitest";
import {
  auditAutopart561lCollisions,
  simulateCorrectedImporter,
  simulateOldLastWinsImporter,
  type CollisionAuditLine,
} from "@/domain/autopart-561l-collision-audit";

function line(
  partial: Partial<CollisionAuditLine> &
    Pick<CollisionAuditLine, "documentReference" | "sku" | "units" | "sales">,
): CollisionAuditLine {
  return {
    documentType: partial.documentType ?? "INVOICE",
    documentReference: partial.documentReference,
    sourceLineNumber: partial.sourceLineNumber ?? 1,
    sku: partial.sku,
    units: partial.units,
    sales: partial.sales,
    rawInvAndLn: partial.rawInvAndLn ?? `I/${partial.documentReference}/1`,
  };
}

describe("561L collision audit simulations", () => {
  it("old last-wins drops earlier SKU when /1 is reused; corrected keeps both", () => {
    const rows = [
      line({ documentReference: "SS263805", sku: "SSAMZ", units: 70, sales: 2419.67 }),
      line({ documentReference: "SS263805", sku: "TFR5000", units: 45, sales: 674.63 }),
    ];
    const old = simulateOldLastWinsImporter(rows);
    expect(old.surviving).toHaveLength(1);
    expect(old.surviving[0]!.sku).toBe("TFR5000");
    expect(old.lostUnits).toBeCloseTo(70, 3);
    expect(old.lostSales).toBeCloseTo(2419.67, 2);

    const fixed = simulateCorrectedImporter(rows);
    expect(fixed.surviving).toHaveLength(2);
    expect(fixed.lost).toHaveLength(0);
    expect(fixed.survivingUnits).toBeCloseTo(115, 3);
    expect(fixed.survivingSales).toBeCloseTo(3094.3, 2);
  });

  it("leaves distinct /1 and /2 unchanged", () => {
    const rows = [
      line({
        documentReference: "SS100",
        sourceLineNumber: 1,
        sku: "AAA",
        units: 1,
        sales: 10,
        rawInvAndLn: "I/SS100/1",
      }),
      line({
        documentReference: "SS100",
        sourceLineNumber: 2,
        sku: "BBB",
        units: 2,
        sales: 20,
        rawInvAndLn: "I/SS100/2",
      }),
    ];
    const old = simulateOldLastWinsImporter(rows);
    const fixed = simulateCorrectedImporter(rows);
    expect(old.surviving).toHaveLength(2);
    expect(fixed.surviving).toHaveLength(2);
    expect(old.lost).toHaveLength(0);
    expect(fixed.lost).toHaveLength(0);
  });

  it("assigns unique numbers for blank OIN lines and keeps both SKUs", () => {
    const rows = [
      line({
        documentReference: "OIN1",
        sourceLineNumber: null,
        sku: "AAA",
        units: 1,
        sales: 10,
        rawInvAndLn: "I/OIN1/",
      }),
      line({
        documentReference: "OIN1",
        sourceLineNumber: null,
        sku: "BBB",
        units: 2,
        sales: 20,
        rawInvAndLn: "I/OIN1/",
      }),
    ];
    const fixed = simulateCorrectedImporter(rows);
    expect(fixed.surviving).toHaveLength(2);
    expect(fixed.lost).toHaveLength(0);
  });

  it("keeps credit collisions signed and independent of invoices", () => {
    const rows = [
      line({
        documentType: "CREDIT",
        documentReference: "OC99",
        sku: "SSAMZ",
        units: -1,
        sales: -31.24,
        rawInvAndLn: "C/OC99/1",
      }),
      line({
        documentType: "CREDIT",
        documentReference: "OC99",
        sku: "TFR5000",
        units: -1,
        sales: -14.99,
        rawInvAndLn: "C/OC99/1",
      }),
    ];
    const old = simulateOldLastWinsImporter(rows);
    const fixed = simulateCorrectedImporter(rows);
    expect(old.surviving).toHaveLength(1);
    expect(fixed.surviving).toHaveLength(2);
    expect(fixed.surviving.every((r) => r.units < 0 && r.sales < 0)).toBe(true);
  });
});

describe("auditAutopart561lCollisions", () => {
  it("flags RETAILA-style multi-SKU /1 collisions as REIMPORT_REQUIRED", () => {
    const text = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
RETAILA,I/SS263805/1,SSAMZ,Steel Seal,70,2419.67
RETAILA,I/SS263805/1,TFR5000,TFR,45,674.63
RETAILA,I/SS100/1,AAA,A,1,10.00
RETAILA,I/SS100/2,BBB,B,2,20.00
`;
    const audit = auditAutopart561lCollisions(text, { account: "RETAILA" });
    expect(audit.multiSkuGroups).toBe(1);
    expect(audit.action).toBe("REIMPORT_REQUIRED");
    expect(audit.oldImporter.lostUnits).toBeCloseTo(70, 3);
    expect(audit.differenceUnits).toBeCloseTo(70, 3);
    expect(audit.correctedImporter.surviving).toHaveLength(4);
  });

  it("reports NO_ACTION when there are no legitimate collisions", () => {
    const text = `Acct.,Inv & Ln,Part Number,Description,Units,Sales
RETAIL,I/SS1/1,AAA,A,1,10.00
RETAIL,I/SS1/2,BBB,B,2,20.00
RETAIL,I/OIN1/,CCC,C,1,5.00
`;
    const audit = auditAutopart561lCollisions(text, { account: "RETAIL" });
    expect(audit.multiSkuGroups).toBe(0);
    expect(audit.action).toBe("NO_ACTION");
    expect(audit.differenceUnits).toBe(0);
    expect(audit.differenceSales).toBe(0);
  });
});
