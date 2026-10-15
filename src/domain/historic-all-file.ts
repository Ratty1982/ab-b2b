/**
 * One 561L-ALL file and one SLRB-ALL file become one historical sales dataset.
 * Verified accounts are imported. Everyone else waits in a review queue.
 * Nothing here writes a second global invoice-line copy.
 */

export type HistoricReviewReason = "UNKNOWN" | "AMBIGUOUS" | "UNLINKED" | "NOT_VERIFIED";

export type HistoricAccountTarget = {
  companyId: string;
  canonicalCode: string;
};

export type HistoricAccountDirectory = {
  /** Exact verified code. Null means more than one company uses it. */
  verifiedByCode: ReadonlyMap<string, HistoricAccountTarget | null>;
  /** 407EXP account. Null company means the master row is not linked. */
  masterCompanyByCode: ReadonlyMap<string, string | null>;
  /**
   * File codes that are a proper prefix of one or more 407EXP accounts.
   * These are never imported. A truncated code is not a verified identity.
   */
  truncatedPrefixes?: ReadonlySet<string>;
};

export type ClassifiedAccount =
  | { outcome: "import"; companyId: string; canonicalCode: string }
  | { outcome: "review"; reason: HistoricReviewReason };

export function classifyHistoricAccount(rawCode: string | null, directory: HistoricAccountDirectory): ClassifiedAccount {
  const code = rawCode?.trim().toUpperCase() ?? "";
  if (!code) return { outcome: "review", reason: "UNKNOWN" };
  const exact = directory.verifiedByCode.get(code);
  if (exact === null) return { outcome: "review", reason: "AMBIGUOUS" };
  if (exact) return { outcome: "import", companyId: exact.companyId, canonicalCode: exact.canonicalCode };
  if (directory.truncatedPrefixes?.has(code)) return { outcome: "review", reason: "AMBIGUOUS" };
  if (!directory.masterCompanyByCode.has(code)) return { outcome: "review", reason: "UNKNOWN" };
  const companyId = directory.masterCompanyByCode.get(code);
  if (!companyId) return { outcome: "review", reason: "UNLINKED" };
  return { outcome: "review", reason: "NOT_VERIFIED" };
}

export function indexShortVerifiedAccounts(
  verifiedByCode: ReadonlyMap<string, HistoricAccountTarget | null>,
  width: number | null,
): Map<string, HistoricAccountTarget | null> {
  const short = new Map<string, HistoricAccountTarget | null>();
  if (width == null) return short;
  for (const [code, target] of verifiedByCode) {
    if (!target || code.length <= width) continue;
    const prefix = code.slice(0, width);
    const current = short.get(prefix);
    if (current === undefined) short.set(prefix, target);
    else if (current?.companyId !== target.companyId) short.set(prefix, null);
  }
  return short;
}

export type AllFileLine = {
  accountCode: string | null;
  documentType: "INVOICE" | "CREDIT" | "UNKNOWN";
  documentReference: string | null;
  sourceLineNumber: number | null;
  partNumber: string | null;
  description: string | null;
  units: string;
  salesNet: string;
  rawInvAndLn: string;
};

export type AllFileDocument = {
  accountCode: string | null;
  documentType: "INVOICE" | "CREDIT" | "PAYMENT" | "JOURNAL" | "UNKNOWN";
  documentReference: string | null;
  documentDate: string | null;
  goodsNet: string | null;
  vat: string | null;
  grossTotal: string | null;
};

export type PlannedDocument = {
  documentType: "INVOICE" | "CREDIT";
  documentReference: string;
  documentDate: string | null;
  goodsNet: string | null;
  vat: string | null;
  grossTotal: string | null;
  source: "SLRB" | "561L";
  lineNetMinor: number;
  goodsMinor: number | null;
  warning: string | null;
};

export type PlannedLine = {
  documentType: "INVOICE" | "CREDIT";
  documentReference: string;
  lineNumber: number;
  sourceLineNumber: number | null;
  sku: string;
  description: string | null;
  units: string;
  salesNet: string;
  rawInvAndLn: string;
};

export type AccountPlan = {
  accountCode: string;
  classification: ClassifiedAccount;
  invoiceDocuments: number;
  creditDocuments: number;
  ledgerRows: number;
  lineCount: number;
  lineNet: string;
  goodsNet: string;
  warnings: string[];
  documents: PlannedDocument[];
  lines: PlannedLine[];
};

export type AllFilePlan = {
  accounts: AccountPlan[];
  importedAccounts: number;
  reviewAccounts: number;
};

export function moneyToMinor(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const negative = trimmed.startsWith("-") || /^\(.*\)$/.test(trimmed);
  const digits = trimmed.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const [whole = "0", frac = ""] = digits.split(".");
  const minor = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isFinite(minor)) return null;
  return negative ? -minor : minor;
}

