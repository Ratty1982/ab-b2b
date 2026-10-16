/**
 * Validates every TRM21QC line that shares a document reference before any write.
 * A verified company code and a verified alias of that same company are one customer.
 * Different accounts, mixed invoice/credit kinds, and ambiguous links are not merged.
 */

export type TrmAccountAuthority =
  | "verified-code"
  | "verified-alias"
  | "stored-code"
  | "account-link"
  | "ambiguous"
  | "unresolved";

export type TrmAccountResolution = {
  account: string;
  companyId: string | null;
  canonicalCode: string | null;
  authority: TrmAccountAuthority;
};

export type TrmGroupLineIdentity = {
  customerAccount: string;
  kind: "INVOICE" | "CREDIT" | "UNKNOWN";
};

export type TrmGroupDecision =
  | {
      action: "accept";
      documentType: "INVOICE" | "CREDIT";
      companyId: string | null;
      canonicalCode: string | null;
      accounts: string[];
      authority: TrmAccountAuthority;
    }
  | {
      action: "reject";
      reason: "MIXED_CUSTOMER_DOCUMENT" | "MIXED_DOCUMENT_TYPE" | "AMBIGUOUS_CUSTOMER_ACCOUNT";
      detail: string;
    };

function normaliseAccount(value: string): string {
  return value.trim().toUpperCase();
}

export function classifyTrmDocumentGroup(input: {
  documentReference: string;
  lines: readonly TrmGroupLineIdentity[];
  resolutions: readonly TrmAccountResolution[];
}): TrmGroupDecision {
  const reference = input.documentReference.trim();
  const kinds = new Set(
    input.lines.map((line) => line.kind).filter((kind): kind is "INVOICE" | "CREDIT" => kind === "INVOICE" || kind === "CREDIT"),
  );
  if (kinds.has("INVOICE") && kinds.has("CREDIT")) {
    return {
      action: "reject",
      reason: "MIXED_DOCUMENT_TYPE",
      detail: `Document ${reference} mixes invoice and credit lines. No lines were written and historical totals were not changed.`,
    };
  }
  const documentType: "INVOICE" | "CREDIT" = kinds.has("CREDIT") ? "CREDIT" : "INVOICE";
  const accounts = [
    ...new Set(input.lines.map((line) => normaliseAccount(line.customerAccount)).filter(Boolean)),
  ];
  const byAccount = new Map(input.resolutions.map((row) => [normaliseAccount(row.account), row]));
  const resolved = accounts.map(
    (account) =>
      byAccount.get(account) ?? {
        account,
        companyId: null,
        canonicalCode: account,
        authority: "unresolved" as const,
      },
  );
  const ambiguous = resolved.filter((row) => row.authority === "ambiguous");
  if (ambiguous.length) {
    const names = ambiguous.map((row) => row.account).join(", ");
    return {
      action: "reject",
      reason: "AMBIGUOUS_CUSTOMER_ACCOUNT",
      detail: `Document ${reference} uses account ${names}, which is linked to more than one customer. No lines were written.`,
    };
  }
  const companyIds = [...new Set(resolved.map((row) => row.companyId).filter((id): id is string => Boolean(id)))];
  const unresolved = resolved.filter((row) => !row.companyId);
  if (companyIds.length > 1 || (companyIds.length === 1 && unresolved.length > 0) || (companyIds.length === 0 && accounts.length > 1)) {
    const names = accounts.join(", ");
    return {
      action: "reject",
      reason: "MIXED_CUSTOMER_DOCUMENT",
      detail: `Document ${reference} contains customer accounts ${names}. Those identities were not merged and no lines were written.`,
    };
  }
  const companyId = companyIds[0] ?? null;
  const canonical =
    resolved.find((row) => row.authority === "verified-code" && row.canonicalCode)?.canonicalCode ??
    resolved.find((row) => row.canonicalCode)?.canonicalCode ??
    accounts[0] ??
    null;
  const authority: TrmAccountAuthority = resolved.some((row) => row.authority === "verified-code")
    ? "verified-code"
    : resolved.some((row) => row.authority === "verified-alias")
      ? "verified-alias"
      : resolved.some((row) => row.authority === "stored-code")
        ? "stored-code"
        : resolved.some((row) => row.authority === "account-link")
          ? "account-link"
          : "unresolved";
  return {
    action: "accept",
    documentType,
    companyId,
    canonicalCode: canonical,
    accounts,
    authority,
  };
}

/** A line already stored for another customer is never replaced because the line number matches. */
export function incomingLineMayReplace(input: {
  existingCompanyId: string | null;
  existingAccount: string;
  incomingCompanyId: string | null;
  incomingAccounts: readonly string[];
}): boolean {
  const existingAccount = normaliseAccount(input.existingAccount);
  const incomingAccounts = new Set(input.incomingAccounts.map(normaliseAccount).filter(Boolean));
  if (input.existingCompanyId && input.incomingCompanyId) {
    return input.existingCompanyId === input.incomingCompanyId;
  }
  if (input.existingCompanyId && !input.incomingCompanyId) return false;
  if (!input.existingCompanyId && input.incomingCompanyId) {
    return existingAccount === "UNKNOWN" || incomingAccounts.has(existingAccount);
  }
  return existingAccount === "UNKNOWN" || incomingAccounts.has(existingAccount);
}
