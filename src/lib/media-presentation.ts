import type { MediaUploadUsage } from "@/domain/media-usage";

export const mediaContainClass = "object-contain object-center";

/** Letterbox / transparent cutouts sit on white — never flatten the file. */
export const catalogueStageClass = "bg-white";

/** Product / cutout catalogue media — never crop, never stretch. */
export const catalogueMediaClass = `h-full w-full ${mediaContainClass} ${catalogueStageClass}`;

/** Brand marks and wordmarks. */
export const brandLogoClass = `h-full w-full ${mediaContainClass} ${catalogueStageClass}`;

/** Category product/cutout imagery. */
export const categoryImageClass = `h-full w-full ${mediaContainClass} ${catalogueStageClass}`;

/** Heroes, banners, and photographic fills when CMS asks for cover. */
export const photoCoverClass = "h-full w-full object-cover object-center";

export function mediaFitClassForUsage(usage: MediaUploadUsage): string {
  if (usage === "CMS_GENERAL") return photoCoverClass;
  if (usage === "BRAND_LOGO") return brandLogoClass;
  if (usage === "CATEGORY_IMAGE") return categoryImageClass;
  return catalogueMediaClass;
}

export function mediaLibraryThumbClass(usage: MediaUploadUsage): string {
  if (usage === "CMS_GENERAL") return `aspect-square w-full ${photoCoverClass}`;
  return `aspect-square w-full ${mediaFitClassForUsage(usage)}`;
}
