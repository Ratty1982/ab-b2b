import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PublicLayout } from "@/components/ab/PublicLayout";

export const Route = createFileRoute("/login")({
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
  const navigate = useNavigate();

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
            navigate({ to: "/portal" });
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
                defaultValue="buyer@abcmotorfactors.co.uk"
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
                defaultValue="demo-account"
                className="mt-1.5 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm"
              />
            </div>
            <button
              type="submit"
              className="h-11 rounded-md bg-primary text-sm font-bold text-primary-foreground transition hover:brightness-110"
            >
              Sign in to the trade portal
            </button>
            <div className="grid gap-2 border-t border-border pt-4 text-[13px]">
              <span className="text-steel">Prototype shortcuts</span>
              <Link to="/sales" className="font-semibold text-cyan hover:underline">
                Sales representative portal →
              </Link>
              <Link to="/crm" className="font-semibold text-cyan hover:underline">
                CRM pipeline →
              </Link>
            </div>
          </div>
        </form>
      </div>
    </PublicLayout>
  );
}
