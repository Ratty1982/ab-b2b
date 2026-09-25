import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { PublicLayout } from "@/components/ab/PublicLayout";
import { Field, inputClass } from "@/components/ab/Drawer";
import {
  acceptTradeInvitationFn,
  getTradeInvitationPreviewFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

type ActivateSearch = { token?: string };

export const Route = createFileRoute("/activate")({
  validateSearch: (search: Record<string, unknown>): ActivateSearch => {
    const token = search["token"];
    return typeof token === "string" ? { token } : {};
  },
  head: () => ({
    meta: [{ title: "Activate account — Automotive Brands" }],
  }),
  component: ActivateAccount,
});

function ActivateAccount() {
  const { token: tokenFromSearch } = Route.useSearch();
  const navigate = useNavigate();
  const [token, setToken] = useState(tokenFromSearch ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [preview, setPreview] = useState<{
    email?: string | undefined;
    companyName?: string | undefined;
    status?: string | undefined;
    expired?: boolean | undefined;
    kind?: string | undefined;
    roleLabel?: string | undefined;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [doneLoginPath, setDoneLoginPath] = useState("/login");
  const [error, setError] = useState<string | null>(null);

  const isStaff = preview?.kind === "STAFF_USER";

  useEffect(() => {
    if (!tokenFromSearch) return;
    setToken(tokenFromSearch);
    void getTradeInvitationPreviewFn({ data: { token: tokenFromSearch } }).then((r) => {
      if (r.ok) setPreview(r.data);
      else setError(r.error);
    });
  }, [tokenFromSearch]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 10) {
      setError("Password must be at least 10 characters.");
      return;
    }
    setLoading(true);
    const result = await acceptTradeInvitationFn({
      data: { token, password, confirmPassword },
    });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    setDoneLoginPath(result.data.loginPath || "/login");
    setDone(true);
    toast.success("Account activated — you can now sign in");
  }

  return (
    <PublicLayout>
      <div className="mx-auto max-w-lg px-4 py-12 sm:px-6 lg:py-16">
        <h1 className="font-display text-3xl font-semibold uppercase tracking-tight">
          {isStaff ? "Set your password" : "Activate your trade account"}
        </h1>
        <p className="mt-3 text-sm text-steel">
          {isStaff
            ? "Choose a password to activate your Automotive Brands account."
            : "Set a password to access the Automotive Brands trade portal for your company."}
        </p>

        {done ? (
          <div className="mt-8 rounded-md border border-good/40 bg-good/10 p-5 text-sm">
            <p className="font-semibold text-foreground">Account activated</p>
            <p className="mt-2 text-steel">
              Your password has been set. Sign in with your email to continue.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
                onClick={() => void navigate({ to: doneLoginPath })}
              >
                Sign in
              </button>
              {!isStaff ? (
                <Link
                  to="/portal"
                  className="inline-flex h-10 items-center text-[13px] text-steel hover:text-foreground"
                >
                  Go to portal
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <form className="mt-8 grid gap-4" onSubmit={(e) => void onSubmit(e)}>
            {error ? (
              <div role="alert" className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
                {error}
              </div>
            ) : null}
            {preview?.companyName ? (
              <p className="text-sm text-steel">
                Activating access for <span className="font-semibold text-foreground">{preview.companyName}</span>
                {preview.email ? (
                  <>
                    {" "}
                    (<span className="num">{preview.email}</span>)
                  </>
                ) : null}
              </p>
            ) : preview?.email ? (
              <p className="text-sm text-steel">
                Activating <span className="num font-semibold text-foreground">{preview.email}</span>
              </p>
            ) : null}
            {!tokenFromSearch ? (
              <Field label="Activation token">
                <input
                  required
                  className={inputClass}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                />
              </Field>
            ) : null}
            <Field label="New password *">
              <input
                required
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={10}
              />
              <p className="mt-1 text-[12px] text-steel">At least 10 characters.</p>
            </Field>
            <Field label="Confirm password *">
              <input
                required
                type="password"
                autoComplete="new-password"
                className={inputClass}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={10}
              />
            </Field>
            <button
              type="submit"
              disabled={loading || preview?.expired}
              className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            >
              {loading ? "Activating…" : "Set password & activate"}
            </button>
          </form>
        )}
      </div>
    </PublicLayout>
  );
}
