import { describe, expect, it } from "vitest";
import {
  BACKORDER_LINE_CSV_HEADERS,
  backorderLinesCsv,
  backorderMovementCsv,
  type BackorderLineCsvRow,
} from "@/server/purchasing/backorder-csv";

function line(overrides: Partial<BackorderLineCsvRow> = {}): BackorderLineCsvRow {
  return {
    statusLabel: "UNCHANGED",
    ageLabel: "Seen for 4 days",
    firstSeenAt: "2026-10-12T11:00:00.000Z",
    lastSeenAt: "2026-10-15T11:00:00.000Z",
    lastChangedAt: "2026-10-15T12:00:00.000Z",
    orderNumber: "SB100",
    customerName: "ABC Motor Factors",
    customerAccount: "ABC001",
    customerOrderRef: "PO-44120",
    description: "Ceramic disc, 310mm",
    productKindLabel: "Catalogue",
    sku: "AA3881",
    outstandingQty: 4,
    unitValue: "12.50",
    outstandingValue: "50.00",
    availQty: 8,
    incomingQty: 0,
    position: "STOCK_AVAILABLE",
    coverSummary: "8 available against 4 backordered (indicative — not a reservation)",
    companyName: "ABC Motor Factors Ltd",
    unmapped: false,
    brand: "Power Maxed",
    previousQty: 6,
    physicalQty: 10,
    stockFeedAt: "2026-10-15T17:00:00.000Z",
    conditionCode: null,
    conditionLabel: null,
    ...overrides,
  };
}

describe("backorder CSV", () => {
  it("exports every field shown on the lines, including text the table truncates", () => {
    const csv = backorderLinesCsv([line()]);
    const [header, row] = csv.split("\n");
    expect(header).toBe(BACKORDER_LINE_CSV_HEADERS.join(","));
    expect(header?.endsWith("Condition Code,Condition")).toBe(true);
    expect(row).toContain("Seen for 4 days");
    expect(row).toContain("12/10/2026");
    expect(row).toContain("SB100");
    expect(row).toContain("PO-44120");
    expect(row).toContain('"Ceramic disc, 310mm"');
    expect(row).toContain("AA3881");
    expect(row).toContain("STOCK AVAILABLE — REVIEW");
    expect(row).toContain("8 available against 4 backordered. Review allocation/despatch.");
    expect(row).toContain("ABC Motor Factors Ltd");
    expect(row).toContain("Power Maxed");
    expect(row).toContain("15/10/2026, 13:00:00 BST");
    expect(row?.endsWith(",")).toBe(true);
  });

  it("keeps a blank product condition as the last empty cells", () => {
    const blank = backorderLinesCsv([line({ conditionCode: null, conditionLabel: "Obsolete" })]);
    expect(blank.split("\n")[1]?.endsWith(",")).toBe(true);
    expect(blank.split("\n")[1]).not.toContain("Obsolete");

    const obsolete = backorderLinesCsv([
      line({ conditionCode: "O", conditionLabel: "Obsolete", description: "Washer" }),
    ]);
    expect(obsolete).toContain("O,Obsolete");
  });

  it("exports movement rows with the same on-screen fields", () => {
    const csv = backorderMovementCsv("NEW", [
      {
        statusLabel: "NEW",
        orderNumber: "SB200",
        customerName: "Seaforth",
        customerAccount: "SEA022",
        customerOrderRef: "REF,1",
        description: "Head gasket sealer",
        productKindLabel: "External product",
        sku: "SS-2287",
        previousQty: null,
        currentQty: 2,
        changeQty: 2,
        unitValue: "11.40",
        previousValue: null,
        currentValue: "22.80",
        ageLabel: "Seen for 1 day",
        firstSeenAt: "2026-10-15T12:00:00.000Z",
        lastChangedAt: "2026-10-15T12:00:00.000Z",
        clearedAt: null,
        availQty: 0,
        incomingQty: 0,
        position: "NO_STOCK_NO_INCOMING",
        coverSummary: "No sellable stock and no incoming quantity",
        companyName: null,
        unmapped: true,
        brand: null,
        conditionCode: "S",
        conditionLabel: "Superseded",
      },
    ]);
    expect(csv.split("\n")[0]).toContain("Age,First Seen,Last Changed");
    expect(csv).toContain("Seen for 1 day");
    expect(csv).toContain('"REF,1"');
    expect(csv).toContain("2 units currently backordered.");
    expect(csv).toContain("Unmapped");
    expect(csv.endsWith("S,Superseded")).toBe(true);
  });
});
