import { describe, expect, it } from "vitest";
import {
  assignAutopart216vIdentityKeys,
  autopart216vBaseIdentityKey,
  autopart216vIdentityKey,
  autopart216vRefsPrefixCompatible,
  compare216vQty,
  isAutopart216vFilename,
  isAutopart216vReport,
  isStrongEmpty216vReport,
  matchAutopart216vAcrossSnapshots,
  parseAutopart216vReport,
} from "@/domain/autopart-216v";
import {
  AUTOPART_216V_EXPANDED_PROFILE,
  AUTOPART_216V_HEADER,
  AUTOPART_216V_PROFILE,
  buildAutopart216vExpandedFixture,
  buildAutopart216vFixture,
} from "@/domain/autopart-216v-fixture";
import { firstSeenAgeLabel, resolveAutopart216vSkuCover, attentionIdsForBackorder } from "@/domain/autopart-216v-position";
import {
  AUTOPART_216V_SCHEDULE_LABEL,
  due216vPollWindow,
  headline216vFeedHealth,
  label216vSnapshotSource,
  resolveAutopart216vFreshness,
} from "@/domain/autopart-216v-freshness";
import { AUTOPART_504C_HEADER } from "@/domain/autopart-504c-fixture";
import { skuMatchKey } from "@/domain/stock";

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

  it("uses base identity alone when Order+Account+SKU is unique in-file", () => {
    const parsed = parseAutopart216vReport(fixture);
    const jet = parsed.rows.find((r) => r.orderNumber === "SB294008");
    expect(jet?.identityKey).toBe(
      autopart216vBaseIdentityKey({
        orderNumber: "SB294008",
        customerAccount: "A2MOTORCRE",
        partMatchKey: skuMatchKey("WW1000RTU"),
      }),
    );
    expect(jet?.identityKey.includes("VALETING")).toBe(false);
  });

  it("keeps duplicate base-identity lines distinct via reference (+ #n)", () => {
    const keys = assignAutopart216vIdentityKeys([
      {
        orderNumber: "SB1",
        customerAccount: "ACC",
        partMatchKey: "SKU",
        customerOrderRef: "REF",
        lineNumber: 2,
      },
      {
        orderNumber: "SB1",
        customerAccount: "ACC",
        partMatchKey: "SKU",
        customerOrderRef: "REF",
        lineNumber: 3,
      },
      {
        orderNumber: "SB1",
        customerAccount: "ACC",
        partMatchKey: "SKU",
        customerOrderRef: "OTHER",
        lineNumber: 4,
      },
    ]);
    expect(keys[0]).toBe(
      autopart216vIdentityKey({
        orderNumber: "SB1",
        customerAccount: "ACC",
        partMatchKey: "SKU",
        customerOrderRef: "REF",
        includeRef: true,
        occurrence: 1,
      }),
    );
    expect(keys[1]).toBe(
      autopart216vIdentityKey({
        orderNumber: "SB1",
        customerAccount: "ACC",
        partMatchKey: "SKU",
        customerOrderRef: "REF",
        includeRef: true,
        occurrence: 2,
      }),
    );
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[2]).toContain("|OTHER");
  });

  it("parses the expanded-width fixture profile without depending on old field widths", () => {
    const expanded = buildAutopart216vExpandedFixture();
    expect(isAutopart216vReport(expanded)).toBe(true);
    const parsed = parseAutopart216vReport(expanded);
    expect(parsed.headerFound).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(AUTOPART_216V_EXPANDED_PROFILE.lines);
    expect(parsed.orderCount).toBe(AUTOPART_216V_EXPANDED_PROFILE.orders);
    expect(parsed.accountCount).toBe(AUTOPART_216V_EXPANDED_PROFILE.accounts);
    expect(parsed.skuCount).toBe(AUTOPART_216V_EXPANDED_PROFILE.skus);
    expect(Number(parsed.outstandingQty)).toBe(AUTOPART_216V_EXPANDED_PROFILE.units);
    expect(parsed.outstandingValue).toBe(AUTOPART_216V_EXPANDED_PROFILE.outstandingValue);

    const additive = parsed.rows.find((r) => r.orderNumber === "SB295193");
    expect(additive?.customerName).toBe("AUTO ADDITIVES WORLDWIDE");
    expect(additive?.customerOrderRef).toBe("ADDITIVELAUNCHSTOCK");
    expect(additive?.description).toContain("Steel Seal");

    const bases = parsed.rows.map((r) =>
      autopart216vBaseIdentityKey({
        orderNumber: r.orderNumber,
        customerAccount: r.customerAccount,
        partMatchKey: r.partMatchKey,
      }),
    );
    expect(new Set(bases).size).toBe(bases.length);
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

  it("does not let 216V detection steal 504 / TRM / 231PO3NEW content", () => {
    expect(isAutopart216vReport(`LISTING OF INVOICES AND CREDITS BY CUSTOMER TYPE (504)\n${AUTOPART_216V_HEADER}`)).toBe(
      false,
    );
    expect(isAutopart216vReport(`Cust,Group,Document\nTRM21QC sample\n${AUTOPART_216V_HEADER}`)).toBe(false);
    expect(isAutopart216vReport(`231PO3NEW stock\n${AUTOPART_216V_HEADER}`)).toBe(false);
  });
});

