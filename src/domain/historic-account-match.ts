/**
 * Classifies one 407EXP account for staff review.
 * Company name similarity is never an input and never a reason to verify.
 * A truncated code, two companies, or two master accounts on one company stay conflicts.
 */

export type HistoricMatchCategory =
  | "VERIFIED"
  | "LINKED_UNVERIFIED"
  | "EXACT_EVIDENCE"
  | "CONFLICT"
  | "NO_MATCH";

export type HistoricMatchFacts = {
  accountCode: string;
  linkedCompanyId: string | null;
  /** Other 407EXP accounts already linked to the same company. */
  otherMastersOnCompany: number;
  /** This code is a proper prefix of a longer 407EXP account. */
  truncatedCode: boolean;
  /** Companies independently verified for this exact code or an exact alias. */
  verifiedCompanyIds: readonly string[];
  /** The one company whose stored Autopart code is exactly this account, if any. */
  codeHolderCompanyId: string | null;
  /** The one company whose external reference is exactly this account, if any. */
  externalRefCompanyId: string | null;
  /** The one company whose account number is exactly this account, if any. */
  accountNumberCompanyId: string | null;
  /** Linked company's stored Autopart code, when it has one. */
  linkedCompanyCode: string | null;
  /** Company number, VAT number, order, quote, invoice, trade application, or active portal user. */
  independentIdentity: boolean;
  /** A person used Link on this account. Prospect conversion is not this. */
  staffLinked: boolean;
  /** The linked company was created from this Autopart row. */
  prospectCreated: boolean;
  /** An indicated company already stores a different Autopart code. */
  foreignStoredCode: boolean;
};

export type HistoricMatchDecision = {
  category: HistoricMatchCategory;
  companyId: string | null;
  evidence: string[];
  conflicts: string[];
};

export const HISTORIC_MATCH_VERIFY_PHRASE = "VERIFY MATCHED HISTORIC ACCOUNTS";

const PROSPECT_NOTE = "Created from the Autopart customer master";

export function prospectNoteMarksCreatedCompany(notes: string | null | undefined): boolean {
  return (notes ?? "").trim().startsWith(PROSPECT_NOTE);
}

/** Codes of length 4 or more that are a proper prefix of another 407EXP code. */
export function truncatedAccountCodes(codes: readonly string[]): Set<string> {
  const sorted = [...new Set(codes.map((code) => code.trim().toUpperCase()).filter(Boolean))].sort();
  const truncated = new Set<string>();
  for (let index = 0; index < sorted.length; index += 1) {
    const code = sorted[index]!;
    if (code.length < 4) continue;
    for (let next = index + 1; next < sorted.length; next += 1) {
      const longer = sorted[next]!;
      if (!longer.startsWith(code)) break;
      if (longer.length > code.length) truncated.add(code);
    }
  }
  return truncated;
}

function sameCompany(left: string | null, right: string | null): boolean {
  return left != null && right != null && left === right;
}

function distinctCompanies(ids: Array<string | null>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export function classifyHistoricMasterAccount(facts: HistoricMatchFacts): HistoricMatchDecision {
  const indicated = distinctCompanies([
    facts.linkedCompanyId,
    facts.codeHolderCompanyId,
    facts.externalRefCompanyId,
    facts.accountNumberCompanyId,
    facts.verifiedCompanyIds.length === 1 ? facts.verifiedCompanyIds[0]! : null,
  ]);
  const conflicts: string[] = [];
  if (facts.verifiedCompanyIds.length > 1) {
    conflicts.push("More than one company is verified for this exact code.");
  }
  if (indicated.length > 1) {
    conflicts.push("Exact codes and the master link point at different companies.");
  }
  if (conflicts.length) {
    return { category: "CONFLICT", companyId: indicated.length === 1 ? indicated[0]! : facts.linkedCompanyId, evidence: [], conflicts };
  }

  const verifiedCompanyId = facts.verifiedCompanyIds.length === 1 ? facts.verifiedCompanyIds[0]! : null;
  if (verifiedCompanyId) {
    return {
      category: "VERIFIED",
      companyId: verifiedCompanyId,
      evidence: ["This exact code is already verified on one company."],
      conflicts: [],
    };
  }

  if (facts.truncatedCode) {
    conflicts.push("This code is a prefix of a longer 407EXP account, so it is not a customer identity.");
  }
  if (facts.otherMastersOnCompany > 0) {
    conflicts.push("More than one 407EXP account is linked to this company.");
  }
  if (facts.linkedCompanyId && facts.linkedCompanyCode && facts.linkedCompanyCode !== facts.accountCode.trim().toUpperCase()) {
    conflicts.push("The linked company is stored with a different Autopart code.");
  }
  if (facts.foreignStoredCode) {
    conflicts.push("A matching company is stored with a different Autopart code.");
  }
  if (conflicts.length) {
    return { category: "CONFLICT", companyId: indicated.length === 1 ? indicated[0]! : facts.linkedCompanyId, evidence: [], conflicts };
  }

  const companyId =
    facts.linkedCompanyId ??
    facts.codeHolderCompanyId ??
    facts.externalRefCompanyId ??
    facts.accountNumberCompanyId;
  const evidence: string[] = [];
  if (companyId && facts.staffLinked && (facts.linkedCompanyId == null || facts.linkedCompanyId === companyId)) {
    evidence.push("A staff member linked this Autopart account to the company.");
  }
  if (companyId && sameCompany(facts.externalRefCompanyId, companyId)) {
    evidence.push("The company external reference equals this Autopart code.");
  }
  if (companyId && sameCompany(facts.accountNumberCompanyId, companyId)) {
    evidence.push("The company account number equals this Autopart code.");
  }
  if (
    companyId &&
    sameCompany(facts.codeHolderCompanyId, companyId) &&
    facts.independentIdentity
  ) {
    evidence.push(
      "The company already stores this exact Autopart code and has its own company number, VAT number, trading document, application, or portal user.",
    );
  }

  if (companyId && evidence.length) {
    return { category: "EXACT_EVIDENCE", companyId, evidence, conflicts: [] };
  }
  if (facts.linkedCompanyId) {
    return {
      category: "LINKED_UNVERIFIED",
      companyId: facts.linkedCompanyId,
      evidence: facts.prospectCreated
        ? ["The company was created from this Autopart account. That link is not separate identity evidence."]
        : ["The master account is linked to one company, without a separate exact identity."],
      conflicts: [],
    };
  }
  return {
    category: "NO_MATCH",
    companyId: null,
    evidence: ["No exact company code, external reference, account number, or staff link matches this account."],
    conflicts: [],
  };
}
