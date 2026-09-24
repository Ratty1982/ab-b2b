import { CMS_SECTION_TYPES, type CmsSectionTypeKey } from "@/domain/cms";
import { defaultFeaturedBrandsConfig } from "@/domain/featured-brands";
import { HOMEPAGE_MOTORSPORT_DEFAULTS } from "@/domain/motorsport";

export type EditorSection = {
  id: string;
  type: CmsSectionTypeKey;
  config: Record<string, unknown>;
  enabled: boolean;
  sortOrder?: number;
};

export const EDITOR_VIEWPORTS = {
  desktop: 1280,
  tablet: 768,
  mobile: 390,
} as const;

export type EditorViewport = keyof typeof EDITOR_VIEWPORTS;

export const SECTION_LIBRARY: Array<{
  type: CmsSectionTypeKey;
  name: string;
  description: string;
}> = [
  { type: "HERO", name: "Hero", description: "Headline, image canvas and primary call to action" },
  { type: "BRAND_LOGO_STRIP", name: "Brand Logos", description: "Horizontal strip of brand marks" },
  { type: "FEATURED_BRANDS", name: "Featured Brands", description: "Brand cards with logos and blurbs" },
  { type: "CATEGORY_GRID", name: "Category Grid", description: "Shop-by-category tiles" },
  { type: "FEATURED_PRODUCTS", name: "Featured Products", description: "Highlight catalogue SKUs by code" },
  { type: "NEW_PRODUCTS", name: "Recently Added", description: "Latest active catalogue lines" },
  { type: "POPULAR_PRODUCTS", name: "Popular Trade Lines", description: "CMS-selected featured SKUs — not sales rank" },
  { type: "RESOURCES", name: "Trade Resources", description: "Documentation and download links" },
  { type: "NEWS", name: "Latest Updates", description: "Range updates and trade notices" },
  { type: "TEXT_IMAGE", name: "Text + Image", description: "Copy on the left, image on the right" },
  { type: "IMAGE_TEXT", name: "Image + Text", description: "Image on the left, copy on the right" },
  { type: "BENEFITS_GRID", name: "Benefits / Icon Grid", description: "Four reasons to trade with you" },
  { type: "TRADE_CTA", name: "Trade CTA", description: "Full-width apply-for-account band" },
  {
    type: "MOTORSPORT_FEATURE",
    name: "Motorsport Feature",
    description: "Full-bleed Power Maxed Racing photographic band with partnership CTAs",
  },
  {
    type: "MEDIA_GALLERY",
    name: "Media Gallery",
    description: "Responsive photographic gallery from uploaded media",
  },
  { type: "BANNER", name: "Banner", description: "Short announcement strip" },
  { type: "RICH_TEXT", name: "Rich Text", description: "Plain text block — no HTML or scripts" },
  { type: "SPACER", name: "Spacer", description: "Vertical breathing room" },
];

export function defaultSectionConfig(type: CmsSectionTypeKey): Record<string, unknown> {
  switch (type) {
    case "HERO":
      return {
        eyebrow: "UK Automotive Aftermarket Supply",
        headline: "New headline",
        supporting: "Supporting copy",
        ctaLabel: "Open a Trade Account",
        ctaHref: "/register",
        secondaryCtaLabel: "Explore Our Brands",
        secondaryCtaHref: "/brands",
        loginCtaLabel: "Trade Login",
        loginCtaHref: "/login",
        calloutSku: "",
        alignment: "left",
        contentPosition: "middle",
        variant: "split",
        spacing: "standard",
        overlayStrength: 0,
        media: { alt: "", fit: "fill", focalX: 50, focalY: 50 },
      };
    case "FEATURED_BRANDS":
      return defaultFeaturedBrandsConfig();
    case "BRAND_LOGO_STRIP":
      return {
        heading: "Our brands",
        brandSlugs: ["power-maxed", "steel-seal"],
        spacing: "standard",
      };
    case "TRADE_CTA":
      return {
        eyebrow: "Open a trade account",
        headline: "Ready to trade?",
        supporting: "",
        ctaLabel: "Apply",
        ctaHref: "/register",
        secondaryCtaLabel: "Trade Login",
        secondaryCtaHref: "/login",
        variant: "dark",
        spacing: "standard",
        media: { alt: "", fit: "fill", focalX: 50, focalY: 50 },
      };
    case "TEXT_IMAGE":
    case "IMAGE_TEXT":
      return {
        heading: "Section heading",
        body: "Supporting copy",
        alignment: "left",
        spacing: "standard",
        media: { alt: "", fit: "content", focalX: 50, focalY: 50 },
      };
    case "SPACER":
      return { size: "md" };
    case "RICH_TEXT":
      return { content: "Plain text content", spacing: "standard" };
    case "BANNER":
      return { text: "Announcement", tone: "brand", spacing: "compact" };
    case "BENEFITS_GRID":
      return {
        eyebrow: "Why buy from Automotive Brands?",
        heading: "Trade supply built for repeat ordering",
        supporting: "",
        ctaLabel: "Why Automotive Brands",
        ctaHref: "/why-automotive-brands",
        items: [{ title: "Benefit", body: "Short supporting line", icon: "warehouse" }],
        customerTypes: [],
        spacing: "standard",
        media: { alt: "", fit: "fill", focalX: 50, focalY: 50 },
      };
    case "CATEGORY_GRID":
      return {
        eyebrow: "Product categories",
        heading: "Categories",
        categorySlugs: [],
        categories: [],
        spacing: "standard",
      };
    case "FEATURED_PRODUCTS":
      return {
        eyebrow: "Featured ranges",
        heading: "Featured products",
        supporting: "",
        productSkus: [],
        layout: "grid",
        spacing: "standard",
      };
    case "NEW_PRODUCTS":
      return {
        eyebrow: "New products",
        heading: "Recently added lines",
        limit: 3,
        spacing: "standard",
      };
    case "POPULAR_PRODUCTS":
      return {
        eyebrow: "Popular trade lines",
        heading: "Popular trade lines",
        supporting: "",
        productSkus: [],
        spacing: "standard",
      };
    case "RESOURCES":
      return {
        eyebrow: "Trade resources",
        heading: "Documentation your counter needs",
        items: [{ label: "Trade catalogue", meta: "PDF", href: "/resources" }],
        spacing: "standard",
      };
    case "NEWS":
      return {
        eyebrow: "Latest from Automotive Brands",
        heading: "Range updates and trade notices",
        items: [],
        spacing: "standard",
      };
    case "MOTORSPORT_FEATURE":
      return {
        ...HOMEPAGE_MOTORSPORT_DEFAULTS,
        spacing: "relaxed",
        media: {
          alt: "Power Maxed Racing / Steel Seal motorsport photography — replace with licensed imagery",
          fit: "fill",
          focalX: 72,
          focalY: 45,
        },
      };
    case "MEDIA_GALLERY":
      return {
        eyebrow: "On track",
        heading: "Motorsport gallery",
        supporting: "Genuine Power Maxed Racing photography. Replace watermarked previews with licensed originals via Media.",
        items: [],
        spacing: "standard",
      };
    default:
      return { heading: type, spacing: "standard" };
  }
}

