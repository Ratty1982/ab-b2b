import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicLayout, PageHeader, Breadcrumbs } from "@/components/ab/PublicLayout";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Automotive Brands — UK Trade Supplier" },
      {
        name: "description",
        content:
          "Automotive Brands supplies Power Maxed and Steel Seal to UK motor factors, workshops, retailers and distributors.",
      },
      { property: "og:title", content: "About Automotive Brands" },
      {
        property: "og:description",
        content: "Trade supplier of Power Maxed and Steel Seal.",
      },
    ],
  }),
  component: About,
});

function About() {
  return (
    <PublicLayout>
      <PageHeader
        eyebrow="About us"
        title="Automotive Brands"
        lead="The trade supplier behind Power Maxed and Steel Seal."
      />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "About Us" }]} />
        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-steel">
          <p>
            Automotive Brands supplies professional automotive products to trade customers across the
            UK. At launch, the public catalogue focuses on Power Maxed and Steel Seal — available
            through one trade account with account pricing once approved.
          </p>
          <p>
            Trade customers can browse the live catalogue, see customer-safe availability, and order
            in trade case quantities where applicable. Dedicated account manager support is available
            through the trade portal.
          </p>
        </div>
        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/register"
            className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Open a trade account
          </Link>
          <Link
            to="/products"
            className="inline-flex h-11 items-center rounded-md border border-border px-5 text-[13px] font-bold uppercase tracking-wide transition-colors hover:border-steel"
          >
            Shop products
          </Link>
        </div>
      </div>
    </PublicLayout>
  );
}
