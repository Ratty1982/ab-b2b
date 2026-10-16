/**
 * Chooses the one ongoing 504/TRM21QC document for a type and reference.
 * Historical rows stay company-scoped. The same reference on two companies is not a duplicate.
 * An ongoing row is the authoritative identity: has504, hasTrm21qc, or an ongoing source.
 */

export const ONGOING_DOCUMENT_SOURCES = ["ONGOING_504", "ONGOING_TRM21QC", "ONGOING_504_BRIDGE"] as const;

export type OngoingDocumentCandidate = {
  id: string;
  companyId: string | null;
  autopartCustomerCode?: string | null;
  documentType: string;
  source: string;
  has504: boolean;
  hasTrm21qc: boolean;
  createdAt: Date;
};

/** Account evidence supplied by a 504 or TRM21QC row. Verified aliases share the verified-code company. */
export type OngoingOwnershipAuthority =
  | "verified-code"
  | "verified-alias"
  | "stored-code"
  | "account-link"
  | "ambiguous"
  | "unresolved"
  | "ab-order"
  | "none";

export type OngoingOwnershipEvidence = {
  accounts: readonly string[];
  authority: OngoingOwnershipAuthority;
};

export type OngoingDocumentDecision =
  | {
      action: "update";
      documentId: string;
      preserveHistoricFinancials: boolean;
      companyId: string | null;
      companyAssignment: "unchanged" | "assign" | "blocked-by-historic";
    }
  | { action: "create" }
  | {
      action: "reject";
      reason: "COMPANY_OWNERSHIP" | "DUPLICATE_ONGOING" | "AMBIGUOUS_HISTORIC";
      documentId: string | null;
      detail: string;
    };

export function isAuthoritativeOngoingDocument(row: {
  has504: boolean;
  hasTrm21qc: boolean;
  source: string;
}): boolean {
  return (
    row.has504 ||
    row.hasTrm21qc ||
    (ONGOING_DOCUMENT_SOURCES as readonly string[]).includes(row.source)
  );
}

function byAge(left: OngoingDocumentCandidate, right: OngoingDocumentCandidate): number {
  return left.createdAt.getTime() - right.createdAt.getTime();
}

function storedType(row: OngoingDocumentCandidate, incomingType: string): string {
  return row.documentType !== "UNKNOWN" ? row.documentType : incomingType;
}

function sameStoredType(row: OngoingDocumentCandidate, incomingType: string): boolean {
  if (incomingType === "UNKNOWN") return row.documentType === "UNKNOWN";
  return row.documentType === incomingType || row.documentType === "UNKNOWN";
}

