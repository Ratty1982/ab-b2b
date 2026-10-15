import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprintAutopartFile, forEachAutopartCsvRecord, pullCsvRecords } from "@/domain/autopart-csv-stream";

describe("Autopart ALL csv reader", () => {
  it("keeps the units field when a description ends with an inch mark", () => {
    const text = '"RETAIL","I/SS143483/1","MASTER14","Master Wheel Trims 14"","1","16.66"\r\n';
    const pulled = pullCsvRecords(text, true);
    expect(pulled.records[0]?.fields).toEqual([
      "RETAIL",
      "I/SS143483/1",
      "MASTER14",
      'Master Wheel Trims 14"',
      "1",
      "16.66",
    ]);
  });

  it("keeps a description that contains a newline", () => {
    const text = '"A2","C/SC501539/1","CUSTOM","Ref: rebate\r\n","-1","-12.00"\r\n';
    const pulled = pullCsvRecords(text, true);
    expect(pulled.records[0]?.multiline).toBe(true);
    expect(pulled.records[0]?.fields[3]).toContain("rebate");
    expect(pulled.records[0]?.fields[4]).toBe("-1");
    expect(pulled.records[0]?.fields[5]).toBe("-12.00");
  });

  it("hashes the original bytes before decoding Windows-1252", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ab-csv-"));
    const file = path.join(dir, "sample.csv");
    const bytes = Buffer.from(
      '"Acct","Inv","Part","Description","Units","Sales"\r\n"A","I/SS1/1","SWCSB","Car Seat Bag \x96 Ideal","1","9.16"\r\n',
      "latin1",
    );
    writeFileSync(file, bytes);
    const fingerprint = await fingerprintAutopartFile(file);
    expect(fingerprint.encoding).toBe("windows-1252");
    expect(fingerprint.bytes).toBe(bytes.length);
    const rows: string[][] = [];
    await forEachAutopartCsvRecord(file, fingerprint.encoding, (record) => {
      rows.push(record.fields);
    }, () => undefined);
    expect(rows[0]?.[3]).toBe("Car Seat Bag \u2013 Ideal");
    expect(rows[0]?.[5]).toBe("9.16");
  });
});
