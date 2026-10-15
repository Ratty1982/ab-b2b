/**
 * Keep one customer's invoices when a 561L/SLRB file also contains other accounts.
 * Ambiguous rows are refused. Nothing is chosen because it has more lines or a higher value.
 */

export type HistoricAccountDisposition = "accepted" | "foreign" | "ambiguous" | "missing";

export type HistoricIsolationMode = "single" | "isolated" | "refused";

export type HistoricSourceRow = {
  accountCode: string | null;
  documentReference: string | null;
  documentType?: string | null;
};

export type HistoricIsolationResult<L extends HistoricSourceRow, D extends HistoricSourceRow> = {
  mode: HistoricIsolationMode;
  lines: L[];
  documents: D[];
  excludedAccounts: string[];
  refusedAmbiguousAccounts: string[];
  includedLineCount: number;
  excludedLineCount: number;
  refusedLineCount: number;
  includedDocumentCount: number;
  excludedDocumentCount: number;
  refusedDocumentCount: number;
};

function normalise(code: string | null | undefined): string | null {
  const value = code?.trim().toUpperCase() ?? "";
  return value || null;
}

function isShortForm(code: string, full: string, width: number | null): boolean {
  if (width == null || width < 4 || width > 12) return false;
  return code.length === width && full.length > width && full.slice(0, width) === code;
}

export function historicAccountDisposition(input: {
  accountCode: string | null;
  acceptedAccounts: ReadonlySet<string>;
  width: number | null;
  /** Short codes that also match another verified customer, when no full account is present. */
  ambiguousShortAccounts: ReadonlySet<string>;
  /** True when this file already shows the selected customer's full account code. */
  fullIdentityPresent: boolean;
}): HistoricAccountDisposition {
  const code = normalise(input.accountCode);
  if (!code) return "missing";
  if (input.acceptedAccounts.has(code)) return "accepted";
  const shortOfAccepted = [...input.acceptedAccounts].some((full) =>
    isShortForm(code, full, input.width),
  );
  if (shortOfAccepted) {
    if (input.ambiguousShortAccounts.has(code) && !input.fullIdentityPresent) return "ambiguous";
    return "accepted";
  }
  if (input.ambiguousShortAccounts.has(code)) return "ambiguous";
  return "foreign";
}

type RefFate = "include" | "exclude" | "refuse";

function fateFor(dispositions: HistoricAccountDisposition[]): RefFate {
  const known = dispositions.filter((item) => item !== "missing");
  if (known.some((item) => item === "ambiguous")) return "refuse";
  const accepted = known.some((item) => item === "accepted");
  const foreign = known.some((item) => item === "foreign");
  if (accepted && foreign) return "refuse";
  if (foreign) return "exclude";
  if (accepted) return "include";
  return "refuse";
}

export function isolateCustomerHistory<L extends HistoricSourceRow, D extends HistoricSourceRow>(input: {
  lines: L[];
  documents: D[];
  acceptedAccounts: ReadonlySet<string>;
  width: number | null;
  ambiguousShortAccounts: ReadonlySet<string>;
  fullIdentityPresent: boolean;
}): HistoricIsolationResult<L, D> {
  const dispositionInput = {
    acceptedAccounts: input.acceptedAccounts,
    width: input.width,
    ambiguousShortAccounts: input.ambiguousShortAccounts,
    fullIdentityPresent: input.fullIdentityPresent,
  };
  const lineDisposition = input.lines.map((line) =>
    historicAccountDisposition({ ...dispositionInput, accountCode: line.accountCode }),
  );
  const documentDisposition = input.documents.map((document) =>
    historicAccountDisposition({ ...dispositionInput, accountCode: document.accountCode }),
  );

  const byRef = new Map<string, HistoricAccountDisposition[]>();
  const add = (reference: string | null, disposition: HistoricAccountDisposition) => {
    const ref = reference?.trim();
    if (!ref) return;
    const current = byRef.get(ref) ?? [];
    current.push(disposition);
    byRef.set(ref, current);
  };
  input.lines.forEach((line, index) => add(line.documentReference, lineDisposition[index]!));
  input.documents.forEach((document, index) => add(document.documentReference, documentDisposition[index]!));

  const refFate = new Map<string, RefFate>();
  for (const [ref, dispositions] of byRef) refFate.set(ref, fateFor(dispositions));

  const lines: L[] = [];
  const documents: D[] = [];
  let excludedLineCount = 0;
  let refusedLineCount = 0;
  let excludedDocumentCount = 0;
  let refusedDocumentCount = 0;
  const excludedAccounts = new Set<string>();
  const refusedAmbiguousAccounts = new Set<string>();

  const remember = (accountCode: string | null, fate: RefFate) => {
    const code = normalise(accountCode);
    if (!code) return;
    if (fate === "exclude") excludedAccounts.add(code);
    if (fate === "refuse") refusedAmbiguousAccounts.add(code);
  };

  input.lines.forEach((line, index) => {
    const ref = line.documentReference?.trim() || null;
    const fate = ref ? (refFate.get(ref) ?? "refuse") : fateFor([lineDisposition[index]!]);
    if (fate === "include") lines.push(line);
    else if (fate === "exclude") {
      excludedLineCount += 1;
      remember(line.accountCode, fate);
    } else {
      refusedLineCount += 1;
      remember(line.accountCode, fate);
    }
  });

  input.documents.forEach((document, index) => {
    const ref = document.documentReference?.trim() || null;
    const fate = ref ? (refFate.get(ref) ?? "refuse") : fateFor([documentDisposition[index]!]);
    if (fate === "include") documents.push(document);
    else if (fate === "exclude") {
      excludedDocumentCount += 1;
      remember(document.accountCode, fate);
    } else {
      refusedDocumentCount += 1;
      remember(document.accountCode, fate);
    }
  });

  const included = lines.length + documents.length;
  const excluded = excludedLineCount + excludedDocumentCount;
  const refused = refusedLineCount + refusedDocumentCount;
  const mode: HistoricIsolationMode =
    included > 0 && (excluded > 0 || refused > 0) ? "isolated" : included > 0 ? "single" : "refused";

  return {
    mode,
    lines,
    documents,
    excludedAccounts: [...excludedAccounts].sort(),
    refusedAmbiguousAccounts: [...refusedAmbiguousAccounts].sort(),
    includedLineCount: lines.length,
    excludedLineCount,
    refusedLineCount,
    includedDocumentCount: documents.length,
    excludedDocumentCount,
    refusedDocumentCount,
  };
}
