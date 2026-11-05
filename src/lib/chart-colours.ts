/**
 * Recharts-safe chart colours.
 *
 * Theme tokens such as `--primary` are defined as `oklch(...)`. Passing them through
 * `hsl(var(--primary))` is invalid CSS and Recharts falls back to black bars that
 * disappear on the dark industrial background. Prefer these hex fills in SVG charts.
 */

/** Brand-visible sales bar fill — readable on dark and light chart cards. */
export const CHART_BAR_FILL = "#EF4444";

/** Secondary series / accents that must remain SVG-safe. */
export const CHART_SERIES_CYAN = "#38BDF8";
export const CHART_SERIES_STEEL = "#94A3B8";
