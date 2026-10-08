/**
 * Delimited 231PO3NEW reader for Amazon FBA imports.
 *
 * Autopart descriptions use a quotation mark as an inch symbol (Venus 14" Wheel Trim).
 * That mark is often not escaped. A standard quote toggle then merges later product
 * rows into one description and can shift Avail onto the wrong SKU.
 *
 * Valid RFC 4180 quoting is unchanged: a quote starts a field only at the field
 * boundary, doubled quotes are escaped quotes, and a quoted field may contain
 * commas and newlines. An interior inch mark is kept only when the field still
 * closes on the same record. A quote that runs into later lines which are not
 * new branch rows blocks the file instead of guessing a quantity.
 */

export const FBA_CSV_UNSAFE_MESSAGE =
  "This file contains a malformed quotation that crosses product rows and cannot be split safely. No FBA stock was changed.";

export type FbaCsvRecord = {
  cells: string[];
  /** 1-based physical line in the file, including blank lines. */
  physicalLine: number;
  quoteRecovered: boolean;
  quoteRejected: boolean;
};

export type FbaCsvDocument =
  | { ok: false; message: string }
  | { ok: true; records: FbaCsvRecord[] };

type LineParse = {
  cells: string[];
  inQuotesAtEnd: boolean;
  recovered: boolean;
  malformed: boolean;
};

function hasValidCloser(line: string, from: number, delimiter: string): boolean {
  for (let k = from; k < line.length; k += 1) {
    if (line[k] !== '"') continue;
    if (line[k + 1] === '"') {
      k += 1;
      continue;
    }
    const next = line[k + 1];
    if (next == null || next === delimiter || next === "\n" || next === "\r") return true;
  }
  return false;
}

function lastCharIsDigit(field: string): boolean {
  const ch = field.at(-1);
  return Boolean(ch && ch >= "0" && ch <= "9");
}

/** A new Autopart data row starts with the branch column. */
function looksLikeBranchRow(line: string, delimiter: string): boolean {
  const escaped = delimiter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*"?(?:OPTIMUS|SS)"?\\s*${escaped}`, "i").test(line);
}

export function parseFbaCsvLine(line: string, delimiter: string): LineParse {
  const cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStart = true;
  let recovered = false;
  let malformed = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
          fieldStart = false;
          continue;
        }
        const next = line[i + 1];
        if (next == null || next === delimiter || next === "\n" || next === "\r") {
          inQuotes = false;
          fieldStart = false;
          continue;
        }
        if (hasValidCloser(line, i + 1, delimiter)) {
          field += '"';
          recovered = true;
          fieldStart = false;
          continue;
        }
        if (lastCharIsDigit(field)) {
          field += '"';
          inQuotes = false;
          recovered = true;
          fieldStart = false;
          continue;
        }
        malformed = true;
        break;
      }
      if (ch === "\r") continue;
      field += ch;
      fieldStart = false;
      continue;
    }

    if (ch === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      continue;
    }
    if (ch === '"') {
      field += '"';
      recovered = true;
      fieldStart = false;
      continue;
    }
    if (ch === delimiter) {
      cells.push(field);
      field = "";
      fieldStart = true;
      continue;
    }
    if (ch === "\n") break;
    if (ch === "\r") continue;
    field += ch;
    fieldStart = false;
  }

  cells.push(field);
  return { cells, inQuotesAtEnd: inQuotes && !malformed, recovered, malformed };
}

export function parseFbaCsvDocument(text: string, delimiter: "," | ";" | "\t"): FbaCsvDocument {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const records: FbaCsvRecord[] = [];
  let expectedColumns: number | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const physicalLine = i + 1;
    if (lines[i]!.trim() === "") continue;

    let parsed = parseFbaCsvLine(lines[i]!, delimiter);
    if (parsed.inQuotesAtEnd) {
      let j = i + 1;
      let chunk = lines[i]!;
      let crossedPlainLine = false;
      while (j < lines.length && parsed.inQuotesAtEnd) {
        const next = lines[j]!;
        if (next.trim() !== "" && looksLikeBranchRow(next, delimiter)) break;
        if (next.trim() !== "") crossedPlainLine = true;
        chunk += `\n${next}`;
        parsed = parseFbaCsvLine(chunk, delimiter);
        j += 1;
      }
      if (crossedPlainLine && (parsed.inQuotesAtEnd || parsed.malformed)) {
        return { ok: false, message: FBA_CSV_UNSAFE_MESSAGE };
      }
      if (parsed.inQuotesAtEnd) {
        parsed = { ...parseFbaCsvLine(lines[i]!, delimiter), malformed: true, inQuotesAtEnd: false };
      } else {
        i = j - 1;
      }
    }

    if (expectedColumns == null) {
      expectedColumns = parsed.cells.length;
      records.push({
        cells: parsed.cells,
        physicalLine,
        quoteRecovered: false,
        quoteRejected: false,
      });
      continue;
    }

    const columnMismatch = parsed.cells.length !== expectedColumns;
    const quoteRejected = parsed.malformed || parsed.inQuotesAtEnd || (columnMismatch && parsed.recovered);
    records.push({
      cells: parsed.cells,
      physicalLine,
      quoteRecovered: parsed.recovered && !quoteRejected,
      quoteRejected,
    });
  }

  return { ok: true, records };
}
