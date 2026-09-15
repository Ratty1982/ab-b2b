import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { PublicLayout } from "@/components/ab/PublicLayout";
import {
  getClientSession,
  resolvePostLoginPath,
  safeReturnPath,
  signInWithPassword,
} from "@/server/auth/session";

const loginSearchSchema = z.object({
  returnTo: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: (search) => loginSearchSchema.parse(search),
  beforeLoad: async ({ search }) => {
    const session = await getClientSession();
    if (session.signedIn) {
      const dest = safeReturnPath(search.returnTo, resolvePostLoginPath(session));
      throw redirect({ href: dest });
    }
  },
  head: () => ({
    meta: [
      { title: "Trade Login — Automotive Brands" },
      {
        name: "description",
        content:
          "Sign in to the Automotive Brands trade portal to see your pricing, place orders and manage your account.",
      },
      { property: "og:title", content: "Trade Login — Automotive Brands" },
      { property: "og:description", content: "Sign in to the Automotive Brands trade portal." },
    ],
  }),
  component: Login,
});

function Login() {
  const navigate = Route.useNavigate();
  const { returnTo } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <PublicLayout>
      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
            Trade Portal
          </div>
          <h1 className="mt-2 font-display text-4xl font-semibold uppercase tracking-tight">
            Trade Login
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-steel">
            Sign in to see your contracted pricing, live availability and full order history across
            every Automotive Brands range.
          </p>
          <p className="mt-6 text-sm text-steel">
            No account yet?{" "}
            <Link to="/register" className="font-semibold text-primary hover:underline">
              Open a trade account
            </Link>
          </p>
        </div>

        <form
          className="rounded-lg border border-border bg-surface/60 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              setPending(true);
              setError(null);
              const result = await signInWithPassword({
                data: { email, password },
              });
              setPending(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              const session = await getClientSession();
              if (!session.signedIn) {
                setError("Invalid email or password");
                return;
              }
              const dest = safeReturnPath(returnTo, resolvePostLoginPath(session));
              await navigate({ href: dest });
            })();
          }}
        >
          <div className="grid gap-4">
            <div>
              <label htmlFor="email" className="block text-[12px] font-medium text-steel">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-[12px] font-medium text-steel">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
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
              {pending ? "Signing in…" : "Sign in to the trade portal"}
            </button>
            <div className="grid gap-2 border-t border-border pt-4 text-[13px]">
              <Link to="/forgot-password" className="font-semibold text-cyan hover:underline">
                Forgot password?
              </Link>
            </div>
          </div>
        </form>
      </div>
    </PublicLayout>
  );
}
