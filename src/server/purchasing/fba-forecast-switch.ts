/**
 * Temporary operator switch for the Amazon FBA reporting route.
 * Set FBA_FORECAST_DISABLED=1 and restart the app. Reporting requests
 * return before any forecast or RETAILA sales query. Other routes are unchanged.
 */
const DISABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export const FBA_FORECAST_DISABLED_MESSAGE =
  "Amazon FBA reporting is temporarily disabled. The rest of the portal is still available.";

export function fbaForecastReportingDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env["FBA_FORECAST_DISABLED"]?.trim().toLowerCase();
  return value != null && DISABLED_VALUES.has(value);
}
