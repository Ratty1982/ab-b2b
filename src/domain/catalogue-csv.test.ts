import { describe, expect, it } from "vitest";
import { decodeCsvBytes, detectCsvDelimiter, ingestCsvText, parseCsvRecords } from "@/domain/catalogue-csv";

function utf16Le(text: string, bom = true): Uint8Array {
  const prefix = bom ? 2 : 0;
  const bytes = new Uint8Array(prefix + text.length * 2);
  if (bom) {
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
  }
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[prefix + i * 2] = code & 0xff;
    bytes[prefix + i * 2 + 1] = code >> 8;
  }
  return bytes;
}

describe("catalogue CSV ingest", () => {
  it("parses Excel semicolon files and sep= markers", () => {
    const csv = "sep=;\r\nsku;name;trade\r\nPM-1;Pad;12,50\r\n";
    expect(detectCsvDelimiter(csv)).toBe(";");
    const table = parseCsvRecords(csv);
    expect(table[0]).toEqual(["sku", "name", "trade"]);
    expect(table[1]).toEqual(["PM-1", "Pad", "12,50"]);
  });

  it("decodes UTF-16 Excel exports and strips null bytes", () => {
    const csv = "sku,name,brand\nA1,Brake Kit,Power Maxed\n";
    const decoded = decodeCsvBytes(utf16Le(csv));
    expect(decoded).toContain("sku,name,brand");
    expect(parseCsvRecords(decoded)[1]?.[0]).toBe("A1");
    expect(ingestCsvText("s\u0000k\u0000u")).toBe("sku");
  });

  it("parses tab-separated catalogues", () => {
    const csv = "sku\tname\nAB-9\tHose\n";
    expect(detectCsvDelimiter(csv)).toBe("\t");
    expect(parseCsvRecords(csv)[1]).toEqual(["AB-9", "Hose"]);
  });
});