function normaliseAccount(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

/** Verified company code, verified alias, or the same AB order company. A reference match is not evidence. */
export function ongoingDocumentOwnershipAllowsUpdate(input: {
  documentReference: string;
  documentType: string;
  documentCompanyId: string | null;
  documentAccount: string | null;
  incomingCompanyId: string | null;
  accounts: readonly string[];
  authority: OngoingOwnershipAuthority;
}): { allow: true } | { allow: false; detail: string } {
  const stored = normaliseAccount(input.documentAccount);
  const accounts = new Set(input.accounts.map(normaliseAccount).filter((account) => account && account !== "UNKNOWN"));
  const storedIsAccount = stored !== "" && stored !== "UNKNOWN";
  const verified = input.authority === "verified-code" || input.authority === "verified-alias";
  const sameCompany = Boolean(
    input.documentCompanyId && input.incomingCompanyId && input.documentCompanyId === input.incomingCompanyId,
  );
  const accountAgrees = storedIsAccount && accounts.has(stored);
  if (verified && sameCompany) return { allow: true };
  if (verified && accountAgrees && (!input.documentCompanyId || !input.incomingCompanyId || sameCompany)) {
    return { allow: true };
  }
  if (verified && !input.documentCompanyId && !storedIsAccount) return { allow: true };
  if (input.authority === "ab-order" && sameCompany) return { allow: true };
  if (input.authority === "ab-order" && !input.documentCompanyId && input.incomingCompanyId && !storedIsAccount) {
    return { allow: true };
  }
  if ((input.authority === "stored-code" || input.authority === "account-link") && sameCompany && accountAgrees) {
    return { allow: true };
  }
  if (
    !input.documentCompanyId &&
    accountAgrees &&
    (input.authority === "stored-code" || input.authority === "account-link" || input.authority === "unresolved")
  ) {
    return { allow: true };
  }
  if (!input.documentCompanyId && !input.incomingCompanyId && accountAgrees) return { allow: true };
  if (input.authority === "none" && accounts.size === 0 && !input.incomingCompanyId) return { allow: true };

  const incoming = [...accounts].join(", ") || "no account";
  const owner = storedIsAccount ? `account ${stored}` : input.documentCompanyId ? "another customer" : "an unassigned document";
  return {
    allow: false,
    detail: `Document ${input.documentReference} (${input.documentType}) belongs to ${owner}. Incoming account ${incoming} is not a verified code or verified alias for that customer. Existing totals and lines were not changed.`,
  };
}

export function resolveOngoingDocumentIdentity(input: {
  documentReference: string;
  documentType: string;
  companyId: string | null;
  candidates: readonly OngoingDocumentCandidate[];
  evidence?: OngoingOwnershipEvidence;
}): OngoingDocumentDecision {
  const reference = input.documentReference.trim();
  const incomingType = input.documentType;
  const ongoing = input.candidates
    .filter((row) => isAuthoritativeOngoingDocument(row) && sameStoredType(row, incomingType))
    .sort(byAge);
  const exactOngoing =
    incomingType === "UNKNOWN" ? ongoing : ongoing.filter((row) => row.documentType === incomingType);
  const adoptableOngoing =
    incomingType === "UNKNOWN" ? [] : ongoing.filter((row) => row.documentType === "UNKNOWN");
  const chosenOngoing = exactOngoing.length ? exactOngoing : adoptableOngoing;

  if (chosenOngoing.length > 1) {
    return {
      action: "reject",
      reason: "DUPLICATE_ONGOING",
      documentId: chosenOngoing[0]!.id,
      detail: `Document ${reference} (${incomingType}) has ${chosenOngoing.length} ongoing rows. None were merged.`,
    };
  }

  const historic = input.candidates
    .filter((row) => !isAuthoritativeOngoingDocument(row) && sameStoredType(row, incomingType))
    .sort(byAge);

  if (chosenOngoing.length === 1) {
    const target = chosenOngoing[0]!;
    if (target.companyId && input.companyId && target.companyId !== input.companyId) {
      return {
        action: "reject",
        reason: "COMPANY_OWNERSHIP",
        documentId: target.id,
        detail: `Document ${reference} (${storedType(target, incomingType)}) already belongs to another customer. Historical rows were not changed.`,
      };
    }
    if (input.evidence) {
      const ownership = ongoingDocumentOwnershipAllowsUpdate({
        documentReference: reference,
        documentType: storedType(target, incomingType),
        documentCompanyId: target.companyId,
        documentAccount: target.autopartCustomerCode ?? null,
        incomingCompanyId: input.companyId,
        accounts: input.evidence.accounts,
        authority: input.evidence.authority,
      });
      if (!ownership.allow) {
        return {
          action: "reject",
          reason: "COMPANY_OWNERSHIP",
          documentId: target.id,
          detail: ownership.detail,
        };
      }
    }
    const nextType = storedType(target, incomingType);
    const verifiedOwnership =
      !input.evidence ||
      input.evidence.authority === "verified-code" ||
      input.evidence.authority === "verified-alias" ||
      input.evidence.authority === "ab-order";
    const historicHoldsCompany = Boolean(
      verifiedOwnership &&
        input.companyId &&
        !target.companyId &&
        historic.some((row) => row.companyId === input.companyId && storedType(row, incomingType) === nextType),
    );
    return {
      action: "update",
      documentId: target.id,
      preserveHistoricFinancials: false,
      companyId: target.companyId,
      companyAssignment:
        !verifiedOwnership || target.companyId || !input.companyId
          ? "unchanged"
          : historicHoldsCompany
            ? "blocked-by-historic"
            : "assign",
    };
  }

  const sameCompany = input.companyId
    ? historic.filter((row) => row.companyId === input.companyId)
    : [];
  if (sameCompany.length > 1) {
    return {
      action: "reject",
      reason: "AMBIGUOUS_HISTORIC",
      documentId: null,
      detail: `Document ${reference} (${incomingType}) has more than one historical row for this company. They were not treated as duplicates.`,
    };
  }
  if (sameCompany.length === 1) {
    const target = sameCompany[0]!;
    return {
      action: "update",
      documentId: target.id,
      preserveHistoricFinancials: true,
      companyId: target.companyId,
      companyAssignment: "unchanged",
    };
  }

  // No resolved company: do not inherit a historical company's identity from the
  // reference alone. A new unassigned ongoing row keeps the feed evidence separate.
  return { action: "create" };
}

export function ongoingDocumentConflictDetail(
  documentReference: string,
  documentType: string,
  target: string | null,
): string {
  const fields = target?.trim() || "documentType, documentReference";
  return `Document ${documentReference} (${documentType}) was not saved. The ongoing identity ${fields} is already in use. Historical totals were not changed.`;
}
