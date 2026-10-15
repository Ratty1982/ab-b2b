import { describe, expect, it } from "vitest";
import {
  classifyHistoricMasterAccount,
  truncatedAccountCodes,
  type HistoricMatchFacts,
} from "@/domain/historic-account-match";

function facts(overrides: Partial<HistoricMatchFacts> = {}): HistoricMatchFacts {
  return {
    accountCode: "ACME01",
    linkedCompanyId: null,
    otherMastersOnCompany: 0,
    truncatedCode: false,
    verifiedCompanyIds: [],
    codeHolderCompanyId: null,
    duplicateStoredCodes: false,
    externalRefCompanyId: null,
    duplicateExternalRefs: false,
    accountNumberCompanyId: null,
    duplicateAccountNumbers: false,
    linkedCompanyCode: null,
    staffLinkCompanyId: null,
    staffLinkDisputed: false,
    prospectCreated: false,
    foreignStoredCode: false,
    ...overrides,
  };
}

describe("historic account matching", () => {
  it("treats a proper prefix as truncated and never as a shorter verified code", () => {
    expect([...truncatedAccountCodes(["ACME", "ACME01", "ZZ", "ZZ9"])]).toEqual(["ACME"]);
    const decision = classifyHistoricMasterAccount(
      facts({ truncatedCode: true, staffLinkCompanyId: "c1", linkedCompanyId: "c1", linkedCompanyCode: "ACME01" }),
    );
    expect(decision.category).toBe("CONFLICT");
    expect(decision.evidence).toEqual([]);
  });

  it("keeps an already verified exact code, including one that is also a prefix", () => {
    const decision = classifyHistoricMasterAccount(
      facts({ verifiedCompanyIds: ["c1"], linkedCompanyId: "c1", linkedCompanyCode: "ACME01" }),
    );
    expect(decision.category).toBe("VERIFIED");
    expect(decision.companyId).toBe("c1");
    const prefixed = classifyHistoricMasterAccount(
      facts({ verifiedCompanyIds: ["c1"], truncatedCode: true, linkedCompanyId: "c1", linkedCompanyCode: "ACME01" }),
    );
    expect(prefixed.category).toBe("VERIFIED");
  });

  it("does not verify from a prospect link, a stored code, or trading details", () => {
    const prospect = classifyHistoricMasterAccount(
      facts({
        linkedCompanyId: "c1",
        codeHolderCompanyId: "c1",
        linkedCompanyCode: "ACME01",
        prospectCreated: true,
      }),
    );
    expect(prospect.category).toBe("LINKED_UNVERIFIED");
    const stored = classifyHistoricMasterAccount(
      facts({
        linkedCompanyId: "c1",
        codeHolderCompanyId: "c1",
        linkedCompanyCode: "ACME01",
        accountNumberCompanyId: "c1",
        externalRefCompanyId: "c1",
      }),
    );
    expect(stored.category).toBe("LINKED_UNVERIFIED");
    expect(classifyHistoricMasterAccount(facts()).category).toBe("NO_MATCH");
    expect(classifyHistoricMasterAccount(facts({ externalRefCompanyId: "c1" })).category).toBe("NO_MATCH");
  });

  it("accepts only a current staff link and rejects stale or duplicated identities", () => {
    const staff = classifyHistoricMasterAccount(
      facts({ linkedCompanyId: "c1", staffLinkCompanyId: "c1", linkedCompanyCode: "ACME01" }),
    );
    expect(staff.category).toBe("EXACT_EVIDENCE");
    expect(staff.evidence[0]).toContain("no later link");

    const stale = classifyHistoricMasterAccount(
      facts({ linkedCompanyId: "c1", staffLinkDisputed: true, linkedCompanyCode: "ACME01" }),
    );
    expect(stale.category).toBe("CONFLICT");
    expect(stale.evidence).toEqual([]);

    expect(classifyHistoricMasterAccount(facts({ duplicateExternalRefs: true, externalRefCompanyId: "c1" })).category).toBe(
      "CONFLICT",
    );
    expect(classifyHistoricMasterAccount(facts({ duplicateAccountNumbers: true, accountNumberCompanyId: "c1" })).category).toBe(
      "CONFLICT",
    );
    expect(classifyHistoricMasterAccount(facts({ duplicateStoredCodes: true, codeHolderCompanyId: "c1" })).category).toBe(
      "CONFLICT",
    );

    const clash = classifyHistoricMasterAccount(
      facts({ linkedCompanyId: "c1", accountNumberCompanyId: "c2", linkedCompanyCode: "ACME01" }),
    );
    expect(clash.category).toBe("CONFLICT");
    const shared = classifyHistoricMasterAccount(facts({ linkedCompanyId: "c1", otherMastersOnCompany: 1 }));
    expect(shared.category).toBe("CONFLICT");
    const different = classifyHistoricMasterAccount(facts({ linkedCompanyId: "c1", linkedCompanyCode: "OTHER" }));
    expect(different.category).toBe("CONFLICT");
    const stored = classifyHistoricMasterAccount(facts({ accountNumberCompanyId: "c1", foreignStoredCode: true }));
    expect(stored.category).toBe("CONFLICT");
  });
});
