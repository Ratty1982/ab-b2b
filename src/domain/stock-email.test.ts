import { describe, expect, it } from "vitest";
import { parseAutopart231Po3New } from "@/domain/stock-parse";
import { detect231Po3ReportKind, is231Po3NewReport, parseNative231Po3New } from "@/domain/stock-parse-native";
import { buildNative231Po3New } from "@/server/stock/fixtures/native-231po3new";
import {
  emailReceiptKey,
  filenameMatchesStockPattern,
  isDuplicateEmailReceipt,
  senderIsAllowed,
  validateImapSettingsUpdate,
} from "@/domain/stock-email";
import { encryptImapPassword } from "@/server/stock/imap-secret";
import { pickNewestValidFeed } from "@/server/stock/poll";

const native = buildNative231Po3New([
  { sku: "GC5000", description: "GLASS CLEANER 5L", stk: "93.0000", avail: "36.0000", pick: "0.0000", physical: "93.0000" },
  { sku: "LOW8", description: "LOW STOCK ITEM", stk: "100.0000", avail: "8.0000", pick: "2.0000", physical: "100.0000" },
  { sku: "NEG1", description: "NEGATIVE AVAIL", stk: "4.0000", avail: "-3.0000", pick: "0.0000", physical: "4.0000" },
]);

describe("native 231PO3NEW parser", () => {
  it("positively detects 231PO3NEW and reads Avail not Stk/Pick/Physical", () => {
    expect(is231Po3NewReport(native)).toBe(true);
    expect(detect231Po3ReportKind(native)).toBe("231PO3NEW");
    const parsed = parseAutopart231Po3New(native);
    if ("code" in parsed) throw new Error(parsed.message);
    expect(parsed.availHeader).toBe("Avail");
    const gc = parsed.rows.find((row) => row.sku === "GC5000");
    expect(gc?.avail).toMatchObject({ ok: true, value: 36 });
    const low = parsed.rows.find((row) => row.sku === "LOW8");
    expect(low?.avail).toMatchObject({ ok: true, value: 8 });
    expect(low?.avail.ok && low.avail.value).not.toBe(100);
    expect(low?.avail.ok && low.avail.value).not.toBe(2);
    const neg = parsed.rows.find((row) => row.sku === "NEG1");
    expect(neg?.avail).toMatchObject({ ok: true, value: -3 });
  });

  it("does not use LOCENQ and does not require a Locenq column", () => {
    expect(native).not.toMatch(/LOCENQ/i);
    const parsed = parseNative231Po3New(native);
    if ("code" in parsed) throw new Error(parsed.message);
    expect(parsed.availHeader).toBe("Avail");
  });

  it("does not treat filename-only as 231PO3NEW", () => {
    expect(is231Po3NewReport("this is not a report")).toBe(false);
    const parsed = parseNative231Po3New("random text named 231PO3NEW");
    expect("code" in parsed).toBe(true);
  });

  it("fails safe when Avail header structure is missing", () => {
    const parsed = parseNative231Po3New("AUTOPART SYSTEM (231PO3NEW)\nSKU,Stk\nAA,1");
    expect("code" in parsed && parsed.code).toBe("MISSING_AVAIL_HEADER");
  });

  it("keeps CSV parser for non-native uploads", () => {
    const parsed = parseAutopart231Po3New("SKU,Description,Avail\nGC5000,x,21");
    if ("code" in parsed) throw new Error(parsed.message);
    expect(parsed.rows[0]?.avail).toMatchObject({ ok: true, value: 21 });
  });
});

describe("email acquisition helpers", () => {
  it("filters allowed senders case-insensitively", () => {
    expect(senderIsAllowed("Autopart <reports@example.com>", ["reports@example.com"])).toBe(true);
    expect(senderIsAllowed("other@example.com", ["reports@example.com"])).toBe(false);
    expect(senderIsAllowed("anyone@x.com", [])).toBe(true);
  });

  it("recognises 231PO3NEW attachments and ignores others", () => {
    expect(filenameMatchesStockPattern("231PO3NEW.txt", "231PO3NEW*.txt")).toBe(true);
    expect(filenameMatchesStockPattern("231PO3NEW(1).txt", "231PO3NEW*.txt")).toBe(true);
    expect(filenameMatchesStockPattern("invoice.pdf", "231PO3NEW*.txt")).toBe(false);
    expect(filenameMatchesStockPattern("LOCENQ.txt", "231PO3NEW*.txt")).toBe(false);
  });

  it("dedupes on UID+Message-ID and does not treat Message-ID alone as unique", () => {
    expect(emailReceiptKey("<a@b>", "10")).toBe("<a@b>|10");
    expect(
      isDuplicateEmailReceipt(
        { messageId: "<a@b>", uid: "10" },
        { emailMessageId: "<a@b>", emailUid: "10" },
      ),
    ).toBe(true);
    expect(
      isDuplicateEmailReceipt(
        { messageId: "<a@b>", uid: "11" },
        { emailMessageId: "<a@b>", emailUid: "10" },
      ),
    ).toBe(false);
  });

  it("picks newest valid 231PO3NEW attachment and ignores wrong files", () => {
    const older = {
      uid: "1",
      messageId: "<old>",
      from: "reports@example.com",
      subject: "old",
      receivedAt: new Date("2026-01-01"),
      attachments: [{ filename: "note.txt", content: Buffer.from("hello") }],
    };
    const newer = {
      uid: "2",
      messageId: "<new>",
      from: "reports@example.com",
      subject: "stock",
      receivedAt: new Date("2026-09-01"),
      attachments: [{ filename: "231PO3NEW.txt", content: Buffer.from(native) }],
    };
    const unapproved = {
      uid: "3",
      messageId: "<bad>",
      from: "spam@example.com",
      subject: "nope",
      receivedAt: new Date("2026-10-01"),
      attachments: [{ filename: "231PO3NEW.txt", content: Buffer.from(native) }],
    };
    const picked = pickNewestValidFeed([older, newer], "231PO3NEW*.txt");
    expect(picked?.email.uid).toBe("2");
    expect(picked?.filename).toBe("231PO3NEW.txt");
    expect(unapproved.attachments[0]?.filename).toBe("231PO3NEW.txt");
  });

  it("never serialises a password in encrypted payload as plaintext DTO shape", () => {
    const stored = encryptImapPassword("super-secret-password");
    expect(stored).not.toContain("super-secret-password");
    expect(stored.startsWith("v1:")).toBe(true);
  });

  it("validates IMAP configuration bounds", () => {
    expect(validateImapSettingsUpdate({ imapPort: 993, pollIntervalMinutes: 15 })).toBeNull();
    expect(validateImapSettingsUpdate({ imapPort: 0 })).toBe("IMAP port must be between 1 and 65535");
    expect(validateImapSettingsUpdate({ pollIntervalMinutes: 0 })).toBe("Poll interval must be between 1 and 1440 minutes");
  });
});
