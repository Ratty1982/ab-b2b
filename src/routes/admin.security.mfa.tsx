import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { ROUTES } from "@/lib/app-nav";
import {
  beginMfaEnrollmentFn,
  confirmMfaEnrollmentFn,
  disableMfaFn,
  getMfaStatusFn,
} from "@/server/auth/mfa";

export const Route = createFileRoute("/admin/security/mfa")({
  head: () => ({
    meta: [
      { title: "MFA setup — Automotive Brands" },
      { name: "description", content: "Authenticator MFA enrollment for privileged staff." },
    ],
  }),
  component: MfaSetupPage,
});

function MfaSetupPage() {
  const [status, setStatus] = useState<{
    twoFactorEnabled: boolean;
    mfaRequired: boolean;
    enforcementActive: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function reload() {
    const res = await getMfaStatusFn();
    if (res.ok) setStatus(res.data);
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div>
      <PanelHeader
        title="Authenticator MFA"
        sub="TOTP for privileged internal accounts — SUPER_ADMIN and ACCOUNTS"
        crumbs={[
          { label: "Admin", to: ROUTES.admin },
          { label: "Security", to: "/admin/security/mfa" },
          { label: "MFA" },
        ]}
      />

      <div className="mx-auto max-w-xl space-y-6 px-4 py-6 sm:px-6">
        {status ? (
          <div className="rounded-lg bg-surface px-4 py-3 text-[13px] ring-1 ring-inset ring-border/50">
            <p>
              Status:{" "}
              <span className="font-semibold">
                {status.twoFactorEnabled ? "Enabled" : "Not enrolled"}
              </span>
            </p>
            <p className="mt-1 text-steel">
              Role requires MFA: {status.mfaRequired ? "Yes" : "No"} · Enforcement:{" "}
              {status.enforcementActive ? "Active" : "Off (set MFA_ENFORCE_PRIVILEGED=true)"}
            </p>
          </div>
        ) : null}

        {!status?.twoFactorEnabled && !totpURI ? (
          <form
            className="space-y-3 rounded-lg bg-surface p-4 ring-1 ring-inset ring-border/50"
            onSubmit={(e) => {
              e.preventDefault();
              const password = String(new FormData(e.currentTarget).get("password") ?? "");
              void (async () => {
                setPending(true);
                setError(null);
                const res = await beginMfaEnrollmentFn({ data: { password } });
                setPending(false);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setTotpURI(res.data.totpURI);
                setBackupCodes(res.data.backupCodes);
              })();
            }}
          >
            <h2 className="font-display text-base font-semibold uppercase">Start enrollment</h2>
            <p className="text-[13px] text-steel">
              Confirm your password to generate a QR/setup URI and one-time recovery codes.
            </p>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Current password"
              className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
            />
            {error ? <p className="text-[13px] text-warn">{error}</p> : null}
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-3 py-2 text-[12px] font-semibold uppercase text-primary-foreground disabled:opacity-60"
            >
              {pending ? "Starting…" : "Generate setup"}
            </button>
          </form>
        ) : null}

        {totpURI && !confirmed ? (
          <div className="space-y-4 rounded-lg bg-surface p-4 ring-1 ring-inset ring-border/50">
            <h2 className="font-display text-base font-semibold uppercase">Scan & verify</h2>
            <p className="break-all text-[12px] text-steel">Setup URI (add to authenticator app):</p>
            <code className="block break-all rounded bg-ink/40 p-2 text-[11px]">{totpURI}</code>
            {backupCodes ? (
              <div>
                <p className="text-[13px] font-semibold text-warn">
                  Save these recovery codes now — they are shown once.
                </p>
                <ul className="mt-2 grid gap-1 font-mono text-[12px]">
                  {backupCodes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const code = String(new FormData(e.currentTarget).get("code") ?? "");
                void (async () => {
                  setPending(true);
                  setError(null);
                  const res = await confirmMfaEnrollmentFn({ data: { code } });
                  setPending(false);
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  setConfirmed(true);
                  setTotpURI(null);
                  setBackupCodes(null);
                  await reload();
                })();
              }}
            >
              <input
                name="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm tracking-widest"
              />
              {error ? <p className="text-[13px] text-warn">{error}</p> : null}
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-primary px-3 py-2 text-[12px] font-semibold uppercase text-primary-foreground disabled:opacity-60"
              >
                {pending ? "Confirming…" : "Confirm MFA"}
              </button>
            </form>
          </div>
        ) : null}

        {status?.twoFactorEnabled ? (
          <div className="space-y-3 rounded-lg bg-good/10 p-4 ring-1 ring-inset ring-good/30">
            <p className="text-[13px] font-semibold text-good">MFA is enabled on this account.</p>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const password = String(new FormData(e.currentTarget).get("password") ?? "");
                void (async () => {
                  setPending(true);
                  setError(null);
                  const res = await disableMfaFn({ data: { password } });
                  setPending(false);
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  await reload();
                })();
              }}
            >
              <input
                name="password"
                type="password"
                required
                placeholder="Password to disable MFA"
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
              />
              {error ? <p className="text-[13px] text-warn">{error}</p> : null}
              <button
                type="submit"
                disabled={pending}
                className="rounded-md border border-border px-3 py-2 text-[12px] font-semibold uppercase disabled:opacity-60"
              >
                Disable MFA
              </button>
            </form>
          </div>
        ) : null}

        <p className="text-[12px] text-steel">
          Lost device: use a recovery code at login, then re-enroll from this page. For locked-out
          privileged accounts, a Super Admin can reset the password (sessions revoked) and assist
          re-enrollment — never share TOTP secrets over email.
        </p>
        <Link to={ROUTES.admin} className="text-[12px] font-semibold text-primary hover:underline">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
