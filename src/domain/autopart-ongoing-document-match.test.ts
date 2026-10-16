import { describe, expect, it } from "vitest";
import {
  resolveOngoingDocumentIdentity,
  type OngoingDocumentCandidate,
} from "@/domain/autopart-ongoing-document-match";

function row(overrides: Partial<OngoingDocumentCandidate> & Pick<OngoingDocumentCandidate, "id">): OngoingDocumentCandidate {
  return {
    companyId: null,
    documentType: "INVOICE",
    source: "SLRB",
    has504: false,
    hasTrm21qc: false,
    createdAt: new Date("2020-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("ongoing document identity", () => {
  it("keeps two historical companies with the same reference as separate rows", () => {
    const decision = resolveOngoingDocumentIdentity({
      documentReference: "INV1",
      documentType: "INVOICE",
      companyId: "company-a",
      candidates: [
        row({ id: "hist-a", companyId: "company-a", createdAt: new Date("2019-01-01T00:00:00.000Z") }),
        row({ id: "hist-b", companyId: "company-b", createdAt: new Date("2018-01-01T00:00:00.000Z") }),
      ],
    });
    expect(decision).toMatchObject({
      action: "update",
      documentId: "hist-a",
      preserveHistoricFinancials: true,
    });
  });

  it("updates the ongoing document instead of an older historical row", () => {
    const decision = resolveOngoingDocumentIdentity({
      documentReference: "INV1",
      documentType: "INVOICE",
      companyId: "company-a",
      candidates: [
        row({ id: "hist-a", companyId: "company-a", createdAt: new Date("2019-01-01T00:00:00.000Z") }),
        row({
          id: "ongoing",
          companyId: "company-a",
          source: "ONGOING_504",
          has504: true,
          createdAt: new Date("2026-10-14T00:00:00.000Z"),
        }),
        row({ id: "hist-b", companyId: "company-b" }),
      ],
    });
    expect(decision).toMatchObject({
      action: "update",
      documentId: "ongoing",
      preserveHistoricFinancials: false,
      companyAssignment: "unchanged",
    });
  });

  it("refuses to attach another customer's ongoing document", () => {
    const decision = resolveOngoingDocumentIdentity({
      documentReference: "INV1",
      documentType: "INVOICE",
      companyId: "company-b",
      candidates: [
        row({ id: "hist-b", companyId: "company-b" }),
        row({ id: "ongoing", companyId: "company-a", has504: true, source: "ONGOING_504" }),
      ],
    });
    expect(decision.action).toBe("reject");
    if (decision.action === "reject") {
      expect(decision.reason).toBe("COMPANY_OWNERSHIP");
      expect(decision.detail).toContain("INV1");
      expect(decision.detail).toContain("another customer");
    }
  });

  it("does not treat duplicate ongoing rows as a last-write winner", () => {
    const decision = resolveOngoingDocumentIdentity({
      documentReference: "INV1",
      documentType: "INVOICE",
      companyId: "company-a",
      candidates: [
        row({ id: "one", has504: true, source: "ONGOING_504" }),
        row({ id: "two", hasTrm21qc: true, source: "ONGOING_TRM21QC", createdAt: new Date("2026-10-15T00:00:00.000Z") }),
      ],
    });
    expect(decision).toMatchObject({ action: "reject", reason: "DUPLICATE_ONGOING" });
  });

  it("updates the only historical document when the feed has not resolved a company", () => {
    const decision = resolveOngoingDocumentIdentity({
      documentReference: "INV1",
      documentType: "INVOICE",
      companyId: null,
      candidates: [row({ id: "hist-a", companyId: "company-a" })],
    });
    expect(decision).toMatchObject({ action: "update", documentId: "hist-a" });
  });

  it("does not guess a company when several historical rows share the reference", () => {
    const decision = resolveOngoingDocumentIdentity({
      documentReference: "INV1",
      documentType: "INVOICE",
      companyId: null,
      candidates: [
        row({ id: "hist-a", companyId: "company-a" }),
        row({ id: "hist-b", companyId: "company-b" }),
      ],
    });
    expect(decision).toMatchObject({ action: "reject", reason: "AMBIGUOUS_HISTORIC" });
  });

  it("creates a new ongoing document when the reference belongs only to other companies", () => {
    const decision = resolveOngoingDocumentIdentity({
      documentReference: "INV1",
      documentType: "INVOICE",
      companyId: "company-a",
      candidates: [row({ id: "hist-b", companyId: "company-b" })],
    });
    expect(decision).toEqual({ action: "create" });
  });

  it("does not assign a company already used by a historical row of the same type", () => {
    const decision = resolveOngoingDocumentIdentity({
      documentReference: "INV1",
      documentType: "INVOICE",
      companyId: "company-a",
      candidates: [
        row({ id: "hist-a", companyId: "company-a" }),
        row({ id: "ongoing", companyId: null, has504: true, source: "ONGOING_504" }),
      ],
    });
    expect(decision).toMatchObject({
      action: "update",
      documentId: "ongoing",
      companyAssignment: "blocked-by-historic",
      companyId: null,
    });
  });
});