export function minorToMoney(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function assignHistoricLineNumbers(
  lines: Array<{ documentType: string; documentReference: string; sourceLineNumber: number | null }>,
): number[] {
  const usedByDoc = new Map<string, Set<number>>();
  const assigned = new Array<number>(lines.length).fill(0);
  const pending: number[] = [];
  lines.forEach((line, index) => {
    const key = `${line.documentType}::${line.documentReference}`;
    const used = usedByDoc.get(key) ?? new Set<number>();
    if (line.sourceLineNumber != null && line.sourceLineNumber >= 1 && !used.has(line.sourceLineNumber)) {
      used.add(line.sourceLineNumber);
      usedByDoc.set(key, used);
      assigned[index] = line.sourceLineNumber;
      return;
    }
    pending.push(index);
    usedByDoc.set(key, used);
  });
  for (const index of pending) {
    const line = lines[index]!;
    const key = `${line.documentType}::${line.documentReference}`;
    const used = usedByDoc.get(key) ?? new Set<number>();
    let next = 1;
    while (used.has(next)) next += 1;
    used.add(next);
    usedByDoc.set(key, used);
    assigned[index] = next;
  }
  return assigned;
}

function normalCode(value: string | null): string {
  return value?.trim().toUpperCase() ?? "";
}

export function planAllHistoricFile(input: {
  lines: AllFileLine[];
  documents: AllFileDocument[];
  directory: HistoricAccountDirectory;
}): AllFilePlan {
  const buckets = new Map<string, { lines: AllFileLine[]; documents: AllFileDocument[] }>();
  const bucketFor = (code: string | null) => {
    const key = normalCode(code);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { lines: [], documents: [] };
      buckets.set(key, bucket);
    }
    return bucket;
  };
  for (const line of input.lines) bucketFor(line.accountCode).lines.push(line);
  for (const document of input.documents) bucketFor(document.accountCode).documents.push(document);

  const accounts: AccountPlan[] = [];
  for (const accountCode of [...buckets.keys()].sort()) {
    const grouped = buckets.get(accountCode)!;
    const classification = classifyHistoricAccount(accountCode || null, input.directory);
    const accountLines = grouped.lines;
    const accountDocs = grouped.documents;
    const salesDocs = accountDocs.filter(
      (document): document is AllFileDocument & { documentType: "INVOICE" | "CREDIT" } =>
        document.documentType === "INVOICE" || document.documentType === "CREDIT",
    );
    const ledgerRows = accountDocs.filter(
      (document) => document.documentType === "PAYMENT" || document.documentType === "JOURNAL",
    ).length;

    const docsByKey = new Map<string, PlannedDocument>();
    for (const document of salesDocs) {
      if (!document.documentReference) continue;
      const key = `${document.documentType}::${document.documentReference}`;
      const goodsMinor = moneyToMinor(document.goodsNet);
      docsByKey.set(key, {
        documentType: document.documentType,
        documentReference: document.documentReference,
        documentDate: document.documentDate,
        goodsNet: document.goodsNet,
        vat: document.vat,
        grossTotal: document.grossTotal,
        source: "SLRB",
        lineNetMinor: 0,
        goodsMinor,
        warning: null,
      });
    }

    const usableLines = accountLines.filter(
      (line): line is AllFileLine & { documentType: "INVOICE" | "CREDIT"; documentReference: string; partNumber: string } =>
        Boolean(line.documentReference) &&
        Boolean(line.partNumber) &&
        (line.documentType === "INVOICE" || line.documentType === "CREDIT"),
    );
    const lineNumbers = assignHistoricLineNumbers(
      usableLines.map((line) => ({
        documentType: line.documentType,
        documentReference: line.documentReference!,
        sourceLineNumber: line.sourceLineNumber,
      })),
    );
    const lines: PlannedLine[] = usableLines.map((line, index) => {
      const key = `${line.documentType}::${line.documentReference}`;
      const current = docsByKey.get(key);
      const lineMinor = moneyToMinor(line.salesNet) ?? 0;
      if (current) current.lineNetMinor += lineMinor;
      else {
        docsByKey.set(key, {
          documentType: line.documentType as "INVOICE" | "CREDIT",
          documentReference: line.documentReference!,
          documentDate: null,
          goodsNet: null,
          vat: null,
          grossTotal: null,
          source: "561L",
          lineNetMinor: lineMinor,
          goodsMinor: null,
          warning: null,
        });
      }
      return {
        documentType: line.documentType as "INVOICE" | "CREDIT",
        documentReference: line.documentReference!,
        lineNumber: lineNumbers[index] ?? index + 1,
        sourceLineNumber: line.sourceLineNumber,
        sku: line.partNumber!.trim(),
        description: line.description,
        units: line.units,
        salesNet: line.salesNet,
        rawInvAndLn: line.rawInvAndLn,
      };
    });

    const warnings: string[] = [];
    let goodsMinor = 0;
    let lineMinor = 0;
    let invoiceDocuments = 0;
    let creditDocuments = 0;
    for (const document of docsByKey.values()) {
      if (document.documentType === "INVOICE") invoiceDocuments += 1;
      else creditDocuments += 1;
      lineMinor += document.lineNetMinor;
      if (document.goodsMinor != null) goodsMinor += document.goodsMinor;
      if (document.goodsMinor == null) {
        document.warning = "561L lines have no SLRB invoice or credit header.";
        warnings.push(`${document.documentReference}: product lines have no SLRB header.`);
      } else if (document.lineNetMinor === 0 && document.source === "SLRB") {
        document.warning = "SLRB header has no 561L product lines.";
        warnings.push(`${document.documentReference}: SLRB header has no product lines.`);
      } else if (Math.abs(document.lineNetMinor - document.goodsMinor) > 1) {
        document.warning = `561L line net ${minorToMoney(document.lineNetMinor)} differs from SLRB goods ${minorToMoney(document.goodsMinor)}.`;
        warnings.push(`${document.documentReference}: ${document.warning}`);
      }
    }
    if (ledgerRows > 0) {
      warnings.push(`${ledgerRows} SLRB payment or journal rows are excluded from sales totals.`);
    }

    accounts.push({
      accountCode: accountCode || "(blank)",
      classification,
      invoiceDocuments,
      creditDocuments,
      ledgerRows,
      lineCount: lines.length,
      lineNet: minorToMoney(lineMinor),
      goodsNet: minorToMoney(goodsMinor),
      warnings,
      documents: [...docsByKey.values()],
      lines,
    });
  }

  return {
    accounts,
    importedAccounts: accounts.filter((account) => account.classification.outcome === "import").length,
    reviewAccounts: accounts.filter((account) => account.classification.outcome === "review").length,
  };
}
