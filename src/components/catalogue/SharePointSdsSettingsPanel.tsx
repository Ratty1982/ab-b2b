import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Field, inputClass } from "@/components/ab/Drawer";
import { InstantText } from "@/components/ab/InstantText";
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
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [upn, setUpn] = useState("");
  const [folderUrl, setFolderUrl] = useState("");
  const [folderName, setFolderName] = useState("Power Maxed SDS 2025");
  const [sourceLabel, setSourceLabel] = useState("Power Maxed SDS");

  const load = useCallback(async () => {
    const res = await getSharePointSdsSettingsFn();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setSettings(res.data);
    setTenantId(res.data.tenantId ?? "");
    setClientId(res.data.clientId ?? "");
    setUpn(res.data.userPrincipalName ?? "");
    setFolderUrl(res.data.folderUrlHint ?? "");
    setFolderName(res.data.folderDisplayName);
    setSourceLabel(res.data.sourceLabel);
    onChanged?.(res.data);
  }, [onChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy("save");
    const res = await updateSharePointSdsSettingsFn({
      data: {
        enabled: true,
        sourceLabel,
        folderDisplayName: folderName,
        folderUrlHint: folderUrl || null,
        tenantId: tenantId || null,
        clientId: clientId || null,
        clientSecret: clientSecret.trim() || undefined,
        userPrincipalName: upn || null,
      },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setClientSecret("");
    setSettings(res.data);
    onChanged?.(res.data);
    toast.success("SharePoint SDS settings saved");
  }

  async function resolveFolder() {
    setBusy("resolve");
    const saveFirst = await updateSharePointSdsSettingsFn({
      data: {
        folderUrlHint: folderUrl || null,
        userPrincipalName: upn || null,
        folderDisplayName: folderName,
        tenantId: tenantId || null,
        clientId: clientId || null,
        clientSecret: clientSecret.trim() || undefined,
      },
    });
    if (!saveFirst.ok) {
      setBusy(null);
      toast.error(saveFirst.error);
      return;
    }
    const res = await resolveSharePointSdsFolderFn();
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      await load();
      return;
    }
    setSettings(res.data);
    onChanged?.(res.data);
    toast.success("Folder resolved");
  }

  async function testConnection() {
    setBusy("test");
    const res = await testSharePointSdsConnectionFn();
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      await load();
      return;
    }
    setSettings(res.data);
    onChanged?.(res.data);
    toast.success("Connected");
  }

  if (!settings && !error) {
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
          <input className={inputClass} value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
        </Field>
        <Field label="Folder display name">
          <input className={inputClass} value={folderName} onChange={(e) => setFolderName(e.target.value)} />
        </Field>
        <Field label="Directory (tenant) ID">
          <input
            className={inputClass}
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            autoComplete="off"
            placeholder={settings?.secretFromEnv ? "May also come from env" : ""}
          />
        </Field>
        <Field label="Application (client) ID">
          <input
            className={inputClass}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="Client secret (write-only)">
          <input
            type="password"
            className={inputClass}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={settings?.hasClientSecret ? "•••••••• (unchanged)" : "Paste secret"}
            autoComplete="new-password"
          />
        </Field>
        <Field label="OneDrive user (UPN)">
          <input
            className={inputClass}
            value={upn}
            onChange={(e) => setUpn(e.target.value)}
            placeholder="george.parker@automotivebrands.co.uk"
            autoComplete="off"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Folder URL (helper — resolved to stable Graph IDs)">
            <input
              className={inputClass}
              value={folderUrl}
              onChange={(e) => setFolderUrl(e.target.value)}
              placeholder="Paste OneDrive/SharePoint folder browser URL"
              autoComplete="off"
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
