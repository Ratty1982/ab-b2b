/**
 * Homepage hero IMAGE CANVAS — measured from `src/assets/hero-parts.jpg`.
 * Photographic heroes use Fill Area (cover). Never stretch.
 */
export const HERO_IMAGE_STANDARD = {
  width: 1200,
  height: 1008,
  aspectRatio: "25:21",
  aspectDecimal: 1200 / 1008,
} as const;

export function heroRecommendedCopy(): string {
  return `Recommended hero size: ${HERO_IMAGE_STANDARD.width} × ${HERO_IMAGE_STANDARD.height}px. Recommended aspect ratio: ${HERO_IMAGE_STANDARD.aspectRatio}.`;
}
