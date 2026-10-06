import { describe, expect, it } from "vitest";
import { isSharePointSdsWorkflowEnabled } from "@/domain/sharepoint-sds-enabled";

describe("isSharePointSdsWorkflowEnabled", () => {
  it("defaults to disabled when unset or blank", () => {
    expect(isSharePointSdsWorkflowEnabled({})).toBe(false);
    expect(isSharePointSdsWorkflowEnabled({ SHAREPOINT_SDS_ENABLED: "" })).toBe(false);
    expect(isSharePointSdsWorkflowEnabled({ SHAREPOINT_SDS_ENABLED: "false" })).toBe(false);
    expect(isSharePointSdsWorkflowEnabled({ SHAREPOINT_SDS_ENABLED: "no" })).toBe(false);
  });

  it("enables only for true / 1 / yes", () => {
    expect(isSharePointSdsWorkflowEnabled({ SHAREPOINT_SDS_ENABLED: "true" })).toBe(true);
    expect(isSharePointSdsWorkflowEnabled({ SHAREPOINT_SDS_ENABLED: "1" })).toBe(true);
    expect(isSharePointSdsWorkflowEnabled({ SHAREPOINT_SDS_ENABLED: "YES" })).toBe(true);
  });
});
