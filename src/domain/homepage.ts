import type { PublicAvailability } from "@/domain/availability";
import type { CmsSectionTypeKey } from "@/domain/cms";
import type { DisplayPrice } from "@/server/pricing/trade-price";

export type HomepageJson =
  | string
  | number
  | boolean
  | null
  | HomepageJson[]
  | { [key: string]: HomepageJson };

export type HomepageSection = {
  id: string;
  type: CmsSectionTypeKey;
  config: { [key: string]: HomepageJson };
  enabled: boolean;
};

export type HomepageBrand = {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logoSrc: string | null;
};

export type HomepageCategory = {
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
};

export type HomepageProduct = {
  sku: string;
  slug: string;
  name: string;
  brand: string;
  imageSrc: string | null;
  rrp: number | null;
  price: DisplayPrice;
  availability: PublicAvailability | null;
};

export type PublicHomepageData = {
  seoTitle: string;
  metaDescription: string;
  ogImageSrc: string | null;
  sections: HomepageSection[];
  brands: HomepageBrand[];
  categories: HomepageCategory[];
  productsBySku: Record<string, HomepageProduct>;
  recentProducts: HomepageProduct[];
  cmsError: string | null;
};

export function collectHomepageSkus(sections: HomepageSection[]): string[] {
  const skus: string[] = [];
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const sku = value.trim().toUpperCase();
    if (sku && !skus.includes(sku)) skus.push(sku);
  };
  for (const section of sections) {
    if (!section.enabled) continue;
    const config = section.config;
    push(config["calloutSku"]);
    const list = config["productSkus"];
    if (Array.isArray(list)) {
      for (const item of list) push(item);
    }
  }
  return skus;
}

export function strConfig(config: Record<string, unknown>, key: string, fallback = ""): string {
  const value = config[key];
  return typeof value === "string" ? value : fallback;
}
