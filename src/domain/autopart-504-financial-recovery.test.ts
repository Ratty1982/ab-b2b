import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertAutopart504FinancialRecoveryAuthorised,
  AUTOPART_504_FINANCIAL_RECOVERY_CONFIRMATION,
  AUTOPART_504_RECOVERY_PROHIBITED_EFFECTS,
  planAutopart504FinancialRecovery,
  type Stored504FinancialDocument,
} from "@/domain/autopart-504-financial-recovery";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/autopart-504-20261019.sanitised.txt"),
  "utf8",
);

const STORED_TRUNCATION: Record<string, { goods: string; vat: string; value: string; verifiedGoods: string }> = {
  SC506126: { goods: "44.16", vat: "-8.83", value: "-52.99", verifiedGoods: "-44.16" },
  SC506127: { goods: "31.66", vat: "-6.33", value: "-37.99", verifiedGoods: "-31.66" },
  SS306549: { goods: "7.48", vat: "21.49", value: "128.97", verifiedGoods: "107.48" },
  SS306576: { goods: "87.01", vat: "37.40", value: "224.41", verifiedGoods: "187.01" },
  SS306579: { goods: "37.12", vat: "47.42", value: "284.54", verifiedGoods: "237.12" },
  SS306591: { goods: "99.20", vat: "79.84", value: "479.04", verifiedGoods: "399.20" },
  SS306594: { goods: "57.60", vat: "131.52", value: "789.12", verifiedGoods: "657.60" },
  SS306595: { goods: "31.60", vat: "46.32", value: "277.92", verifiedGoods: "231.60" },
};

function document(overrides: Partial<Stored504FinancialDocument> & Pick<Stored504FinancialDocument, "id" | "documentReference">): Stored504FinancialDocument {
  return {
    documentType: "INVOICE",
    documentDate: "2026-10-19",
    companyId: "company-1",
    autopartCustomerCode: "ACCT",
    customerNameSnapshot: "Stored name",
    customerOrderNumber: "REF",
    abOrderId: null,
    abOrderNumber: null,
    has504: true,
    hasTrm21qc: true,
    source: "ONGOING_504",
    goodsNet: "10.00",
    vat: "2.00",
    grossTotal: "12.00",
    reconciliationStatus: "COMPLETE",
    fulfilmentStatus: null,
    trmSalesNets: ["10.00"],
    ...overrides,
  };
}

