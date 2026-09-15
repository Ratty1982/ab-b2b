import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout, PageHeader, Breadcrumbs } from "@/components/ab/PublicLayout";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Automotive Brands — UK Multi-Brand Automotive Supplier" },
      {
        name: "description",
        content:
          "Automotive Brands supplies Power Maxed, Steel Seal, Street Rhino, Bramley Power and Kidzmotion to UK motor factors, workshops, retailers and distributors.",
      },
      { property: "og:title", content: "About Automotive Brands" },
      {
        property: "og:description",
        content: "The umbrella business behind five automotive aftermarket brands.",
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
        title="The group behind five automotive brands"
        sub="Manufacturing, distribution and trade supply from a single UK operation."
      />
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "About Us" }]} />
        <div className="mt-8 space-y-6 text-[15px] leading-relaxed text-steel">
          <p>
            Automotive Brands is a UK aftermarket group supplying trade customers with products from
            Power Maxed, Steel Seal, Street Rhino, Bramley Power and Kidzmotion. Each brand keeps its
            own identity, product development and following — while factors, workshops and
            distributors buy them all through one trade account, one delivery and one invoice.
          </p>
          <p>
            We hold stock in the UK, pick and despatch the same working day on orders placed before
            3pm, and support accounts with a dedicated representative rather than a call queue.
          </p>
          <p>
            Our customers range from single-site garages to national buying groups and export
            distributors. Pricing is structured by account, with quantity breaks, case pricing and
            contract rates applied automatically at the point of ordering.
          </p>
        </div>
        <dl className="mt-10 grid gap-px border border-border bg-border sm:grid-cols-3">
          {[
            ["5", "Aftermarket brands"],
            ["2,400+", "Trade accounts"],
            ["Same day", "Despatch before 3pm"],
          ].map(([v, l]) => (
            <div key={l} className="bg-surface/60 p-5">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">{l}</dt>
              <dd className="num mt-1 font-display text-2xl font-semibold text-primary">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </PublicLayout>
  );
}
