import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicLayout, PageHeader } from "@/components/ab/PublicLayout";
import { brands } from "@/lib/data";

export const Route = createFileRoute("/brands/")({
  head: () => ({
    meta: [
      { title: "Our Brands — Automotive Brands" },
      {
        name: "description",
        content:
          "Power Maxed, Steel Seal, Street Rhino, Bramley Power and Kidzmotion — the Automotive Brands trade portfolio, available on one account.",
      },
      { property: "og:title", content: "Our Brands — Automotive Brands" },
      {
        property: "og:description",
        content: "The Automotive Brands trade portfolio, available on one trade account.",
      },
    ],
  }),
  component: BrandsIndex,
});

function BrandsIndex() {
  return (
    <PublicLayout>
      <PageHeader
        eyebrow="Portfolio"
        title="Our Brands"
        lead="Each brand keeps its own identity and product programme. Every one of them is available to you through a single Automotive Brands trade account."
      />
      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 lg:px-10">
        {brands.map((b) => (
          <Link
            key={b.slug}
            to="/brands/$slug"
            params={{ slug: b.slug }}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface/50 p-6 transition-colors hover:border-primary/60"
          >
            <span className="grid size-12 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
              {b.name
                .split(" ")
                .map((w) => w[0])
                .join("")}
            </span>
            <span className="font-display text-xl font-semibold uppercase">{b.name}</span>
            <span className="text-[12px] uppercase tracking-[0.16em] text-cyan">{b.category}</span>
            <span className="text-sm text-steel">{b.blurb}</span>
            <span className="num mt-auto text-[12px] text-steel">
              {b.lines.toLocaleString("en-GB")} active lines
            </span>
          </Link>
        ))}
      </div>
    </PublicLayout>
  );
}
