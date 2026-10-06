import { describe, expect, it } from "vitest";
import {
  autopart216vIdentityKey,
  compare216vQty,
  isAutopart216vFilename,
  isAutopart216vReport,
  isStrongEmpty216vReport,
  parseAutopart216vReport,
} from "@/domain/autopart-216v";
import { AUTOPART_216V_HEADER, AUTOPART_216V_PROFILE, buildAutopart216vFixture } from "@/domain/autopart-216v-fixture";
import { firstSeenAgeLabel, resolveAutopart216vSkuCover, attentionIdsForBackorder } from "@/domain/autopart-216v-position";
import { resolveAutopart216vFreshness } from "@/domain/autopart-216v-freshness";
import { AUTOPART_504C_HEADER } from "@/domain/autopart-504c-fixture";

describe("Autopart 216V detector/parser", () => {
  const fixture = buildAutopart216vFixture();

  it("detects the real awkward 216V header", () => {
    expect(isAutopart216vReport(fixture)).toBe(true);
    expect(isAutopart216vReport(AUTOPART_216V_HEADER)).toBe(true);
    expect(isAutopart216vFilename("216V.CSV")).toBe(true);
    expect(isAutopart216vFilename("216V.csv")).toBe(true);
    expect(isAutopart216vFilename("notes.csv")).toBe(false);
    expect(isAutopart216vReport("Order,Qty\nA,1")).toBe(false);
    expect(isAutopart216vReport(`LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)\n${AUTOPART_504C_HEADER}`)).toBe(
      false,
    );
  });

  it("parses the 66-line production-shaped fixture", () => {
    const parsed = parseAutopart216vReport(fixture);
    expect(parsed.headerFound).toBe(true);
    expect(parsed.rows).toHaveLength(AUTOPART_216V_PROFILE.lines);
    expect(parsed.orderCount).toBe(AUTOPART_216V_PROFILE.orders);
    expect(parsed.accountCount).toBe(AUTOPART_216V_PROFILE.accounts);
    expect(parsed.skuCount).toBe(AUTOPART_216V_PROFILE.skus);
    expect(Number(parsed.outstandingQty)).toBe(AUTOPART_216V_PROFILE.units);
    expect(parsed.outstandingValue).toBe(AUTOPART_216V_PROFILE.outstandingValue);

    const jet = parsed.rows.find((r) => r.orderNumber === "SB294008");
    expect(jet?.customerAccount).toBe("A2MOTORCRE");
    expect(jet?.customerName).toBe("A2 Motorparts Crew");
    expect(jet?.partNumber).toBe("WW1000RTU");
    expect(jet?.description).toBe("1 Litre Jet Wash & Wax");
    expect(jet?.customerOrderRef).toBe("VALETING S");
    expect(jet?.outstandingQty).toBe("3");
    expect(jet?.unitValue).toBe("2.73");
    expect(jet?.outstandingValue).toBe("8.19");

    const seal = parsed.rows.find((r) => r.orderNumber === "SB295193");
    expect(seal?.customerAccount).toBe("AUTOADDIT");
    expect(seal?.partNumber).toBe("SSIN");
    expect(seal?.customerOrderRef).toBe("INDIAQUOTE");
    expect(seal?.outstandingQty).toBe("120");
    expect(seal?.outstandingValue).toBe("1944.00");
  });

  it("tolerates blank columns and does not require clean semantic headers", () => {
    const parsed = parseAutopart216vReport(fixture);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.every((r) => r.partMatchKey)).toBe(true);
  });

  it("keeps duplicate order/sku/ref lines distinct", () => {
    const a = autopart216vIdentityKey({
      orderNumber: "SB1",
      customerAccount: "ACC",
      partMatchKey: "SKU",
      customerOrderRef: "REF",
    });
    const b = autopart216vIdentityKey({
      orderNumber: "SB1",
      customerAccount: "ACC",
      partMatchKey: "SKU",
      customerOrderRef: "REF",
      occurrence: 2,
    });
    expect(a).not.toBe(b);
  });

  it("classifies quantity changes", () => {
    expect(compare216vQty(null, "6")).toBe("NEW");
    expect(compare216vQty("6", "6")).toBe("UNCHANGED");
    expect(compare216vQty("12", "6")).toBe("QUANTITY_REDUCED");
    expect(compare216vQty("6", "12")).toBe("QUANTITY_INCREASED");
  });

  it("requires a strong empty 216V before allowing a clear-all", () => {
    const empty = `${AUTOPART_216V_HEADER}\n`;
    expect(isStrongEmpty216vReport(empty)).toBe(true);
    expect(isStrongEmpty216vReport("not a report")).toBe(false);
    expect(isStrongEmpty216vReport("Order No,Part Number\n")).toBe(false);
  });
});

