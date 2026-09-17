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
