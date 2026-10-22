import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ongoingDocumentOwnershipAllowsUpdate } from "@/domain/autopart-ongoing-document-match";
import {
  AUTOPART_ACCOUNT_VERIFICATION_CONFIRMATION,
  assignmentBlockers,
  autopartMappingDisplay,
  classifyCompanyAutopartCode,
  classifyLinkedMasterAccount,
  normaliseAssignedAutopartCode,
  ongoingPrimaryAuthority,
  planAutopartAccountVerification,
} from "@/domain/autopart-account-verification";

describe("assigned Autopart ID normalisation", () => {
  it("keeps leading zeroes and punctuation", () => {
    const code = normaliseAssignedAutopartCode("  001-AB  ");
    expect(code.display).toBe("001-AB");
    expect(code.key).toBe("001-AB");
    expect(code.valid).toBe(true);
  });

  it("sends amounts and spaced tokens to manual review", () => {
    expect(normaliseAssignedAutopartCode("12.50").valid).toBe(false);
    expect(normaliseAssignedAutopartCode("£10").valid).toBe(false);
    expect(normaliseAssignedAutopartCode("AB 12").valid).toBe(false);
    expect(normaliseAssignedAutopartCode("00123").valid).toBe(true);
  });
});

describe("automatic verification plan", () => {
  const verifiedAt = "2026-01-01T00:00:00.000Z";

  it("verifies a unique assigned ID and leaves an existing verification untouched", () => {
    const plan = planAutopartAccountVerification({
      companies: [
        { id: "a", name: "Alpha", code: "001-AB", verifiedAt: null, verifiedById: null },
        { id: "b", name: "Beta", code: "BETA01", verifiedAt, verifiedById: "staff-1" },
      ],
      aliases: [],
      masterLinks: [],
    });
    expect(plan.companiesWithAssignedIds).toBe(2);
    expect(plan.eligible).toBe(1);
    expect(plan.eligibleCompanyIds).toEqual(["a"]);
    expect(plan.alreadyVerified).toBe(1);
    expect(plan.conflicts).toBe(0);

    const again = planAutopartAccountVerification({
      companies: [
        { id: "a", name: "Alpha", code: "001-AB", verifiedAt, verifiedById: null },
        { id: "b", name: "Beta", code: "BETA01", verifiedAt, verifiedById: "staff-1" },
      ],
      aliases: [],
      masterLinks: [],
    });
    expect(again.eligible).toBe(0);
    expect(again.alreadyVerified).toBe(2);
    expect(again.eligibleCompanyIds).toEqual([]);
  });

  it("does not verify a code held as another company's alias or 407EXP link", () => {
    const plan = planAutopartAccountVerification({
      companies: [
        { id: "a", name: "Alpha", code: "SHARED", verifiedAt: null, verifiedById: null },
        { id: "b", name: "Beta", code: "BETA01", verifiedAt, verifiedById: "staff-1" },
        { id: "c", name: "Gamma", code: "LINKED", verifiedAt: null, verifiedById: null },
      ],
      aliases: [{ companyId: "b", alias: "SHARED" }],
      masterLinks: [{ companyId: "b", accountCode: "LINKED" }],
    });
    expect(plan.eligibleCompanyIds).toEqual([]);
    expect(plan.conflicts).toBeGreaterThanOrEqual(2);
    expect(plan.samples.conflicts.map((row) => row.code).sort()).toEqual(["LINKED", "LINKED", "SHARED"]);
  });

  it("keeps a second unique 407EXP ID off the primary code", () => {
    const plan = planAutopartAccountVerification({
      companies: [{ id: "a", name: "Alpha", code: "PRIMARY", verifiedAt: null, verifiedById: null }],
      aliases: [{ companyId: "a", alias: "ALIAS1" }],
      masterLinks: [
        { companyId: "a", accountCode: "PRIMARY" },
        { companyId: "a", accountCode: "EXTRA01" },
      ],
    });
    expect(plan.eligibleCompanyIds).toEqual(["a"]);
    expect(plan.linked407exp).toBe(2);
    expect(plan.samples.linked407exp).toEqual([
      { companyId: "a", code: "PRIMARY", relationship: "MATCHES_PRIMARY" },
      { companyId: "a", code: "EXTRA01", relationship: "UNIQUE_EXTRA" },
    ]);
    expect(plan.samples.eligible[0]?.code).toBe("PRIMARY");
  });

  it("treats two companies with the same ID as a conflict", () => {
    const plan = planAutopartAccountVerification({
      companies: [
        { id: "a", name: "Alpha", code: "dup01", verifiedAt: null, verifiedById: null },
        { id: "b", name: "Beta", code: "DUP01", verifiedAt: null, verifiedById: null },
      ],
      aliases: [],
      masterLinks: [],
    });
    expect(plan.eligible).toBe(0);
    expect(plan.conflicts).toBe(2);
  });

  it("shows Needs review for a verified ID that another company also claims", () => {
    const cases = [
      {
        own: "PRIMARY" as const,
        foreign: "PRIMARY" as const,
        reason: /already has this Autopart ID/i,
      },
      {
        own: "ALIAS" as const,
        foreign: "ALIAS" as const,
        reason: /verified alias/i,
      },
      {
        own: "PRIMARY" as const,
        foreign: "MASTER_LINK" as const,
        reason: /407EXP/i,
      },
    ];
    for (const item of cases) {
      const assessment = classifyCompanyAutopartCode({
        companyId: "a",
        code: "DUP01",
        verifiedAt,
        claims: [
          { companyId: "a", kind: item.own },
          { companyId: "b", kind: item.foreign },
        ],
      });
      expect(assessment.decision).toBe("ALREADY_VERIFIED");
      expect(assessment.preserveVerification).toBe(true);
      expect(assessment.reason).toMatch(item.reason);
      const display = autopartMappingDisplay({
        decision: assessment.decision,
        reason: assessment.reason,
        verifiedByName: "Alex",
      });
      expect(display.verified).toBe(false);
      expect(display.verificationRecorded).toBe(true);
      expect(display.attention).toMatch(item.reason);
      expect(display.verifiedByLabel).toBe("Alex");
    }
  });

  it("labels a unique unverified mapping as verified for display", () => {
    const eligible = classifyCompanyAutopartCode({
      companyId: "a",
      code: "00123",
      verifiedAt: null,
      claims: [{ companyId: "a", kind: "PRIMARY" }],
    });
    const display = autopartMappingDisplay({
      decision: eligible.decision,
      reason: eligible.reason,
      verifiedByName: null,
    });
    expect(display.verified).toBe(true);
    expect(display.verificationRecorded).toBe(false);
    expect(display.verifiedByLabel).toBeNull();

    const recorded = autopartMappingDisplay({
      decision: "ALREADY_VERIFIED",
      reason: null,
      verifiedByName: null,
    });
    expect(recorded.verified).toBe(true);
    expect(recorded.verificationRecorded).toBe(true);
    expect(recorded.verifiedByLabel).toBe("Automatic");
    expect(recorded.attention).toBeNull();
  });

  it("sends an invalid stored ID to manual review and does not verify it", () => {
    const plan = planAutopartAccountVerification({
      companies: [{ id: "a", name: "Alpha", code: "12.50", verifiedAt: null, verifiedById: null }],
      aliases: [],
      masterLinks: [],
    });
    expect(plan.eligibleCompanyIds).toEqual([]);
    expect(plan.manualReview).toBe(1);
    expect(plan.samples.manualReview[0]?.reason).toMatch(/amount/i);
  });

  it("does not call an extra unique link a replacement primary", () => {
    const link = classifyLinkedMasterAccount({
      companyId: "a",
      accountCode: "EXTRA01",
      primaryKey: "PRIMARY",
      claims: [{ companyId: "a", kind: "MASTER_LINK" }],
    });
    expect(link.decision).toBe("UNIQUE_EXTRA");
  });
});

