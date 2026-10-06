import { describe, expect, it } from "vitest";
import { filenameMatchesStockPattern } from "@/domain/stock-email";
import { AUTOPART_504C_REPORT_TITLE } from "@/domain/autopart-504c";
import { AUTOPART_504C_HEADER } from "@/domain/autopart-504c-fixture";
import {
  classifyOngoingSalesAttachment,
  detectOngoingSalesAttachmentType,
  formatOngoingSalesAttachmentDiagnostic,
  isOngoingSalesAttachmentCandidate,
} from "@/domain/autopart-ongoing-sales-attachment";

const SAMPLE_504 = `Type,Document,Date,Time,Customer Name,Goods,VAT,Value,Inits,Customer Order Number
ACCOUNT,SS100001,29/09/2026,13:05,EXAMPLE MOTOR FACTORS,303.00,60.60,363.60,WR,AB-001234
ACCOUNT,SC100002,29/09/2026,14:10,EXAMPLE MOTOR FACTORS,-33.33,-6.66,-39.99,WR,AB-001234
`;

const SAMPLE_TRM = `Cust,Group,Document,Date,Part Number,Description,Qty,Sales,Cost,Margin,Perc%
AB001,TRADE,SS100001,29/09/2026,SKU-A,Cleaner A,2,200.00,100.00,100.00,50.0
`;

const SAMPLE_504C = `${AUTOPART_504C_REPORT_TITLE}\n${AUTOPART_504C_HEADER}\n`;

describe("ongoing sales attachment candidates", () => {
  it("treats 504.TXT / 504.txt as candidates regardless of case", () => {
    expect(isOngoingSalesAttachmentCandidate({ filename: "504.TXT", mime: "text/plain" }).candidate).toBe(true);
    expect(isOngoingSalesAttachmentCandidate({ filename: "504.txt", mime: "text/plain" }).candidate).toBe(true);
    expect(isOngoingSalesAttachmentCandidate({ filename: "504.Txt" }).candidate).toBe(true);
  });

  it("accepts text/plain and octet-stream 504 TXT when content can still be examined", () => {
    expect(
      isOngoingSalesAttachmentCandidate({ filename: "504.TXT", mime: "text/plain" }).candidate,
    ).toBe(true);
    expect(
      isOngoingSalesAttachmentCandidate({
        filename: "504.TXT",
        mime: "application/octet-stream",
      }).candidate,
    ).toBe(true);
    expect(
      isOngoingSalesAttachmentCandidate({ filename: "504", mime: "application/octet-stream" }).candidate,
    ).toBe(true);
  });

  it("rejects arbitrary octet-stream without a plausible name", () => {
    expect(
      isOngoingSalesAttachmentCandidate({
        filename: "payload.bin",
        mime: "application/octet-stream",
      }).candidate,
    ).toBe(false);
  });

  it("rejects 231PO3NEW even though it is TXT", () => {
    expect(
      isOngoingSalesAttachmentCandidate({ filename: "231PO3NEW.txt", mime: "text/plain" }).candidate,
    ).toBe(false);
  });

  it("does not use the old *.csv IMAP pattern for 504 TXT", () => {
    expect(filenameMatchesStockPattern("504.TXT", "*.csv")).toBe(false);
    expect(filenameMatchesStockPattern("TRM21QC.CSV", "*.csv")).toBe(true);
  });
});

describe("ongoing sales content detection", () => {
  it("detects genuine 504 content in 504.TXT / 504.txt", () => {
    expect(detectOngoingSalesAttachmentType("504.TXT", SAMPLE_504)).toBe("ONGOING_504");
    expect(detectOngoingSalesAttachmentType("504.txt", SAMPLE_504)).toBe("ONGOING_504");
    expect(classifyOngoingSalesAttachment("504.TXT", SAMPLE_504)).toBe("504");
  });

  it("does not require the filename to be exactly 504.TXT when content is 504", () => {
    expect(detectOngoingSalesAttachmentType("DayEnd_invoices.txt", SAMPLE_504)).toBe("ONGOING_504");
    expect(detectOngoingSalesAttachmentType("report.txt", SAMPLE_504)).toBe("ONGOING_504");
  });

  it("does not require subject — content alone is enough", () => {
    expect(detectOngoingSalesAttachmentType("attachment.txt", SAMPLE_504)).toBe("ONGOING_504");
  });

  it("rejects arbitrary TXT as UNKNOWN", () => {
    expect(detectOngoingSalesAttachmentType("notes.txt", "hello world\nthis is not a report")).toBe(
      "UNKNOWN",
    );
  });

  it("keeps CSV 504 backwards compatible and TRM21QC CSV unchanged", () => {
    expect(detectOngoingSalesAttachmentType("504.CSV", SAMPLE_504)).toBe("ONGOING_504");
    expect(detectOngoingSalesAttachmentType("TRM21QC.CSV", SAMPLE_TRM)).toBe("TRM21QC");
    expect(detectOngoingSalesAttachmentType("trm21qc.csv", SAMPLE_TRM)).toBe("TRM21QC");
  });

  it("never treats legacy 504C TXT as ongoing 504", () => {
    expect(detectOngoingSalesAttachmentType("504.TXT", SAMPLE_504C)).toBe("LEGACY_504C");
    expect(detectOngoingSalesAttachmentType("504C.TXT", SAMPLE_504C)).toBe("LEGACY_504C");
    expect(classifyOngoingSalesAttachment("504C.CSV", SAMPLE_504C)).toBe("504C");
    expect(detectOngoingSalesAttachmentType("504.TXT", SAMPLE_504)).not.toBe("LEGACY_504C");
  });

  it("formats Super Admin diagnostics without credentials", () => {
    const text = formatOngoingSalesAttachmentDiagnostic({
      filename: "504.TXT",
      mime: "text/plain",
      candidate: true,
      candidateType: "ONGOING_504",
      detectedType: "ONGOING_504",
      result: "imported",
      skipReason: null,
    });
    expect(text).toContain("504.TXT");
    expect(text).toContain("Detected: ONGOING_504");
    expect(text).toContain("Result: Imported");
    expect(text).not.toMatch(/password|imap|message-id/i);

    const skipped = formatOngoingSalesAttachmentDiagnostic({
      filename: "report.txt",
      mime: "text/plain",
      candidate: true,
      candidateType: "UNKNOWN",
      detectedType: "UNKNOWN",
      result: "skipped",
      skipReason: "content not recognised",
    });
    expect(skipped).toContain("Detected: UNKNOWN");
    expect(skipped).toContain("Skipped — content not recognised");
  });
});
