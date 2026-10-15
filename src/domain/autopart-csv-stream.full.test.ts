import { existsSync } from "node:fs";
import { Decimal } from "@prisma/client/runtime/library";
import { describe, expect, it } from "vitest";
import { fingerprintAutopartFile, forEachAutopartCsvRecord } from "@/domain/autopart-csv-stream";
import { parseInvAndLn } from "@/domain/autopart-561l";

const linesPath = "/tmp/autopart-all/561L-ALL(1).CSV";
const ledgerPath = "/tmp/autopart-all/SLRB-ALL(1).CSV";
const originalsPresent = existsSync(linesPath) && existsSync(ledgerPath);

describe.skipIf(!originalsPresent)("original 561L-ALL and SLRB-ALL files", () => {
  it("parses every logical record without dropping the SS272042 lines", async () => {
    const lines = await fingerprintAutopartFile(linesPath);
    const ledger = await fingerprintAutopartFile(ledgerPath);
    expect(lines).toMatchObject({
      bytes: 35_972_427,
      sha256: "9c74cfd8aa4b2910c66e963175a6869ff077d62fd83d06263ac39981b324b3ea",
      encoding: "windows-1252",
    });
    expect(ledger).toMatchObject({
      bytes: 35_026_202,
      sha256: "1458ebcc61a401b3dfb2e104828d40e8c1efac36c541f8d6112ff46004663fac",
      encoding: "windows-1252",
    });

    let records = 0;
    let malformed = 0;
    let multiline = 0;
    let invoiceLines = 0;
    let creditLines = 0;
    let ssLines = 0;
    let ssNet = new Decimal(0);
    const started = Date.now();
    let peak = process.memoryUsage().rss;
    await forEachAutopartCsvRecord(linesPath, lines.encoding, (record) => {
      records += 1;
      if (record.malformed) malformed += 1;
      if (record.multiline) multiline += 1;
      const identity = parseInvAndLn(record.fields[1]);
      if (identity.documentType === "INVOICE") invoiceLines += 1;
      if (identity.documentType === "CREDIT") creditLines += 1;
      if (identity.documentReference === "SS272042") {
        ssLines += 1;
        ssNet = ssNet.plus(record.fields[5] ?? "0");
      }
      if ((records & 65535) === 0) peak = Math.max(peak, process.memoryUsage().rss);
    });
    peak = Math.max(peak, process.memoryUsage().rss);
    expect(records).toBe(492_560);
    expect(malformed).toBe(0);
    expect(multiline).toBe(258);
    expect(invoiceLines).toBe(478_715);
    expect(creditLines).toBe(13_845);
    expect(ssLines).toBe(99);
    expect(ssNet.toFixed(2)).toBe("27825.77");

    let ledgerRecords = 0;
    let ledgerMalformed = 0;
    const types = new Map<string, number>();
    let ssGoods = "";
    await forEachAutopartCsvRecord(ledgerPath, ledger.encoding, (record) => {
      ledgerRecords += 1;
      if (record.malformed) ledgerMalformed += 1;
      const type = record.fields[3] ?? "";
      types.set(type, (types.get(type) ?? 0) + 1);
      if (type === "INV" && record.fields[4] === "SS272042") ssGoods = record.fields[6] ?? "";
      if ((ledgerRecords & 65535) === 0) peak = Math.max(peak, process.memoryUsage().rss);
    });
    expect(ledgerRecords).toBe(337_750);
    expect(ledgerMalformed).toBe(0);
    expect(types.get("INV")).toBe(229_270);
    expect(types.get("CRN")).toBe(8_713);
    expect(types.get("CSH")).toBe(99_596);
    expect(types.get("OPB")).toBe(171);
    expect(ssGoods).toBe("27825.68");
    console.log(JSON.stringify({
      elapsedMs: Date.now() - started,
      peakRssBytes: peak,
      records,
      ledgerRecords,
      ssLines,
      ssNet: ssNet.toFixed(2),
      ssGoods,
    }));
  }, 120_000);
});
