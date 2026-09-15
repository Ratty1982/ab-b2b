import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PublicLayout } from "@/components/ab/PublicLayout";
import { requestPasswordReset } from "@/server/auth/session";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [{ title: "Forgot password — Automotive Brands" }],
  }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <PublicLayout>
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
          Account
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight">
          Forgot password
        </h1>
        <p className="mt-3 text-sm text-steel">
          Enter your email and we will send reset instructions if an account exists.
        </p>
        <form
          className="mt-8 grid gap-4 rounded-lg border border-border bg-surface/60 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              setPending(true);
              const result = await requestPasswordReset({ data: { email } });
              setPending(false);
              setMessage(result.message);
            })();
          }}
        >
          <div>
            <label htmlFor="email" className="block text-[12px] font-medium text-steel">
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
            />
          </div>
          {message ? <p className="text-[13px] text-steel">{message}</p> : null}
          <button
            type="submit"
            disabled={pending}
            className="h-11 rounded-md bg-primary text-sm font-bold text-primary-foreground transition hover:brightness-110 disabled:opacity-60"
          >
            {pending ? "Sending…" : "Send reset link"}
          </button>
          <Link to="/login" className="text-[13px] font-semibold text-cyan hover:underline">
            Back to login
          </Link>
        </form>
      </div>
    </PublicLayout>
  );
}
