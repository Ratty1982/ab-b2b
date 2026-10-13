import { describe, expect, it } from "vitest";
import { campaignDisplayStatus, promotionalLineSaving, summariseSavings } from "@/domain/promotion-campaigns";

const at = new Date("2026-10-13T12:00:00.000Z");

describe("campaign display status", () => {
  it("keeps a legacy promotion on its existing active, scheduled, expired and disabled states", () => {
    expect(
      campaignDisplayStatus({
        campaignStatus: "LEGACY",
        isActive: true,
        startsAt: null,
        endsAt: null,
        at,
      }).status,
    ).toBe("LEGACY_ACTIVE");
    expect(
      campaignDisplayStatus({
        campaignStatus: "LEGACY",
        isActive: true,
        startsAt: new Date("2026-11-01T00:00:00.000Z"),
        endsAt: null,
        at,
      }).label,
    ).toBe("Scheduled");
    expect(
      campaignDisplayStatus({
        campaignStatus: "LEGACY",
        isActive: false,
        startsAt: null,
        endsAt: null,
        at,
      }).label,
    ).toBe("Disabled");
  });

  it("moves an approved campaign from approved to active to expired by date", () => {
    expect(
      campaignDisplayStatus({
        campaignStatus: "APPROVED",
        isActive: true,
        startsAt: new Date("2026-11-01T00:00:00.000Z"),
        endsAt: new Date("2026-11-30T00:00:00.000Z"),
        at,
      }).status,
    ).toBe("SCHEDULED");
    expect(
      campaignDisplayStatus({
        campaignStatus: "APPROVED",
        isActive: true,
        startsAt: at,
        endsAt: new Date("2026-10-13T18:00:00.000Z"),
        at,
      }).status,
    ).toBe("ACTIVE");
    expect(
      campaignDisplayStatus({
        campaignStatus: "APPROVED",
        isActive: true,
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
        endsAt: at,
        at,
      }).status,
    ).toBe("ACTIVE");
    expect(
      campaignDisplayStatus({
        campaignStatus: "CANCELLED",
        isActive: false,
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
        endsAt: new Date("2026-10-31T00:00:00.000Z"),
        at,
      }).label,
    ).toBe("Cancelled");
    expect(
      campaignDisplayStatus({
        campaignStatus: "APPROVED",
        isActive: true,
        startsAt: new Date("2026-10-01T00:00:00.000Z"),
        endsAt: new Date("2026-10-31T00:00:00.000Z"),
        at,
      }).status,
    ).toBe("ACTIVE");
    expect(
      campaignDisplayStatus({
        campaignStatus: "APPROVED",
        isActive: true,
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2026-09-30T00:00:00.000Z"),
        at,
      }).status,
    ).toBe("EXPIRED");
  });

  it("keeps scheduled, active, expired and cancelled states across the GMT and BST boundary", () => {
    const beforeChange = new Date("2026-10-25T00:29:00.000Z");
    const duringBst = new Date("2026-10-25T00:30:00.000Z");
    const afterGmt = new Date("2026-10-25T01:30:00.000Z");
    const window = {
      campaignStatus: "APPROVED" as const,
      isActive: true,
      startsAt: duringBst,
      endsAt: afterGmt,
    };
    expect(campaignDisplayStatus({ ...window, at: beforeChange }).status).toBe("SCHEDULED");
    expect(campaignDisplayStatus({ ...window, at: duringBst }).status).toBe("ACTIVE");
    expect(campaignDisplayStatus({ ...window, at: afterGmt }).status).toBe("ACTIVE");
    expect(campaignDisplayStatus({ ...window, at: new Date("2026-10-25T01:30:00.001Z") }).status).toBe("EXPIRED");
    expect(
      campaignDisplayStatus({
        campaignStatus: "CANCELLED",
        isActive: false,
        startsAt: duringBst,
        endsAt: afterGmt,
        at: duringBst,
      }).status,
    ).toBe("CANCELLED");
  });
});

describe("promotional savings", () => {
  it("uses an order-time baseline and leaves a missing baseline unavailable", () => {
    expect(promotionalLineSaving({ qty: 2, baselineUnitPrice: "10.0000", unitPrice: "9.0000" }).savings).toBe(
      "2.0000",
    );
    expect(promotionalLineSaving({ qty: 2, baselineUnitPrice: null, unitPrice: "9.0000" }).savings).toBeNull();
    const summary = summariseSavings([
      { qty: 2, baselineUnitPrice: "10.0000", unitPrice: "9.0000" },
      { qty: 1, baselineUnitPrice: null, unitPrice: "8.0000" },
    ]);
    expect(summary.coverage).toBe("partial");
    expect(summary.savingsExVat).toBe("2.0000");
    expect(summary.linesWithoutBaseline).toBe(1);
    expect(summariseSavings([{ qty: 1, baselineUnitPrice: null, unitPrice: "8" }]).coverage).toBe("unavailable");
  });
});
