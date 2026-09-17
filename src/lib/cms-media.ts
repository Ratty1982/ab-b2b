/** Public URL for a stored CMS media row (served by `/api/cms-media/$id`). */
export function cmsMediaPublicPath(id: string): string {
  return `/api/cms-media/${id}`;
}

export function cmsMediaDisplaySrc(media: {
  mediaId?: unknown;
  src?: unknown;
} | null | undefined): string | undefined {
  if (!media) return undefined;
  if (typeof media.mediaId === "string" && media.mediaId) {
    return cmsMediaPublicPath(media.mediaId);
  }
  if (typeof media.src === "string" && media.src) return media.src;
  return undefined;
}

export type BrandLogoRef = {
  mediaId?: string | undefined;
  src?: string | undefined;
  alt?: string | undefined;
};

export function readBrandLogos(
  config: Record<string, unknown> | null | undefined,
): Record<string, BrandLogoRef> {
  const raw = config?.["logos"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, BrandLogoRef> = {};
  for (const [slug, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    out[slug] = {
      mediaId: typeof row["mediaId"] === "string" ? row["mediaId"] : undefined,
      src: typeof row["src"] === "string" ? row["src"] : undefined,
      alt: typeof row["alt"] === "string" ? row["alt"] : undefined,
    };
  }
  return out;
}

export function mergeBrandLogoMaps(
  sectionLogos: Record<string, BrandLogoRef>,
  catalogueLogos: Record<string, BrandLogoRef>,
): Record<string, BrandLogoRef> {
  const out = { ...catalogueLogos };
  for (const [slug, logo] of Object.entries(sectionLogos)) {
    if (cmsMediaDisplaySrc(logo)) out[slug] = { ...out[slug], ...logo };
    else delete out[slug];
  }
  return out;
}
