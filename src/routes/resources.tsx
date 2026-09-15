import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { PublicLayout, PageHeader, Breadcrumbs } from "@/components/ab/PublicLayout";

export const Route = createFileRoute("/resources")({
  head: () => ({
    meta: [
      { title: "Trade Resources & Downloads — Automotive Brands" },
      {
        name: "description",
        content:
          "Price lists, product catalogues, safety data sheets, technical documents and approved marketing imagery for Automotive Brands trade customers.",
      },
      { property: "og:title", content: "Trade Resources & Downloads — Automotive Brands" },
      { property: "og:description", content: "Catalogues, data sheets and approved marketing assets." },
    ],
  }),
  component: Resources,
});

const groups = [
  {
    title: "Catalogues & price lists",
    items: [
      ["Automotive Brands Trade Catalogue 2026", "PDF · 18.4 MB"],
      ["Power Maxed Price List — Trade A", "PDF · 1.2 MB"],
      ["Steel Seal Case Pricing 2026", "PDF · 480 KB"],
    ],
  },
  {
    title: "Technical & safety",
    items: [
      ["Steel Seal Head Gasket Sealer — Safety Data Sheet", "PDF · 220 KB"],
      ["Power Maxed Brake Cleaner — SDS", "PDF · 210 KB"],
      ["Bramley Power Battery Fitment Guide", "PDF · 3.1 MB"],
    ],
  },
  {
    title: "Marketing & point of sale",
    items: [
      ["Approved product imagery pack", "ZIP · 96 MB"],
      ["Counter display artwork — Street Rhino", "PDF · 6.8 MB"],
      ["Brand usage guidelines", "PDF · 1.9 MB"],
    ],
  },
];

function Resources() {
  return (
    <PublicLayout>
      <PageHeader
        eyebrow="Resources"
        title="Downloads for trade customers"
        sub="Pricing, technical documentation and approved imagery. Trade account holders see account-specific price lists once signed in."
      />
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Resources" }]} />
        <div className="mt-8 grid gap-6 lg:grid-cols-3">
          {groups.map((g) => (
            <section key={g.title}>
              <h2 className="mb-3 font-display text-lg font-semibold uppercase">{g.title}</h2>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {g.items.map(([name, meta]) => (
                  <li key={name}>
                    <a
                      href="#"
                      onClick={(e) => e.preventDefault()}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 hover:bg-secondary/60"
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium">{name}</span>
                        <span className="num block text-[11px] text-steel">{meta}</span>
                      </span>
                      <Download className="size-4 shrink-0 text-primary" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
