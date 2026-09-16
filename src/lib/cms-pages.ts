import { ROUTES } from "@/lib/app-nav";

/** Display copy for known CMS slugs — only used when the page exists in the database. */
const BLURBS: Record<string, string> = {
  home: "Main public website homepage",
  about: "About Automotive Brands",
  brands: "Brand portfolio",
  "trade-solutions": "Trade solutions",
  contact: "Contact",
};

export function cmsPageBlurb(slug: string): string {
  return BLURBS[slug] ?? "Public website page";
}

export function cmsPublicPath(slug: string): string {
  return slug === "home" ? ROUTES.home : `/${slug}`;
}

export function cmsEditorPath(slug: string): string {
  return ROUTES.adminCmsPage(slug);
}
