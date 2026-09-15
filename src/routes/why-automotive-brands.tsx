import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicLayout, PageHeader, Breadcrumbs } from "@/components/ab/PublicLayout";

export const Route = createFileRoute("/why-automotive-brands")({
  head: () => ({
    meta: [
      { title: "Why Automotive Brands — One Trade Account, Every Brand" },
      {
        name: "description",
        content:
          "One account across five brands, live availability, structured trade pricing, same-day despatch and a named account representative.",
      },
      { property: "og:title", content: "Why Automotive Brands" },
      { property: "og:description", content: "One trade account across five automotive brands." },
    ],
  }),
  component: Why,
});

const reasons = [
  ["One account, every brand", "Order Power Maxed, Steel Seal, Street Rhino, Bramley Power and Kidzmotion on one account, one delivery, one invoice."],
  ["Pricing that reflects your business", "Trade A, B, C, distributor and buying-group pricing, with quantity breaks and case rates applied automatically."],
  ["Live availability", "Stock figures shown at the point of ordering, with backorder dates rather than silent shortfalls."],
  ["Fast ordering", "Quick Order by SKU, pasted SKU lists, CSV upload and one-click reorder of your usual products."],
  ["Full order history", "Every order, PO number, invoice and tracking reference retained and searchable."],
  ["A named representative", "A dedicated account manager who knows your business, not a general call queue."],
];

function Why() {
  return (
    <PublicLayout>
      <PageHeader
        eyebrow="Why Automotive Brands"
        title="One trade account. Every brand."
        sub="What trade customers get when they buy the group rather than five separate suppliers."
      />
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Why Automotive Brands" }]} />
        <ol className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {reasons.map(([title, body], i) => (
            <li key={title} className="bg-surface/60 p-6">
              <span className="num font-display text-sm font-semibold text-primary">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 className="mt-1 font-display text-lg font-semibold uppercase">{title}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-steel">{body}</p>
            </li>
          ))}
        </ol>
        <Link
          to="/register"
          className="mt-10 inline-flex h-12 items-center rounded-md bg-primary px-6 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
        >
          Open a trade account
        </Link>
      </div>
    </PublicLayout>
  );
}
