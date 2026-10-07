import { describe, expect, it } from "vitest";
import {
  accumulateSupplierGroupPlan,
  emptySupplierGroupTotals,
  normalizeAutopartGroupCode,
  planAutopartGroupReconciliation,
  type SupplierRelationState,
} from "@/domain/autopart-supplier-group";
import { classifyPlannerRecommendation, plannerPurchaseQty } from "@/domain/purchasing-planner";

const saxon = { id: "map-sx", supplierId: "sup-saxon", groupCode: "SX" };
const street = { id: "map-st", supplierId: "sup-street", groupCode: "ST" };

function rel(partial: Partial<SupplierRelationState> & Pick<SupplierRelationState, "id" | "supplierId" | "source">): SupplierRelationState {
  return {
    autopartGroupCode: null,
    active: true,
    isPreferred: false,
    ...partial,
  };
}

describe("Autopart group normalization", () => {
  it("uppercases and removes whitespace", () => {
    expect(normalizeAutopartGroupCode(" sx ")).toBe("SX");
    expect(normalizeAutopartGroupCode("st")).toBe("ST");
    expect(normalizeAutopartGroupCode("")).toBeNull();
    expect(normalizeAutopartGroupCode("   ")).toBeNull();
  });
});

describe("Autopart group reconciliation", () => {
  it("creates a preferred automatic relationship when the product has no supplier", () => {
    const plan = planAutopartGroupReconciliation({ groupCode: "SX", relations: [], mapping: saxon });
    expect(plan.created).toBe(true);
    expect(plan.decisions).toEqual([
      {
        kind: "ensure-auto",
        existingId: null,
        supplierId: "sup-saxon",
        groupCode: "SX",
        mappingId: "map-sx",
        isPreferred: true,
      },
    ]);
  });

  it("does not use a supplier code; the mapping supplier id is the only target", () => {
    const plan = planAutopartGroupReconciliation({
      groupCode: "SX",
      relations: [],
      mapping: { id: "map-sx", supplierId: "sup-saxon-long-code", groupCode: "SX" },
    });
    expect(plan.decisions[0]).toMatchObject({ supplierId: "sup-saxon-long-code" });
  });

  it("keeps a manual preferred supplier and adds the automatic supplier as not preferred", () => {
    const plan = planAutopartGroupReconciliation({
      groupCode: "SX",
      mapping: saxon,
      relations: [rel({ id: "manual", supplierId: "sup-other", source: "MANUAL", isPreferred: true })],
    });
    expect(plan.created).toBe(true);
    expect(plan.manualPreserved).toBe(true);
    expect(plan.decisions).toEqual([
      expect.objectContaining({ kind: "ensure-auto", supplierId: "sup-saxon", isPreferred: false }),
    ]);
    expect(plan.decisions.some((d) => d.kind === "deactivate")).toBe(false);
  });

  it("does not replace a manual relationship for the mapped supplier", () => {
    const plan = planAutopartGroupReconciliation({
      groupCode: "SX",
      mapping: saxon,
      relations: [rel({ id: "manual-saxon", supplierId: "sup-saxon", source: "MANUAL", isPreferred: true })],
    });
    expect(plan.created).toBe(false);
    expect(plan.manualPreserved).toBe(true);
    expect(plan.alreadyLinked).toBe(true);
    expect(plan.decisions).toEqual([]);
  });

  it("makes the automatic supplier preferred when nobody else is preferred", () => {
    const plan = planAutopartGroupReconciliation({
      groupCode: "SX",
      mapping: saxon,
      relations: [rel({ id: "alt", supplierId: "sup-other", source: "MANUAL", isPreferred: false })],
    });
    expect(plan.decisions).toEqual([expect.objectContaining({ isPreferred: true })]);
    expect(plan.manualPreserved).toBe(false);
  });

  it("moves the automatic relationship when the group changes and leaves a manual one in place", () => {
    const changed = planAutopartGroupReconciliation({
      groupCode: "ST",
      mapping: street,
      relations: [
        rel({
          id: "auto-sx",
          supplierId: "sup-saxon",
          source: "AUTOPART_GROUP",
          autopartGroupCode: "SX",
          isPreferred: true,
        }),
      ],
    });
    expect(changed.changedGroup).toBe(true);
    expect(changed.created).toBe(true);
    expect(changed.decisions).toEqual([
      { kind: "deactivate", id: "auto-sx" },
      expect.objectContaining({ kind: "ensure-auto", supplierId: "sup-street", isPreferred: true }),
    ]);

    const manualKept = planAutopartGroupReconciliation({
      groupCode: "ST",
      mapping: street,
      relations: [
        rel({
          id: "manual-saxon",
          supplierId: "sup-saxon",
          source: "MANUAL",
          isPreferred: true,
        }),
      ],
    });
    expect(manualKept.decisions.some((d) => d.kind === "deactivate")).toBe(false);
    expect(manualKept.manualPreserved).toBe(true);
    expect(manualKept.decisions).toEqual([
      expect.objectContaining({ supplierId: "sup-street", isPreferred: false }),
    ]);
  });

  it("deactivates a stale automatic supplier when the group becomes unmapped", () => {
    const plan = planAutopartGroupReconciliation({
      groupCode: "ZZ",
      mapping: null,
      relations: [
        rel({
          id: "auto-sx",
          supplierId: "sup-saxon",
          source: "AUTOPART_GROUP",
          autopartGroupCode: "SX",
          isPreferred: true,
        }),
        rel({ id: "manual", supplierId: "sup-other", source: "MANUAL", isPreferred: false }),
      ],
    });
    expect(plan.unmappedGroup).toBe("ZZ");
    expect(plan.mapped).toBe(false);
    expect(plan.decisions).toEqual([{ kind: "deactivate", id: "auto-sx" }]);
  });

  it("does not associate an inactive mapping and can restore when the mapping returns", () => {
    const inactive = planAutopartGroupReconciliation({
      groupCode: "SX",
      mapping: null,
      relations: [
        rel({
          id: "auto-sx",
          supplierId: "sup-saxon",
          source: "AUTOPART_GROUP",
          autopartGroupCode: "SX",
          isPreferred: true,
        }),
      ],
    });
    expect(inactive.decisions).toEqual([{ kind: "deactivate", id: "auto-sx" }]);

    const restored = planAutopartGroupReconciliation({
      groupCode: "SX",
      mapping: saxon,
      relations: [
        rel({
          id: "auto-sx",
          supplierId: "sup-saxon",
          source: "AUTOPART_GROUP",
          autopartGroupCode: "SX",
          active: false,
          isPreferred: false,
        }),
      ],
    });
    expect(restored.restored).toBe(true);
    expect(restored.decisions).toEqual([
      expect.objectContaining({ existingId: "auto-sx", isPreferred: true }),
    ]);
  });

  it("leaves an already current automatic relationship unchanged", () => {
    const plan = planAutopartGroupReconciliation({
      groupCode: "sx",
      mapping: saxon,
      relations: [
        rel({
          id: "auto-sx",
          supplierId: "sup-saxon",
          source: "AUTOPART_GROUP",
          autopartGroupCode: "SX",
          isPreferred: true,
        }),
      ],
    });
    expect(plan.alreadyCurrent).toBe(true);
    expect(plan.decisions).toEqual([]);
  });

  it("counts import diagnostics without treating an unmapped group as a failure", () => {
    const totals = emptySupplierGroupTotals();
    const unmapped = new Set<string>();
    accumulateSupplierGroupPlan(
      totals,
      planAutopartGroupReconciliation({ groupCode: "SX", relations: [], mapping: saxon }),
      unmapped,
    );
    accumulateSupplierGroupPlan(
      totals,
      planAutopartGroupReconciliation({ groupCode: "ZZ", relations: [], mapping: null }),
      unmapped,
    );
    expect(totals.matchedProducts).toBe(1);
    expect(totals.relationshipsCreated).toBe(1);
    expect(totals.unmappedGroups).toBe(1);
    expect(totals.unmappedProducts).toBe(1);
  });
});

