/**
 * Admin → Settings → Email panel (SiteGround SMTP).
 * Password is write-only; never echoed from the server.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Field, inputClass } from "@/components/ab/Drawer";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { formatDateTime } from "@/lib/datetime";
import {
  getEmailSettingsFn,
  listTransactionalEmailsFn,
  retryTransactionalEmailFn,
  saveEmailSettingsFn,
  sendTestEmailFn,
  testSmtpConnectionFn,
} from "@/server/phase2/fns";

type EmailSettingsDto = {
  enabled: boolean;
  smtpHost: string | null;
  smtpPort: number;
  smtpSecurity: "SSL_TLS" | "STARTTLS" | "NONE";
  smtpUsername: string | null;
  smtpPasswordConfigured: boolean;
  fromName: string | null;
  fromEmail: string | null;
  replyToName: string | null;
  replyToEmail: string | null;
  tradeApplicationRecipients: string[];
  orderNotificationRecipients: string[];
  motorsportEnquiryRecipients: string[];
  status: {
    smtpConfigured: boolean;
    passwordConfigured: boolean;
    deliveryEnabled: boolean;
    senderConfigured: boolean;
    applicationAlertsConfigured: boolean;
    orderAlertsConfigured: boolean;
    motorsportAlertsConfigured: boolean;
  };
  lastConnectionTestAt: string | null;
  lastConnectionTestOk: boolean | null;
  lastConnectionTestError: string | null;
  lastTestEmailAt: string | null;
  lastTestEmailOk: boolean | null;
  lastTestEmailError: string | null;
  updatedAt: string;
};

type EmailHistoryRow = {
  id: string;
  purpose: string;
  status: string;
  toEmail: string;
  reference: string | null;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
};

function statusTone(ok: boolean): Tone {
  return ok ? "good" : "warn";
}

function purposeLabel(purpose: string): string {
  switch (purpose) {
    case "ORDER_RECEIVED":
      return "Order Received";
    case "ORDER_RECEIVED_INTERNAL":
      return "New B2B Order (internal)";
    case "TRADE_APPLICATION_RECEIVED":
      return "Application Received";
    case "TRADE_APPLICATION_INTERNAL_NOTIFICATION":
      return "New Application (internal)";
    case "TRADE_APPLICATION_MORE_INFO":
      return "Application More Info";
    case "TRADE_APPLICATION_APPROVED":
      return "Trade Account Approved";
    case "TRADE_APPLICATION_REJECTED":
      return "Application Rejected";
    case "TRADE_ACCOUNT_ACTIVATED":
      return "Account Activated";
    case "EMAIL_TEST":
      return "Test Email";
    case "PASSWORD_RESET":
      return "Password Reset";
    case "USER_INVITATION":
      return "User Invitation";
    case "COMPANY_USER_INVITED":
      return "Portal Invite";
    case "MOTORSPORT_PARTNERSHIP_INTERNAL":
      return "Motorsport Enquiry";
    default:
      return purpose;
  }
}

function RecipientEditor({
  label,
  recipients,
  onChange,
}: {
  label: string;
  recipients: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const value = draft.trim().toLowerCase();
    if (!value) return;
    if (recipients.includes(value)) {
      toast.error("Recipient already added");
      return;
    }
    onChange([...recipients, value]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-steel">{label}</p>
      <ul className="divide-y divide-border rounded-md border border-border text-[13px]">
        {recipients.length === 0 ? (
          <li className="px-3 py-2 text-steel">No recipients configured</li>
        ) : (
          recipients.map((email) => (
            <li key={email} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{email}</span>
              <button
                type="button"
                className="shrink-0 text-[12px] font-semibold text-destructive"
                onClick={() => onChange(recipients.filter((e) => e !== email))}
                aria-label={`Remove ${email}`}
              >
                ×
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label="Add recipient">
            <input
              className={inputClass}
              type="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder="orders-team@example.com"
              autoComplete="off"
            />
          </Field>
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-[13px] font-semibold"
        >
          Add recipient
        </button>
      </div>
    </div>
  );
}

export function EmailSettingsPanel() {
  const [settings, setSettings] = useState<EmailSettingsDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [replacePassword, setReplacePassword] = useState(false);
  const [smtpPassword, setSmtpPassword] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testName, setTestName] = useState("");
  const [history, setHistory] = useState<EmailHistoryRow[]>([]);
  const [historyStatus, setHistoryStatus] = useState("ALL");
  const [historyPurpose, setHistoryPurpose] = useState("ALL");
  const [form, setForm] = useState({
    enabled: false,
    smtpHost: "",
    smtpPort: 465,
    smtpSecurity: "SSL_TLS" as "SSL_TLS" | "STARTTLS" | "NONE",
    smtpUsername: "",
    fromName: "",
    fromEmail: "",
    replyToName: "",
    replyToEmail: "",
    tradeApplicationRecipients: [] as string[],
    orderNotificationRecipients: [] as string[],
    motorsportEnquiryRecipients: [] as string[],
  });

  const loadHistory = useCallback(async (status: string, purpose: string) => {
    const result = await listTransactionalEmailsFn({
      data: {
        status,
        purpose,
        limit: 20,
      },
    });
    if (result.ok) {
      setHistory(result.data as EmailHistoryRow[]);
    }
  }, []);

  const load = useCallback(async () => {
    const result = await getEmailSettingsFn();
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    const data = result.data as EmailSettingsDto;
    setSettings(data);
    setForm({
      enabled: data.enabled,
      smtpHost: data.smtpHost ?? "",
      smtpPort: data.smtpPort,
      smtpSecurity: data.smtpSecurity,
      smtpUsername: data.smtpUsername ?? "",
      fromName: data.fromName ?? "",
      fromEmail: data.fromEmail ?? "",
      replyToName: data.replyToName ?? "",
      replyToEmail: data.replyToEmail ?? "",
      tradeApplicationRecipients: data.tradeApplicationRecipients,
      orderNotificationRecipients: data.orderNotificationRecipients,
      motorsportEnquiryRecipients: data.motorsportEnquiryRecipients,
    });
    setReplacePassword(false);
    setSmtpPassword("");
    setLoadError(null);
    await loadHistory(historyStatus, historyPurpose);
  }, [historyPurpose, historyStatus, loadHistory]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave() {
    setSaving(true);
    const payload: Record<string, unknown> = {
      enabled: form.enabled,
      smtpHost: form.smtpHost.trim() || null,
      smtpPort: form.smtpPort,
      smtpSecurity: form.smtpSecurity,
      smtpUsername: form.smtpUsername.trim() || null,
      fromName: form.fromName.trim() || null,
      fromEmail: form.fromEmail.trim() || null,
      replyToName: form.replyToName.trim() || null,
      replyToEmail: form.replyToEmail.trim() || null,
      tradeApplicationRecipients: form.tradeApplicationRecipients,
      orderNotificationRecipients: form.orderNotificationRecipients,
      motorsportEnquiryRecipients: form.motorsportEnquiryRecipients,
    };
    if (replacePassword || (!settings?.smtpPasswordConfigured && smtpPassword)) {
      payload["replacePassword"] = true;
      payload["smtpPassword"] = smtpPassword;
    }
    const result = await saveEmailSettingsFn({ data: payload });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Email settings saved");
    setSettings(result.data as EmailSettingsDto);
    setReplacePassword(false);
    setSmtpPassword("");
    await load();
  }

  async function onTestConnection() {
    setTesting(true);
    const result = await testSmtpConnectionFn();
    setTesting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.data.ok) {
      toast.success(result.data.message);
    } else {
      toast.error(result.data.message);
    }
    await load();
  }

  async function onSendTest() {
    setSendingTest(true);
    const result = await sendTestEmailFn({
      data: {
        toEmail: testTo.trim(),
        ...(testName.trim() ? { toName: testName.trim() } : {}),
      },
    });
    setSendingTest(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (result.data.ok) {
      toast.success(`SENT ${result.data.sentAt ? formatDateTime(result.data.sentAt, { seconds: false }) : ""}`.trim());
    } else {
      toast.error(result.data.message);
    }
    await loadHistory(historyStatus, historyPurpose);
    await load();
  }

  async function onRetry(emailId: string) {
    const result = await retryTransactionalEmailFn({ data: { emailId } });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.data.status === "SENT" ? "Email sent" : `Status: ${result.data.status}`);
    await loadHistory(historyStatus, historyPurpose);
  }

  const status = settings?.status;

  return (
    <section
      data-admin-section="email-settings"
      className="space-y-6 rounded-lg border border-border bg-surface/30 p-4 sm:p-5 lg:col-span-2"
    >
      <div>
        <h2 className="font-display text-lg font-semibold uppercase">Email</h2>
        <p className="mt-1 max-w-3xl text-[13px] text-steel">
          Configure SiteGround SMTP for Automotive Brands transactional email. Enter the host,
          port, encryption, username and password provided by SiteGround. Save settings before
          testing the connection. Coolify SMTP environment variables are not required.
        </p>
      </div>

      {loadError ? (
        <p className="text-[13px] text-warn" role="status">
          {loadError}
        </p>
      ) : null}

      {/* Status card */}
      <div className="rounded-md border border-border bg-ink/40 p-4" data-email-status-card>
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide">Email system</h3>
        <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["SMTP Configuration", status?.smtpConfigured],
            ["Password", status?.passwordConfigured],
            ["Delivery", status?.deliveryEnabled],
            ["Sender", status?.senderConfigured],
            ["Application Alerts", status?.applicationAlertsConfigured],
            ["Order Alerts", status?.orderAlertsConfigured],
            ["Motorsport Alerts", status?.motorsportAlertsConfigured],
          ].map(([label, ok]) => (
            <div key={String(label)} className="flex items-center justify-between gap-2 rounded border border-border/60 px-3 py-2">
              <dt className="text-steel">{label as string}</dt>
              <dd>
                <StatusBadge tone={ok ? "good" : "warn"}>
                  {label === "Delivery"
                    ? ok
                      ? "Enabled"
                      : "Disabled"
                    : ok
                      ? "Configured"
                      : "Incomplete"}
                </StatusBadge>
              </dd>
            </div>
          ))}
        </dl>
        {!status?.deliveryEnabled ? (
          <p className="mt-3 text-[12px] text-warn" role="status">
            Transactional email delivery is disabled. Business workflows continue; outbound emails
            are recorded as DEFERRED until you enable delivery.
          </p>
        ) : null}
      </div>

      {/* SMTP */}
      <div className="space-y-4">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide">SMTP server</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="SMTP host">
            <input
              className={inputClass}
              value={form.smtpHost}
              onChange={(e) => setForm((f) => ({ ...f, smtpHost: e.target.value }))}
              placeholder="smtp.example.com"
              autoComplete="off"
            />
          </Field>
          <Field label="SMTP port">
            <input
              className={inputClass}
              type="number"
              min={1}
              max={65535}
              value={form.smtpPort}
              onChange={(e) => setForm((f) => ({ ...f, smtpPort: Number(e.target.value) || 0 }))}
            />
          </Field>
          <Field label="Encryption / security">
            <select
              className={inputClass}
              value={form.smtpSecurity}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  smtpSecurity: e.target.value as EmailSettingsDto["smtpSecurity"],
                }))
              }
            >
              <option value="SSL_TLS">SSL/TLS</option>
              <option value="STARTTLS">STARTTLS</option>
              <option value="NONE">None (not recommended)</option>
            </select>
          </Field>
          <Field label="SMTP username">
            <input
              className={inputClass}
              value={form.smtpUsername}
              onChange={(e) => setForm((f) => ({ ...f, smtpUsername: e.target.value }))}
              autoComplete="off"
            />
          </Field>
          <div className="sm:col-span-2 space-y-2">
            <Field label="SMTP password">
              {settings?.smtpPasswordConfigured && !replacePassword ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    className={inputClass}
                    type="password"
                    value="••••••••••••"
                    disabled
                    readOnly
                    aria-label="SMTP password configured"
                  />
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-[13px] font-semibold"
                    onClick={() => setReplacePassword(true)}
                  >
                    Replace password
                  </button>
                </div>
              ) : (
                <input
                  className={inputClass}
                  type="password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder={settings?.smtpPasswordConfigured ? "Enter new password" : "Enter SMTP password"}
                  autoComplete="new-password"
                />
              )}
            </Field>
            {form.smtpSecurity === "NONE" ? (
              <p className="text-[12px] text-warn">
                Sending without encryption is insecure. Prefer SSL/TLS or STARTTLS as provided by
                SiteGround.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Sender */}
      <div className="space-y-4">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide">Sender details</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From name">
            <input
              className={inputClass}
              value={form.fromName}
              onChange={(e) => setForm((f) => ({ ...f, fromName: e.target.value }))}
              placeholder="Automotive Brands Trade"
            />
          </Field>
          <Field label="From email">
            <input
              className={inputClass}
              type="email"
              value={form.fromEmail}
              onChange={(e) => setForm((f) => ({ ...f, fromEmail: e.target.value }))}
              placeholder="trade@example.com"
            />
          </Field>
          <Field label="Reply-To name">
            <input
              className={inputClass}
              value={form.replyToName}
              onChange={(e) => setForm((f) => ({ ...f, replyToName: e.target.value }))}
            />
          </Field>
          <Field label="Reply-To email">
            <input
              className={inputClass}
              type="email"
              value={form.replyToEmail}
              onChange={(e) => setForm((f) => ({ ...f, replyToEmail: e.target.value }))}
            />
          </Field>
        </div>
      </div>

      {/* Notifications */}
      <div className="space-y-4">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide">Notifications</h3>
        <div className="grid gap-6 lg:grid-cols-2">
          <RecipientEditor
            label="Trade application notifications"
            recipients={form.tradeApplicationRecipients}
            onChange={(tradeApplicationRecipients) =>
              setForm((f) => ({ ...f, tradeApplicationRecipients }))
            }
          />
          <RecipientEditor
            label="New B2B order notifications"
            recipients={form.orderNotificationRecipients}
            onChange={(orderNotificationRecipients) =>
              setForm((f) => ({ ...f, orderNotificationRecipients }))
            }
          />
          <RecipientEditor
            label="Motorsport partnership enquiries"
            recipients={form.motorsportEnquiryRecipients}
            onChange={(motorsportEnquiryRecipients) =>
              setForm((f) => ({ ...f, motorsportEnquiryRecipients }))
            }
          />
        </div>
      </div>

      {/* Delivery */}
      <div className="space-y-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide">Email delivery</h3>
        <label className="flex items-center gap-3 text-[13px]">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          <span>
            Transactional email{" "}
            <strong>{form.enabled ? "Enabled" : "Disabled"}</strong>
          </span>
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void onSave()}
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13px] font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>

      {/* Test & diagnostics */}
      <div className="space-y-4 border-t border-border pt-5">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide">
          Test &amp; diagnostics
        </h3>
        <p className="text-[13px] text-steel">
          Test Connection uses the <strong>saved</strong> SMTP configuration. Save settings first,
          then test.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={testing}
            onClick={() => void onTestConnection()}
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[13px] font-semibold disabled:opacity-60"
          >
            {testing ? "Testing…" : "Test SMTP connection"}
          </button>
          {settings?.lastConnectionTestAt ? (
            <StatusBadge tone={statusTone(Boolean(settings.lastConnectionTestOk))}>
              {settings.lastConnectionTestOk ? "CONNECTION SUCCESSFUL" : settings.lastConnectionTestError ?? "Failed"}{" "}
              · {formatDateTime(settings.lastConnectionTestAt, { seconds: false })}
            </StatusBadge>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Test recipient email">
            <input
              className={inputClass}
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Recipient name (optional)">
            <input
              className={inputClass}
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
            />
          </Field>
        </div>
        <p className="text-[12px] text-steel">
          Send Test Email is a diagnostic action. It uses the same SMTP transport as production mail
          and can run even when delivery is disabled, so you can verify SiteGround before going live.
        </p>
        <button
          type="button"
          disabled={sendingTest || !testTo.trim()}
          onClick={() => void onSendTest()}
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[13px] font-semibold disabled:opacity-60"
        >
          {sendingTest ? "Sending…" : "Send test email"}
        </button>
        {settings?.lastTestEmailAt ? (
          <StatusBadge tone={statusTone(Boolean(settings.lastTestEmailOk))}>
            {settings.lastTestEmailOk ? "SENT" : settings.lastTestEmailError ?? "FAILED"} ·{" "}
            {formatDateTime(settings.lastTestEmailAt, { seconds: false })}
          </StatusBadge>
        ) : null}
      </div>

      {/* Recent emails */}
      <div className="space-y-3 border-t border-border pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide">Recent emails</h3>
          <div className="flex flex-wrap gap-2">
            <select
              className={inputClass}
              value={historyStatus}
              onChange={(e) => {
                setHistoryStatus(e.target.value);
                void loadHistory(e.target.value, historyPurpose);
              }}
              aria-label="Filter by status"
            >
              <option value="ALL">All statuses</option>
              <option value="SENT">Sent</option>
              <option value="FAILED">Failed</option>
              <option value="DEFERRED">Deferred</option>
              <option value="PENDING">Pending</option>
            </select>
            <select
              className={inputClass}
              value={historyPurpose}
              onChange={(e) => {
                setHistoryPurpose(e.target.value);
                void loadHistory(historyStatus, e.target.value);
              }}
              aria-label="Filter by purpose"
            >
              <option value="ALL">All purposes</option>
              <option value="ORDER_RECEIVED">Order Received</option>
              <option value="ORDER_RECEIVED_INTERNAL">Order Internal</option>
              <option value="TRADE_APPLICATION_RECEIVED">Application Received</option>
              <option value="TRADE_APPLICATION_INTERNAL_NOTIFICATION">Application Internal</option>
              <option value="TRADE_APPLICATION_APPROVED">Application Approved</option>
              <option value="EMAIL_TEST">Test Email</option>
              <option value="PASSWORD_RESET">Password Reset</option>
              <option value="USER_INVITATION">User Invitation</option>
              <option value="COMPANY_USER_INVITED">Portal Invite</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full text-left text-[13px]">
            <thead className="border-b border-border bg-ink/50 text-[11px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Purpose</th>
                <th className="px-3 py-2 font-semibold">Recipient</th>
                <th className="px-3 py-2 font-semibold">Reference</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-steel">
                    No emails yet
                  </td>
                </tr>
              ) : (
                history.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-3 py-2">
                      {formatDateTime(row.createdAt, { seconds: false }) ?? "—"}
                    </td>
                    <td className="px-3 py-2">{purposeLabel(row.purpose)}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2">{row.toEmail}</td>
                    <td className="px-3 py-2">{row.reference ?? "—"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge
                        tone={
                          row.status === "SENT"
                            ? "good"
                            : row.status === "FAILED"
                              ? "bad"
                              : row.status === "DEFERRED"
                                ? "warn"
                                : "neutral"
                        }
                      >
                        {row.status}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {(row.status === "FAILED" || row.status === "DEFERRED") &&
                      row.purpose !== "EMAIL_TEST" ? (
                        <button
                          type="button"
                          className="text-[12px] font-semibold uppercase tracking-wide"
                          onClick={() => void onRetry(row.id)}
                        >
                          Retry
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
