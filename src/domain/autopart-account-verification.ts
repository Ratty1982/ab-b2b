/**
 * Decide which assigned Autopart customer IDs may be marked verified.
 *
 * Verification accepts a unique Autopart-to-company mapping. It does not approve
 * a trade application, enable portal access, or move invoices, orders, or history.
 */

export const AUTOPART_ACCOUNT_VERIFICATION_CONFIRMATION = "VERIFY_UNAMBIGUOUS_AUTOPART_ACCOUNTS";

export type AutopartVerificationDecision =
  | "NO_CODE"
  | "ALREADY_VERIFIED"
  | "ELIGIBLE"
  | "CONFLICT"
  | "MANUAL_REVIEW";

export type LinkedMasterDecision = "MATCHES_PRIMARY" | "UNIQUE_EXTRA" | "CONFLICT" | "INVALID";

export type NormalisedAssignedCode = {
  /** Trimmed, whitespace collapsed. Case, leading zeroes, and punctuation stay. */
  display: string | null;
  key: string | null;
  valid: boolean;
  reason: string | null;
};

export type CodeClaim = {
  companyId: string;
  kind: "PRIMARY" | "ALIAS" | "MASTER_LINK";
};

export type CompanyCodeRow = {
  id: string;
  name: string;
  code: string | null;
  verifiedAt: string | null;
  verifiedById: string | null;
};

export type CompanyCodeAssessment = {
  companyId: string;
  companyName: string;
  decision: AutopartVerificationDecision;
  display: string | null;
  key: string | null;
  reason: string | null;
  /** Existing verification timestamp and verifier must be left as they are. */
  preserveVerification: boolean;
};

export type LinkedMasterAssessment = {
  companyId: string;
  display: string | null;
  key: string | null;
  decision: LinkedMasterDecision;
  reason: string | null;
};

