import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { PublicLayout } from "@/components/ab/PublicLayout";
import { completePasswordReset } from "@/server/auth/session";

const searchSchema = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [{ title: "Reset password — Automotive Brands" }],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <PublicLayout>
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
          Account
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight">
          Reset password
        </h1>
        <p className="mt-3 text-sm text-steel">Choose a new password (minimum 10 characters).</p>
        <form
          className="mt-8 grid gap-4 rounded-lg border border-border bg-surface/60 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!token) {
              setError("Missing reset token. Request a new link from the forgot password page.");
              return;
            }
            if (password !== confirm) {
              setError("Passwords do not match");
              return;
            }
            void (async () => {
              setPending(true);
              setError(null);
              const result = await completePasswordReset({
                data: { token, newPassword: password },
              });
              setPending(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              await navigate({ to: "/login" });
            })();
          }}
        >
          <div>
            <label htmlFor="password" className="block text-[12px] font-medium text-steel">
              New password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
            />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-[12px] font-medium text-steel">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              required
              minLength={10}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
            />
          </div>
          {error ? (
            <p className="text-[13px] text-warn" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-md bg-primary text-sm font-bold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
          >
            {pending ? "Updating…" : "Update password"}
          </button>
          <Link to="/login" className="text-[13px] font-semibold text-cyan hover:underline">
            Back to login
          </Link>
        </form>
      </div>
    </PublicLayout>
  );
}
