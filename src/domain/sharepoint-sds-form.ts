/**
 * SharePoint SDS connection form draft helpers.
 * Keeps editable fields independent of status refreshes (test/resolve failures).
 */

export type SharePointSdsFormDraft = {
  sourceLabel: string;
  folderDisplayName: string;
  tenantId: string;
  clientId: string;
  /** Write-only — never hydrated from the server. */
  clientSecret: string;
  userPrincipalName: string;
  folderUrlHint: string;
};

export type SharePointSdsFormSettingsSlice = {
  sourceLabel: string;
  folderDisplayName: string;
  tenantId: string | null;
  clientId: string | null;
  userPrincipalName: string | null;
  folderUrlHint: string | null;
  hasClientSecret: boolean;
};

export function emptySharePointSdsFormDraft(): SharePointSdsFormDraft {
  return {
    sourceLabel: "Power Maxed SDS",
    folderDisplayName: "Power Maxed SDS 2025",
    tenantId: "",
    clientId: "",
    clientSecret: "",
    userPrincipalName: "",
    folderUrlHint: "",
  };
}

/** Hydrate editable fields from public settings. Never copies a secret value. */
export function formDraftFromSettings(
  settings: SharePointSdsFormSettingsSlice,
): SharePointSdsFormDraft {
  return {
    sourceLabel: settings.sourceLabel || "Power Maxed SDS",
    folderDisplayName: settings.folderDisplayName || "Power Maxed SDS 2025",
    tenantId: settings.tenantId ?? "",
    clientId: settings.clientId ?? "",
    clientSecret: "",
    userPrincipalName: settings.userPrincipalName ?? "",
    folderUrlHint: settings.folderUrlHint ?? "",
  };
}

export function updateFormDraftField<K extends keyof SharePointSdsFormDraft>(
  draft: SharePointSdsFormDraft,
  field: K,
  value: SharePointSdsFormDraft[K],
): SharePointSdsFormDraft {
  return { ...draft, [field]: value };
}

/**
 * Status refreshes (failed test/resolve, parent re-render) must not wipe in-progress edits.
 * Only an explicit hydrate (initial load / successful save that chooses to re-sync) should replace the draft.
 */
export function retainFormDraftAcrossStatusRefresh(
  draft: SharePointSdsFormDraft,
  _settings: SharePointSdsFormSettingsSlice,
): SharePointSdsFormDraft {
  return draft;
}

/** Build save payload — blank secret omitted so the server preserves the stored secret. */
export function buildSharePointSdsSavePayload(draft: SharePointSdsFormDraft): {
  enabled: true;
  sourceLabel: string;
  folderDisplayName: string;
  folderUrlHint: string | null;
  tenantId: string | null;
  clientId: string | null;
  userPrincipalName: string | null;
  clientSecret?: string;
} {
  const secret = draft.clientSecret.trim();
  return {
    enabled: true,
    sourceLabel: draft.sourceLabel,
    folderDisplayName: draft.folderDisplayName,
    folderUrlHint: draft.folderUrlHint.trim() || null,
    tenantId: draft.tenantId.trim() || null,
    clientId: draft.clientId.trim() || null,
    userPrincipalName: draft.userPrincipalName.trim() || null,
    ...(secret ? { clientSecret: secret } : {}),
  };
}

export function clientSecretFieldPlaceholder(hasClientSecret: boolean): string {
  return hasClientSecret ? "Secret configured — paste to replace" : "Paste secret";
}
