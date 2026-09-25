import { describe, expect, it } from "vitest";
import {
  AUTOPART_EXPORT_SOURCE,
  AUTOPART_ORDER_CSV_HEADERS,
  apportionCentsByWeights,
  buildAutopartCsvRowsForOrder,
  buildAutopartExportFilename,
  buildAutopartOrdersCsv,
  buildOrderLineApportionment,
  csvEscapeAutopartField,
  csvEscapeExcelSafePhone,
  csvEscapeFormulaSafe,
  formatAutopartExportOrderDate,
  serializeAutopartOrderCsv,
  sumMoneyStrings,
  type AutopartExportOrderInput,
} from "@/domain/autopart-order-export";

function sampleOrder(overrides: Partial<AutopartExportOrderInput> = {}): AutopartExportOrderInput {
  return {
    orderNumber: "AB-000002",
    orderDate: new Date("2026-09-25T15:00:00.000Z"),
    companyName: "Example Motor Factors Ltd",
    deliveryAddress: {
      line1: "12 High Street",
      line2: "Unit B",
      town: "Leeds",
      county: "West Yorkshire",
      postcode: "LS1 1AA",
      country: "GB",
      contactName: "Alex Buyer",
    },
    contact: {
      name: "Alex Buyer",
      email: "buyer@example.test",
      phone: "07700900123",
    },
    autopartCustomerCodeSnapshot: "TEST-MAM-CODE",
    subtotal: "44.28",
    deliveryTotal: "5.95",
    vatTotal: "10.05",
    grandTotal: "60.28",
    items: [
      {
        sku: "PMML500SC40",
        qty: 12,
        lineTotal: "44.28",
        customerUnitPrice: "3.69",
      },
    ],
    ...overrides,
  };
}

