import { describe, expect, it } from "vitest";
import {
  AUTOPART_216V_MOVEMENTS,
  AUTOPART_216V_MOVEMENT_CHANGE_STATUS,
  autopart216vMovementEmptyCopy,
  autopart216vMovementIgnoredFilters,
  autopart216vMovementQuantities,
  formatAutopart216vChangeQty,
  isAutopart216vMovement,
} from "@/domain/autopart-216v-movement";

describe("216V movement semantics", () => {
  it("maps each movement KPI to exactly one persisted change status", () => {
    expect(AUTOPART_216V_MOVEMENT_CHANGE_STATUS).toEqual({
      NEW: "NEW",
      INCREASED: "QUANTITY_INCREASED",
      REDUCED: "QUANTITY_REDUCED",
      CLEARED: "CLEARED",
    });
    expect(new Set(Object.values(AUTOPART_216V_MOVEMENT_CHANGE_STATUS)).size).toBe(AUTOPART_216V_MOVEMENTS.length);
  });

  it("validates movement ids", () => {
    expect(isAutopart216vMovement("CLEARED")).toBe(true);
    expect(isAutopart216vMovement("UNCHANGED")).toBe(false);
    expect(isAutopart216vMovement("cleared")).toBe(false);
    expect(isAutopart216vMovement(null)).toBe(false);
  });

  it("exposes previous/current/change for increased and reduced lines", () => {
    expect(autopart216vMovementQuantities({ movement: "INCREASED", outstandingQty: 7, previousQty: 4 })).toEqual({
      previousQty: 4,
      currentQty: 7,
      changeQty: 3,
    });
    expect(autopart216vMovementQuantities({ movement: "REDUCED", outstandingQty: 4, previousQty: 7 })).toEqual({
      previousQty: 7,
      currentQty: 4,
      changeQty: -3,
    });
  });

  it("never invents a current quantity for cleared lines", () => {
    expect(autopart216vMovementQuantities({ movement: "CLEARED", outstandingQty: 0, previousQty: 5 })).toEqual({
      previousQty: 5,
      currentQty: null,
      changeQty: null,
    });
  });

  it("treats new lines as having no previous quantity", () => {
    expect(autopart216vMovementQuantities({ movement: "NEW", outstandingQty: 2, previousQty: null })).toEqual({
      previousQty: null,
      currentQty: 2,
      changeQty: 2,
    });
  });

  it("ignores current-state filters for cleared history and status for every movement", () => {
    expect(autopart216vMovementIgnoredFilters("CLEARED")).toEqual(["status", "position", "ageDays"]);
    expect(autopart216vMovementIgnoredFilters("NEW")).toEqual(["status"]);
    expect(autopart216vMovementIgnoredFilters("INCREASED")).toEqual(["status"]);
  });

  it("formats signed changes and useful empty states", () => {
    expect(formatAutopart216vChangeQty(3)).toBe("+3");
    expect(formatAutopart216vChangeQty(-3)).toBe("−3");
    expect(formatAutopart216vChangeQty(0)).toBe("0");
    expect(formatAutopart216vChangeQty(null)).toBe("—");
    expect(autopart216vMovementEmptyCopy("INCREASED")).toBe("No increased backorders in this snapshot.");
    expect(autopart216vMovementEmptyCopy("CLEARED")).toBe("No cleared backorders in this snapshot.");
  });
});
