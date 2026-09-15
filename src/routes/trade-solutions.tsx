import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicLayout, PageHeader, Breadcrumbs } from "@/components/ab/PublicLayout";

export const Route = createFileRoute("/trade-solutions")({
  head: () => ({
    meta: [
      { title: "Trade Solutions by Industry — Automotive Brands" },
      {
        name: "description",
        content:
          "Supply, pricing and support built around motor factors, workshops and garages, retailers, distributors and buying groups.",
      },
      { property: "og:title", content: "Trade Solutions by Industry — Automotive Brands" },
      { property: "og:description", content: "How we supply factors, workshops, retailers and distributors." },
    ],
  }),
  component: TradeSolutions,
});

const industries = [
  {
    name: "Motor factors",
    body: "Counter-ready packaging, quantity breaks and case pricing, plus same-day despatch so your shelves stay filled between deliveries.",
    points: ["Trade A–C price groups", "Case and pallet pricing", "Backorder visibility"],
  },
  {
    name: "Workshops & garages",
    body: "Fast reordering of the consumables you fit every day, with fitment data and safety documentation attached to every product.",
    points: ["Quick Order by SKU", "Saved usual-order lists", "Technical documents"],
  },
  {
    name: "Retailers",
    body: "Retail-ready lines across five brands with approved imagery, point-of-sale artwork and promotional support.",
    points: ["Approved imagery pack", "POS and display kits", "Seasonal promotions"],
  },
  {
    name: "Distributors & buying groups",
    body: "Contract pricing, volume agreements and account-specific catalogues, managed by a named account representative.",
    points: ["Contract pricing", "Distributor price group", "Dedicated representative"],
  },
];

function TradeSolutions() {
  return (
    <PublicLayout>
      <PageHeader
        eyebrow="Trade solutions"
        title="Built around how your business buys"
        sub="Five brands, one account, and pricing structured for the way your trade operates."
      />
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Trade Solutions" }]} />
        <div className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2">
          {industries.map((i) => (
            <article key={i.name} className="bg-surface/60 p-6">
              <h2 className="font-display text-xl font-semibold uppercase">{i.name}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-steel">{i.body}</p>
              <ul className="mt-4 space-y-1.5 text-[13px]">
                {i.points.map((p) => (
                  <li key={p} className="flex items-center gap-2">
                    <span className="size-1.5 shrink-0 bg-primary" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
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
            to="/brands"
            className="inline-flex h-12 items-center rounded-md border border-border px-6 text-[13px] font-bold uppercase tracking-wide transition-colors hover:border-steel"
          >
            Explore our brands
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
