import { createFileRoute, Link } from "@tanstack/react-router";
import { PanelHeader } from "@/components/ab/AppShell";
import { ROUTES } from "@/lib/app-nav";

export const Route = createFileRoute("/portal/quick-order")({
  head: () => ({
    meta: [{ title: "Quick Order — Automotive Brands Trade Portal" }],
  }),
  component: QuickOrderComingSoon,
});

function QuickOrderComingSoon() {
  return (
    <div>
      <PanelHeader title="Quick order" sub="Coming soon" />
      <div className="p-4 sm:p-6">
        <div className="max-w-xl rounded-lg border border-dashed border-border p-6">
          <p className="text-[13px] text-steel">
            SKU quick-order will return once it is wired to the live catalogue, pricing, and basket.
            Until then, place orders from Shop.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to={ROUTES.products}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
            >
              Shop products
            </Link>
            <Link
              to={ROUTES.portalBasket}
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-bold uppercase hover:border-steel"
            >
              View basket
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
