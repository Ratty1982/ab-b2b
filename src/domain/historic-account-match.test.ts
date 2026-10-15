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
    externalRefCompanyId: null,
    accountNumberCompanyId: null,
    linkedCompanyCode: null,
    independentIdentity: false,
    staffLinked: false,
    prospectCreated: false,
    foreignStoredCode: false,
    ...overrides,
  };
}

describe("historic account matching", () => {
  it("treats a proper prefix as truncated and never as a shorter verified code", () => {
    expect([...truncatedAccountCodes(["ACME", "ACME01", "ZZ", "ZZ9"])]).toEqual(["ACME"]);
    const decision = classifyHistoricMasterAccount(facts({ truncatedCode: true, staffLinked: true, linkedCompanyId: "c1" }));
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

  it("does not verify from a prospect link or from the company name", () => {
    const prospect = classifyHistoricMasterAccount(
      facts({
        linkedCompanyId: "c1",
        codeHolderCompanyId: "c1",
        linkedCompanyCode: "ACME01",
        prospectCreated: true,
      }),
    );
    expect(prospect.category).toBe("LINKED_UNVERIFIED");
    const namedOnly = classifyHistoricMasterAccount(facts());
    expect(namedOnly.category).toBe("NO_MATCH");
  });

  it("accepts exact independent evidence and rejects conflicts", () => {
    const external = classifyHistoricMasterAccount(facts({ externalRefCompanyId: "c1" }));
    expect(external.category).toBe("EXACT_EVIDENCE");
    expect(external.evidence[0]).toContain("external reference");

    const trading = classifyHistoricMasterAccount(
      facts({
        linkedCompanyId: "c1",
        codeHolderCompanyId: "c1",
        linkedCompanyCode: "ACME01",
        independentIdentity: true,
        prospectCreated: true,
      }),
    );
    expect(trading.category).toBe("EXACT_EVIDENCE");

    const staff = classifyHistoricMasterAccount(facts({ linkedCompanyId: "c1", staffLinked: true, linkedCompanyCode: "ACME01" }));
    expect(staff.category).toBe("EXACT_EVIDENCE");

    const clash = classifyHistoricMasterAccount(
      facts({ linkedCompanyId: "c1", externalRefCompanyId: "c2", linkedCompanyCode: "ACME01" }),
    );
    expect(clash.category).toBe("CONFLICT");
    const shared = classifyHistoricMasterAccount(facts({ linkedCompanyId: "c1", otherMastersOnCompany: 1 }));
    expect(shared.category).toBe("CONFLICT");
    const different = classifyHistoricMasterAccount(
      facts({ linkedCompanyId: "c1", linkedCompanyCode: "OTHER" }),
    );
    expect(different.category).toBe("CONFLICT");
    const stored = classifyHistoricMasterAccount(facts({ externalRefCompanyId: "c1", foreignStoredCode: true }));
    expect(stored.category).toBe("CONFLICT");
    expect(stored.evidence).toEqual([]);
  });
});
