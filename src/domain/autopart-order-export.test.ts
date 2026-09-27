import { describe, expect, it } from "vitest";
import {
  AUTOPART_DELIVERY_SKU,
  AUTOPART_EXPORT_SOURCE,
  AUTOPART_ORDER_CSV_HEADERS,
  apportionCentsByWeights,
  buildAutopartCsvRowsForOrder,
  buildAutopartExportFilename,
  buildAutopartExportLines,
  buildAutopartOrdersCsv,
  buildOrderLineApportionment,
  countAutopartCsvLinesForOrder,
  csvEscapeAutopartField,
  csvEscapeExcelSafePhone,
  csvEscapeFormulaSafe,
  formatAutopartExportOrderDate,
  orderHasPaidDeliverySnapshot,
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

/** AB-000003 real MAM import regression: goods 10.56 + delivery 5.95 + VAT 3.30 = 19.81 */
function ab000003Order(): AutopartExportOrderInput {
  return sampleOrder({
    orderNumber: "AB-000003",
    subtotal: "10.56",
    deliveryTotal: "5.95",
    vatTotal: "3.30",
    grandTotal: "19.81",
    items: [
      {
        sku: "PMAPC500",
        qty: 6,
        lineTotal: "10.56",
        customerUnitPrice: "1.76",
      },
    ],
  });
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

  it("paid delivery creates SDEL row at snapshotted net (AB-000002)", () => {
    const rows = buildAutopartCsvRowsForOrder(sampleOrder());
    expect(rows).toHaveLength(2);
    const product = rows[0]!;
    const sdel = rows[1]!;
    expect(product["External Reference"]).toBe("AB-000002");
    expect(product["Supplier SKU"]).toBe("PMML500SC40");
    expect(product.Quantity).toBe("12");
    expect(product.Price).toBe("3.69");
    expect(product["Sub Total"]).toBe("44.28");
    expect(product.Shipping).toBe("0.00");
    expect(sdel["Supplier SKU"]).toBe(AUTOPART_DELIVERY_SKU);
    expect(sdel.Quantity).toBe("1");
    expect(sdel.Price).toBe("5.95");
    expect(sdel["Sub Total"]).toBe("5.95");
    expect(sdel.Shipping).toBe("0.00");
    expect(sdel["External Reference"]).toBe("AB-000002");
    expect(sdel["MAM Account"]).toBe("TEST-MAM-CODE");
    expect(sdel.Source).toBe(AUTOPART_EXPORT_SOURCE);
    expect(sumMoneyStrings(rows.map((r) => r.Shipping))).toBe("0.00");
    expect(sumMoneyStrings(rows.map((r) => r["Sub Total"]))).toBe("50.23");
    expect(sumMoneyStrings(rows.map((r) => r.VAT))).toBe("10.05");
    expect(sumMoneyStrings(rows.map((r) => r.Total))).toBe("60.28");
    expect(sumMoneyStrings(rows.map((r) => r["Payment Amount 1"]))).toBe("60.28");
  });

  it("AB-000003 regression: PMAPC500 + SDEL reconciles to MAM import target", () => {
    const order = ab000003Order();
    const rows = buildAutopartCsvRowsForOrder(order);
    expect(rows).toHaveLength(2);

    const product = rows.find((r) => r["Supplier SKU"] === "PMAPC500")!;
    const sdel = rows.find((r) => r["Supplier SKU"] === AUTOPART_DELIVERY_SKU)!;
    expect(product).toBeTruthy();
    expect(sdel).toBeTruthy();

    expect(product.Quantity).toBe("6");
    expect(product.Price).toBe("1.76");
    expect(product["Sub Total"]).toBe("10.56");
    expect(product.Shipping).toBe("0.00");

    expect(sdel.Quantity).toBe("1");
    expect(sdel.Price).toBe("5.95");
    expect(sdel["Sub Total"]).toBe("5.95");
    expect(sdel.Shipping).toBe("0.00");
    expect(sdel["External Reference"]).toBe("AB-000003");
    expect(sdel["MAM Account"]).toBe("TEST-MAM-CODE");
    expect(sdel.Source).toBe(AUTOPART_EXPORT_SOURCE);

    // Delivery not double-counted via Shipping column
    expect(sumMoneyStrings(rows.map((r) => r.Shipping))).toBe("0.00");

    // MAM financial target: net 16.51 + VAT 3.30 = gross 19.81
    expect(sumMoneyStrings(rows.map((r) => r["Sub Total"]))).toBe("16.51");
    expect(sumMoneyStrings(rows.map((r) => r.VAT))).toBe("3.30");
    expect(sumMoneyStrings(rows.map((r) => r.Total))).toBe("19.81");
    expect(sumMoneyStrings(rows.map((r) => r["Payment Amount 1"]))).toBe("19.81");
  });

  it("formats order date as YYYY-MM-DD", () => {
    expect(formatAutopartExportOrderDate(new Date("2026-09-25T12:00:00.000Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("multi-product paid delivery appends one SDEL without double-counting Shipping", () => {
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
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r["Supplier SKU"] === AUTOPART_DELIVERY_SKU)).toHaveLength(1);
    const sdel = rows.find((r) => r["Supplier SKU"] === AUTOPART_DELIVERY_SKU)!;
    expect(sdel.Quantity).toBe("1");
    expect(sdel.Price).toBe("5.95");
    expect(sumMoneyStrings(rows.map((r) => r["Sub Total"]))).toBe("105.95");
    expect(sumMoneyStrings(rows.map((r) => r.Shipping))).toBe("0.00");
    expect(sumMoneyStrings(rows.map((r) => r.VAT))).toBe("21.19");
    expect(sumMoneyStrings(rows.map((r) => r.Total))).toBe("127.14");
    expect(sumMoneyStrings(rows.map((r) => r["Payment Amount 1"]))).toBe("127.14");
    expect(rows.every((r) => r["External Reference"] === "AB-MULTI")).toBe(true);
    expect(rows.every((r) => r["MAM Account"] === "TEST-MAM-CODE")).toBe(true);
    expect(rows.every((r) => r.Source === AUTOPART_EXPORT_SOURCE)).toBe(true);
  });

  it("free delivery produces no SDEL row and Shipping stays 0.00", () => {
    const rows = buildAutopartCsvRowsForOrder(
      sampleOrder({
        subtotal: "150.00",
        deliveryTotal: "0.00",
        vatTotal: "30.00",
        grandTotal: "180.00",
        items: [{ sku: "BIG", qty: 10, lineTotal: "150.00", customerUnitPrice: "15.00" }],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows.some((r) => r["Supplier SKU"] === AUTOPART_DELIVERY_SKU)).toBe(false);
    expect(rows[0]!.Shipping).toBe("0.00");
    expect(rows[0]!["Sub Total"]).toBe("150.00");
    expect(rows[0]!.Total).toBe("180.00");
    expect(orderHasPaidDeliverySnapshot("0.00")).toBe(false);
    expect(buildAutopartExportLines(sampleOrder({ deliveryTotal: "0.00" })).map((l) => l.sku)).not.toContain(
      AUTOPART_DELIVERY_SKU,
    );
  });

  it("zero/exempt VAT with paid delivery still exports SDEL and reconciles", () => {
    const rows = buildAutopartCsvRowsForOrder(
      sampleOrder({
        orderNumber: "AB-ZERO-VAT",
        subtotal: "10.56",
        deliveryTotal: "5.95",
        vatTotal: "0.00",
        grandTotal: "16.51",
        items: [{ sku: "PMAPC500", qty: 6, lineTotal: "10.56", customerUnitPrice: "1.76" }],
      }),
    );
    expect(rows).toHaveLength(2);
    const sdel = rows.find((r) => r["Supplier SKU"] === AUTOPART_DELIVERY_SKU)!;
    expect(sdel.Price).toBe("5.95");
    expect(sumMoneyStrings(rows.map((r) => r.VAT))).toBe("0.00");
    expect(sumMoneyStrings(rows.map((r) => r.Shipping))).toBe("0.00");
    expect(sumMoneyStrings(rows.map((r) => r["Sub Total"]))).toBe("16.51");
    expect(sumMoneyStrings(rows.map((r) => r.Total))).toBe("16.51");
  });

  it("standard VAT scenario reconciles CSV totals to order snapshot", () => {
    const order = sampleOrder({
      subtotal: "44.28",
      deliveryTotal: "5.95",
      vatTotal: "10.05",
      grandTotal: "60.28",
    });
    const rows = buildAutopartCsvRowsForOrder(order);
    expect(sumMoneyStrings(rows.map((r) => r["Sub Total"]))).toBe(
      sumMoneyStrings([order.subtotal, order.deliveryTotal]),
    );
    expect(sumMoneyStrings(rows.map((r) => r.VAT))).toBe(order.vatTotal);
    expect(sumMoneyStrings(rows.map((r) => r.Total))).toBe(order.grandTotal);
    expect(sumMoneyStrings(rows.map((r) => r.Shipping))).toBe("0.00");
  });

  it("customer PO is never used as External Reference", () => {
    const rows = buildAutopartCsvRowsForOrder(
      sampleOrder({
        orderNumber: "AB-000003",
        // poNumber is not part of export input — External Reference stays AB order number
      }),
    );
    expect(rows.every((r) => r["External Reference"] === "AB-000003")).toBe(true);
    expect(rows.some((r) => r["External Reference"].startsWith("PO"))).toBe(false);
  });

  it("countAutopartCsvLinesForOrder includes SDEL for paid delivery only", () => {
    expect(countAutopartCsvLinesForOrder(sampleOrder())).toBe(2);
    expect(countAutopartCsvLinesForOrder(sampleOrder({ deliveryTotal: "0.00" }))).toBe(1);
    expect(countAutopartCsvLinesForOrder(ab000003Order())).toBe(2);
  });

  it("largest-remainder apportionment never loses pennies", () => {
    expect(apportionCentsByWeights(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(apportionCentsByWeights(5, [2, 2, 1]).reduce((a, b) => a + b, 0)).toBe(5);
    const parts = buildOrderLineApportionment(
      [{ qty: 1 }, { qty: 1 }, { qty: 1 }],
      {
        orderShipping: "0.00",
        orderTax: "10.05",
        orderTotal: "60.28",
        paymentAmount1: "60.28",
      },
    );
    expect(sumMoneyStrings(parts.shippingByIndex)).toBe("0.00");
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

  it("batch CSV concatenates multiple orders including SDEL rows", () => {
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
    // header + (1 product + SDEL) + (2 products + SDEL)
    expect(lines).toHaveLength(1 + 2 + 3);
    expect(lines[0]!.split(",")).toHaveLength(AUTOPART_ORDER_CSV_HEADERS.length);
    expect(csv).toContain(AUTOPART_DELIVERY_SKU);
  });
});
