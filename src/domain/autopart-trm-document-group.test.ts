import { describe, expect, it } from "vitest";
import { classifyTrmDocumentGroup, incomingLineMayReplace } from "@/domain/autopart-trm-document-group";

describe("TRM document group identity", () => {
  it("accepts a verified code and a verified alias as one customer", () => {
    const decision = classifyTrmDocumentGroup({
      documentReference: "INV1",
      lines: [
        { customerAccount: "yorkmot", kind: "INVOICE" },
        { customerAccount: "YORKMOTO", kind: "INVOICE" },
      ],
      resolutions: [
        { account: "YORKMOT", companyId: "company-a", canonicalCode: "YORKMOT", authority: "verified-code" },
        { account: "YORKMOTO", companyId: "company-a", canonicalCode: "YORKMOT", authority: "verified-alias" },
      ],
    });
    expect(decision).toMatchObject({
      action: "accept",
      documentType: "INVOICE",
      companyId: "company-a",
      canonicalCode: "YORKMOT",
    });
  });

  it("rejects two customer accounts on one document reference", () => {
    const decision = classifyTrmDocumentGroup({
      documentReference: "INV1",
      lines: [
        { customerAccount: "ACCT-A", kind: "INVOICE" },
        { customerAccount: "ACCT-B", kind: "INVOICE" },
      ],
      resolutions: [
        { account: "ACCT-A", companyId: "company-a", canonicalCode: "ACCT-A", authority: "verified-code" },
        { account: "ACCT-B", companyId: "company-b", canonicalCode: "ACCT-B", authority: "verified-code" },
      ],
    });
    expect(decision.action).toBe("reject");
    if (decision.action === "reject") {
      expect(decision.reason).toBe("MIXED_CUSTOMER_DOCUMENT");
      expect(decision.detail).toContain("INV1");
      expect(decision.detail).toContain("ACCT-A");
      expect(decision.detail).toContain("ACCT-B");
    }
  });

  it("rejects an unresolved account riding on a resolved customer", () => {
    const decision = classifyTrmDocumentGroup({
      documentReference: "INV1",
      lines: [
        { customerAccount: "ACCT-A", kind: "INVOICE" },
        { customerAccount: "ACCT-X", kind: "INVOICE" },
      ],
      resolutions: [
        { account: "ACCT-A", companyId: "company-a", canonicalCode: "ACCT-A", authority: "verified-code" },
        { account: "ACCT-X", companyId: null, canonicalCode: "ACCT-X", authority: "unresolved" },
      ],
    });
    expect(decision).toMatchObject({ action: "reject", reason: "MIXED_CUSTOMER_DOCUMENT" });
  });

  it("rejects two unresolved accounts that only share a document reference", () => {
    const decision = classifyTrmDocumentGroup({
      documentReference: "INV1",
      lines: [
        { customerAccount: "ACCT-A", kind: "INVOICE" },
        { customerAccount: "ACCT-B", kind: "INVOICE" },
      ],
      resolutions: [
        { account: "ACCT-A", companyId: null, canonicalCode: "ACCT-A", authority: "unresolved" },
        { account: "ACCT-B", companyId: null, canonicalCode: "ACCT-B", authority: "unresolved" },
      ],
    });
    expect(decision).toMatchObject({ action: "reject", reason: "MIXED_CUSTOMER_DOCUMENT" });
  });

  it("rejects mixed invoice and credit lines", () => {
    const decision = classifyTrmDocumentGroup({
      documentReference: "INV1",
      lines: [
        { customerAccount: "ACCT-A", kind: "INVOICE" },
        { customerAccount: "ACCT-A", kind: "CREDIT" },
      ],
      resolutions: [
        { account: "ACCT-A", companyId: "company-a", canonicalCode: "ACCT-A", authority: "verified-code" },
      ],
    });
    expect(decision).toMatchObject({ action: "reject", reason: "MIXED_DOCUMENT_TYPE" });
  });

  it("rejects an account linked to more than one customer", () => {
    const decision = classifyTrmDocumentGroup({
      documentReference: "INV1",
      lines: [{ customerAccount: "SHARED", kind: "CREDIT" }],
      resolutions: [{ account: "SHARED", companyId: null, canonicalCode: "SHARED", authority: "ambiguous" }],
    });
    expect(decision).toMatchObject({ action: "reject", reason: "AMBIGUOUS_CUSTOMER_ACCOUNT" });
  });

  it("keeps one unresolved account unassigned", () => {
    const decision = classifyTrmDocumentGroup({
      documentReference: "INV1",
      lines: [{ customerAccount: "ACCT-A", kind: "INVOICE" }],
      resolutions: [{ account: "ACCT-A", companyId: null, canonicalCode: "ACCT-A", authority: "unresolved" }],
    });
    expect(decision).toMatchObject({ action: "accept", companyId: null, canonicalCode: "ACCT-A" });
  });
});

describe("TRM line replacement", () => {
  it("allows a repeat for the same customer and refuses another customer's line number", () => {
    expect(
      incomingLineMayReplace({
        existingCompanyId: "company-a",
        existingAccount: "ACCT-A",
        incomingCompanyId: "company-a",
        incomingAccounts: ["ACCT-A"],
      }),
    ).toBe(true);
    expect(
      incomingLineMayReplace({
        existingCompanyId: "company-a",
        existingAccount: "ACCT-A",
        incomingCompanyId: "company-b",
        incomingAccounts: ["ACCT-B"],
      }),
    ).toBe(false);
    expect(
      incomingLineMayReplace({
        existingCompanyId: "company-a",
        existingAccount: "ACCT-A",
        incomingCompanyId: null,
        incomingAccounts: ["ACCT-A"],
      }),
    ).toBe(false);
    expect(
      incomingLineMayReplace({
        existingCompanyId: null,
        existingAccount: "ACCT-B",
        incomingCompanyId: null,
        incomingAccounts: ["ACCT-A"],
      }),
    ).toBe(false);
  });
});
