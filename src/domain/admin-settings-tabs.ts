/**
 * Admin Settings workspace tab ids and URL search parsing.
 * Kept outside the route module so tests can import without mounting the route tree.
 */

export const SETTINGS_TABS = [
  "general",
  "trade",
  "email",
  "autopart",
  "documents",
  "system",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Optional so bare `/admin/settings` Links remain valid; missing/invalid → General. */
export type SettingsSearch = { tab?: SettingsTab };

/** Canonicalise ?tab= — invalid/missing → General (omit or general). */
export function parseSettingsSearch(search: Record<string, unknown>): SettingsSearch {
  const raw = typeof search["tab"] === "string" ? search["tab"].trim().toLowerCase() : "";
  if (!(SETTINGS_TABS as readonly string[]).includes(raw)) {
    return { tab: "general" };
  }
  return { tab: raw as SettingsTab };
}

export function resolveSettingsTab(search: SettingsSearch): SettingsTab {
  return search.tab ?? "general";
}

export const SETTINGS_TAB_META: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "trade", label: "Trade & Ordering" },
  { id: "email", label: "Email" },
  { id: "autopart", label: "Autopart" },
  { id: "documents", label: "Documents & SDS" },
  { id: "system", label: "System" },
];