describe("future assignment safeguards", () => {
  it("allows reassignment of one binding and blocks a leftover 407EXP link", () => {
    const primary = { companyId: "b", kind: "PRIMARY" as const };
    expect(assignmentBlockers([primary], primary)).toEqual([]);
    expect(
      assignmentBlockers(
        [primary, { companyId: "b", kind: "MASTER_LINK" }],
        primary,
      ).map((claim) => claim.kind),
    ).toEqual(["MASTER_LINK"]);
    expect(assignmentBlockers([{ companyId: "b", kind: "MASTER_LINK" }], null)).toHaveLength(1);
  });
});

describe("verified Autopart IDs and ongoing ownership", () => {
  it("treats a recorded timestamp as verified-code and a missing one as stored-code", () => {
    expect(ongoingPrimaryAuthority(null)).toBe("stored-code");
    expect(ongoingPrimaryAuthority("2026-10-20T00:00:00.000Z")).toBe("verified-code");
  });

  it("lets a verified code update its own unassigned document and refuses another customer", () => {
    expect(
      ongoingDocumentOwnershipAllowsUpdate({
        documentReference: "SS1",
        documentType: "INVOICE",
        documentCompanyId: null,
        documentAccount: "001-AB",
        incomingCompanyId: "company-a",
        accounts: ["001-AB"],
        authority: "verified-code",
      }).allow,
    ).toBe(true);
    const blocked = ongoingDocumentOwnershipAllowsUpdate({
      documentReference: "SS1",
      documentType: "INVOICE",
      documentCompanyId: "company-b",
      documentAccount: "001-AB",
      incomingCompanyId: "company-a",
      accounts: ["001-AB"],
      authority: "verified-code",
    });
    expect(blocked.allow).toBe(false);
    expect(
      ongoingDocumentOwnershipAllowsUpdate({
        documentReference: "SS1",
        documentType: "INVOICE",
        documentCompanyId: "company-b",
        documentAccount: "001-AB",
        incomingCompanyId: "company-a",
        accounts: ["001-AB"],
        authority: ongoingPrimaryAuthority(null),
      }).allow,
    ).toBe(false);
    expect(
      ongoingDocumentOwnershipAllowsUpdate({
        documentReference: "SS2",
        documentType: "INVOICE",
        documentCompanyId: null,
        documentAccount: "OTHER",
        incomingCompanyId: "company-a",
        accounts: ["001-AB"],
        authority: "verified-code",
      }).allow,
    ).toBe(false);
  });

  it("does not let an ambiguous account claim an unassigned document or reassign another customer's", () => {
    const invoice = ongoingDocumentOwnershipAllowsUpdate({
      documentReference: "SS1",
      documentType: "INVOICE",
      documentCompanyId: null,
      documentAccount: "DUP01",
      incomingCompanyId: "company-a",
      accounts: ["DUP01"],
      authority: "ambiguous",
    });
    expect(invoice.allow).toBe(false);
    const credit = ongoingDocumentOwnershipAllowsUpdate({
      documentReference: "CR1",
      documentType: "CREDIT",
      documentCompanyId: "company-b",
      documentAccount: "DUP01",
      incomingCompanyId: "company-a",
      accounts: ["DUP01"],
      authority: "ambiguous",
    });
    expect(credit.allow).toBe(false);
  });
});

