/**
 * Autopart 561L — historic product-level sales/credit lines.
 * Native CSV/header parser — no LLM guessing.
 */
import {
  autopartMoneyToGbp2,
  headerKey,
  normaliseAccountToken,
  normaliseReportLines,
  parseAutopartMoney,
  splitCsvLine,
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
  const accounts = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNumberInFile = i + 1;
    if (!rawLine.trim()) {
      rows.push(blankRow(lineNumberInFile));
      continue;
    }
    const upper = rawLine.trim().toUpperCase();
    if (
      upper.includes("561L") ||
      upper.startsWith("END OF REPORT") ||
      upper.startsWith("PAGE ") ||
      /^[-_=.\s]+$/.test(rawLine.trim())
    ) {
      rows.push({
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
        classification: "HEADER",
        issue: null,
      });
      continue;
    }

    const cells = splitCsvLine(rawLine);
    if (!headerFound) {
      const mapped = mapHeader(cells);
      if (mapped) {
        headerFound = true;
        colMap = mapped;
        rows.push({
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
          classification: "HEADER",
          issue: null,
        });
        continue;
      }
    }

    if (!colMap) {
      // Try headerless positional: Acct, Inv&Ln, Part, Description, Units, Sales
      if (cells.length >= 6 && /^(I|C)\//i.test(cells[1] ?? "")) {
        colMap = { account: 0, invLn: 1, part: 2, description: 3, units: 4, sales: 5 };
        headerFound = true;
      } else {
        rows.push({
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
          classification: "MALFORMED",
          issue: "No 561L header recognised before data row",
        });
        continue;
      }
    }

    if (looksLikeTotalRow(cells, colMap)) {
      rows.push({
        lineNumberInFile,
        accountCode: null,
        rawInvAndLn: "",
        documentType: "UNKNOWN",
        documentReference: null,
        sourceLineNumber: null,
        partNumber: null,
        description: cells.join(" ").slice(0, 120),
        units: null,
        salesNet: null,
        classification: "TOTAL",
        issue: null,
      });
      continue;
    }

    const accountCode = normaliseAccountToken(cellAt(cells, colMap.account));
    const rawInvAndLn = cellAt(cells, colMap.invLn) ?? "";
    const identity = parseInvAndLn(rawInvAndLn);
    const partNumber = (cellAt(cells, colMap.part) ?? "").trim() || null;
    const description = (cellAt(cells, colMap.description) ?? "").trim() || null;
    const units = parseUnits(cellAt(cells, colMap.units));
    const salesMoney = parseAutopartMoney(cellAt(cells, colMap.sales));

    if (accountCode) accounts.add(accountCode);

    // Credits: if identity is CREDIT and sales is positive, store as negative for net aggregation.
    let salesNet: string | null = salesMoney ? autopartMoneyToGbp2(salesMoney) : null;
    if (identity.documentType === "CREDIT" && salesMoney && salesMoney.minor > 0n) {
      salesNet = autopartMoneyToGbp2({ minor: -salesMoney.minor });
    }
    // Units for credits: if positive in source, store negative for net units.
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

    rows.push({
      lineNumberInFile,
      accountCode,
      rawInvAndLn,
      documentType: identity.documentType,
      documentReference: identity.documentReference,
      sourceLineNumber: identity.sourceLineNumber,
      partNumber: partNumber ? partNumber.trim() : null,
      description,
      units: signedUnits,
      salesNet,
      classification: ok ? "LINE" : "MALFORMED",
      issue: ok
        ? null
        : identity.issue ||
          (!accountCode ? "Missing account" : null) ||
          (!partNumber ? "Missing part number" : null) ||
          (units == null ? "Invalid units" : null) ||
          (salesNet == null ? "Invalid sales value" : null),
    });
  }

  if (!headerFound) errors.push("561L header row not found");

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
    errors,
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

function looksLikeTotalRow(
  cells: string[],
  colMap: { invLn: number },
): boolean {
  const joined = cells.join(" ").toUpperCase();
  if (joined.includes("TOTAL") && !/^(I|C)\//i.test(cellAt(cells, colMap.invLn) ?? "")) {
    return true;
  }
  return false;
}
