/**
 * Autopart 561L — historic product-level sales/credit lines.
 *
 * Native printed layout (confirmed against real Autopart output):
 *
 *   .Acct. Inv & Ln    Part Number   Description              Units     Sales
 *   YORKMOTC/SC500093/127113         Red 13ml Threadlocker       -1     -8.98
 *
 * Critical:
 * - `.Acct.` is exactly 7 characters. Inv & Ln begins immediately after — no
 *   required whitespace. YORKMOT + C/SC500093/1 + 27113 may be adjacent.
 * - Column starts come from the printed header labels, not whitespace splits.
 * - Account codes come ONLY from the Acct field on DATA_LINE rows (or the
 *   report `[Start Customer …]` selection parameter — never from titles).
 * - Document type comes from Inv & Ln (`I/` / `C/`), never from signed money.
 */
import {
  autopartMoneyToGbp2,
  extractAutopartAccountCode,
  extractReportCustomerSelection,
  headerKey,
  isPlausibleAutopartAccountCode,
  normaliseReportLines,
  parseAutopartMoney,
  splitAutopartReportCells,
  splitCsvLine,
} from "@/domain/autopart-report-money";

export { extractReportCustomerSelection };

export type Autopart561lDocumentType = "INVOICE" | "CREDIT" | "UNKNOWN";

/** Structural row kinds for printed Autopart reports. */
export type Autopart561lRowKind =
  | "REPORT_TITLE"
  | "PAGE_HEADER"
  | "COLUMN_HEADER"
  | "CUSTOMER_HEADER"
  | "SELECTION_PARAM"
  | "DATA_LINE"
  | "CONTINUATION_LINE"
  | "SUBTOTAL"
  | "TOTAL"
  | "FOOTER"
  | "BLANK"
  | "UNKNOWN"
  | "MALFORMED";

export type Autopart561lLine = {
  lineNumberInFile: number;
  rowKind: Autopart561lRowKind;
  accountCode: string | null;
  customerName: string | null;
  rawInvAndLn: string;
  documentType: Autopart561lDocumentType;
  documentReference: string | null;
  sourceLineNumber: number | null;
  partNumber: string | null;
  description: string | null;
  units: number | null;
  /** Signed sales net as GBP 2dp string (credits typically negative when source is signed). */
  salesNet: string | null;
  /** @deprecated use rowKind — kept for existing callers expecting LINE/HEADER/… */
  classification: "LINE" | "HEADER" | "TOTAL" | "BLANK" | "MALFORMED";
  issue: string | null;
};

export type Autopart561lColumnLayout = {
  account: { start: number; end: number };
  invLn: { start: number; end: number };
  part: { start: number; end: number };
  description: { start: number; end: number };
  units: { start: number; end: number };
  sales: { start: number; end: number | null };
  accountFieldWidth: number;
};

export type Autopart561lParseResult = {
  report: "561L";
  rows: Autopart561lLine[];
  lines: Autopart561lLine[];
  invoiceLines: number;
  creditLines: number;
  malformedRows: number;
  blankRows: number;
  detectedAccounts: string[];
  /** `[Start Customer XXX]` from report selection parameters. */
  reportStartCustomer: string | null;
  reportEndCustomer: string | null;
  headerFound: boolean;
  /** Confirmed printed account width (native layout = 7). */
  accountFieldWidth: number | null;
  layout: "CSV" | "NATIVE_FIXED" | "POSITIONAL" | null;
  columnLayout: Autopart561lColumnLayout | null;
  errors: string[];
  diagnostics: {
    uniqueDocumentRefs: string[];
    uniqueInvoiceRefs: string[];
    uniqueCreditRefs: string[];
  };
};

const HEADER_ALIASES: Record<string, string> = {
  acct: "account",
  "a c": "account",
  account: "account",
  "inv ln": "invLn",
  "inv & ln": "invLn",
  "invoice line": "invLn",
  "part number": "part",
  part: "part",
  sku: "part",
  description: "description",
  desc: "description",
  units: "units",
  qty: "units",
  quantity: "units",
  sales: "sales",
  value: "sales",
  amount: "sales",
};

