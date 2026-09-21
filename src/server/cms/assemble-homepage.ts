import { defaultHomepageSections } from "@/server/cms/homepage-seed";
import { getPublishedHomepage } from "@/server/cms/service";
import {
  getPublicProductsBySkus,
  listPublicBrands,
  listPublicCategories,
  listRecentPublicProducts,
  type PublicProductCard,
} from "@/server/catalogue/products";
import { collectHomepageSkus, type HomepageProduct, type HomepageSection, type PublicHomepageData } from "@/domain/homepage";
import type { CmsSectionTypeKey } from "@/domain/cms";

const DEFAULT_SEO_TITLE = "Automotive Brands — The brands behind the automotive aftermarket";
const DEFAULT_SEO_DESC =
  "Trade supply of Power Maxed, Steel Seal, Street Rhino, Bramley Power and Kidzmotion to UK motor factors, retailers, workshops and distributors. One trade account, every brand.";

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
    config: section.config,
    enabled: true,
  }));
}

export async function loadPublicHomepage(userId: string | null): Promise<PublicHomepageData> {
  let cmsError: string | null = null;
  let published: Awaited<ReturnType<typeof getPublishedHomepage>> = null;
  try {
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
          config: (section.config ?? {}) as Record<string, unknown>,
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
    const [brands, categories, recentCards, skuCards] = await Promise.all([
      listPublicBrands(),
      listPublicCategories(),
      listRecentPublicProducts(userId, 6),
      getPublicProductsBySkus(userId, collectHomepageSkus(sections)),
    ]);
    const productsBySku: Record<string, HomepageProduct> = {};
    for (const card of [...skuCards, ...recentCards]) {
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
    };
  } catch (error) {
    console.error("[ab:homepage] catalogue load failed", error);
    return {
      brands: [],
      categories: [],
      productsBySku: {},
      recentProducts: [],
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
