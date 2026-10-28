import { describe, expect, it } from "vitest";
import {
  FBA_FORECAST_DISABLED_MESSAGE,
  fbaForecastReportingDisabled,
} from "@/server/purchasing/fba-forecast-switch";

describe("FBA forecast kill switch", () => {
  it("stays off unless the env explicitly disables reporting", () => {
    expect(fbaForecastReportingDisabled({})).toBe(false);
    expect(fbaForecastReportingDisabled({ FBA_FORECAST_DISABLED: "" })).toBe(false);
    expect(fbaForecastReportingDisabled({ FBA_FORECAST_DISABLED: "0" })).toBe(false);
    expect(fbaForecastReportingDisabled({ FBA_FORECAST_DISABLED: "false" })).toBe(false);
    for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
      expect(fbaForecastReportingDisabled({ FBA_FORECAST_DISABLED: value })).toBe(true);
    }
  });

  it("rejects a forecast read before any database call when reporting is disabled", async () => {
    const previous = process.env["FBA_FORECAST_DISABLED"];
    process.env["FBA_FORECAST_DISABLED"] = "1";
    try {
      const { getFbaForecastWorkspace, getFbaOinHistory, getFbaForecastSku } = await import(
        "@/server/purchasing/fba-forecast"
      );
      await expect(getFbaForecastWorkspace("not-a-user")).rejects.toThrow(FBA_FORECAST_DISABLED_MESSAGE);
      await expect(getFbaOinHistory("not-a-user", {})).rejects.toThrow(FBA_FORECAST_DISABLED_MESSAGE);
      await expect(getFbaForecastSku("not-a-user", { matchKey: "SKU" })).rejects.toThrow(
        FBA_FORECAST_DISABLED_MESSAGE,
      );
    } finally {
      if (previous === undefined) delete process.env["FBA_FORECAST_DISABLED"];
      else process.env["FBA_FORECAST_DISABLED"] = previous;
    }
  });
});