describe("504 financial recovery plan", () => {
  const truncated = Object.entries(STORED_TRUNCATION).map(([reference, amounts]) =>
    document({
      id: reference,
      documentReference: reference,
      documentType: reference.startsWith("SC") ? "CREDIT" : "INVOICE",
      goodsNet: amounts.goods,
      vat: amounts.vat,
      grossTotal: amounts.value,
      abOrderId: reference === "SS306591" ? "order-13" : null,
      abOrderNumber: reference === "SS306591" ? "AB-000013" : null,
      trmSalesNets: [amounts.verifiedGoods],
      fulfilmentStatus: reference === "SS306591" ? "FULFILMENT_APPLIED" : null,
      source: reference === "SS306576" ? "561L" : "ONGOING_504",
    }),
  );

  const reports = [{ filename: "504_20261019.txt", text: fixture }];

  it("proposes the eight verified corrections and does not invent goods without a report", () => {
    const plan = planAutopart504FinancialRecovery({
      documents: [
        ...truncated,
        document({
          id: "unbalanced-no-source",
          documentReference: "SS399999",
          documentDate: "2026-10-08",
          goodsNet: "7.48",
          vat: "21.49",
          grossTotal: "128.97",
        }),
        document({
          id: "historic",
          documentReference: "SS100001",
          has504: false,
          source: "SLRB",
          goodsNet: "1.00",
          vat: "0.20",
          grossTotal: "9.99",
        }),
      ],
      reports,
    });

    expect(plan.applyCount).toBe(8);
    expect(plan.manualReviewCount).toBe(1);
    expect(plan.outOfScopeCount).toBe(1);
    expect(plan.creditCount).toBe(2);
    expect(plan.affectedAbOrders).toEqual(["AB-000013"]);
    expect(plan.fulfilmentReviewDocumentReferences).toEqual(["SS306591"]);
    expect(plan.prohibitedEffects).toEqual(AUTOPART_504_RECOVERY_PROHIBITED_EFFECTS);
    expect(plan.dateRange).toEqual({ earliest: "2026-10-08", latest: "2026-10-19" });

    const corrected = plan.actions.find((row) => row.documentReference === "SS306591");
    expect(corrected).toMatchObject({
      disposition: "APPLY",
      verified: { goods: "399.20", vat: "79.84", value: "479.04" },
      preserved: {
        companyId: "company-1",
        documentReference: "SS306591",
        abOrderId: "order-13",
        abOrderNumber: "AB-000013",
      },
      expectedReconciliationStatus: "COMPLETE",
      postCorrectionFulfilmentReview: true,
    });
    expect(corrected?.salesImpact?.goodsMinor).toBe(30000);
    expect(plan.actions.find((row) => row.documentReference === "SC506126")?.verified?.goods).toBe("-44.16");
    expect(plan.actions.find((row) => row.documentReference === "SS306576")?.historicalProvenance).toBe(true);

    const missing = plan.actions.find((row) => row.documentReference === "SS399999");
    expect(missing?.disposition).toBe("MANUAL_REVIEW");
    expect(missing?.verified).toBeNull();
    expect(missing?.reason).toMatch(/does not prove the original goods value/i);

    expect(plan.actions.find((row) => row.documentReference === "SS100001")?.disposition).toBe("OUT_OF_SCOPE");
  });

  it("is idempotent when the stored triple already matches the report", () => {
    const plan = planAutopart504FinancialRecovery({
      documents: [
        document({
          id: "done",
          documentReference: "SS306591",
          goodsNet: "399.20",
          vat: "79.84",
          grossTotal: "479.04",
          abOrderNumber: "AB-000013",
        }),
      ],
      reports,
    });
    expect(plan.actions[0]).toMatchObject({ disposition: "UNCHANGED", salesImpact: null });
    expect(plan.applyCount).toBe(0);
  });

  it("holds conflicting reports and dates outside the incident window for manual review", () => {
    const other = fixture.replace("399.20", "398.20").replace("479.04", "478.04");
    const plan = planAutopart504FinancialRecovery({
      documents: [
        document({
          id: "conflict",
          documentReference: "SS306591",
          goodsNet: "99.20",
          vat: "79.84",
          grossTotal: "479.04",
        }),
        document({
          id: "early",
          documentReference: "SS306541",
          documentDate: "2026-09-30",
          goodsNet: "1.00",
          vat: "0.20",
          grossTotal: "1.20",
        }),
      ],
      reports: [
        { filename: "504_20261019.txt", text: fixture },
        { filename: "504_20261019-copy.txt", text: other },
      ],
    });
    expect(plan.actions.find((row) => row.documentReference === "SS306591")?.disposition).toBe("MANUAL_REVIEW");
    expect(plan.actions.find((row) => row.documentReference === "SS306541")?.disposition).toBe("MANUAL_REVIEW");
    expect(plan.applyCount).toBe(0);
  });

  it("refuses an apply that is not explicitly confirmed", () => {
    expect(() => assertAutopart504FinancialRecoveryAuthorised({ authorise: false, dryRun: true })).toThrow(/authorisation/i);
    expect(() =>
      assertAutopart504FinancialRecoveryAuthorised({ authorise: true, dryRun: false, confirmation: "yes" }),
    ).toThrow(AUTOPART_504_FINANCIAL_RECOVERY_CONFIRMATION);
    expect(() =>
      assertAutopart504FinancialRecoveryAuthorised({
        authorise: true,
        dryRun: false,
        confirmation: AUTOPART_504_FINANCIAL_RECOVERY_CONFIRMATION,
      }),
    ).not.toThrow();
  });

  it("keeps the apply path clear of fulfilment, orders, stock, and mail", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../server/companies/autopart-504-financial-recovery.ts"),
      "utf8",
    );
    const imports = source.split("\n").filter((line) => line.trimStart().startsWith("import"));
    expect(imports.join("\n")).not.toMatch(/fulfilment|504c|orders\/|mail|stock/i);
    expect(source).not.toContain("run504TrmFulfilment");
    expect(source).not.toContain("applyAutopart504c");
    expect(source).not.toContain("order.update");
  });
});