describe("planner quantity is independent of supplier assignment", () => {
  const qtyInput = {
    availableQty: 2,
    incomingQty: 1,
    backorderUnits: 0,
    recommendedWeekly: 4,
    targetCoverWeeks: 8,
    safetyStockQty: 0,
    leadTimeDays: null,
    minimumOrderQty: null,
    orderMultiple: null,
  };

  it("keeps the suggested quantity when the only change is that a supplier now exists", () => {
    const before = plannerPurchaseQty(qtyInput);
    const after = plannerPurchaseQty(qtyInput);
    expect(after.suggestedQty).toBe(before.suggestedQty);
    const unassigned = classifyPlannerRecommendation({
      stockStale: false,
      recommendedWeekly: 4,
      confidenceSufficient: true,
      forecastStatus: "REORDER",
      suggestedQty: before.suggestedQty,
      requirementBeforeIncoming: 10,
      backorderCoverage: "NONE",
      supplierState: "NONE",
      incomingQty: 1,
    });
    const assigned = classifyPlannerRecommendation({
      stockStale: false,
      recommendedWeekly: 4,
      confidenceSufficient: true,
      forecastStatus: "REORDER",
      suggestedQty: after.suggestedQty,
      requirementBeforeIncoming: 10,
      backorderCoverage: "NONE",
      supplierState: "ASSIGNED",
      incomingQty: 1,
    });
    expect(unassigned.recommendation).toBe("NO_SUPPLIER");
    expect(assigned.recommendation).not.toBe("NO_SUPPLIER");
    expect(assigned.recommendation).toBe("ORDER_NOW");
  });
});
