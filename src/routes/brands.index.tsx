import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicLayout, PageHeader } from "@/components/ab/PublicLayout";
import { mediaContainClass } from "@/lib/media-presentation";
import { cn } from "@/lib/utils";
import { listPublicBrandsFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/brands/")({
  loader: async () => {
    const result = await listPublicBrandsFn();
    return result.ok ? result.data : [];
  },
  head: () => ({
    meta: [
      { title: "Our Brands — Automotive Brands" },
      {
        name: "description",
        content: "Power Maxed and Steel Seal — trade brands supplied through one Automotive Brands account.",
      },
    ],
  }),
  component: BrandsIndex,
});

function BrandsIndex() {
  const brands = Route.useLoaderData();
  return (
    <PublicLayout>
      <PageHeader
        eyebrow="Brands"
        title="Two brands. One trade supplier."
        lead="Power Maxed and Steel Seal are available through a single Automotive Brands trade account — browse the range, then order with account pricing once approved."
      />
      <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:px-10">
        {brands.map((b) => (
          <article
            key={b.slug}
            className="flex flex-col gap-4 rounded-lg border border-border/80 bg-surface/40 p-6 sm:p-8"
          >
            {b.logoSrc ? (
              <div className="grid h-16 w-fit place-items-center rounded-md bg-white px-3 py-2">
                <img src={b.logoSrc} alt={`${b.name} logo`} className={cn("h-10 w-auto", mediaContainClass)} />
              </div>
            ) : (
              <span className="grid size-12 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
                {b.name
                  .split(" ")
                  .map((w) => w[0])
                  .join("")}
              </span>
            )}
            <div>
              <h2 className="font-display text-2xl font-semibold uppercase sm:text-3xl">{b.name}</h2>
              {b.tagline ? (
                <p className="mt-1 text-[12px] uppercase tracking-[0.16em] text-cyan">{b.tagline}</p>
              ) : null}
            </div>
            {b.description ? <p className="text-sm leading-relaxed text-steel">{b.description}</p> : null}
            <p className="num text-[12px] text-steel">
              {b.lines.toLocaleString("en-GB")} trade-visible line{b.lines === 1 ? "" : "s"}
            </p>
            <Link
              to="/brands/$slug"
              params={{ slug: b.slug }}
              className="mt-auto inline-flex h-11 w-fit items-center rounded-md bg-primary px-5 text-[12px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
            >
              Shop {b.name}
            </Link>
          </article>
        ))}
      </div>
    </PublicLayout>
  );
}