describe("autopart order CSV contract", () => {
  it("matches AlphaOps header names and order", () => {
    expect([...AUTOPART_ORDER_CSV_HEADERS]).toEqual([
      "External Reference",
      "Order Date",
      "Shipping Name",
      "Shipping Address 1",
      "Shipping Address 2",
      "Shipping City",
      "Shipping County",
      "Shipping Postcode",
      "Shipping Country",
      "Email",
      "Phone",
      "Supplier SKU",
      "Quantity",
      "Sub Total",
      "Shipping",
      "VAT",
      "Total",
      "Price",
      "Source",
      "Payment Amount 1",
      "MAM Account",
    ]);
  });

  it("exports AB-000002 acceptance case with exact reconciliation", () => {
    const rows = buildAutopartCsvRowsForOrder(sampleOrder());
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row["External Reference"]).toBe("AB-000002");
    expect(row["Supplier SKU"]).toBe("PMML500SC40");
    expect(row.Quantity).toBe("12");
    expect(row.Price).toBe("3.69");
    expect(row["Sub Total"]).toBe("44.28");
    expect(row.Shipping).toBe("5.95");
    expect(row.VAT).toBe("10.05");
    expect(row.Total).toBe("60.28");
    expect(row["Payment Amount 1"]).toBe("60.28");
    expect(row["MAM Account"]).toBe("TEST-MAM-CODE");
    expect(row.Source).toBe(AUTOPART_EXPORT_SOURCE);
    expect(row["Shipping Name"]).toBe("Alex Buyer");
    expect(row["Shipping City"]).toBe("Leeds");
    expect(row.Email).toBe("buyer@example.test");
  });

  it("formats order date as YYYY-MM-DD", () => {
    expect(formatAutopartExportOrderDate(new Date("2026-09-25T12:00:00.000Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("apportionment is penny-safe for multi-line orders", () => {
    const order = sampleOrder({
      orderNumber: "AB-MULTI",
      subtotal: "100.00",
      deliveryTotal: "5.95",
      vatTotal: "21.19",
      grandTotal: "127.14",
      items: [
        { sku: "SKU-A", qty: 12, lineTotal: "40.00", customerUnitPrice: "3.33" },
        { sku: "SKU-B", qty: 6, lineTotal: "35.00", customerUnitPrice: "5.83" },
        { sku: "SKU-C", qty: 1, lineTotal: "25.00", customerUnitPrice: "25.00" },
      ],
    });
    const rows = buildAutopartCsvRowsForOrder(order);
    expect(rows).toHaveLength(3);
    expect(sumMoneyStrings(rows.map((r) => r["Sub Total"]))).toBe("100.00");
    expect(sumMoneyStrings(rows.map((r) => r.Shipping))).toBe("5.95");
    expect(sumMoneyStrings(rows.map((r) => r.VAT))).toBe("21.19");
    expect(sumMoneyStrings(rows.map((r) => r.Total))).toBe("127.14");
    expect(sumMoneyStrings(rows.map((r) => r["Payment Amount 1"]))).toBe("127.14");
    expect(rows.every((r) => r["External Reference"] === "AB-MULTI")).toBe(true);
    expect(rows.every((r) => r["MAM Account"] === "TEST-MAM-CODE")).toBe(true);
  });

  it("exports FREE delivery as 0.00 shipping that still reconciles", () => {
    const rows = buildAutopartCsvRowsForOrder(
      sampleOrder({
        subtotal: "150.00",
        deliveryTotal: "0.00",
        vatTotal: "30.00",
        grandTotal: "180.00",
        items: [{ sku: "BIG", qty: 10, lineTotal: "150.00", customerUnitPrice: "15.00" }],
      }),
    );
    expect(rows[0]!.Shipping).toBe("0.00");
    expect(rows[0]!.Total).toBe("180.00");
  });

  it("largest-remainder apportionment never loses pennies", () => {
    expect(apportionCentsByWeights(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(apportionCentsByWeights(5, [2, 2, 1]).reduce((a, b) => a + b, 0)).toBe(5);
    const parts = buildOrderLineApportionment(
      [{ qty: 1 }, { qty: 1 }, { qty: 1 }],
      {
        orderShipping: "5.95",
        orderTax: "10.05",
        orderTotal: "60.28",
        paymentAmount1: "60.28",
      },
    );
    expect(sumMoneyStrings(parts.shippingByIndex)).toBe("5.95");
    expect(sumMoneyStrings(parts.vatByIndex)).toBe("10.05");
    expect(sumMoneyStrings(parts.totalByIndex)).toBe("60.28");
  });

  it("escapes commas, quotes, newlines and Unicode", () => {
    const rows = buildAutopartCsvRowsForOrder(
      sampleOrder({
        companyName: 'Smith "Trade" & Co',
        deliveryAddress: {
          line1: "12 High Street, Annex",
          line2: "Floor 1\nRear",
          town: "São Paulo",
          county: "West Yorkshire",
          postcode: "LS1 1AA",
          country: "GB",
          contactName: 'José "Trade" O\'Brien',
        },
      }),
    );
    const csv = serializeAutopartOrderCsv(rows);
    expect(csv.split("\n")[0]).toContain(csvEscapeAutopartField("External Reference"));
    expect(csv).toContain('José ""Trade"" O\'Brien');
    expect(csv).toContain("12 High Street, Annex");
    expect(csv).toContain("Floor 1\nRear");
  });

  it("protects phone and formula-like SKU/refs", () => {
    expect(csvEscapeExcelSafePhone("07700900123")).toBe('"\t07700900123"');
    expect(csvEscapeFormulaSafe("=CMD()")).toBe('"\t=CMD()"');
    expect(csvEscapeFormulaSafe("PMML500SC40")).toBe('"PMML500SC40"');
  });

  it("builds useful filenames", () => {
    expect(buildAutopartExportFilename({ mode: "single", orderNumber: "AB-000002" })).toBe(
      "autopart-AB-000002.csv",
    );
    expect(
      buildAutopartExportFilename({
        mode: "batch",
        batchReference: "APX-000001",
        at: new Date("2026-09-25T12:00:00Z"),
      }),
    ).toBe("automotive-brands-autopart-orders-APX-000001.csv");
  });

  it("batch CSV concatenates multiple orders as one row per line", () => {
    const csv = buildAutopartOrdersCsv([
      sampleOrder({ orderNumber: "AB-000010" }),
      sampleOrder({
        orderNumber: "AB-000011",
        items: [
          { sku: "A", qty: 1, lineTotal: "10.00", customerUnitPrice: "10.00" },
          { sku: "B", qty: 2, lineTotal: "20.00", customerUnitPrice: "10.00" },
        ],
        subtotal: "30.00",
        deliveryTotal: "5.95",
        vatTotal: "7.19",
        grandTotal: "43.14",
      }),
    ]);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(1 + 1 + 2); // header + 1 + 2
    expect(lines[0]!.split(",")).toHaveLength(AUTOPART_ORDER_CSV_HEADERS.length);
  });
});
