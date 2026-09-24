import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicLayout, PageHeader, Breadcrumbs } from "@/components/ab/PublicLayout";
import { ACCOUNT_MANAGER_HOURS } from "@/domain/account-manager-hours";

export const Route = createFileRoute("/why-automotive-brands")({
  head: () => ({
    meta: [
      { title: "Why Automotive Brands — Trade Supplier for Power Maxed & Steel Seal" },
      {
        name: "description",
        content:
          "Automotive Brands supplies Power Maxed and Steel Seal to UK trade customers with account pricing, live availability and dedicated support.",
      },
      { property: "og:title", content: "Why Automotive Brands" },
      {
        property: "og:description",
        content: "Trade supply of Power Maxed and Steel Seal from one account.",
      },
    ],
  }),
  component: Why,
});

const reasons = [
  [
    "Trade supplier for Power Maxed & Steel Seal",
    "Browse both brands in one catalogue and order through a single Automotive Brands trade account.",
  ],
  [
    "Commercial pricing for approved accounts",
    "Approved trade customers see their account pricing on products and in the basket.",
  ],
  [
    "Ordering convenience",
    "Catalogue browsing with case quantities and customer-safe availability for trade supply.",
  ],
  [
    "Account support",
    `Dedicated account manager support for trade customers. ${ACCOUNT_MANAGER_HOURS.weekdayLine}. ${ACCOUNT_MANAGER_HOURS.orderCutoffLine}.`,
  ],
];

function Why() {
  return (
    <PublicLayout>
      <PageHeader
        eyebrow="Why Automotive Brands"
        title="Trade supply, without the noise"
        lead="A concise proposition for trade customers who need Power Maxed and Steel Seal from one supplier."
      />
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Why Automotive Brands" }]} />
        <ol className="mt-8 grid gap-4 sm:grid-cols-2">
          {reasons.map(([title, body], i) => (
            <li key={title} className="rounded-lg border border-border/80 bg-surface/40 p-6">
              <span className="num font-display text-sm font-semibold text-primary">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 className="mt-1 font-display text-lg font-semibold uppercase">{title}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-steel">{body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/register"
            className="inline-flex h-12 items-center rounded-md bg-primary px-6 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Open a trade account
          </Link>
          <Link
            to="/brands"
            className="inline-flex h-12 items-center rounded-md border border-border px-6 text-[13px] font-bold uppercase tracking-wide transition-colors hover:border-steel"
          >
            View brands
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
