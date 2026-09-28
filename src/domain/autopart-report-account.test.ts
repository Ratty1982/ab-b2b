import { describe, expect, it } from "vitest";
import {
  extractAutopartAccountCode,
  isPlausibleAutopartAccountCode,
  splitAutopartReportCells,
} from "@/domain/autopart-report-money";

describe("isPlausibleAutopartAccountCode", () => {
  it("accepts alphanumeric Autopart codes", () => {
    expect(isPlausibleAutopartAccountCode("YORKMOT")).toBe(true);
    expect(isPlausibleAutopartAccountCode("YORKMOTO")).toBe(true);
    expect(isPlausibleAutopartAccountCode("ab123")).toBe(true);
  });

  it("rejects financial and quantity values", () => {
    for (const bad of [
      "-1",
      "-104.38",
      "-119.95",
      "-16.38",
      "104.38",
      "1,234.56",
      "£622.80",
      "(51.90)",
      "51.90CR",
      "I/SS306008/1",
    ]) {
      expect(isPlausibleAutopartAccountCode(bad), bad).toBe(false);
      expect(extractAutopartAccountCode(bad), bad).toBeNull();
    }
  });
});

describe("splitAutopartReportCells", () => {
  it("splits CSV and multi-space report text", () => {
    expect(splitAutopartReportCells("YORKMOT,I/SS1/1,SS,Desc,24,622.80").length).toBe(6);
    expect(
      splitAutopartReportCells("YORKMOT   I/SS1/1    SS           Desc here        24      622.80")
        .length,
    ).toBeGreaterThanOrEqual(5);
  });
});