const INV_LN_RE = /^([IC])\/([A-Za-z0-9][A-Za-z0-9._-]*)\/(\d+)$/i;
const START_CUSTOMER_RE = /\[\s*Start\s+Customer\s+/i;
const END_CUSTOMER_RE = /\[\s*End\s+Customer\s+/i;

/**
 * Normalise Inv & Ln identities such as I/SS306008/1 or C/SC500093/1.
 * Does not guess malformed values.
 */
export function parseInvAndLn(raw: string | null | undefined): {
  documentType: Autopart561lDocumentType;
  documentReference: string | null;
  sourceLineNumber: number | null;
  ok: boolean;
  issue: string | null;
} {
  if (raw == null || !String(raw).trim()) {
    return {
      documentType: "UNKNOWN",
      documentReference: null,
      sourceLineNumber: null,
      ok: false,
      issue: "Missing Inv & Ln",
    };
  }
  const t = String(raw).trim();
  const m = t.match(INV_LN_RE);
  if (!m) {
    return {
      documentType: "UNKNOWN",
      documentReference: null,
      sourceLineNumber: null,
      ok: false,
      issue: `Malformed Inv & Ln: ${t}`,
    };
  }
  const kind = m[1]!.toUpperCase();
  const documentType: Autopart561lDocumentType = kind === "C" ? "CREDIT" : "INVOICE";
  const documentReference = m[2]!.trim().toUpperCase();
  const sourceLineNumber = Number(m[3]);
  if (!documentReference || !Number.isInteger(sourceLineNumber) || sourceLineNumber < 1) {
    return {
      documentType: "UNKNOWN",
      documentReference: null,
      sourceLineNumber: null,
      ok: false,
      issue: `Malformed Inv & Ln: ${t}`,
    };
  }
  return {
    documentType,
    documentReference,
    sourceLineNumber,
    ok: true,
    issue: null,
  };
}

function parseUnits(raw: string | null | undefined): number | null {
  if (raw == null || !String(raw).trim()) return null;
  const s = String(raw).trim().replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function mapHeader(cells: string[]): {
  account: number;
  invLn: number;
  part: number;
  description?: number;
  units?: number;
  sales: number;
} | null {
  const map: Partial<Record<string, number>> = {};
  cells.forEach((cell, idx) => {
    const key = HEADER_ALIASES[headerKey(cell)];
    if (key) map[key] = idx;
  });
  if (map["account"] != null && map["invLn"] != null && map["part"] != null && map["sales"] != null) {
    return {
      account: map["account"],
      invLn: map["invLn"],
      part: map["part"],
      ...(map["description"] != null ? { description: map["description"] } : {}),
      ...(map["units"] != null ? { units: map["units"] } : {}),
      sales: map["sales"],
    };
  }
  return null;
}

function cellAt(cells: string[], idx: number | undefined): string | null {
  if (idx == null) return null;
  return cells[idx] ?? null;
}

function looksLikeColumnHeader(raw: string): boolean {
  const u = raw.toUpperCase();
  const hasAcct = /\.?\bACCT\.?\b/.test(u) || /\bACCOUNT\b/.test(u) || /\bA\/C\b/.test(u);
  const hasInv = /INV\s*&\s*LN/.test(u) || /INV\s*\/?\s*LN/.test(u) || /INVOICE\s*LINE/.test(u);
  const hasPart = /PART\s*NUMBER/.test(u) || /PART\s*NO/.test(u);
  const hasSales = /\bSALES\b/.test(u) || /\bVALUE\b/.test(u);
  return hasAcct && hasInv && hasPart && hasSales;
}

/**
 * Derive fixed column starts from a native 561L header line such as:
 * `.Acct. Inv & Ln    Part Number   Description              Units     Sales`
 *
 * Rejects CSV/delimited headers (commas/tabs). Requires multi-space padding
 * typical of printed Autopart reports.
 */
export function detectNative561lLayout(headerLine: string): Autopart561lColumnLayout | null {
  if (!looksLikeColumnHeader(headerLine)) return null;
  if (headerLine.includes(",") || headerLine.includes("\t") || headerLine.includes(";")) {
    return null;
  }
  // Printed reports pad columns with 2+ spaces between some labels
  if (!/\s{2,}/.test(headerLine)) return null;

  const acct = headerLine.search(/\.Acct\.|\bAcct\.?/i);
  const inv = headerLine.search(/Inv\s*&\s*Ln/i);
  const part = headerLine.search(/Part\s*Number/i);
  const desc = headerLine.search(/Description/i);
  const units = headerLine.search(/\bUnits\b/i);
  const sales = headerLine.search(/\bSales\b/i);
  if (acct < 0 || inv < 0 || part < 0 || desc < 0 || units < 0 || sales < 0) return null;
  if (!(acct < inv && inv < part && part < desc && desc < units && units < sales)) return null;

  const accountFieldWidth = inv - acct;
  // Real Autopart 561L uses a 7-character .Acct. field; allow 6–8 for close variants.
  if (accountFieldWidth < 6 || accountFieldWidth > 8) return null;

  return {
    account: { start: acct, end: inv },
    invLn: { start: inv, end: part },
    part: { start: part, end: desc },
    description: { start: desc, end: units },
    units: { start: units, end: sales },
    sales: { start: sales, end: null },
    accountFieldWidth,
  };
}

function sliceCol(line: string, start: number, end: number | null): string {
  const padded = line.length < start ? line.padEnd(start) : line;
  if (end == null) return padded.slice(start);
  // Pad only when the line is short of this column — never shift existing chars
  const src = padded.length < end ? padded.padEnd(end) : padded;
  return src.slice(start, end);
}

/**
 * Parse one native fixed-width 561L data row using layout from the column header.
 * Account is ALWAYS characters [account.start, account.end) — never whitespace-tokenised.
 */
export function parseNative561lDataLine(
  raw: string,
  layout: Autopart561lColumnLayout,
): {
  accountRaw: string;
  invLnRaw: string;
  partRaw: string;
  descriptionRaw: string;
  unitsRaw: string;
  salesRaw: string;
} | null {
  if (raw.length < layout.invLn.start + 5) return null;
  const accountRaw = sliceCol(raw, layout.account.start, layout.account.end);
  const invLnRaw = sliceCol(raw, layout.invLn.start, layout.invLn.end).trim();
  // Inv & Ln must look like I/…/n or C/…/n (may be left-aligned within its field)
  if (!INV_LN_RE.test(invLnRaw)) return null;
  return {
    accountRaw,
    invLnRaw,
    partRaw: sliceCol(raw, layout.part.start, layout.part.end).trim(),
    descriptionRaw: sliceCol(raw, layout.description.start, layout.description.end).trim(),
    unitsRaw: sliceCol(raw, layout.units.start, layout.units.end).trim(),
    salesRaw: sliceCol(raw, layout.sales.start, layout.sales.end).trim(),
  };
}

function looksLikeReportTitle(raw: string): boolean {
  const u = raw.trim().toUpperCase();
  if (!u) return false;
  if (/^561L\b/.test(u)) return true;
  if (/\b561L\b/.test(u)) return true;
  if (/CUSTOMER\s+SALES\s+FOR\s+PART\s+NUMBERS/i.test(u)) return true;
  if (/^END OF REPORT/.test(u)) return true;
  return false;
}

function looksLikePageHeader(raw: string): boolean {
  const u = raw.trim().toUpperCase();
  if (/^PAGE\s+\d+/.test(u)) return true;
  if (/\bPAGE\s+\d+\s+OF\s+\d+\b/.test(u)) return true;
  if (/^-{3,}$/.test(u) || /^={3,}$/.test(u) || /^\.{3,}$/.test(u)) return true;
  if (START_CUSTOMER_RE.test(raw) || END_CUSTOMER_RE.test(raw)) return true;
  return false;
}

function looksLikeTotal(raw: string): boolean {
  const u = raw.trim().toUpperCase();
  if (!u) return false;
  if (/[IC]\//i.test(u)) return false;
  return (
    /^(GRAND\s+)?TOTALS?\b/.test(u) ||
    /\bSUB[- ]?TOTALS?\b/.test(u) ||
    /^ACCOUNT\s+TOTAL\b/.test(u)
  );
}

function toLegacyClassification(kind: Autopart561lRowKind): Autopart561lLine["classification"] {
  if (kind === "DATA_LINE" || kind === "CONTINUATION_LINE") return "LINE";
  if (kind === "BLANK") return "BLANK";
  if (kind === "TOTAL" || kind === "SUBTOTAL") return "TOTAL";
  if (kind === "MALFORMED") return "MALFORMED";
  return "HEADER";
}

function blankRow(lineNumberInFile: number, kind: Autopart561lRowKind = "BLANK"): Autopart561lLine {
  return {
    lineNumberInFile,
    rowKind: kind,
    accountCode: null,
    customerName: null,
    rawInvAndLn: "",
    documentType: "UNKNOWN",
    documentReference: null,
    sourceLineNumber: null,
    partNumber: null,
    description: null,
    units: null,
    salesNet: null,
    classification: toLegacyClassification(kind),
    issue: null,
  };
}

function buildDataLine(input: {
  lineNumberInFile: number;
  rowKind: "DATA_LINE" | "CONTINUATION_LINE";
  accountCode: string | null;
  invLnRaw: string;
  partRaw: string | null;
  descriptionRaw: string | null;
  unitsRaw: string | null;
  salesRaw: string | null;
}): Autopart561lLine {
  const identity = parseInvAndLn(input.invLnRaw);
  const partNumber = (input.partRaw ?? "").trim() || null;
  const description = (input.descriptionRaw ?? "").trim() || null;
  const units = parseUnits(input.unitsRaw);
  const salesMoney = parseAutopartMoney(input.salesRaw);

  let salesNet: string | null = salesMoney ? autopartMoneyToGbp2(salesMoney) : null;
  // Credit identity forces negative storage when source amount is unsigned positive
  if (identity.documentType === "CREDIT" && salesMoney && salesMoney.minor > 0n) {
    salesNet = autopartMoneyToGbp2({ minor: -salesMoney.minor });
  }
  let signedUnits = units;
  if (identity.documentType === "CREDIT" && units != null && units > 0) {
    signedUnits = -units;
  }

  const accountCode = input.accountCode;
  const ok =
    identity.ok &&
    Boolean(accountCode) &&
    Boolean(partNumber) &&
    units != null &&
    salesNet != null;

  return {
    lineNumberInFile: input.lineNumberInFile,
    rowKind: ok ? input.rowKind : "MALFORMED",
    accountCode,
    customerName: null,
    rawInvAndLn: input.invLnRaw,
    documentType: identity.documentType,
    documentReference: identity.documentReference,
    sourceLineNumber: identity.sourceLineNumber,
    partNumber,
    description,
    units: signedUnits,
    salesNet,
    classification: ok ? "LINE" : "MALFORMED",
    issue: ok
      ? null
      : identity.issue ||
        (!accountCode ? "Missing account (blank Acct field with no carry-forward)" : null) ||
        (!partNumber ? "Missing part number" : null) ||
        (units == null ? "Invalid units" : null) ||
        (salesNet == null ? "Invalid sales value" : null),
  };
}

function fileLooksDelimited(text: string): boolean {
  const sample = normaliseReportLines(text).slice(0, 40);
  let commaRows = 0;
  let nativeHits = 0;
  for (const line of sample) {
    if (!line.trim()) continue;
    if (detectNative561lLayout(line)) {
      nativeHits += 1;
      continue;
    }
    const cells = splitCsvLine(line);
    if (cells.length >= 5 && mapHeader(cells)) return true;
    if (cells.length >= 6 && INV_LN_RE.test((cells[1] ?? "").trim())) commaRows += 1;
  }
  if (nativeHits > 0) return false;
  return commaRows >= 2;
}

export function parseAutopart561l(text: string): Autopart561lParseResult {
  const selection = extractReportCustomerSelection(text);
  if (fileLooksDelimited(text)) {
    return parseDelimited561l(text, selection);
  }
  return parseNativeFixed561l(text, selection);
}

function parseDelimited561l(
  text: string,
  selection: { startCustomer: string | null; endCustomer: string | null },
): Autopart561lParseResult {
  const lines = normaliseReportLines(text);
  const rows: Autopart561lLine[] = [];
  const errors: string[] = [];
  const accounts = new Set<string>();
  let headerFound = false;
  let colMap: ReturnType<typeof mapHeader> = null;
  let lastAccount: string | null = null;
  let layout: Autopart561lParseResult["layout"] = "CSV";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNumberInFile = i + 1;
    if (!rawLine.trim()) {
      rows.push(blankRow(lineNumberInFile));
      continue;
    }
    if (looksLikeReportTitle(rawLine)) {
      rows.push(blankRow(lineNumberInFile, "REPORT_TITLE"));
      continue;
    }
    if (looksLikePageHeader(rawLine)) {
      rows.push(
        blankRow(
          lineNumberInFile,
          START_CUSTOMER_RE.test(rawLine) || END_CUSTOMER_RE.test(rawLine)
            ? "SELECTION_PARAM"
            : "PAGE_HEADER",
        ),
      );
      continue;
    }

    const cells = splitAutopartReportCells(rawLine);
    if (!headerFound) {
      const mapped = mapHeader(cells.length >= 4 ? cells : splitCsvLine(rawLine));
      if (mapped) {
        headerFound = true;
        colMap = mapped;
        rows.push(blankRow(lineNumberInFile, "COLUMN_HEADER"));
        continue;
      }
    }

    if (!colMap) {
      if (cells.length >= 6 && INV_LN_RE.test((cells[1] ?? "").trim())) {
        colMap = { account: 0, invLn: 1, part: 2, description: 3, units: 4, sales: 5 };
        headerFound = true;
        layout = "POSITIONAL";
      } else {
        rows.push({
          ...blankRow(lineNumberInFile, "MALFORMED"),
          issue: "No 561L header recognised before data row",
        });
        continue;
      }
    }

    const invLnRaw = cellAt(cells, colMap.invLn) ?? "";
    if (looksLikeTotal(rawLine) && !INV_LN_RE.test(invLnRaw.trim())) {
      rows.push(blankRow(lineNumberInFile, "TOTAL"));
      continue;
    }

    const accountRaw = cellAt(cells, colMap.account);
    let accountCode = extractAutopartAccountCode(accountRaw);
    let rowKind: "DATA_LINE" | "CONTINUATION_LINE" = "DATA_LINE";
    if (!accountCode) {
      accountCode = lastAccount;
      rowKind = "CONTINUATION_LINE";
    } else {
      lastAccount = accountCode;
    }

    const row = buildDataLine({
      lineNumberInFile,
      rowKind,
      accountCode,
      invLnRaw,
      partRaw: cellAt(cells, colMap.part),
      descriptionRaw: cellAt(cells, colMap.description),
      unitsRaw: cellAt(cells, colMap.units),
      salesRaw: cellAt(cells, colMap.sales),
    });
    if (row.classification === "LINE" && row.accountCode) accounts.add(row.accountCode);
    rows.push(row);
  }

  return finalise(rows, accounts, selection, headerFound, null, layout, null, errors);
}

function parseNativeFixed561l(
  text: string,
  selection: { startCustomer: string | null; endCustomer: string | null },
): Autopart561lParseResult {
  const lines = normaliseReportLines(text);
  const rows: Autopart561lLine[] = [];
  const errors: string[] = [];
  const accounts = new Set<string>();
  let headerFound = false;
  let columnLayout: Autopart561lColumnLayout | null = null;
  let lastAccount: string | null = null;
  const layout: Autopart561lParseResult["layout"] = "NATIVE_FIXED";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNumberInFile = i + 1;
    if (!rawLine.trim()) {
      rows.push(blankRow(lineNumberInFile));
      continue;
    }

    if (looksLikeReportTitle(rawLine)) {
      rows.push(blankRow(lineNumberInFile, "REPORT_TITLE"));
      continue;
    }

    if (START_CUSTOMER_RE.test(rawLine) || END_CUSTOMER_RE.test(rawLine)) {
      // Selection parameters may share a line with other page chrome
      rows.push(blankRow(lineNumberInFile, "SELECTION_PARAM"));
      // Do not reset lastAccount — page chrome repeats mid-customer
      continue;
    }

    if (looksLikePageHeader(rawLine)) {
      rows.push(blankRow(lineNumberInFile, "PAGE_HEADER"));
      continue;
    }

    const detected = detectNative561lLayout(rawLine);
    if (detected) {
      headerFound = true;
      columnLayout = detected;
      rows.push(blankRow(lineNumberInFile, "COLUMN_HEADER"));
      continue;
    }

    if (looksLikeColumnHeader(rawLine)) {
      headerFound = true;
      rows.push(blankRow(lineNumberInFile, "COLUMN_HEADER"));
      continue;
    }

    if (looksLikeTotal(rawLine)) {
      rows.push(blankRow(lineNumberInFile, /SUB/.test(rawLine.toUpperCase()) ? "SUBTOTAL" : "TOTAL"));
      continue;
    }

    if (columnLayout) {
      const parsed = parseNative561lDataLine(rawLine, columnLayout);
      if (parsed) {
        let accountCode = extractAutopartAccountCode(parsed.accountRaw.trim());
        // Defensive: never accept multi-token / garbage from a mis-sliced field
        if (accountCode && !isPlausibleAutopartAccountCode(accountCode)) accountCode = null;
        let rowKind: "DATA_LINE" | "CONTINUATION_LINE" = "DATA_LINE";
        if (!accountCode) {
          accountCode = lastAccount;
          rowKind = "CONTINUATION_LINE";
        } else {
          lastAccount = accountCode;
        }
        const row = buildDataLine({
          lineNumberInFile,
          rowKind,
          accountCode,
          invLnRaw: parsed.invLnRaw,
          partRaw: parsed.partRaw,
          descriptionRaw: parsed.descriptionRaw,
          unitsRaw: parsed.unitsRaw,
          salesRaw: parsed.salesRaw,
        });
        if (row.classification === "LINE" && row.accountCode) accounts.add(row.accountCode);
        rows.push(row);
        continue;
      }
    }

    rows.push({
      ...blankRow(lineNumberInFile, "UNKNOWN"),
      issue: "Unrecognised 561L row (ignored for account detection)",
      classification: "HEADER",
    });
  }

  if (!headerFound) {
    errors.push(
      "561L report format not recognised. Expected an Autopart 561L report containing: Acct / Inv & Ln / Part Number / Description / Units / Sales.",
    );
  }

  return finalise(
    rows,
    accounts,
    selection,
    headerFound,
    columnLayout?.accountFieldWidth ?? null,
    layout,
    columnLayout,
    errors,
  );
}

function finalise(
  rows: Autopart561lLine[],
  accounts: Set<string>,
  selection: { startCustomer: string | null; endCustomer: string | null },
  headerFound: boolean,
  accountFieldWidth: number | null,
  layout: Autopart561lParseResult["layout"],
  columnLayout: Autopart561lColumnLayout | null,
  errors: string[],
): Autopart561lParseResult {
  const dataLines = rows.filter((r) => r.classification === "LINE");
  let width = accountFieldWidth;
  if (width == null && accounts.size > 0) {
    const lengths = [...accounts].map((a) => a.length);
    const max = Math.max(...lengths);
    const min = Math.min(...lengths);
    if (max === min && max >= 4 && max <= 12) width = max;
  }
  const uniqueDocumentRefs = [
    ...new Set(dataLines.map((l) => l.documentReference).filter(Boolean) as string[]),
  ].sort();
  const uniqueInvoiceRefs = [
    ...new Set(
      dataLines
        .filter((l) => l.documentType === "INVOICE")
        .map((l) => l.documentReference)
        .filter(Boolean) as string[],
    ),
  ].sort();
  const uniqueCreditRefs = [
    ...new Set(
      dataLines
        .filter((l) => l.documentType === "CREDIT")
        .map((l) => l.documentReference)
        .filter(Boolean) as string[],
    ),
  ].sort();

  return {
    report: "561L",
    rows,
    lines: dataLines,
    invoiceLines: dataLines.filter((r) => r.documentType === "INVOICE").length,
    creditLines: dataLines.filter((r) => r.documentType === "CREDIT").length,
    malformedRows: rows.filter((r) => r.classification === "MALFORMED").length,
    blankRows: rows.filter((r) => r.classification === "BLANK").length,
    detectedAccounts: [...accounts].sort(),
    reportStartCustomer: selection.startCustomer,
    reportEndCustomer: selection.endCustomer,
    headerFound,
    accountFieldWidth: width,
    layout,
    columnLayout,
    errors,
    diagnostics: { uniqueDocumentRefs, uniqueInvoiceRefs, uniqueCreditRefs },
  };
}

/** Test/dev diagnostic — selected rows only; never log full customer reports in production. */
export function diagnose561lRows(
  result: Autopart561lParseResult,
  opts?: { limit?: number; kinds?: Autopart561lRowKind[] },
): Array<{
  lineNumberInFile: number;
  rowKind: Autopart561lRowKind;
  accountCode: string | null;
  documentReference: string | null;
  partNumber: string | null;
  units: number | null;
  salesNet: string | null;
}> {
  const limit = opts?.limit ?? 50;
  const kinds = opts?.kinds;
  return result.rows
    .filter((r) => !kinds || kinds.includes(r.rowKind))
    .slice(0, limit)
    .map((r) => ({
      lineNumberInFile: r.lineNumberInFile,
      rowKind: r.rowKind,
      accountCode: r.accountCode,
      documentReference: r.documentReference,
      partNumber: r.partNumber,
      units: r.units,
      salesNet: r.salesNet,
    }));
}
