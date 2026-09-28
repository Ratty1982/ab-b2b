/**
 * Autopart 561L — historic product-level sales/credit lines.
 * Native content-based parser (CSV / tab / report text) — no LLM guessing.
 * Filename/extension is never used for format detection.
 */
import {
  autopartMoneyToGbp2,
  detectFixedWidthLayout,
  extractAutopartAccountCode,
  headerKey,
  normaliseReportLines,
  parseAutopartMoney,
  sliceFixedWidthCells,
  splitAutopartReportCells,
  splitCsvLine,
  type FixedWidthColumn,
} from "@/domain/autopart-report-money";

export type Autopart561lDocumentType = "INVOICE" | "CREDIT" | "UNKNOWN";

export type Autopart561lLine = {
  lineNumberInFile: number;
  accountCode: string | null;
  rawInvAndLn: string;
  documentType: Autopart561lDocumentType;
  documentReference: string | null;
  sourceLineNumber: number | null;
  partNumber: string | null;
  description: string | null;
  units: number | null;
  /** Signed sales net as GBP 2dp string (credits typically negative when source is signed). */
  salesNet: string | null;
  classification: "LINE" | "HEADER" | "TOTAL" | "BLANK" | "MALFORMED";
  issue: string | null;
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
  headerFound: boolean;
  /** Confirmed account field width from fixed-width layout, else null. */
  accountFieldWidth: number | null;
  layout: "CSV" | "FIXED_WIDTH" | "SPACED" | "POSITIONAL" | null;
  errors: string[];
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

const FIXED_WIDTH_LABELS = [
  { key: "account", patterns: [/\bAcct\.?\b/i, /\bAccount\b/i, /\bA\/C\b/i] },
  { key: "invLn", patterns: [/\bInv\s*&\s*Ln\b/i, /\bInv\s*\/?\s*Ln\b/i, /\bInvoice\s*Line\b/i] },
  { key: "part", patterns: [/\bPart\s*Number\b/i, /\bPart\s*No\.?\b/i] },
  { key: "description", patterns: [/\bDescription\b/i, /\bDesc\.?\b/i] },
  { key: "units", patterns: [/\bUnits\b/i, /\bQty\b/i] },
  { key: "sales", patterns: [/\bSales\b/i, /\bValue\b/i, /\bAmount\b/i] },
];

/**
 * Normalise Inv & Ln identities such as I/SS306008/1 or C/SS100818/2.
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
  const m = t.match(/^([IC])\/([^/]+)\/(\d+)$/i);
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

function looksLike561lHeaderLine(raw: string): boolean {
  const u = raw.toUpperCase();
  const hasAcct = /\bACCT\.?\b/.test(u) || /\bACCOUNT\b/.test(u) || /\bA\/C\b/.test(u);
  const hasInv = /INV\s*&\s*LN/.test(u) || /INV\s*\/?\s*LN/.test(u) || /INVOICE\s*LINE/.test(u);
  const hasPart = /PART\s*NUMBER/.test(u) || /PART\s*NO/.test(u);
  const hasSales = /\bSALES\b/.test(u) || /\bVALUE\b/.test(u);
  return hasAcct && hasInv && hasPart && hasSales;
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

function looksLikeTotalRow(cells: string[], invLnRaw: string): boolean {
  const joined = cells.join(" ").toUpperCase();
  if (joined.includes("TOTAL") && !/^(I|C)\//i.test(invLnRaw)) {
    return true;
  }
  return false;
}

/** Space-separated 561L data row: Acct Inv&Ln Part Description… Units Sales */
function parseSpaced561lDataRow(raw: string): {
  account: string;
  invLn: string;
  part: string;
  description: string;
  units: string;
  sales: string;
} | null {
  const m = raw
    .trim()
    .match(
      /^(\S+)\s+([IC]\/\S+)\s+(\S+)\s+(.+?)\s+(-?\d+(?:\.\d+)?)\s+([£(+-]?[\d,().]+(?:\s*CR)?)\s*$/i,
    );
  if (!m) return null;
  return {
    account: m[1]!,
    invLn: m[2]!,
    part: m[3]!,
    description: m[4]!.trim(),
    units: m[5]!,
    sales: m[6]!,
  };
}

function blankRow(lineNumberInFile: number): Autopart561lLine {
  return {
    lineNumberInFile,
    accountCode: null,
    rawInvAndLn: "",
    documentType: "UNKNOWN",
    documentReference: null,
    sourceLineNumber: null,
    partNumber: null,
    description: null,
    units: null,
    salesNet: null,
    classification: "BLANK",
    issue: null,
  };
}

function buildLine(input: {
  lineNumberInFile: number;
  accountRaw: string | null;
  invLnRaw: string;
  partRaw: string | null;
  descriptionRaw: string | null;
  unitsRaw: string | null;
  salesRaw: string | null;
}): Autopart561lLine {
  // Account ONLY from the account field — never scan other cells.
  const accountCode = extractAutopartAccountCode(input.accountRaw);
  const identity = parseInvAndLn(input.invLnRaw);
  const partNumber = (input.partRaw ?? "").trim() || null;
  const description = (input.descriptionRaw ?? "").trim() || null;
  const units = parseUnits(input.unitsRaw);
  const salesMoney = parseAutopartMoney(input.salesRaw);

  let salesNet: string | null = salesMoney ? autopartMoneyToGbp2(salesMoney) : null;
  if (identity.documentType === "CREDIT" && salesMoney && salesMoney.minor > 0n) {
    salesNet = autopartMoneyToGbp2({ minor: -salesMoney.minor });
  }
  let signedUnits = units;
  if (identity.documentType === "CREDIT" && units != null && units > 0) {
    signedUnits = -units;
  }

  const ok =
    identity.ok &&
    Boolean(accountCode) &&
    Boolean(partNumber) &&
    units != null &&
    salesNet != null;

  return {
    lineNumberInFile: input.lineNumberInFile,
    accountCode,
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
        (!accountCode
          ? input.accountRaw?.trim()
            ? "Invalid account field (not an Autopart customer code)"
            : "Missing account"
          : null) ||
        (!partNumber ? "Missing part number" : null) ||
        (units == null ? "Invalid units" : null) ||
        (salesNet == null ? "Invalid sales value" : null),
  };
}

export function parseAutopart561l(text: string): Autopart561lParseResult {
  const lines = normaliseReportLines(text);
  const errors: string[] = [];
  const rows: Autopart561lLine[] = [];
  type ColMap = {
    account: number;
    invLn: number;
    part: number;
    description?: number;
    units?: number;
    sales: number;
  };

  let headerFound = false;
  let colMap: ColMap | null = null;
  let fixedColumns: FixedWidthColumn[] | null = null;
  let accountFieldWidth: number | null = null;
  let layout: Autopart561lParseResult["layout"] = null;
  const accounts = new Set<string>();
  /** Carry forward only when the account *field* is blank on continuation lines. */
  let lastAccountRaw: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNumberInFile = i + 1;
    if (!rawLine.trim()) {
      rows.push(blankRow(lineNumberInFile));
      continue;
    }
    const upper = rawLine.trim().toUpperCase();
    if (
      (upper.includes("561L") && !looksLike561lHeaderLine(rawLine)) ||
      upper.startsWith("END OF REPORT") ||
      upper.startsWith("PAGE ") ||
      /^[-_=.\s]+$/.test(rawLine.trim())
    ) {
      rows.push({
        ...blankRow(lineNumberInFile),
        classification: "HEADER",
      });
      continue;
    }

    // Header detection — content based. Prefer fixed-width when labels sit on one
    // padded report line (multi-space CSV-style splits collapse Description).
    if (!headerFound) {
      if (looksLike561lHeaderLine(rawLine) && !rawLine.includes(",")) {
        const fw = detectFixedWidthLayout(rawLine, FIXED_WIDTH_LABELS);
        if (
          fw &&
          fw.columns.some((c) => c.key === "account") &&
          fw.columns.some((c) => c.key === "invLn") &&
          fw.columns.some((c) => c.key === "part") &&
          fw.columns.some((c) => c.key === "sales")
        ) {
          headerFound = true;
          fixedColumns = fw.columns;
          accountFieldWidth = fw.accountFieldWidth;
          layout = "FIXED_WIDTH";
          rows.push({ ...blankRow(lineNumberInFile), classification: "HEADER" });
          continue;
        }
      }
      const cells = splitAutopartReportCells(rawLine);
      const mapped = mapHeader(cells.length >= 4 ? cells : splitCsvLine(rawLine));
      if (mapped) {
        headerFound = true;
        colMap = mapped;
        layout = rawLine.includes(",") || rawLine.includes("\t") ? "CSV" : "SPACED";
        rows.push({ ...blankRow(lineNumberInFile), classification: "HEADER" });
        continue;
      }
      if (looksLike561lHeaderLine(rawLine)) {
        // Header keywords present but columns not sliced — use spaced regex rows
        headerFound = true;
        layout = "SPACED";
        rows.push({ ...blankRow(lineNumberInFile), classification: "HEADER" });
        continue;
      }
    }

    // Fixed-width body
    if (fixedColumns) {
      const sliced = sliceFixedWidthCells(rawLine, fixedColumns);
      let accountRaw = sliced["account"] ?? "";
      if (!accountRaw.trim() && lastAccountRaw) accountRaw = lastAccountRaw;
      if ((sliced["account"] ?? "").trim()) lastAccountRaw = sliced["account"]!;
      const invLnRaw = sliced["invLn"] ?? "";
      if (looksLikeTotalRow([rawLine], invLnRaw)) {
        rows.push({
          ...blankRow(lineNumberInFile),
          description: rawLine.trim().slice(0, 120),
          classification: "TOTAL",
        });
        continue;
      }
      const row = buildLine({
        lineNumberInFile,
        accountRaw,
        invLnRaw,
        partRaw: sliced["part"] ?? null,
        descriptionRaw: sliced["description"] ?? null,
        unitsRaw: sliced["units"] ?? null,
        salesRaw: sliced["sales"] ?? null,
      });
      // Only valid LINE accounts enter detectedAccounts
      if (row.classification === "LINE" && row.accountCode) accounts.add(row.accountCode);
      rows.push(row);
      continue;
    }

    // Delimited / spaced cell body
    if (colMap) {
      const cells = splitAutopartReportCells(rawLine);
      // If multi-space split collapsed description into part (missing sales col), use regex.
      const salesCell = cellAt(cells, colMap.sales);
      if (salesCell == null || salesCell === "") {
        const spaced = parseSpaced561lDataRow(rawLine);
        if (spaced) {
          let accountRaw = spaced.account;
          if (!accountRaw.trim() && lastAccountRaw) accountRaw = lastAccountRaw;
          if (spaced.account.trim()) lastAccountRaw = spaced.account;
          const row = buildLine({
            lineNumberInFile,
            accountRaw,
            invLnRaw: spaced.invLn,
            partRaw: spaced.part,
            descriptionRaw: spaced.description,
            unitsRaw: spaced.units,
            salesRaw: spaced.sales,
          });
          if (row.classification === "LINE" && row.accountCode) accounts.add(row.accountCode);
          rows.push(row);
          continue;
        }
      }
      let accountRaw = cellAt(cells, colMap.account);
      if (!(accountRaw ?? "").trim() && lastAccountRaw) accountRaw = lastAccountRaw;
      if ((cellAt(cells, colMap.account) ?? "").trim()) {
        lastAccountRaw = cellAt(cells, colMap.account);
      }
      const invLnRaw = cellAt(cells, colMap.invLn) ?? "";
      if (looksLikeTotalRow(cells, invLnRaw)) {
        rows.push({
          ...blankRow(lineNumberInFile),
          description: cells.join(" ").slice(0, 120),
          classification: "TOTAL",
        });
        continue;
      }
      const row = buildLine({
        lineNumberInFile,
        accountRaw,
        invLnRaw,
        partRaw: cellAt(cells, colMap.part),
        descriptionRaw: cellAt(cells, colMap.description),
        unitsRaw: cellAt(cells, colMap.units),
        salesRaw: cellAt(cells, colMap.sales),
      });
      if (row.classification === "LINE" && row.accountCode) accounts.add(row.accountCode);
      rows.push(row);
      continue;
    }

    // Positional CSV fallback once we see Inv&Ln in column 1
    {
      const cells = splitAutopartReportCells(rawLine);
      if (cells.length >= 6 && /^(I|C)\//i.test(cells[1] ?? "")) {
        colMap = { account: 0, invLn: 1, part: 2, description: 3, units: 4, sales: 5 };
        headerFound = true;
        layout = layout ?? "POSITIONAL";
        let accountRaw = cells[0] ?? "";
        if (!accountRaw.trim() && lastAccountRaw) accountRaw = lastAccountRaw;
        if ((cells[0] ?? "").trim()) lastAccountRaw = cells[0]!;
        const row = buildLine({
          lineNumberInFile,
          accountRaw,
          invLnRaw: cells[1] ?? "",
          partRaw: cells[2] ?? null,
          descriptionRaw: cells[3] ?? null,
          unitsRaw: cells[4] ?? null,
          salesRaw: cells[5] ?? null,
        });
        if (row.classification === "LINE" && row.accountCode) accounts.add(row.accountCode);
        rows.push(row);
        continue;
      }
    }

    // Spaced regex body (report .txt without recoverable column map)
    const spaced = parseSpaced561lDataRow(rawLine);
    if (spaced) {
      headerFound = true;
      layout = layout ?? "SPACED";
      let accountRaw = spaced.account;
      if (!accountRaw.trim() && lastAccountRaw) accountRaw = lastAccountRaw;
      if (spaced.account.trim()) lastAccountRaw = spaced.account;
      const row = buildLine({
        lineNumberInFile,
        accountRaw,
        invLnRaw: spaced.invLn,
        partRaw: spaced.part,
        descriptionRaw: spaced.description,
        unitsRaw: spaced.units,
        salesRaw: spaced.sales,
      });
      if (row.classification === "LINE" && row.accountCode) accounts.add(row.accountCode);
      rows.push(row);
      continue;
    }

    rows.push({
      ...blankRow(lineNumberInFile),
      classification: "MALFORMED",
      issue: headerFound
        ? "Unrecognised 561L data row"
        : "No 561L header recognised before data row",
    });
  }

  // Confirmed truncation width = consistent printed account length in this report.
  // Prefer content length over padded fixed-width column span (spaces are not account chars).
  if (accounts.size > 0) {
    const lengths = [...accounts].map((a) => a.length);
    const max = Math.max(...lengths);
    const min = Math.min(...lengths);
    if (max === min && max >= 4 && max <= 12) {
      accountFieldWidth = max;
    }
  }

  if (!headerFound) {
    errors.push(
      "561L report format not recognised. Expected an Autopart 561L report containing: Acct / Inv & Ln / Part Number / Description / Units / Sales.",
    );
  }

  const dataLines = rows.filter((r) => r.classification === "LINE");
  return {
    report: "561L",
    rows,
    lines: dataLines,
    invoiceLines: dataLines.filter((r) => r.documentType === "INVOICE").length,
    creditLines: dataLines.filter((r) => r.documentType === "CREDIT").length,
    malformedRows: rows.filter((r) => r.classification === "MALFORMED").length,
    blankRows: rows.filter((r) => r.classification === "BLANK").length,
    detectedAccounts: [...accounts].sort(),
    headerFound,
    accountFieldWidth,
    layout,
    errors,
  };
}
