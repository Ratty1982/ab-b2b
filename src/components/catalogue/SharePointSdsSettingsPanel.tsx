import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Field, inputClass } from "@/components/ab/Drawer";
import { InstantText } from "@/components/ab/InstantText";
import {
  buildSharePointSdsSavePayload,
  clientSecretFieldPlaceholder,
  emptySharePointSdsFormDraft,
  formDraftFromSettings,
  updateFormDraftField,
  type SharePointSdsFormDraft,
} from "@/domain/sharepoint-sds-form";
import { cn } from "@/lib/utils";
import {
  getSharePointSdsSettingsFn,
  resolveSharePointSdsFolderFn,
  testSharePointSdsConnectionFn,
  updateSharePointSdsSettingsFn,
} from "@/server/phase2/fns";

type Settings = Extract<
  Awaited<ReturnType<typeof getSharePointSdsSettingsFn>>,
  { ok: true }
>["data"];

export function SharePointSdsSettingsPanel({
  compact = false,
  onChanged,
}: {
  compact?: boolean;
  onChanged?: (settings: Settings) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<SharePointSdsFormDraft>(emptySharePointSdsFormDraft);
  const [hydrated, setHydrated] = useState(false);

  // Parent often passes an inline onChanged — keep it out of effect deps so we never
  // re-fetch/re-hydrate (which was wiping Tenant ID and other fields while typing).
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getSharePointSdsSettingsFn();
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setSettings(res.data);
      setDraft(formDraftFromSettings(res.data));
      setHydrated(true);
      onChangedRef.current?.(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setField<K extends keyof SharePointSdsFormDraft>(
    field: K,
    value: SharePointSdsFormDraft[K],
  ) {
    setDraft((prev) => updateFormDraftField(prev, field, value));
  }

  /** Refresh connection status only — do not reset form draft. */
  async function refreshStatus() {
    const res = await getSharePointSdsSettingsFn();
    if (!res.ok) {
      setError(res.error);
      return null;
    }
    setError(null);
    setSettings(res.data);
    onChangedRef.current?.(res.data);
    return res.data;
  }

  async function save() {
    setBusy("save");
    const res = await updateSharePointSdsSettingsFn({
      data: buildSharePointSdsSavePayload(draft),
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSettings(res.data);
    // Re-sync non-secret fields from server; always clear write-only secret input.
    setDraft(formDraftFromSettings(res.data));
    onChangedRef.current?.(res.data);
    toast.success("SharePoint SDS settings saved");
  }

  async function resolveFolder() {
    setBusy("resolve");
    const saveFirst = await updateSharePointSdsSettingsFn({
      data: buildSharePointSdsSavePayload(draft),
    });
    if (!saveFirst.ok) {
      setBusy(null);
      toast.error(saveFirst.error);
      return;
    }
    // Keep typed secret until resolve finishes; clear only after successful save path above
    // already persisted it. Clear local secret copy now that it was sent.
    setDraft((prev) => ({ ...prev, clientSecret: "" }));
    setSettings(saveFirst.data);
    onChangedRef.current?.(saveFirst.data);

    const res = await resolveSharePointSdsFolderFn();
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      // Failed Graph auth must not wipe saved settings or in-progress form fields.
      await refreshStatus();
      return;
    }
    setSettings(res.data);
    setDraft(formDraftFromSettings(res.data));
    onChangedRef.current?.(res.data);
    toast.success("Folder resolved");
  }

  async function testConnection() {
    setBusy("test");
    const res = await testSharePointSdsConnectionFn();
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      // Update last-tested status only — keep Tenant ID / Client ID / etc.
      await refreshStatus();
      return;
    }
    setSettings(res.data);
    onChangedRef.current?.(res.data);
    toast.success("Connected");
  }

  if (!hydrated && !error) {
    return <p className="text-[13px] text-steel">Loading SharePoint settings…</p>;
  }

  return (
    <section
      data-admin-section="sharepoint-sds"
      className={cn(
        "space-y-4 rounded-lg border border-border bg-surface/30 p-4",
        !compact && "sm:p-5",
      )}
    >
      <div>
        <h3 className="font-display text-base font-semibold uppercase">
          SharePoint SDS connection
        </h3>
        <p className="mt-1 text-[12px] text-steel">
          Organisation Microsoft Entra app (client credentials). Secrets stay on the server.
          Customer downloads continue from Automotive Brands storage after import.
        </p>
      </div>

      {error ? <p className="text-[13px] text-bad">{error}</p> : null}

      {settings ? (
        <dl className="grid gap-2 text-[12px] sm:grid-cols-2">
          <div>
            <dt className="uppercase text-steel">Connection</dt>
            <dd className="font-semibold">
              {settings.connected
                ? "Connected"
                : settings.configured
                  ? settings.folderResolved
                    ? "Configured — test connection"
                    : "Configured — resolve folder"
                  : "Not configured"}
            </dd>
          </div>
          <div>
            <dt className="uppercase text-steel">Folder</dt>
            <dd className="font-semibold">{settings.folderDisplayName}</dd>
          </div>
          <div>
            <dt className="uppercase text-steel">Client secret</dt>
            <dd className="font-semibold">
              {settings.hasClientSecret ? "Secret configured" : "Not set"}
              {settings.secretFromEnv ? " (env)" : null}
            </dd>
          </div>
          {settings.lastConnectionTestAt ? (
            <div>
              <dt className="uppercase text-steel">Last tested</dt>
              <dd>
                <InstantText value={settings.lastConnectionTestAt} variant="audit" />
                {settings.lastConnectionTestOk === false && settings.lastConnectionTestError
                  ? ` · ${settings.lastConnectionTestError}`
                  : null}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Source label">
          <input
            className={inputClass}
            value={draft.sourceLabel}
            onChange={(e) => setField("sourceLabel", e.target.value)}
          />
        </Field>
        <Field label="Folder display name">
          <input
            className={inputClass}
            value={draft.folderDisplayName}
            onChange={(e) => setField("folderDisplayName", e.target.value)}
          />
        </Field>
        <Field label="Directory (tenant) ID">
          <input
            className={inputClass}
            value={draft.tenantId}
            onChange={(e) => setField("tenantId", e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={settings?.secretFromEnv ? "May also come from env" : ""}
          />
        </Field>
        <Field label="Application (client) ID">
          <input
            className={inputClass}
            value={draft.clientId}
            onChange={(e) => setField("clientId", e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Client secret (write-only)">
          <input
            type="password"
            className={inputClass}
            value={draft.clientSecret}
            onChange={(e) => setField("clientSecret", e.target.value)}
            placeholder={clientSecretFieldPlaceholder(Boolean(settings?.hasClientSecret))}
            autoComplete="new-password"
          />
        </Field>
        <Field label="OneDrive user (UPN)">
          <input
            className={inputClass}
            value={draft.userPrincipalName}
            onChange={(e) => setField("userPrincipalName", e.target.value)}
            placeholder="george.parker@automotivebrands.co.uk"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Folder URL (helper — resolved to stable Graph IDs)">
            <input
              className={inputClass}
              value={draft.folderUrlHint}
              onChange={(e) => setField("folderUrlHint", e.target.value)}
              placeholder="Paste OneDrive/SharePoint folder browser URL"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="h-9 rounded-md bg-primary px-3 text-[11px] font-semibold uppercase text-primary-foreground disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void save()}
        >
          Save
        </button>
        <button
          type="button"
          className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void resolveFolder()}
        >
          Resolve folder
        </button>
        <button
          type="button"
          className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void testConnection()}
        >
          Test connection
        </button>
      </div>
    </section>
  );
}
