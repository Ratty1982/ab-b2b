import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicLayout, PageHeader, Breadcrumbs } from "@/components/ab/PublicLayout";
import { ACCOUNT_MANAGER_HOURS } from "@/domain/account-manager-hours";

export const Route = createFileRoute("/trade-solutions")({
  head: () => ({
    meta: [
      { title: "Trade Solutions — Automotive Brands" },
      {
        name: "description",
        content:
          "Trade pricing, case ordering, live availability and account support for Power Maxed and Steel Seal customers.",
      },
      { property: "og:title", content: "Trade Solutions — Automotive Brands" },
      {
        property: "og:description",
        content: "How Automotive Brands supports trade customers on Power Maxed and Steel Seal.",
      },
    ],
  }),
  component: TradeSolutions,
});

const capabilities = [
  {
    name: "Trade pricing",
    body: "Approved customers see their account pricing on the catalogue and product pages.",
  },
  {
    name: "Customer-specific pricing",
    body: "Negotiated product prices can be applied to individual trade accounts.",
  },
  {
    name: "Case ordering",
    body: "Products can be ordered in the correct trade case quantities where case packs apply.",
  },
  {
    name: "Live availability",
    body: "Customer-safe availability is derived from current stock data at the point of browsing and ordering.",
  },
  {
    name: "Account support",
    body: `Dedicated account manager details are available in the trade portal. ${ACCOUNT_MANAGER_HOURS.weekdayLine}. ${ACCOUNT_MANAGER_HOURS.orderCutoffLine}.`,
  },
  {
    name: "Quick ordering",
    body: "Trade catalogue designed for rapid repeat purchasing of Power Maxed and Steel Seal lines.",
  },
];

function TradeSolutions() {
  return (
    <PublicLayout>
      <PageHeader
        eyebrow="Trade solutions"
        title="Built for trade ordering"
        lead="Practical capabilities for approved Automotive Brands trade accounts ordering Power Maxed and Steel Seal."
      />
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Trade Solutions" }]} />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {capabilities.map((item) => (
            <article key={item.name} className="rounded-lg border border-border/80 bg-surface/40 p-6">
              <h2 className="font-display text-xl font-semibold uppercase">{item.name}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-steel">{item.body}</p>
            </article>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/register"
            className="inline-flex h-12 items-center rounded-md bg-primary px-6 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Open a trade account
          </Link>
          <Link
            to="/products"
            className="inline-flex h-12 items-center rounded-md border border-border px-6 text-[13px] font-bold uppercase tracking-wide transition-colors hover:border-steel"
          >
            Shop products
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