describe("verification confirmation", () => {
  it("uses an explicit phrase and does not describe access approval", () => {
    expect(AUTOPART_ACCOUNT_VERIFICATION_CONFIRMATION).toBe("VERIFY_UNAMBIGUOUS_AUTOPART_ACCOUNTS");
  });

  it("records only the verification timestamp and leaves access fields alone", () => {
    const source = readFileSync("src/server/companies/autopart-account-verification.ts", "utf8");
    const apply = source.slice(source.indexOf("export async function applyAutopartAccountVerification"));
    expect(apply).toContain("autopartCustomerCodeVerifiedAt: verifiedAt");
    expect(apply).not.toContain("autopartCustomerCodeVerifiedById");
    expect(apply).not.toMatch(/portalEligible|historicalAccess|priceList|paymentTerms/);
    expect(apply).toContain('attribution: "automatic"');
    const sales = readFileSync("src/server/sales-intelligence/unified-sales.ts", "utf8");
    expect(sales).toContain('c."autopartCustomerCodeVerifiedById" IS NOT NULL');
    const history = readFileSync("src/server/companies/autopart-history.ts", "utf8");
    expect(history).toContain("!company.autopartCustomerCodeVerifiedById");
    expect(source).not.toContain("prisma.order");
    expect(source).not.toContain("prisma.invoice");
    expect(source).not.toContain("prisma.autopartSalesDocument");
  });
});