export function addEditorSection(
  sections: EditorSection[],
  type: CmsSectionTypeKey,
  id: string,
): EditorSection[] {
  if (!(CMS_SECTION_TYPES as readonly string[]).includes(type)) {
    throw new Error(`Unknown section type: ${type}`);
  }
  return [
    ...sections,
    { id, type, config: defaultSectionConfig(type), enabled: true, sortOrder: sections.length },
  ];
}

export function duplicateEditorSection(
  sections: EditorSection[],
  id: string,
  newId: string,
): EditorSection[] {
  const index = sections.findIndex((s) => s.id === id);
  if (index < 0) return sections;
  const source = sections[index]!;
  const copy: EditorSection = {
    ...source,
    id: newId,
    config: structuredClone(source.config),
  };
  const next = [...sections];
  next.splice(index + 1, 0, copy);
  return next.map((s, i) => ({ ...s, sortOrder: i }));
}

export function deleteEditorSection(sections: EditorSection[], id: string): EditorSection[] {
  return sections.filter((s) => s.id !== id).map((s, i) => ({ ...s, sortOrder: i }));
}

export function moveEditorSection(
  sections: EditorSection[],
  id: string,
  direction: -1 | 1,
): EditorSection[] {
  const index = sections.findIndex((s) => s.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= sections.length) return sections;
  const next = [...sections];
  const current = next[index]!;
  next[index] = next[nextIndex]!;
  next[nextIndex] = current;
  return next.map((s, i) => ({ ...s, sortOrder: i }));
}

export function toggleEditorSection(
  sections: EditorSection[],
  id: string,
  enabled: boolean,
): EditorSection[] {
  return sections.map((s) => (s.id === id ? { ...s, enabled } : s));
}

export function reorderEditorSections(
  sections: EditorSection[],
  activeId: string,
  overId: string,
): EditorSection[] {
  if (activeId === overId) return sections;
  const from = sections.findIndex((s) => s.id === activeId);
  const to = sections.findIndex((s) => s.id === overId);
  if (from < 0 || to < 0) return sections;
  const next = [...sections];
  const [moved] = next.splice(from, 1);
  if (!moved) return sections;
  next.splice(to, 0, moved);
  return next.map((s, i) => ({ ...s, sortOrder: i }));
}

export function collectMediaIds(config: unknown, into = new Set<string>()): Set<string> {
  if (!config) return into;
  if (Array.isArray(config)) {
    for (const item of config) collectMediaIds(item, into);
    return into;
  }
  if (typeof config === "object") {
    for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
      if ((key === "mediaId" || key === "ogImageMediaId") && typeof value === "string" && value) {
        into.add(value);
      } else {
        collectMediaIds(value, into);
      }
    }
  }
  return into;
}

/**
 * Parse a "one per line" textarea while the user is typing.
 * Blank lines are kept so pressing Enter can open the next row.
 * Trailing spaces on a line are trimmed; leading spaces stay until blur/compact.
 */
export function linesFromMultilineInput(value: string): string[] {
  return value.split("\n").map((line) => line.replace(/[ \t]+$/u, ""));
}

/** Drop blank/whitespace-only rows after editing (blur / save). */
export function compactMultilineList(lines: unknown): string[] {
  if (!Array.isArray(lines)) return [];
  const out: string[] = [];
  for (const item of lines) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export function multilineListToTextareaValue(lines: unknown): string {
  if (!Array.isArray(lines)) return "";
  return lines.map((item) => (typeof item === "string" ? item : "")).join("\n");
}
