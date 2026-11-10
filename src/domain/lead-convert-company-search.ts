/**
 * Ranking for CRM lead convert → link existing company search.
 * Exact Autopart / account codes must outrank alphabetical name matches.
 */

export type LeadConvertMatchKind =
  | "exact_autopart_code"
  | "exact_account_number"
  | "autopart_code_prefix"
  | "account_number_prefix"
  | "name_prefix"
  | "name_partial"
  | "email_partial";

export type LeadConvertCompanyCandidate = {
  id: string;
  name: string;
  tradingName: string | null;
  status: string;
  autopartCustomerCode: string | null;
  autopartCustomerCodeVerifiedAt: string | Date | null;
  accountNumber: string | null;
  primaryEmail: string | null;
};

export type RankedLeadConvertCompany = LeadConvertCompanyCandidate & {
  matchKind: LeadConvertMatchKind;
  exactCodeMatch: boolean;
  autopartVerified: boolean;
};

const MATCH_RANK: Record<LeadConvertMatchKind, number> = {
  exact_autopart_code: 1,
  exact_account_number: 2,
  autopart_code_prefix: 3,
  account_number_prefix: 4,
  name_prefix: 5,
  name_partial: 6,
  email_partial: 7,
};

export function normalizeLeadConvertSearchQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ");
}

function fold(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function classifyLeadConvertCompanyMatch(
  candidate: LeadConvertCompanyCandidate,
  rawQuery: string,
): LeadConvertMatchKind | null {
  const q = fold(normalizeLeadConvertSearchQuery(rawQuery));
  if (!q) return null;

  const code = fold(candidate.autopartCustomerCode);
  const account = fold(candidate.accountNumber);
  const name = fold(candidate.name);
  const trading = fold(candidate.tradingName);
  const email = fold(candidate.primaryEmail);

  if (code && code === q) return "exact_autopart_code";
  if (account && account === q) return "exact_account_number";
  if (code && code.startsWith(q)) return "autopart_code_prefix";
  if (account && account.startsWith(q)) return "account_number_prefix";
  if ((name && name.startsWith(q)) || (trading && trading.startsWith(q))) return "name_prefix";
  if ((name && name.includes(q)) || (trading && trading.includes(q))) return "name_partial";
  if (email && email.includes(q)) return "email_partial";
  return null;
}

export function rankLeadConvertCompanies(
  candidates: LeadConvertCompanyCandidate[],
  rawQuery: string,
  limit = 15,
): RankedLeadConvertCompany[] {
  const scored = candidates
    .map((candidate) => {
      const matchKind = classifyLeadConvertCompanyMatch(candidate, rawQuery);
      if (!matchKind) return null;
      return {
        ...candidate,
        matchKind,
        exactCodeMatch:
          matchKind === "exact_autopart_code" || matchKind === "exact_account_number",
        autopartVerified: Boolean(candidate.autopartCustomerCodeVerifiedAt),
        _rank: MATCH_RANK[matchKind],
        _name: fold(candidate.name),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  scored.sort((a, b) => {
    if (a._rank !== b._rank) return a._rank - b._rank;
    return a._name.localeCompare(b._name);
  });

  const seen = new Set<string>();
  const out: RankedLeadConvertCompany[] = [];
  for (const row of scored) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({
      id: row.id,
      name: row.name,
      tradingName: row.tradingName,
      status: row.status,
      autopartCustomerCode: row.autopartCustomerCode,
      autopartCustomerCodeVerifiedAt: row.autopartCustomerCodeVerifiedAt,
      accountNumber: row.accountNumber,
      primaryEmail: row.primaryEmail,
      matchKind: row.matchKind,
      exactCodeMatch: row.exactCodeMatch,
      autopartVerified: row.autopartVerified,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function leadConvertMatchLabel(kind: LeadConvertMatchKind): string | null {
  if (kind === "exact_autopart_code" || kind === "exact_account_number") {
    return "Exact code match";
  }
  return null;
}

/** Clear the linked-company selection whenever the search box value changes. */
export function shouldClearLeadConvertSelection(
  previousQuery: string,
  nextQuery: string,
): boolean {
  return previousQuery !== nextQuery;
}
