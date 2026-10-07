/**
 * Explicit Autopart Group → Supplier reconciliation.
 *
 * Supplier.code is never compared to a group. A relationship exists only when an
 * authorised user saved SupplierAutopartGroup.
 *
 * Preferred supplier:
 * - No remaining active preferred relationship: the current AUTOPART_GROUP link may be preferred.
 * - An active MANUAL preferred relationship stays preferred. The automatic link may coexist, not preferred.
 * - Manual rows are never deleted, moved to another supplier, or changed.
 * - A MANUAL row for the mapped supplier blocks an automatic row for that same supplier.
 * - Stale AUTOPART_GROUP rows (group changed, group unmapped, or mapping deactivated) are deactivated.
 */

export const AUTOPART_GROUP_CODE_MAX = 20;

export type ProductSupplierOrigin = "MANUAL" | "AUTOPART_GROUP";

export type ActiveAutopartGroupMapping = {
  id: string;
  supplierId: string;
  groupCode: string;
};

export type SupplierRelationState = {
  id: string;
  supplierId: string;
  source: ProductSupplierOrigin;
  autopartGroupCode: string | null;
  active: boolean;
  isPreferred: boolean;
};

export type SupplierGroupDecision =
  | { kind: "deactivate"; id: string }
  | {
      kind: "ensure-auto";
      existingId: string | null;
      supplierId: string;
      groupCode: string;
      mappingId: string;
      isPreferred: boolean;
    };

export type SupplierGroupPlan = {
  decisions: SupplierGroupDecision[];
  mapped: boolean;
  created: boolean;
  restored: boolean;
  alreadyCurrent: boolean;
  alreadyLinked: boolean;
  changedGroup: boolean;
  manualPreserved: boolean;
  unmappedGroup: string | null;
};

/** Trim, uppercase, and remove whitespace. Empty becomes null. */
export function normalizeAutopartGroupCode(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const code = raw.toUpperCase().replace(/\s+/g, "");
  if (!code || code.length > AUTOPART_GROUP_CODE_MAX) return null;
  return code;
}

export function planAutopartGroupReconciliation(input: {
  groupCode: string | null;
  relations: SupplierRelationState[];
  mapping: ActiveAutopartGroupMapping | null;
}): SupplierGroupPlan {
  const group = normalizeAutopartGroupCode(input.groupCode);
  const mapping = group && input.mapping && input.mapping.groupCode === group ? input.mapping : null;
  const decisions: SupplierGroupDecision[] = [];
  const deactivated = new Set<string>();

  for (const rel of input.relations) {
    if (rel.source !== "AUTOPART_GROUP" || !rel.active) continue;
    const current =
      mapping != null &&
      rel.supplierId === mapping.supplierId &&
      normalizeAutopartGroupCode(rel.autopartGroupCode) === mapping.groupCode;
    if (!current) {
      decisions.push({ kind: "deactivate", id: rel.id });
      deactivated.add(rel.id);
    }
  }

  const changedGroup = deactivated.size > 0;
  if (!mapping) {
    return {
      decisions,
      mapped: false,
      created: false,
      restored: false,
      alreadyCurrent: false,
      alreadyLinked: false,
      changedGroup,
      manualPreserved: false,
      unmappedGroup: group,
    };
  }

  const target = input.relations.find((rel) => rel.supplierId === mapping.supplierId);
  const remainsPreferred = (rel: SupplierRelationState) => rel.active && rel.isPreferred && !deactivated.has(rel.id);

  if (target?.source === "MANUAL") {
    return {
      decisions,
      mapped: true,
      created: false,
      restored: false,
      alreadyCurrent: false,
      alreadyLinked: target.active,
      changedGroup,
      manualPreserved: true,
      unmappedGroup: null,
    };
  }

  const otherPreferred = input.relations.some((rel) => rel.id !== target?.id && remainsPreferred(rel));
  const isPreferred = !otherPreferred;
  const manualPreferredKept = input.relations.some(
    (rel) => rel.source === "MANUAL" && rel.supplierId !== mapping.supplierId && remainsPreferred(rel),
  );

  if (target?.source === "AUTOPART_GROUP") {
    const already =
      target.active &&
      !deactivated.has(target.id) &&
      normalizeAutopartGroupCode(target.autopartGroupCode) === mapping.groupCode &&
      target.isPreferred === isPreferred;
    if (!already) {
      decisions.push({
        kind: "ensure-auto",
        existingId: target.id,
        supplierId: mapping.supplierId,
        groupCode: mapping.groupCode,
        mappingId: mapping.id,
        isPreferred,
      });
    }
    return {
      decisions,
      mapped: true,
      created: false,
      restored: !target.active,
      alreadyCurrent: already,
      alreadyLinked: target.active,
      changedGroup,
      manualPreserved: manualPreferredKept,
      unmappedGroup: null,
    };
  }

  decisions.push({
    kind: "ensure-auto",
    existingId: null,
    supplierId: mapping.supplierId,
    groupCode: mapping.groupCode,
    mappingId: mapping.id,
    isPreferred,
  });
  return {
    decisions,
    mapped: true,
    created: true,
    restored: false,
    alreadyCurrent: false,
    alreadyLinked: false,
    changedGroup,
    manualPreserved: manualPreferredKept,
    unmappedGroup: null,
  };
}

export type SupplierGroupReconcileTotals = {
  matchedProducts: number;
  relationshipsCreated: number;
  alreadyCurrent: number;
  alreadyLinked: number;
  changedGroup: number;
  manualOverridesPreserved: number;
  unmappedProducts: number;
  unmappedGroups: number;
};

export function emptySupplierGroupTotals(): SupplierGroupReconcileTotals {
  return {
    matchedProducts: 0,
    relationshipsCreated: 0,
    alreadyCurrent: 0,
    alreadyLinked: 0,
    changedGroup: 0,
    manualOverridesPreserved: 0,
    unmappedProducts: 0,
    unmappedGroups: 0,
  };
}

export function accumulateSupplierGroupPlan(
  totals: SupplierGroupReconcileTotals,
  plan: SupplierGroupPlan,
  unmapped: Set<string>,
): void {
  if (plan.mapped) totals.matchedProducts += 1;
  if (plan.created || plan.restored) totals.relationshipsCreated += 1;
  if (plan.alreadyCurrent) totals.alreadyCurrent += 1;
  if (plan.alreadyLinked) totals.alreadyLinked += 1;
  if (plan.changedGroup) totals.changedGroup += 1;
  if (plan.manualPreserved) totals.manualOverridesPreserved += 1;
  if (plan.unmappedGroup) {
    totals.unmappedProducts += 1;
    unmapped.add(plan.unmappedGroup);
  }
  totals.unmappedGroups = unmapped.size;
}

export function formatSupplierGroupReconciliation(totals: SupplierGroupReconcileTotals): string {
  return [
    "Supplier group reconciliation",
    `Mapped: ${totals.matchedProducts}`,
    `Created: ${totals.relationshipsCreated}`,
    `Already current: ${totals.alreadyCurrent}`,
    `Changed group: ${totals.changedGroup}`,
    `Manual override preserved: ${totals.manualOverridesPreserved}`,
    `Unmapped groups: ${totals.unmappedGroups}`,
  ].join("\n");
}