const MONEY_LIKE = /^[+-]?(?:\d+\.\d+|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/;

/** Normalise an assigned Autopart ID without dropping leading zeroes or punctuation. */
export function normaliseAssignedAutopartCode(raw: string | null | undefined): NormalisedAssignedCode {
  if (raw == null) return { display: null, key: null, valid: false, reason: null };
  const display = String(raw).trim().replace(/\s+/g, " ");
  if (!display) return { display: null, key: null, valid: false, reason: null };
  const key = display.toUpperCase();
  if (display.length > 80) {
    return { display, key, valid: false, reason: "Autopart ID is longer than 80 characters." };
  }
  if (/\s/.test(display)) {
    return { display, key, valid: false, reason: "Autopart ID contains a space." };
  }
  if (/[£$€]/.test(display) || /\(.*\)/.test(display) || MONEY_LIKE.test(display)) {
    return { display, key, valid: false, reason: "Autopart ID looks like an amount, not an account." };
  }
  return { display, key, valid: true, reason: null };
}

export function classifyCompanyAutopartCode(input: {
  companyId: string;
  companyName?: string;
  code: string | null;
  verifiedAt: string | null;
  claims: readonly CodeClaim[];
}): CompanyCodeAssessment {
  const normalised = normaliseAssignedAutopartCode(input.code);
  const base = {
    companyId: input.companyId,
    companyName: input.companyName ?? "",
    display: normalised.display,
    key: normalised.key,
  };
  if (!normalised.display || !normalised.key) {
    return { ...base, decision: "NO_CODE", reason: null, preserveVerification: false };
  }
  if (!normalised.valid) {
    return {
      ...base,
      decision: "MANUAL_REVIEW",
      reason: normalised.reason,
      preserveVerification: Boolean(input.verifiedAt),
    };
  }
  const foreign = input.claims.filter((claim) => claim.companyId !== input.companyId);
  if (foreign.length > 0) {
    const reason = foreignClaimReason(foreign);
    if (input.verifiedAt) {
      return {
        ...base,
        decision: "ALREADY_VERIFIED",
        reason,
        preserveVerification: true,
      };
    }
    return { ...base, decision: "CONFLICT", reason, preserveVerification: false };
  }
  if (input.verifiedAt) {
    return { ...base, decision: "ALREADY_VERIFIED", reason: null, preserveVerification: true };
  }
  return { ...base, decision: "ELIGIBLE", reason: null, preserveVerification: false };
}

export function classifyLinkedMasterAccount(input: {
  companyId: string;
  accountCode: string;
  primaryKey: string | null;
  claims: readonly CodeClaim[];
}): LinkedMasterAssessment {
  const normalised = normaliseAssignedAutopartCode(input.accountCode);
  const base = {
    companyId: input.companyId,
    display: normalised.display,
    key: normalised.key,
  };
  if (!normalised.valid || !normalised.key) {
    return {
      ...base,
      decision: "INVALID",
      reason: normalised.reason ?? "Linked Autopart ID is missing.",
    };
  }
  const foreign = input.claims.filter((claim) => claim.companyId !== input.companyId);
  if (foreign.length > 0) {
    return { ...base, decision: "CONFLICT", reason: foreignClaimReason(foreign) };
  }
  if (input.primaryKey && input.primaryKey === normalised.key) {
    return { ...base, decision: "MATCHES_PRIMARY", reason: null };
  }
  return {
    ...base,
    decision: "UNIQUE_EXTRA",
    reason: "Linked Autopart ID is unique to this company and is not its primary ID.",
  };
}

/**
 * Claims that stop a silent assignment. The single binding a confirmed reassignment
 * will remove is not a blocker. A 407EXP link or a third company's alias still is.
 */
export function assignmentBlockers(
  foreign: readonly CodeClaim[],
  existing: { companyId: string; kind: CodeClaim["kind"] } | null,
): CodeClaim[] {
  if (!existing) return [...foreign];
  return foreign.filter(
    (claim) => claim.companyId !== existing.companyId || claim.kind !== existing.kind,
  );
}

/**
 * Importer authority for a primary Autopart ID held by one company.
 * A stored timestamp is verified-code. A code also claimed by another company
 * is ambiguous and must not use this result to claim or reassign documents.
 */
export function ongoingPrimaryAuthority(verifiedAt: string | Date | null | undefined): "verified-code" | "stored-code" {
  return verifiedAt ? "verified-code" : "stored-code";
}

function foreignClaimReason(claims: readonly CodeClaim[]): string {
  const kinds = [...new Set(claims.map((claim) => claim.kind))];
  if (kinds.includes("PRIMARY")) return "Another company already has this Autopart ID.";
  if (kinds.includes("ALIAS")) return "Another company has this Autopart ID as a verified alias.";
  return "A 407EXP account with this ID is linked to another company.";
}

export type AutopartVerificationPlan = {
  companiesWithAssignedIds: number;
  alreadyVerified: number;
  eligible: number;
  linked407exp: number;
  conflicts: number;
  manualReview: number;
  eligibleCompanyIds: string[];
  samples: {
    eligible: Array<{ companyId: string; companyName: string; code: string }>;
    conflicts: Array<{ companyId: string; companyName: string; code: string; reason: string }>;
    manualReview: Array<{ companyId: string; companyName: string; code: string; reason: string }>;
    linked407exp: Array<{ companyId: string; code: string; relationship: LinkedMasterDecision }>;
  };
};

const SAMPLE_LIMIT = 25;

/**
 * Read-only plan. Eligible rows are the only ones a later apply may timestamp.
 * Extra unique 407EXP IDs are reported and are not written over the primary code.
 */
export function planAutopartAccountVerification(input: {
  companies: readonly CompanyCodeRow[];
  aliases: readonly { companyId: string; alias: string }[];
  masterLinks: readonly { companyId: string | null; accountCode: string }[];
}): AutopartVerificationPlan {
  const claimsByKey = new Map<string, CodeClaim[]>();
  const addClaim = (raw: string | null, claim: CodeClaim) => {
    const normalised = normaliseAssignedAutopartCode(raw);
    if (!normalised.valid || !normalised.key) return;
    const list = claimsByKey.get(normalised.key) ?? [];
    list.push(claim);
    claimsByKey.set(normalised.key, list);
  };

  for (const company of input.companies) {
    addClaim(company.code, { companyId: company.id, kind: "PRIMARY" });
  }
  for (const alias of input.aliases) {
    addClaim(alias.alias, { companyId: alias.companyId, kind: "ALIAS" });
  }
  const linked = input.masterLinks.filter((row) => row.companyId);
  for (const link of linked) {
    addClaim(link.accountCode, { companyId: link.companyId!, kind: "MASTER_LINK" });
  }

  const primaryKeyByCompany = new Map<string, string | null>();
  const companyName = new Map(input.companies.map((company) => [company.id, company.name]));
  let companiesWithAssignedIds = 0;
  let alreadyVerified = 0;
  let eligible = 0;
  let conflicts = 0;
  let manualReview = 0;
  const eligibleCompanyIds: string[] = [];
  const samples: AutopartVerificationPlan["samples"] = {
    eligible: [],
    conflicts: [],
    manualReview: [],
    linked407exp: [],
  };

  for (const company of input.companies) {
    const normalised = normaliseAssignedAutopartCode(company.code);
    primaryKeyByCompany.set(company.id, normalised.key);
    const assessment = classifyCompanyAutopartCode({
      companyId: company.id,
      companyName: company.name,
      code: company.code,
      verifiedAt: company.verifiedAt,
      claims: normalised.key ? (claimsByKey.get(normalised.key) ?? []) : [],
    });
    if (assessment.decision === "NO_CODE") continue;
    companiesWithAssignedIds += 1;
    if (assessment.decision === "ALREADY_VERIFIED") {
      alreadyVerified += 1;
      if (assessment.reason) {
        conflicts += 1;
        pushSample(samples.conflicts, {
          companyId: company.id,
          companyName: company.name,
          code: assessment.display ?? "",
          reason: assessment.reason,
        });
      }
    } else if (assessment.decision === "ELIGIBLE") {
      eligible += 1;
      eligibleCompanyIds.push(company.id);
      pushSample(samples.eligible, {
        companyId: company.id,
        companyName: company.name,
        code: assessment.display ?? "",
      });
    } else if (assessment.decision === "CONFLICT") {
      conflicts += 1;
      pushSample(samples.conflicts, {
        companyId: company.id,
        companyName: company.name,
        code: assessment.display ?? "",
        reason: assessment.reason ?? "Conflicting Autopart ID.",
      });
    } else {
      manualReview += 1;
      pushSample(samples.manualReview, {
        companyId: company.id,
        companyName: company.name,
        code: assessment.display ?? "",
        reason: assessment.reason ?? "Needs manual review.",
      });
    }
  }

  for (const link of linked) {
    const companyId = link.companyId!;
    const primaryKey = primaryKeyByCompany.get(companyId) ?? null;
    const normalised = normaliseAssignedAutopartCode(link.accountCode);
    const assessment = classifyLinkedMasterAccount({
      companyId,
      accountCode: link.accountCode,
      primaryKey,
      claims: normalised.key ? (claimsByKey.get(normalised.key) ?? []) : [],
    });
    pushSample(samples.linked407exp, {
      companyId,
      code: assessment.display ?? link.accountCode,
      relationship: assessment.decision,
    });
    if (assessment.decision === "MATCHES_PRIMARY") continue;
    if (assessment.decision === "CONFLICT") {
      conflicts += 1;
      pushSample(samples.conflicts, {
        companyId,
        companyName: companyName.get(companyId) ?? "",
        code: assessment.display ?? link.accountCode,
        reason: assessment.reason ?? "Conflicting 407EXP link.",
      });
    } else if (assessment.decision === "INVALID") {
      manualReview += 1;
      pushSample(samples.manualReview, {
        companyId,
        companyName: companyName.get(companyId) ?? "",
        code: assessment.display ?? link.accountCode,
        reason: assessment.reason ?? "Linked Autopart ID needs review.",
      });
    }
  }

  return {
    companiesWithAssignedIds,
    alreadyVerified,
    eligible,
    linked407exp: linked.length,
    conflicts,
    manualReview,
    eligibleCompanyIds,
    samples,
  };
}

function pushSample<T>(list: T[], row: T) {
  if (list.length < SAMPLE_LIMIT) list.push(row);
}

/** Staff-facing status. A unique assigned ID is Verified even before the timestamp is stored. */
export function autopartMappingDisplay(input: {
  decision: AutopartVerificationDecision;
  reason: string | null;
  verifiedByName: string | null;
}): {
  verified: boolean;
  verificationRecorded: boolean;
  attention: string | null;
  verifiedByLabel: string | null;
} {
  if (input.decision === "NO_CODE") {
    return { verified: false, verificationRecorded: false, attention: null, verifiedByLabel: null };
  }
  if (input.decision === "CONFLICT" || input.decision === "MANUAL_REVIEW") {
    return {
      verified: false,
      verificationRecorded: false,
      attention: input.reason,
      verifiedByLabel: null,
    };
  }
  const recorded = input.decision === "ALREADY_VERIFIED";
  if (recorded && input.reason) {
    return {
      verified: false,
      verificationRecorded: true,
      attention: input.reason,
      verifiedByLabel: input.verifiedByName ?? "Automatic",
    };
  }
  return {
    verified: true,
    verificationRecorded: recorded,
    attention: input.reason,
    verifiedByLabel: recorded ? (input.verifiedByName ?? "Automatic") : null,
  };
}
