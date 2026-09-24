import { cmsFocalStyle, cmsImageFitClass, cmsMediaDisplaySrc } from "@/lib/cms-media";
import { cn } from "@/lib/utils";

function str(c: Record<string, unknown>, key: string, fallback = ""): string {
  const v = c[key];
  return typeof v === "string" ? v : fallback;
}

/**
 * Responsive motorsport gallery from CMS MEDIA_GALLERY items.
 * Empty state explains media upload — never invents race photography.
 */
export function MotorsportMediaGallery({ config }: { config: Record<string, unknown> }) {
  const itemsRaw = config["items"];
  const items = Array.isArray(itemsRaw)
    ? itemsRaw.filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
    : [];

  const withSrc = items
    .map((item) => ({
      item,
      src: cmsMediaDisplaySrc(item),
      alt: typeof item["alt"] === "string" ? item["alt"] : "Power Maxed Racing photography",
      caption: typeof item["caption"] === "string" ? item["caption"] : "",
      fit: (item["fit"] as string | undefined) ?? "fill",
    }))
    .filter((row) => Boolean(row.src));

  return (
    <section className="border-b border-border/50 bg-ink" data-motorsport-section="gallery">
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10 lg:py-16">
        {str(config, "eyebrow") ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan">
            {str(config, "eyebrow")}
          </p>
        ) : null}
        <h2 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
          {str(config, "heading", "Gallery")}
        </h2>
        {str(config, "supporting") ? (
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-steel">
            {str(config, "supporting")}
          </p>
        ) : null}

        {withSrc.length === 0 ? (
          <div
            className="mt-8 rounded-lg border border-dashed border-border/70 bg-surface/30 px-5 py-10 text-center"
            role="status"
            data-gallery-empty="true"
          >
            <p className="text-[14px] text-steel">
              Gallery images are managed in Website Builder. Upload licensed Power Maxed Racing
              photography under Admin → Content → Media, then attach them to this gallery section.
            </p>
            <p className="mt-2 text-[12px] text-steel/80">
              Do not crop, blur, or overlay watermarks on preview photography.
            </p>
          </div>
        ) : (
          <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {withSrc.map((row, index) => (
              <li
                key={`${row.src}-${index}`}
                className={cn(
                  "relative overflow-hidden rounded-md bg-[#0c1220]",
                  index % 5 === 0 ? "sm:col-span-2 sm:row-span-2 aspect-[16/10] sm:aspect-auto sm:min-h-[22rem]" : "aspect-[4/3]",
                )}
              >
                <img
                  src={row.src!}
                  alt={row.alt}
                  className={cn(
                    "size-full",
                    cmsImageFitClass(row.fit === "contain" ? "contain" : "fill"),
                  )}
                  style={cmsFocalStyle(row.item)}
                  loading="lazy"
                  decoding="async"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                />
                {row.caption ? (
                  <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8 text-[12px] text-white/90">
                    {row.caption}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
