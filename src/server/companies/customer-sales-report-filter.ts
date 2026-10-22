/**
 * Stream a customer sales report and keep only the selected account.
 * Other customers' rows are counted and discarded. Continuation lines stay
 * with the account that carried forward. The matching text is what the
 * existing parsers and duplicate checks receive.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { AuthError } from "@/server/rbac/guards";
import {
  extractAutopartAccountCode,
  headerKey,
  splitAutopartReportCells,
} from "@/domain/autopart-report-money";

export const MATCHING_TEXT_MAX_CHARS = 32_000_000;
const HEADER_SCAN_LINES = 200;
const BATCH_504 = 400;

export type CustomerSalesFilterMode = "HISTORY_561L" | "HISTORY_SLRB" | "ONGOING";

export type FilteredSalesReport = {
  text: string;
  rowsRead: number;
  matchingRows: number;
  otherCustomerRows: number;
};

type Filter504Row = { raw: string; document: string; orderNumber: string };

type ColumnMap = {
  kind: "ACCOUNT" | "504";
  account?: number;
  document?: number;
  order?: number;
};

function findColumn(keys: string[], aliases: string[]): number {
  return keys.findIndex((key) => aliases.includes(key));
}

const HEADER_TOKENS = new Set([
  "acct",
  "account",
  "a c",
  "cust",
  "customer code",
  "part number",
  "part",
  "sku",
  "inv ln",
  "inv & ln",
  "invoice line",
  "type",
  "ref",
  "reference",
  "document",
  "customer order number",
  "order number",
  "goods",
  "vat",
  "description",
  "units",
  "sales",
  "date",
  "qty",
  "quantity",
]);

function mapHeader(cells: string[], mode: CustomerSalesFilterMode): ColumnMap | null {
  const keys = cells.map((cell) => headerKey(cell));
  if (keys.filter((key) => HEADER_TOKENS.has(key)).length < 2) return null;
  if (mode === "HISTORY_561L") {
    const account = findColumn(keys, ["acct", "account", "a c"]);
    const part = findColumn(keys, ["part number", "part", "sku"]);
    const inv = findColumn(keys, ["inv ln", "inv & ln", "invoice line"]);
    if (account >= 0 && (part >= 0 || inv >= 0)) return { kind: "ACCOUNT", account, ...(inv >= 0 ? { document: inv } : {}) };
    return null;
  }
  if (mode === "HISTORY_SLRB") {
    const account = findColumn(keys, ["a c", "acct", "account"]);
    const type = findColumn(keys, ["type"]);
    const ref = findColumn(keys, ["ref", "reference", "document"]);
    if (account >= 0 && (type >= 0 || ref >= 0)) return { kind: "ACCOUNT", account, ...(ref >= 0 ? { document: ref } : {}) };
    return null;
  }
  const cust = findColumn(keys, ["cust", "customer code"]);
  const part = findColumn(keys, ["part number", "part", "sku"]);
  const document = findColumn(keys, ["document"]);
  if (cust >= 0 && part >= 0 && document >= 0) return { kind: "ACCOUNT", account: cust, document };
  const order = findColumn(keys, ["customer order number", "order number"]);
  const goods = findColumn(keys, ["goods", "value"]);
  if (document >= 0 && (order >= 0 || goods >= 0)) return { kind: "504", document, ...(order >= 0 ? { order } : {}) };
  return null;
}

function chrome(line: string): boolean {
  const upper = line.trim().toUpperCase();
  if (!upper) return true;
  if (/^PAGE\s+\d+/.test(upper) || /\bPAGE\s+\d+\s+OF\s+\d+\b/.test(upper)) return true;
  if (/^-{3,}$/.test(upper) || /^={3,}$/.test(upper)) return true;
  if (/^(GRAND\s+)?TOTALS?\b/.test(upper) || /\bSUB[- ]?TOTALS?\b/.test(upper) || /^ACCOUNT\s+TOTAL\b/.test(upper)) return true;
  if (upper.includes("[START CUSTOMER") || upper.includes("[END CUSTOMER")) return true;
  return false;
}

function matchAuthorisedPrefix(value: string, codesLongestFirst: string[]): string | null {
  const trimmed = value.trim().toUpperCase();
  for (const code of codesLongestFirst) {
    if (!trimmed.startsWith(code)) continue;
    const rest = trimmed.slice(code.length);
    if (rest.length === 0 || /^[,;\t ]/.test(rest) || /^[IC]\//.test(rest)) return code;
  }
  return null;
}

function accountDecision(
  raw: string,
  cells: string[],
  column: number,
  codes: Set<string>,
  codesLongestFirst: string[],
): { account: string | null; other: boolean } {
  const cell = cells.length > column ? (cells[column] ?? "") : cells.length === 1 ? (cells[0] ?? raw) : "";
  const extracted = extractAutopartAccountCode(cell);
  if (extracted) return codes.has(extracted) ? { account: extracted, other: false } : { account: null, other: true };
  const prefixed = matchAuthorisedPrefix(cell || raw, codesLongestFirst);
  if (prefixed) return { account: prefixed, other: false };
  const nativeOther = (cell || raw).trim().match(/^([A-Z0-9][A-Z0-9_-]{2,15})[IC]\//i);
  if (nativeOther) {
    const code = nativeOther[1]!.toUpperCase();
    if (!codes.has(code)) return { account: null, other: true };
    return { account: code, other: false };
  }
  return { account: null, other: false };
}

export async function streamFilterReport(input: {
  filePath: string;
  mode: CustomerSalesFilterMode;
  accountCodes: string[];
  classify504Batch?: (rows: Filter504Row[]) => Promise<boolean[]>;
  maxChars?: number;
}): Promise<FilteredSalesReport> {
  const maxChars = input.maxChars ?? MATCHING_TEXT_MAX_CHARS;
  const codes = new Set(input.accountCodes.map((code) => code.trim().toUpperCase()).filter(Boolean));
  const codesLongestFirst = [...codes].sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  let chars = 0;
  let rowsRead = 0;
  let matchingRows = 0;
  let otherCustomerRows = 0;
  let columns: ColumnMap | null = null;
  let lastAccount: string | null = null;
  let lineNumber = 0;
  const pending504: Filter504Row[] = [];

  function append(line: string) {
    chars += line.length + 1;
    if (chars > maxChars) {
      throw new AuthError(
        `This customer's matching rows are above the ${maxChars.toLocaleString("en-GB")} character processing limit. Other customers' rows were not loaded. Split this customer's report and upload it again. No sales records were written.`,
        "VALIDATION",
        400,
      );
    }
    kept.push(line);
  }

  async function flush504() {
    if (pending504.length === 0) return;
    if (!input.classify504Batch) {
      throw new AuthError("504 reports need the selected customer before they can be filtered.", "VALIDATION", 400);
    }
    const batch = pending504.splice(0, pending504.length);
    const keep = await input.classify504Batch(batch);
    if (keep.length !== batch.length) {
      throw new AuthError("504 filtering returned an unexpected result. No sales records were written.", "VALIDATION", 500);
    }
    for (let index = 0; index < batch.length; index += 1) {
      rowsRead += 1;
      if (keep[index]) {
        matchingRows += 1;
        append(batch[index]!.raw);
      } else {
        otherCustomerRows += 1;
      }
    }
  }

  const rl = createInterface({
    input: createReadStream(input.filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const entry of rl) {
      lineNumber += 1;
      const line = lineNumber === 1 ? String(entry).replace(/^\uFEFF/, "") : String(entry);
      if (!line.trim() || chrome(line)) {
        append(line);
        continue;
      }
      const cells = splitAutopartReportCells(line);
      const header = mapHeader(cells, input.mode);
      if (header) {
        columns = header;
        append(line);
        continue;
      }
      if (!columns) {
        if (lineNumber > HEADER_SCAN_LINES) {
          throw new AuthError(
            "The report header was not recognised within the first 200 lines. No sales records were written.",
            "VALIDATION",
            400,
          );
        }
        append(line);
        continue;
      }
      if (columns.kind === "504") {
        const document = (cells[columns.document ?? 0] ?? "").trim();
        const orderNumber = columns.order == null ? "" : (cells[columns.order] ?? "").trim();
        pending504.push({ raw: line, document, orderNumber });
        if (pending504.length >= BATCH_504) await flush504();
        continue;
      }
      const decision = accountDecision(line, cells, columns.account ?? 0, codes, codesLongestFirst);
      if (decision.account) {
        lastAccount = decision.account;
        rowsRead += 1;
        matchingRows += 1;
        append(line);
        continue;
      }
      if (decision.other) {
        const extracted = extractAutopartAccountCode(cells[columns.account ?? 0] ?? "");
        if (extracted) lastAccount = extracted;
        else {
          const nativeOther = line.trim().match(/^([A-Z0-9][A-Z0-9_-]{2,15})[IC]\//i);
          if (nativeOther) lastAccount = nativeOther[1]!.toUpperCase();
        }
        rowsRead += 1;
        otherCustomerRows += 1;
        continue;
      }
      rowsRead += 1;
      if (lastAccount && codes.has(lastAccount)) {
        matchingRows += 1;
        append(line);
      } else if (!lastAccount) {
        matchingRows += 1;
        append(line);
      } else {
        otherCustomerRows += 1;
      }
    }
    await flush504();
  } finally {
    rl.close();
  }

  return { text: kept.join("\n"), rowsRead, matchingRows, otherCustomerRows };
}