describe("216V stock cover", () => {
  it("does not overclaim Avail across multiple backorders for the same SKU", () => {
    const cover = resolveAutopart216vSkuCover({
      outstandingQty: 16,
      availQty: 10,
      incomingQty: 0,
      presentInLatestFeed: true,
    });
    expect(cover.position).toBe("PART_STOCK_AVAILABLE");
    expect(cover.coverSummary).toContain("10 available against 16");
    expect(cover.incomingHasEta).toBe(false);
  });

  it("maps the documented cover examples", () => {
    expect(
      resolveAutopart216vSkuCover({
        outstandingQty: 6,
        availQty: 20,
        incomingQty: 0,
        presentInLatestFeed: true,
      }).position,
    ).toBe("STOCK_AVAILABLE");
    expect(
      resolveAutopart216vSkuCover({
        outstandingQty: 12,
        availQty: 0,
        incomingQty: 20,
        presentInLatestFeed: true,
      }).position,
    ).toBe("INCOMING_COVERS");
    expect(
      resolveAutopart216vSkuCover({
        outstandingQty: 12,
        availQty: 0,
        incomingQty: 5,
        presentInLatestFeed: true,
      }).position,
    ).toBe("INCOMING_PART_COVERS");
    expect(
      resolveAutopart216vSkuCover({
        outstandingQty: 12,
        availQty: 0,
        incomingQty: 0,
        presentInLatestFeed: true,
      }).position,
    ).toBe("NO_STOCK_NO_INCOMING");
    expect(
      resolveAutopart216vSkuCover({
        outstandingQty: 12,
        availQty: null,
        incomingQty: null,
        presentInLatestFeed: false,
      }).position,
    ).toBe("PRODUCT_NOT_IN_CURRENT_STOCK_FEED");
  });

  it("labels first-seen age without inventing order dates", () => {
    expect(firstSeenAgeLabel(1)).toBe("Seen for 1 day");
    expect(firstSeenAgeLabel(4)).toBe("Seen for 4 days");
    expect(firstSeenAgeLabel(12)).toBe("Seen for 12 days");
  });

  it("applies visible attention rules without a black-box score", () => {
    expect(
      attentionIdsForBackorder({
        ageDays: 12,
        outstandingValue: 10,
        skuPosition: "NO_STOCK_NO_INCOMING",
        skuAvailQty: 0,
      }),
    ).toEqual(["NO_STOCK_NO_INCOMING", "LONG_STANDING"]);
    expect(
      attentionIdsForBackorder({
        ageDays: 1,
        outstandingValue: 300,
        skuPosition: "STOCK_AVAILABLE",
        skuAvailQty: 20,
      }),
    ).toEqual(["STOCK_NOW_AVAILABLE", "HIGH_VALUE"]);
  });
});

describe("216V freshness", () => {
  it("does not alert on Sunday merely because no weekend report exists", () => {
    const sunday = new Date("2026-10-11T10:00:00.000Z"); // Sunday morning UTC ~ BST
    const result = resolveAutopart216vFreshness({
      lastSuccessAt: new Date("2026-10-09T17:04:00.000Z"),
      lastBusinessDate: "2026-10-09",
      now: sunday,
    });
    expect(result.status).toBe("WEEKEND_USING_LAST_WORKING_DAY");
    expect(result.stale).toBe(false);
  });

  it("warns after the working-day 18:00 grace if today's report is missing", () => {
    const tueEvening = new Date("2026-10-06T19:00:00.000Z"); // 20:00 BST
    const result = resolveAutopart216vFreshness({
      lastSuccessAt: new Date("2026-10-05T17:04:00.000Z"),
      lastBusinessDate: "2026-10-05",
      now: tueEvening,
    });
    expect(result.status).toBe("EXPECTED_REPORT_NOT_RECEIVED");
    expect(result.warning).toMatch(/not arrived/i);
  });
});
