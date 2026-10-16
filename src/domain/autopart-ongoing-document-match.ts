/**
 * Chooses the one ongoing 504/TRM21QC document for a type and reference.
 * Historical rows stay company-scoped. The same reference on two companies is not a duplicate.
 * An ongoing row is the authoritative identity: has504, hasTrm21qc, or an ongoing source.
 */

export const ONGOING_DOCUMENT_SOURCES = ["ONGOING_504", "ONGOING_TRM21QC", "ONGOING_504_BRIDGE"] as const;

export type OngoingDocumentCandidate = {
  id: string;
  companyId: string | null;
  documentType: string;
  source: string;
  has504: boolean;
  hasTrm21qc: boolean;
  createdAt: Date;
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

export function resolveOngoingDocumentIdentity(input: {
  documentReference: string;
  documentType: string;
  companyId: string | null;
  candidates: readonly OngoingDocumentCandidate[];
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
    const nextType = storedType(target, incomingType);
    const historicHoldsCompany = Boolean(
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
        target.companyId || !input.companyId ? "unchanged" : historicHoldsCompany ? "blocked-by-historic" : "assign",
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

  if (!input.companyId && historic.length === 1) {
    const target = historic[0]!;
    return {
      action: "update",
      documentId: target.id,
      preserveHistoricFinancials: true,
      companyId: target.companyId,
      companyAssignment: "unchanged",
    };
  }
  if (!input.companyId && historic.length > 1) {
    return {
      action: "reject",
      reason: "AMBIGUOUS_HISTORIC",
      documentId: null,
      detail: `Document ${reference} (${incomingType}) is on more than one historical company and this feed row has no customer. None of those totals were changed.`,
    };
  }

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