describe("216V cross-snapshot identity matching", () => {
  it("treats truncated→expanded reference/name/description as the same unique-base line", () => {
    const previous = [
      {
        identityKey: "SB295193|AUTOADDIT|SSIN|INDIAQUOTE",
        orderNumber: "SB295193",
        customerAccount: "AUTOADDIT",
        partMatchKey: "SSIN",
        customerOrderRef: "INDIAQUOTE",
      },
    ];
    const next = [
      {
        identityKey: "SB295193|AUTOADDIT|SSIN",
        orderNumber: "SB295193",
        customerAccount: "AUTOADDIT",
        partMatchKey: "SSIN",
        customerOrderRef: "ADDITIVELAUNCHSTOCK",
      },
    ];
    const result = matchAutopart216vAcrossSnapshots(previous, next);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.continuedIdentityKey).toBe(previous[0]!.identityKey);
    expect(result.unmatchedPrevious).toHaveLength(0);
    expect(result.unmatchedNext).toHaveLength(0);
    expect(result.ambiguities).toEqual([]);
  });

  it("matches duplicate bases only via unambiguous prefix-compatible references", () => {
    expect(autopart216vRefsPrefixCompatible("ABC123", "ABC123FULLREFERENCE")).toBe(true);
    expect(autopart216vRefsPrefixCompatible("ABC123", "XYZ")).toBe(false);

    const previous = [
      {
        identityKey: "SB1|ACC|SKU|ABC123",
        orderNumber: "SB1",
        customerAccount: "ACC",
        partMatchKey: "SKU",
        customerOrderRef: "ABC123",
      },
      {
        identityKey: "SB1|ACC|SKU|OTHER",
        orderNumber: "SB1",
        customerAccount: "ACC",
        partMatchKey: "SKU",
        customerOrderRef: "OTHER",
      },
    ];
    const next = [
      {
        identityKey: "SB1|ACC|SKU|ABC123FULLREFERENCE",
        orderNumber: "SB1",
        customerAccount: "ACC",
        partMatchKey: "SKU",
        customerOrderRef: "ABC123FULLREFERENCE",
      },
      {
        identityKey: "SB1|ACC|SKU|OTHER",
        orderNumber: "SB1",
        customerAccount: "ACC",
        partMatchKey: "SKU",
        customerOrderRef: "OTHER",
      },
    ];
    const result = matchAutopart216vAcrossSnapshots(previous, next);
    expect(result.matches).toHaveLength(2);
    expect(result.unmatchedPrevious).toHaveLength(0);
    expect(result.unmatchedNext).toHaveLength(0);
  });

  it("does not guess when duplicate-base reference matching is ambiguous", () => {
    const previous = [
      {
        identityKey: "SB1|ACC|SKU|AB",
        orderNumber: "SB1",
        customerAccount: "ACC",
        partMatchKey: "SKU",
        customerOrderRef: "AB",
      },
      {
        identityKey: "SB1|ACC|SKU|ABC",
        orderNumber: "SB1",
        customerAccount: "ACC",
        partMatchKey: "SKU",
        customerOrderRef: "ABC",
      },
    ];
    const next = [
      {
        identityKey: "SB1|ACC|SKU|ABCFULL",
        orderNumber: "SB1",
        customerAccount: "ACC",
        partMatchKey: "SKU",
        customerOrderRef: "ABCFULL",
      },
    ];
    const result = matchAutopart216vAcrossSnapshots(previous, next);
    expect(result.matches).toHaveLength(0);
    expect(result.unmatchedPrevious).toHaveLength(2);
    expect(result.unmatchedNext).toHaveLength(1);
    expect(result.ambiguities.some((a) => a.includes("Ambiguous base identity"))).toBe(true);
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

  it("polls from 18:15 Europe/London on working days and not before", () => {
    expect(AUTOPART_216V_SCHEDULE_LABEL).toContain("18:15");
    // Wednesday 30 Sep 2026 BST: 18:14 London = 17:14 UTC, 18:15 = 17:15 UTC
    expect(due216vPollWindow(new Date("2026-09-30T17:14:00.000Z"))).toBe(false);
    expect(due216vPollWindow(new Date("2026-09-30T17:15:00.000Z"))).toBe(true);
    // Wednesday 14 Jan 2026 GMT
    expect(due216vPollWindow(new Date("2026-01-14T18:14:00.000Z"))).toBe(false);
    expect(due216vPollWindow(new Date("2026-01-14T18:15:00.000Z"))).toBe(true);
    expect(due216vPollWindow(new Date("2026-09-26T17:15:00.000Z"))).toBe(false);
  });

  it("keeps the 90-minute grace measured from 18:15", () => {
    const yesterday = {
      lastSuccessAt: new Date("2026-10-05T17:04:00.000Z"),
      lastBusinessDate: "2026-10-05",
    };
    const beforeGrace = new Date("2026-10-06T18:40:00.000Z"); // 19:40 BST
    expect(resolveAutopart216vFreshness({ ...yesterday, now: beforeGrace }).status).toBe("CURRENT");
    const afterGrace = new Date("2026-10-06T18:45:00.000Z"); // 19:45 BST
    expect(resolveAutopart216vFreshness({ ...yesterday, now: afterGrace }).status).toBe(
      "EXPECTED_REPORT_NOT_RECEIVED",
    );
    const gmtAfter = new Date("2026-01-14T19:45:00.000Z");
    expect(
      resolveAutopart216vFreshness({
        lastSuccessAt: new Date("2026-01-13T18:20:00.000Z"),
        lastBusinessDate: "2026-01-13",
        now: gmtAfter,
      }).status,
    ).toBe("EXPECTED_REPORT_NOT_RECEIVED");
  });

  it("warns after the working-day 18:15 grace if today's report is missing", () => {
    const tueEvening = new Date("2026-10-06T19:00:00.000Z"); // 20:00 BST
    const result = resolveAutopart216vFreshness({
      lastSuccessAt: new Date("2026-10-05T17:04:00.000Z"),
      lastBusinessDate: "2026-10-05",
      now: tueEvening,
    });
    expect(result.status).toBe("EXPECTED_REPORT_NOT_RECEIVED");
    expect(result.warning).toMatch(/not arrived/i);
    expect(
      headline216vFeedHealth({
        status: result.status,
        stale: result.stale,
        lastBusinessDate: "2026-10-05",
        now: tueEvening,
      }).key,
    ).toBe("REPORT_OVERDUE");
  });

  it("does not treat a waiting working-day morning as overdue", () => {
    const tueMorning = new Date("2026-10-06T08:00:00.000Z"); // 09:00 BST
    const result = resolveAutopart216vFreshness({
      lastSuccessAt: new Date("2026-10-05T17:04:00.000Z"),
      lastBusinessDate: "2026-10-05",
      now: tueMorning,
    });
    expect(result.status).toBe("CURRENT");
    expect(result.stale).toBe(false);
    expect(
      headline216vFeedHealth({
        status: result.status,
        stale: result.stale,
        lastBusinessDate: "2026-10-05",
        now: tueMorning,
      }).key,
    ).toBe("WAITING_FOR_TODAYS_REPORT");
  });

  it("maps persisted 216V source without inventing labels", () => {
    expect(label216vSnapshotSource("MANUAL")).toBe("Manual upload");
    expect(label216vSnapshotSource("EMAIL")).toBe("Mailbox poll");
    expect(label216vSnapshotSource("SCHEDULE")).toBe("Autopart email");
    expect(label216vSnapshotSource(null)).toBeNull();
  });

  it("weekend headline stays current when last working-day snapshot is present", () => {
    const sunday = new Date("2026-10-11T10:00:00.000Z");
    const result = resolveAutopart216vFreshness({
      lastSuccessAt: new Date("2026-10-09T17:04:00.000Z"),
      lastBusinessDate: "2026-10-09",
      now: sunday,
    });
    expect(
      headline216vFeedHealth({
        status: result.status,
        stale: result.stale,
        lastBusinessDate: "2026-10-09",
        now: sunday,
      }).key,
    ).toBe("CURRENT");
  });

  it("does not mark a current snapshot as failed just because a later poll error is stored", () => {
    const tueMorning = new Date("2026-10-06T08:00:00.000Z");
    const current = resolveAutopart216vFreshness({
      lastSuccessAt: new Date("2026-10-05T17:04:00.000Z"),
      lastBusinessDate: "2026-10-05",
      now: tueMorning,
    });
    expect(
      headline216vFeedHealth({
        status: current.status,
        stale: current.stale,
        lastError: "IMAP timeout",
        lastBusinessDate: "2026-10-05",
        now: tueMorning,
      }).key,
    ).toBe("WAITING_FOR_TODAYS_REPORT");
  });

  it("headlines import failure when there is no usable snapshot", () => {
    const result = resolveAutopart216vFreshness({
      lastSuccessAt: null,
      lastBusinessDate: null,
      now: new Date("2026-10-06T19:00:00.000Z"),
    });
    expect(
      headline216vFeedHealth({
        status: result.status,
        stale: result.stale,
        lastError: "Mailbox authentication failed",
        lastBusinessDate: null,
        now: new Date("2026-10-06T19:00:00.000Z"),
      }).key,
    ).toBe("IMPORT_FAILED");
  });
});
