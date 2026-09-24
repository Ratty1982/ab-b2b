import { defaultHomepageSections } from "@/server/cms/homepage-seed";
import { getPublishedHomepage } from "@/server/cms/service";
import {
  getPublicProductsBySkus,
  listFeaturedPublicProducts,
  listPublicBrands,
  listPublicCategories,
  listRecentPublicProducts,
  type PublicProductCard,
} from "@/server/catalogue/products";
import { collectHomepageSkus, type HomepageJson, type HomepageProduct, type HomepageSection, type PublicHomepageData } from "@/domain/homepage";
import type { CmsSectionTypeKey } from "@/domain/cms";

const DEFAULT_SEO_TITLE = "Automotive Brands — Automotive products built for the trade";
const DEFAULT_SEO_DESC =
  "Trade supply of Power Maxed and Steel Seal to UK motor factors, workshops, retailers and distributors. Open a trade account for account pricing and case ordering.";

function toHomepageProduct(card: PublicProductCard): HomepageProduct {
  return {
    sku: card.sku,
    slug: card.slug,
    name: card.name,
    brand: card.brand,
    imageSrc: card.imageSrc,
    rrp: card.rrp,
    price: card.price,
    availability: card.availability,
  };
}

function fallbackSections(): HomepageSection[] {
  return defaultHomepageSections().map((section, index) => ({
    id: `default-${section.type}-${index}`,
    type: section.type,
    config: section.config as { [key: string]: HomepageJson },
    enabled: section.enabled !== false,
  }));
}

export async function loadPublicHomepage(userId: string | null): Promise<PublicHomepageData> {
  let cmsError: string | null = null;
  let published: Awaited<ReturnType<typeof getPublishedHomepage>> = null;
  try {
    const { bootstrapHomepageCms } = await import("@/server/cms/service");
    await bootstrapHomepageCms();
    published = await getPublishedHomepage();
  } catch (error) {
    cmsError = error instanceof Error ? error.message : "Homepage content could not be loaded";
    console.error("[ab:homepage] published CMS load failed", error);
  }

  const sections: HomepageSection[] =
    published?.sections?.length
      ? published.sections.map((section) => ({
          id: section.id,
          type: section.type as CmsSectionTypeKey,
          config: ((section.config ?? {}) as { [key: string]: HomepageJson }),
          enabled: true,
        }))
      : fallbackSections();

  const catalogue = await loadCatalogue(userId, sections);

  return {
    seoTitle: published?.seoTitle || DEFAULT_SEO_TITLE,
    metaDescription: published?.metaDescription || DEFAULT_SEO_DESC,
    ogImageSrc: published?.ogImageSrc ?? null,
    sections,
    ...catalogue,
    cmsError,
  };
}

async function loadCatalogue(userId: string | null, sections: HomepageSection[]) {
  try {
    const needsFeaturedFallback = sections.some(
      (section) =>
        section.enabled &&
        section.type === "FEATURED_PRODUCTS" &&
        (!Array.isArray(section.config["productSkus"]) || section.config["productSkus"].length === 0),
    );
    const [brands, categories, recentCards, skuCards, featuredCards] = await Promise.all([
      listPublicBrands(),
      listPublicCategories(),
      listRecentPublicProducts(userId, 6),
      getPublicProductsBySkus(userId, collectHomepageSkus(sections)),
      needsFeaturedFallback ? listFeaturedPublicProducts(userId, 8) : Promise.resolve([] as PublicProductCard[]),
    ]);
    const productsBySku: Record<string, HomepageProduct> = {};
    for (const card of [...skuCards, ...recentCards, ...featuredCards]) {
      if (card.sku) productsBySku[card.sku.toUpperCase()] = toHomepageProduct(card);
    }
    return {
      brands: brands.map((brand) => ({
        slug: brand.slug,
        name: brand.name,
        tagline: brand.tagline,
        description: brand.description,
        logoSrc: brand.logoSrc,
      })),
      categories: categories.map((category) => ({
        slug: category.slug,
        name: category.name,
        description: category.description,
        parentId: category.parentId,
      })),
      productsBySku,
      recentProducts: recentCards.map(toHomepageProduct),
      featuredProducts: featuredCards.map(toHomepageProduct),
    };
  } catch (error) {
    console.error("[ab:homepage] catalogue load failed", error);
    return {
      brands: [],
      categories: [],
      productsBySku: {},
      recentProducts: [],
      featuredProducts: [],
    };
  }
}

export async function assembleHomepagePreview(
  userId: string | null,
  sections: HomepageSection[],
): Promise<PublicHomepageData> {
  const enabled = sections.filter((section) => section.enabled);
  const catalogue = await loadCatalogue(userId, enabled);
  return {
    seoTitle: DEFAULT_SEO_TITLE,
    metaDescription: DEFAULT_SEO_DESC,
    ogImageSrc: null,
    sections,
    ...catalogue,
    cmsError: null,
  };
}
