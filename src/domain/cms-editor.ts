import { CMS_SECTION_TYPES, type CmsSectionTypeKey } from "@/domain/cms";

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
  { type: "TEXT_IMAGE", name: "Text + Image", description: "Copy on the left, image on the right" },
  { type: "IMAGE_TEXT", name: "Image + Text", description: "Image on the left, copy on the right" },
  { type: "BENEFITS_GRID", name: "Benefits / Icon Grid", description: "Four reasons to trade with you" },
  { type: "TRADE_CTA", name: "Trade CTA", description: "Full-width apply-for-account band" },
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
        alignment: "left",
        contentPosition: "middle",
        variant: "split",
        spacing: "standard",
        overlayStrength: 0,
        media: { alt: "", fit: "fill", focalX: 50, focalY: 50 },
      };
    case "FEATURED_BRANDS":
      return {
        heading: "Our brands",
        supporting: "Our brands",
        brandSlugs: ["power-maxed", "steel-seal", "street-rhino", "bramley-power", "kidzmotion"],
        displayCount: 5,
        variant: "standard",
        spacing: "standard",
        logos: {},
      };
    case "BRAND_LOGO_STRIP":
      return {
        heading: "Our brands",
        brandSlugs: ["power-maxed", "steel-seal", "street-rhino", "bramley-power", "kidzmotion"],
        spacing: "standard",
      };
    case "TRADE_CTA":
      return {
        headline: "Ready to trade?",
        supporting: "",
        ctaLabel: "Apply",
        ctaHref: "/register",
        variant: "dark",
        spacing: "standard",
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
        heading: "Benefits",
        items: [
          { title: "Benefit", body: "Short supporting line", icon: "warehouse" },
        ],
        spacing: "standard",
      };
    case "CATEGORY_GRID":
      return {
        heading: "Categories",
        categories: [{ name: "Category", href: "/products", imageAlt: "" }],
        spacing: "standard",
      };
    case "FEATURED_PRODUCTS":
      return {
        heading: "Featured products",
        supporting: "",
        productSkus: [],
        layout: "grid",
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
