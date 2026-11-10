import { describe, expect, it } from "vitest";
import {
  classifyLeadConvertCompanyMatch,
  leadConvertMatchLabel,
  normalizeLeadConvertSearchQuery,
  rankLeadConvertCompanies,
  shouldClearLeadConvertSelection,
  type LeadConvertCompanyCandidate,
} from "@/domain/lead-convert-company-search";

function candidate(
  partial: Partial<LeadConvertCompanyCandidate> & Pick<LeadConvertCompanyCandidate, "id" | "name">,
): LeadConvertCompanyCandidate {
  return {
    tradingName: null,
    status: "ACTIVE",
    autopartCustomerCode: null,
    autopartCustomerCodeVerifiedAt: null,
    accountNumber: null,
    primaryEmail: null,
    ...partial,
  };
}

describe("lead convert company search ranking", () => {
  it("normalises whitespace", () => {
    expect(normalizeLeadConvertSearchQuery("  AA   12  ")).toBe("AA 12");
  });

  it("ranks exact Autopart code above alphabetical company names", () => {
    const clutter = Array.from({ length: 20 }, (_, i) =>
      candidate({
        id: `name-${i}`,
        name: `A & B AUTOPARTS LTD ${String(i).padStart(2, "0")}`,
      }),
    );
    const exact = candidate({
      id: "exact-aa",
      name: "Zulu Motors",
      autopartCustomerCode: "AA",
      autopartCustomerCodeVerifiedAt: new Date("2024-01-01"),
    });
    const ranked = rankLeadConvertCompanies([...clutter, exact], "aa", 15);
    expect(ranked[0]?.id).toBe("exact-aa");
    expect(ranked[0]?.matchKind).toBe("exact_autopart_code");
    expect(ranked[0]?.exactCodeMatch).toBe(true);
    expect(ranked[0]?.autopartVerified).toBe(true);
    expect(leadConvertMatchLabel(ranked[0]!.matchKind)).toBe("Exact code match");
    expect(ranked.some((r) => r.id === "exact-aa")).toBe(true);
  });

  it("ranks exact account number after exact Autopart code", () => {
    const byAccount = candidate({
      id: "acct",
      name: "Account Match Co",
      accountNumber: "AA99",
    });
    const byCode = candidate({
      id: "code",
      name: "Code Match Co",
      autopartCustomerCode: "AA99",
    });
    const ranked = rankLeadConvertCompanies([byAccount, byCode], "AA99");
    expect(ranked.map((r) => r.id)).toEqual(["code", "acct"]);
    expect(ranked[1]?.matchKind).toBe("exact_account_number");
  });

  it("ranks Autopart code prefix ahead of name starts-with", () => {
    const prefix = candidate({
      id: "prefix",
      name: "Zebra Factors",
      autopartCustomerCode: "AAB12",
    });
    const nameStart = candidate({
      id: "name",
      name: "AA Wholesale",
    });
    const ranked = rankLeadConvertCompanies([nameStart, prefix], "AA");
    expect(ranked.map((r) => r.id)).toEqual(["prefix", "name"]);
    expect(ranked[0]?.matchKind).toBe("autopart_code_prefix");
    expect(ranked[1]?.matchKind).toBe("name_prefix");
  });

  it("ranks account number prefix ahead of name starts-with", () => {
    const acctPrefix = candidate({
      id: "acct-prefix",
      name: "Late Alphabet Co",
      accountNumber: "AA400",
    });
    const nameStart = candidate({
      id: "name-start",
      name: "AA Early Name",
    });
    const ranked = rankLeadConvertCompanies([nameStart, acctPrefix], "AA");
    expect(ranked[0]?.id).toBe("acct-prefix");
    expect(ranked[0]?.matchKind).toBe("account_number_prefix");
  });

  it("keeps exact code inside the 15-result window despite alphabetical crowding", () => {
    const names = Array.from({ length: 40 }, (_, i) =>
      candidate({
        id: `alpha-${i}`,
        name: `AA Alpha Name ${String(i).padStart(2, "0")}`,
      }),
    );
    const exact = candidate({
      id: "buried-code",
      name: "ZZ Last Alphabetically",
      autopartCustomerCode: "AA",
    });
    const ranked = rankLeadConvertCompanies([...names, exact], "AA", 15);
    expect(ranked).toHaveLength(15);
    expect(ranked[0]?.id).toBe("buried-code");
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    const row = candidate({
      id: "case",
      name: "Case Co",
      autopartCustomerCode: "Ab12",
    });
    expect(classifyLeadConvertCompanyMatch(row, "  ab12 ")).toBe("exact_autopart_code");
    expect(rankLeadConvertCompanies([row], "ab12")[0]?.id).toBe("case");
  });

  it("handles duplicate / similar company names without auto-picking", () => {
    const a = candidate({ id: "dup-a", name: "Smith Motors", tradingName: "Smith" });
    const b = candidate({ id: "dup-b", name: "Smith Motors", tradingName: "Smith Trading" });
    const ranked = rankLeadConvertCompanies([b, a], "Smith");
    expect(ranked).toHaveLength(2);
    expect(new Set(ranked.map((r) => r.id))).toEqual(new Set(["dup-a", "dup-b"]));
    expect(ranked.every((r) => r.exactCodeMatch === false)).toBe(true);
  });

  it("returns no matches when nothing fits", () => {
    const ranked = rankLeadConvertCompanies(
      [candidate({ id: "x", name: "Completely Different", primaryEmail: "other@example.invalid" })],
      "AA99",
    );
    expect(ranked).toEqual([]);
  });

  it("ranks partial email after name partial", () => {
    const email = candidate({
      id: "email",
      name: "Other Co",
      primaryEmail: "buyer@aa-motors.example",
    });
    const namePartial = candidate({
      id: "name-partial",
      name: "North AA Supplies",
    });
    const ranked = rankLeadConvertCompanies([email, namePartial], "AA");
    expect(ranked.map((r) => r.id)).toEqual(["name-partial", "email"]);
    expect(ranked[1]?.matchKind).toBe("email_partial");
  });

  it("clears selection when the search query changes", () => {
    expect(shouldClearLeadConvertSelection("AA", "AAB")).toBe(true);
    expect(shouldClearLeadConvertSelection("AA", "AA")).toBe(false);
  });
});
