import { ROUTES } from "@/lib/app-nav";
import { MARKETING_CMS_PAGES } from "@/domain/cms-marketing-pages";

/** Display copy for known CMS slugs — only used when the page exists in the database. */
const BLURBS: Record<string, string> = {
  home: "Main public website homepage",
  ...Object.fromEntries(MARKETING_CMS_PAGES.map((page) => [page.slug, page.blurb])),
};

export function cmsPageBlurb(slug: string): string {
  return BLURBS[slug] ?? "Public website page";
}

export function cmsPublicPath(slug: string): string {
  if (slug === "home") return ROUTES.home;
  if (slug === "brands") return "/brands";
  return `/${slug}`;
}

export function cmsEditorPath(slug: string): string {
  return ROUTES.adminCmsPage(slug);
}
