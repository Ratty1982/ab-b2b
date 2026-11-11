import { Link } from "@tanstack/react-router";
import { CatalogueMedia } from "@/components/catalogue/CatalogueMedia";
import { cn } from "@/lib/utils";
import type { AdminDashboardData } from "./types";

type BackInStockItem = NonNullable<AdminDashboardData["backInStock"]>["items"][number];

function BackInStockCard({ item }: { item: BackInStockItem }) {
  return (
    <a
      href={item.href}
      className={cn(
        "group flex gap-3 rounded-xl bg-[#12151c] p-3 ring-1 ring-inset ring-white/10",
        "transition-[transform,box-shadow,background-color] duration-200",
        "hover:-translate-y-0.5 hover:bg-[#171b24] hover:ring-emerald-400/30 hover:shadow-[0_12px_28px_-18px_rgba(16,185,129,0.55)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
      )}
    >
      <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-black/5">
        <CatalogueMedia
          src={item.imageSrc}
          alt={item.productName}
          className="size-full"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-white">{item.productName}</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-white/55">{item.sku}</p>
          </div>
          <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-300 ring-1 ring-inset ring-emerald-400/30">
            Now in stock
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/70">
          <span>
            Prev <span className="font-semibold text-white/90">0</span>
          </span>
          <span>
            Now{" "}
            <span className="font-semibold text-emerald-300">{item.currentSellableQty}</span>
            {item.reservedQty > 0 ? (
              <span className="text-white/45"> · {item.reservedQty} reserved</span>
            ) : null}
            {item.manualOverrideQty != null ? (
              <span className="text-white/45"> · override</span>
            ) : null}
          </span>
          <span className="text-white/45">{item.observedAtLabel}</span>
        </div>
      </div>
    </a>
  );
}

export function BackInStockPanel({
  data,
}: {
  data: NonNullable<AdminDashboardData["backInStock"]>;
}) {
  return (
    <section aria-labelledby="back-in-stock-heading" className="px-4 sm:px-6">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="back-in-stock-heading" className="font-display text-lg font-semibold uppercase">
            Back in stock
          </h2>
          <p className="mt-0.5 text-[12px] text-steel">
            Confirmed Autopart Avail returned from zero — trade-visible products only.
          </p>
        </div>
        <Link
          to={data.viewAllHref}
          className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary hover:underline"
        >
          View all
        </Link>
      </div>

      {data.empty || data.items.length === 0 ? (
        <div className="rounded-xl bg-[#12151c] px-4 py-8 text-center ring-1 ring-inset ring-white/10">
          <p className="text-[13px] font-medium text-white/85">No recent back-in-stock events</p>
          <p className="mt-1 text-[12px] text-white/45">
            When a confirmed zero Avail returns positive on a live sync, it appears here.
          </p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((item) => (
            <BackInStockCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}
