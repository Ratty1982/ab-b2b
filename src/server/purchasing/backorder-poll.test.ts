import { describe, expect, it } from "vitest";
import { inspected216vFileHash } from "@/domain/autopart-216v";
import {
  backorderFeedPatchAfterPoll,
  decide216vMailboxAttachment,
  summarise216vPoll,
} from "@/server/purchasing/backorder-poll";

describe("216V mailbox duplicate identity", () => {
  it("imports a new file even when the inspected hash is known and not committed", () => {
    const inspected = inspected216vFileHash();
    const decision = decide216vMailboxAttachment({
      is216v: true,
      contentHash: inspected,
      committedHashes: new Set(["older-snapshot"]),
    });
    expect(decision).toEqual({ action: "import" });
  });

  it("duplicates only an exact committed 216V hash", () => {
    const inspected = inspected216vFileHash();
    expect(
      decide216vMailboxAttachment({
        is216v: true,
        contentHash: inspected,
        committedHashes: new Set([inspected]),
      }),
    ).toEqual({ action: "duplicate", reason: "This file is already a committed 216V snapshot" });
  });

  it("skips attachments that are not 216V reports", () => {
    expect(
      decide216vMailboxAttachment({
        is216v: false,
        contentHash: "abc",
        committedHashes: new Set(),
      }).action,
    ).toBe("skip");
  });

  it("describes skipped, duplicate and failed polls", () => {
    expect(
      summarise216vPoll({
        ran: false,
        reason:
          "216V backorder feed is DISABLED. Enable it under Purchasing → Backorders (purchasing.manage).",
        processed: 0,
        duplicatesIgnored: 0,
        skipped: 0,
        errors: [],
        notes: [],
      }),
    ).toMatch(/DISABLED/);
    expect(
      summarise216vPoll({
        ran: true,
        processed: 0,
        duplicatesIgnored: 1,
        skipped: 0,
        errors: [],
        notes: ["216V.CSV: already a committed snapshot"],
      }),
    ).toMatch(/No new 216V report was imported/);
    expect(
      summarise216vPoll({
        ran: true,
        processed: 0,
        duplicatesIgnored: 1,
        skipped: 0,
        errors: [],
        notes: ["216V.CSV: already a committed snapshot"],
      }),
    ).toMatch(/duplicate/);
    expect(
      summarise216vPoll({
        ran: true,
        processed: 0,
        duplicatesIgnored: 0,
        skipped: 2,
        errors: [],
        notes: ["notes.csv: Not a 216V report"],
      }),
    ).toMatch(/skipped/);
  });

  it("does not treat a mailbox poll as a successful import unless a report was committed", () => {
    const now = new Date("2026-10-12T20:53:05.000Z");
    const duplicatePoll = backorderFeedPatchAfterPoll(
      {
        ran: true,
        processed: 0,
        duplicatesIgnored: 1,
        skipped: 0,
        errors: [],
        notes: ["216V_20261012.csv: already imported, snapshot unchanged"],
      },
      now,
    );
    expect(duplicatePoll.lastPolledAt).toEqual(now);
    expect(duplicatePoll.lastSuccessAt).toBeUndefined();
    expect(duplicatePoll.lastError).toBeNull();

    const emptyPoll = backorderFeedPatchAfterPoll(
      { ran: true, processed: 0, duplicatesIgnored: 0, skipped: 0, errors: [], notes: [] },
      now,
    );
    expect(emptyPoll.lastSuccessAt).toBeUndefined();
    expect(emptyPoll.lastError).toMatch(/No new 216V report was imported/);

    const imported = backorderFeedPatchAfterPoll(
      { ran: true, processed: 1, duplicatesIgnored: 0, skipped: 0, errors: [], notes: [] },
      now,
    );
    expect(imported.lastSuccessAt).toEqual(now);
  });
});
