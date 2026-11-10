import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PublicLayout } from "@/components/ab/PublicLayout";
import { getClientSession, signOutCurrent } from "@/server/auth/session";
import {
  beginMfaEnrollmentFn,
  confirmMfaEnrollmentFn,
  disableMfaFn,
  getMfaStatusFn,
  regenerateMfaBackupCodesFn,
} from "@/server/auth/mfa";
import { authFlowRobotsMeta } from "@/domain/private-route-seo";

export const Route = createFileRoute("/account/security")({
  beforeLoad: async () => {
    const session = await getClientSession();
    if (!session.signedIn) {
      throw redirect({ to: "/login", search: { returnTo: "/account/security" } });
    }
  },
  head: () => ({
    meta: [
      { title: "Account security — Automotive Brands" },
      { name: "description", content: "Set up an authenticator app for your Automotive Brands account." },
      authFlowRobotsMeta(),
    ],
  }),
  component: AccountSecurityPage,
});

type Status = {
  twoFactorEnabled: boolean;
  mfaRequired: boolean;
  enrollmentRequired: boolean;
};

function AccountSecurityPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [heldCodes, setHeldCodes] = useState<string[] | null>(null);
  const [revealedCodes, setRevealedCodes] = useState<string[] | null>(null);

  async function reload() {
    const res = await getMfaStatusFn();
    if (res.ok) setStatus(res.data);
    else setError(res.error);
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <PublicLayout>
      <div className="mx-auto max-w-xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-tight">Account security</h1>
        <p className="mt-3 text-sm leading-relaxed text-steel">
          Add an authenticator app, such as Microsoft Authenticator, so a password alone is not enough
          to sign in.
        </p>

        {status ? (
          <div className="mt-6 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
            <p>
              Authenticator:{" "}
              <span className="font-semibold">{status.twoFactorEnabled ? "On" : "Not set up"}</span>
            </p>
            {status.enrollmentRequired ? (
              <p className="mt-2 text-warn" role="status">
                Your role needs this before you can use the rest of the site. You can set it up here or
                sign out.
              </p>
            ) : (
              <p className="mt-2 text-steel">
                {status.mfaRequired
                  ? "Your role is due to use an authenticator. It is not blocking you yet."
                  : "This is optional for your account unless the business later asks for it."}
              </p>
            )}
          </div>
        ) : null}

        {!status?.twoFactorEnabled && !qrDataUrl ? (
          <form
            method="post"
            className="mt-6 space-y-3 rounded-lg border border-border bg-surface p-4"
            onSubmit={(event) => {
              event.preventDefault();
              const password = String(new FormData(event.currentTarget).get("password") ?? "");
              void (async () => {
                setPending(true);
                setError(null);
                const res = await beginMfaEnrollmentFn({ data: { password } });
                setPending(false);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setQrDataUrl(res.data.qrDataUrl);
                setManualKey(res.data.manualKey);
                setHeldCodes(res.data.backupCodes);
                setRevealedCodes(null);
              })();
            }}
          >
            <h2 className="text-base font-semibold">Turn on authenticator</h2>
            <p className="text-sm text-steel">Enter your password to start. The app is not switched on until the code is accepted.</p>
            <label className="block text-[12px] font-medium text-steel" htmlFor="current-password">
              Password
            </label>
            <input
              id="current-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="h-11 w-full rounded-md border border-border bg-background px-3 text-base"
            />
            {error ? (
              <p className="text-sm text-warn" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="h-11 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60"
            >
              {pending ? "Starting…" : "Continue"}
            </button>
          </form>
        ) : null}

        {qrDataUrl && !status?.twoFactorEnabled ? (
          <div className="mt-6 space-y-4 rounded-lg border border-border bg-surface p-4">
            <h2 className="text-base font-semibold">Scan the code</h2>
            <p className="text-sm text-steel">
              Open Microsoft Authenticator, or another authenticator app, and scan this image. Then enter
              the 6-digit code it shows.
            </p>
            <img
              src={qrDataUrl}
              alt="Authenticator setup code"
              width={220}
              height={220}
              className="rounded-md bg-white p-2"
            />
            {manualKey ? (
              <div>
                <p className="text-sm text-steel">If you cannot scan, type this key into the app. Do not email it or save it in the browser.</p>
                <p className="mt-2 break-all font-mono text-sm">{manualKey}</p>
              </div>
            ) : null}
            <form
              method="post"
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const code = String(new FormData(event.currentTarget).get("code") ?? "");
                void (async () => {
                  setPending(true);
                  setError(null);
                  const res = await confirmMfaEnrollmentFn({ data: { code } });
                  setPending(false);
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  setRevealedCodes(heldCodes);
                  setHeldCodes(null);
                  setQrDataUrl(null);
                  setManualKey(null);
                  await reload();
                })();
              }}
            >
              <label className="block text-[12px] font-medium text-steel" htmlFor="setup-code">
                6-digit code
              </label>
              <input
                id="setup-code"
                name="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,8}"
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-base tracking-widest"
              />
              {error ? (
                <p className="text-sm text-warn" role="alert">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={pending}
                className="h-11 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-60"
              >
                {pending ? "Checking…" : "Confirm and switch on"}
              </button>
            </form>
          </div>
        ) : null}

        {revealedCodes && revealedCodes.length > 0 ? (
          <div className="mt-6 rounded-lg border border-warn/40 bg-surface p-4">
            <h2 className="text-base font-semibold">Save your recovery codes</h2>
            <p className="mt-2 text-sm text-steel">
              Each code works once if you lose your phone. Store them somewhere safe, then leave this
              page. They will not be shown again.
            </p>
            <ul className="mt-3 grid gap-1 font-mono text-sm">
              {revealedCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {status?.twoFactorEnabled ? (
          <div className="mt-6 space-y-6">
            <form
              method="post"
              className="space-y-3 rounded-lg border border-border bg-surface p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const password = String(new FormData(form).get("password") ?? "");
                void (async () => {
                  setPending(true);
                  setError(null);
                  const res = await regenerateMfaBackupCodesFn({ data: { password } });
                  setPending(false);
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  setRevealedCodes(res.data.backupCodes);
                  form.reset();
                })();
              }}
            >
              <h2 className="text-base font-semibold">New recovery codes</h2>
              <p className="text-sm text-steel">Enter your password. The previous codes stop working.</p>
              <label className="block text-[12px] font-medium text-steel" htmlFor="regen-password">
                Password
              </label>
              <input
                id="regen-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-base"
              />
              <button
                type="submit"
                disabled={pending}
                className="h-11 rounded-md border border-border px-4 text-sm font-bold disabled:opacity-60"
              >
                Create new codes
              </button>
            </form>

            {status.enrollmentRequired ? (
              <p className="rounded-lg border border-border bg-surface p-4 text-sm text-steel">
                Your role needs the authenticator, so it stays on. If you lose your phone, use a recovery
                code or ask a Super Admin to reset it.
              </p>
            ) : (
            <form
              method="post"
              className="space-y-3 rounded-lg border border-border bg-surface p-4"
              onSubmit={(event) => {
                event.preventDefault();
                const password = String(new FormData(event.currentTarget).get("password") ?? "");
                void (async () => {
                  setPending(true);
                  setError(null);
                  const res = await disableMfaFn({ data: { password } });
                  setPending(false);
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  setRevealedCodes(null);
                  await reload();
                })();
              }}
            >
              <h2 className="text-base font-semibold">Switch off authenticator</h2>
              <p className="text-sm text-steel">
                This also forgets browsers you had asked us to remember. You will need your password.
              </p>
              <label className="block text-[12px] font-medium text-steel" htmlFor="disable-password">
                Password
              </label>
              <input
                id="disable-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="h-11 w-full rounded-md border border-border bg-background px-3 text-base"
              />
              <button
                type="submit"
                disabled={pending}
                className="h-11 rounded-md border border-border px-4 text-sm font-bold disabled:opacity-60"
              >
                Switch off
              </button>
            </form>
            )}
          </div>
        ) : null}

        {error && status?.twoFactorEnabled ? (
          <p className="mt-4 text-sm text-warn" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Back to sign in
          </Link>
          <button
            type="button"
            className="font-semibold text-steel hover:text-primary"
            onClick={() => {
              void (async () => {
                try {
                  await signOutCurrent();
                } finally {
                  window.location.href = "/login";
                }
              })();
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </PublicLayout>
  );
}
