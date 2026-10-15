/**
 * Streaming reader for Autopart ALL exports.
 *
 * These files are Windows-1252 CSV. Descriptions can contain inch marks written as a
 * quote immediately before the closing quote (`14""`), and a few descriptions contain
 * a raw newline. A strict RFC CSV reader treats the inch mark as an escaped quote and
 * then swallows the units field. This reader keeps that units field.
 *
 * The original bytes are hashed by the caller before they are decoded.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export type AutopartCsvEncoding = "utf-8" | "windows-1252";

export type AutopartFileFingerprint = {
  bytes: number;
  sha256: string;
  encoding: AutopartCsvEncoding;
};

export type AutopartCsvRecord = {
  /** 1-based data record. The header is not a data record. */
  recordNumber: number;
  fields: string[];
  multiline: boolean;
  malformed: boolean;
  issue: string | null;
};

export type AutopartCsvScan = {
  fingerprint: AutopartFileFingerprint;
  header: string[];
  records: number;
  malformed: number;
  multiline: number;
};

const decoderFor = (encoding: AutopartCsvEncoding) => new TextDecoder(encoding);

export async function fingerprintAutopartFile(filePath: string): Promise<AutopartFileFingerprint> {
  const hash = createHash("sha256");
  const utf8 = new Utf8Validator();
  let bytes = 0;
  for await (const chunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    hash.update(buffer);
    utf8.push(buffer);
  }
  utf8.end();
  return {
    bytes,
    sha256: hash.digest("hex"),
    encoding: utf8.valid ? "utf-8" : "windows-1252",
  };
}

export async function scanAutopartCsv(
  filePath: string,
  fingerprint?: AutopartFileFingerprint,
): Promise<AutopartCsvScan> {
  const known = fingerprint ?? (await fingerprintAutopartFile(filePath));
  let records = 0;
  let malformed = 0;
  let multiline = 0;
  let header: string[] = [];
  await forEachAutopartCsvRecord(filePath, known.encoding, (record) => {
    if (header.length === 0) return;
    records += 1;
    if (record.malformed) malformed += 1;
    if (record.multiline) multiline += 1;
  }, (found) => {
    header = found;
  });
  return { fingerprint: known, header, records, malformed, multiline };
}

export async function forEachAutopartCsvRecord(
  filePath: string,
  encoding: AutopartCsvEncoding,
  onRecord: (record: AutopartCsvRecord) => void | Promise<void>,
  onHeader?: (header: string[]) => void,
): Promise<void> {
  const decoder = decoderFor(encoding);
  let pending = "";
  let header: string[] | null = null;
  let expected = 0;
  let recordNumber = 0;
  const emit = async (fields: string[], multiline: boolean) => {
    if (!header) {
      header = fields.map((field) => field.trim());
      expected = header.length;
      onHeader?.(header);
      return;
    }
    recordNumber += 1;
    const malformed = fields.length !== expected;
    await onRecord({
      recordNumber,
      fields,
      multiline,
      malformed,
      issue: malformed ? `Expected ${expected} fields and parsed ${fields.length}.` : null,
    });
  };
  const consume = async (end: boolean) => {
    const pulled = pullCsvRecords(pending, end);
    pending = pulled.rest;
    for (const record of pulled.records) await emit(record.fields, record.multiline);
  };

  for await (const chunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    pending += decoder.decode(buffer, { stream: true });
    await consume(false);
  }
  pending += decoder.decode();
  await consume(true);
}

export function pullCsvRecords(
  input: string,
  end: boolean,
): { records: Array<{ fields: string[]; multiline: boolean }>; rest: string } {
  const records: Array<{ fields: string[]; multiline: boolean }> = [];
  let index = 0;
  while (index < input.length) {
    const parsed = readCsvRecord(input, index, end);
    if (!parsed.complete) return { records, rest: input.slice(index) };
    if (parsed.fields.length || parsed.multiline) records.push({ fields: parsed.fields, multiline: parsed.multiline });
    index = parsed.next;
  }
  return { records, rest: "" };
}

function readCsvRecord(
  input: string,
  start: number,
  end: boolean,
): { complete: boolean; next: number; fields: string[]; multiline: boolean } {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let multiline = false;
  let i = start;
  const incomplete = { complete: false, next: start, fields: [], multiline: false };
  while (i < input.length) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 >= input.length && !end) return incomplete;
        const next = input[i + 1] ?? "";
        if (next === '"') {
          if (i + 2 >= input.length && !end) return incomplete;
          const after = input[i + 2] ?? "";
          if (after === "," || after === "\n" || after === "\r" || (end && after === "")) {
            current += '"';
            inQuotes = false;
            i += 2;
            continue;
          }
          current += '"';
          i += 2;
          continue;
        }
        if (next === "," || next === "\n" || next === "\r" || (end && next === "")) {
          inQuotes = false;
          i += 1;
          continue;
        }
        current += '"';
        i += 1;
        continue;
      }
      if (ch === "\n") multiline = true;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      fields.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      fields.push(current.trim());
      return { complete: true, next: i + 1, fields, multiline };
    }
    current += ch;
    i += 1;
  }
  if (!end || inQuotes) return incomplete;
  if (!current && fields.length === 0) return { complete: true, next: input.length, fields: [], multiline };
  fields.push(current.trim());
  return { complete: true, next: input.length, fields, multiline };
}

class Utf8Validator {
  private carry: number[] = [];
  valid = true;

  push(buffer: Buffer) {
    if (!this.valid) return;
    const bytes = this.carry.length ? Buffer.concat([Buffer.from(this.carry), buffer]) : buffer;
    this.carry = [];
    let i = 0;
    while (i < bytes.length) {
      const lead = bytes[i]!;
      if (lead < 0x80) {
        i += 1;
        continue;
      }
      let need = 0;
      if (lead >= 0xc2 && lead <= 0xdf) need = 2;
      else if (lead >= 0xe0 && lead <= 0xef) need = 3;
      else if (lead >= 0xf0 && lead <= 0xf4) need = 4;
      else {
        this.valid = false;
        return;
      }
      if (i + need > bytes.length) {
        this.carry = [...bytes.subarray(i)];
        return;
      }
      for (let j = 1; j < need; j += 1) {
        const cont = bytes[i + j]!;
        if (cont < 0x80 || cont > 0xbf) {
          this.valid = false;
          return;
        }
      }
      i += need;
    }
  }

  end() {
    if (this.carry.length) this.valid = false;
  }
}
