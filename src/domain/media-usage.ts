export const MEDIA_UPLOAD_USAGES = [
  "PRODUCT_IMAGE",
  "BRAND_LOGO",
  "CATEGORY_IMAGE",
  "CMS_GENERAL",
] as const;

export type MediaUploadUsage = (typeof MEDIA_UPLOAD_USAGES)[number];

/** Product catalogue bounding box — not a forced square. */
export const PRODUCT_IMAGE_MAX_EDGE = 1000;

export function defaultMediaUsage(): MediaUploadUsage {
  return "CMS_GENERAL";
}

export function mediaUsageAppliesProductCap(usage: MediaUploadUsage): boolean {
  return usage === "PRODUCT_IMAGE";
}
