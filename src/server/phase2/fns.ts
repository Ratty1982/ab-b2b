import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/infra/auth";
import { formatZodError } from "@/domain/cms";
import type { HomepageJson } from "@/domain/homepage";
import { AuthError } from "@/server/rbac/guards";
import { resolveOptionalRequestUserId } from "@/server/auth/request-session";
import * as companies from "@/server/companies/service";
import * as applications from "@/server/applications/service";
import * as cms from "@/server/cms/service";
import * as cmsMedia from "@/server/cms/media";
import * as catalogue from "@/server/catalogue/service";
import * as catalogueProducts from "@/server/catalogue/products";
import * as productContentJson from "@/server/catalogue/product-content-json";
import * as catalogueImport from "@/server/catalogue/import";
import * as staffUsers from "@/server/users/service";
import * as pricing from "@/server/pricing/service";
import * as stock from "@/server/stock/service";
import * as basket from "@/server/basket/service";
import * as motorsport from "@/server/motorsport/service";

async function requireUserId(): Promise<string> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) {
    throw new AuthError("Authentication required", "UNAUTHENTICATED", 401);
  }
  return session.user.id;
}

async function optionalUserId(): Promise<string | null> {
  return resolveOptionalRequestUserId();
}

function toError(error: unknown): { ok: false; error: string; code?: string } {
  if (error instanceof AuthError) {
    return { ok: false, error: error.message, code: error.code };
  }
  const validation = formatZodError(error);
  if (validation) {
    return { ok: false, error: validation, code: "VALIDATION" };
  }
  if (error instanceof Error && error.message) {
    return { ok: false, error: error.message, code: "INTERNAL" };
  }
  console.error("[ab:fn]", error);
  return { ok: false, error: "Request failed", code: "INTERNAL" };
}

export const listCompaniesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await companies.listCompaniesForActor(userId, data ?? {});
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const getCompanyWorkspaceFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await companies.getCompanyWorkspace(userId, data.id);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const createCompanyFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await companies.createCompany(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const updateCompanyFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await companies.updateCompany(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const deleteCompanyFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await companies.deleteCompany(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const createContactFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await companies.createContact(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const updateContactFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await companies.updateContact(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const createAddressFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await companies.createAddress(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const updateAddressFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await companies.updateAddress(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const inviteCompanyUserFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await companies.inviteCompanyUser(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listCompanyActivityFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { companyId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await companies.listCompanyActivity(userId, data.companyId);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listSalesRepsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const result = await companies.listSalesRepsForSelect(userId);
    return { ok: true as const, data: result };
  } catch (e) {
    return toError(e);
  }
});

export const listPriceListsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const result = await companies.listPriceListsForSelect(userId);
    return { ok: true as const, data: result };
  } catch (e) {
    return toError(e);
  }
});

export const submitTradeApplicationFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const headers = getRequestHeaders();
      const ip =
        headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
      const result = await applications.submitTradeApplication(data, { ip });
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const submitMotorsportPartnershipEnquiryFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const headers = getRequestHeaders();
      const ip =
        headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
      const result = await motorsport.submitMotorsportPartnershipEnquiry(data, { ip });
      if (!result.ok) {
        return {
          ok: false as const,
          error: result.error,
          ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
        };
      }
      return { ok: true as const, data: { leadId: result.leadId, duplicate: result.duplicate ?? false } };
    } catch (e) {
      return toError(e);
    }
  });

export const listTradeApplicationsFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: unknown) =>
      data as {
        status?: string;
        businessType?: string;
        existingAccount?: string;
        q?: string;
        assignedRepId?: string;
      },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await applications.listTradeApplications(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const getTradeApplicationFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await applications.getTradeApplication(userId, data.id);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const markTradeApplicationUnderReviewFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await applications.markApplicationUnderReview(userId, data.id);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const requestTradeApplicationMoreInfoFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await applications.requestApplicationMoreInfo(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const approveTradeApplicationFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await applications.approveTradeApplication(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const rejectTradeApplicationFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await applications.rejectTradeApplication(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const updateTradeApplicationDetailsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await applications.updateTradeApplicationDetails(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const withdrawTradeApplicationFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await applications.withdrawTradeApplication(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const deleteTradeApplicationFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await applications.deleteTradeApplication(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const getTradeInvitationPreviewFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { token: string })
  .handler(async ({ data }) => {
    try {
      const result = await applications.getInvitationPreview(data.token);
      if (!result) {
        return { ok: false as const, error: "Invitation not found", code: "NOT_FOUND" };
      }
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const acceptTradeInvitationFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const result = await applications.acceptTradeInvitation(data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listCmsPagesFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const result = await cms.listCmsPages(userId);
    return { ok: true as const, data: result };
  } catch (e) {
    return toError(e);
  }
});

export const getCmsPageDraftFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { slug: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await cms.getCmsPageDraft(userId, data.slug);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const saveCmsDraftFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { slug: string; sections: unknown[] })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await cms.saveCmsDraftSections(userId, data.slug, data.sections);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const updateCmsPageMetaFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await cms.updateCmsPageMeta(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const restoreCmsVersionFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { slug: string; versionId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await cms.restoreCmsVersion(userId, data.slug, data.versionId);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const publishCmsPageFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { slug: string; note?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await cms.publishCmsPage(userId, data.slug, data.note);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const getPublishedHomepageFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const result = await cms.getPublishedHomepage();
    return { ok: true as const, data: result };
  } catch (e) {
    return toError(e);
  }
});

export const getPublicHomepageFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await optionalUserId();
    const { loadPublicHomepage } = await import("@/server/cms/assemble-homepage");
    const data = await loadPublicHomepage(userId);
    return { ok: true as const, data };
  } catch (e) {
    console.error("[ab:homepage] public homepage RPC failed", e);
    return toError(e);
  }
});

/** Public marketing CMS page by slug (about, brands, trade-solutions, …). */
export const getPublicCmsPageFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { slug: string })
  .handler(async ({ data }) => {
    try {
      const slug = typeof data?.slug === "string" ? data.slug.trim() : "";
      if (!slug || slug === "home") {
        return { ok: false as const, error: "Invalid CMS page slug", code: "VALIDATION" };
      }
      await cms.bootstrapMarketingCmsPages();
      const page = await cms.getPublishedCmsPage(slug);
      if (!page) {
        return { ok: false as const, error: "Page not found", code: "NOT_FOUND" };
      }
      return { ok: true as const, data: page };
    } catch (e) {
      return toError(e);
    }
  });

export const previewPublicHomepageFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) =>
      data as {
        sections: Array<{
          id: string;
          type: string;
          config: Record<string, HomepageJson>;
          enabled: boolean;
        }>;
      },
  )
  .handler(async ({ data }) => {
    try {
      await requireUserId();
      const userId = await optionalUserId();
      const { assembleHomepagePreview } = await import("@/server/cms/assemble-homepage");
      const result = await assembleHomepagePreview(
        userId,
        data.sections.map((section) => ({
          id: section.id,
          type: section.type as import("@/domain/cms").CmsSectionTypeKey,
          config: section.config as { [key: string]: HomepageJson },
          enabled: section.enabled,
        })),
      );
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listCmsMediaFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { q?: string } | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await cmsMedia.listCmsMedia(userId, data?.q);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const getCmsMediaStorageFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    await requireUserId();
    return { ok: true as const, data: cmsMedia.getMediaStorageStatus() };
  } catch (e) {
    return toError(e);
  }
});

export const uploadCmsMediaFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await cmsMedia.uploadCmsMedia(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const updateCmsMediaFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await cmsMedia.updateCmsMedia(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const deleteCmsMediaFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await cmsMedia.deleteCmsMedia(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listCatalogueCategoriesFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const result = await catalogue.listCategories(userId);
    return { ok: true as const, data: result };
  } catch (e) {
    return toError(e);
  }
});

export const saveCatalogueCategoryFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id?: string } & Record<string, unknown>)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = data.id
        ? await catalogue.updateCategory(userId, data)
        : await catalogue.createCategory(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const deleteCatalogueCategoryFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogue.deleteCategory(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listCatalogueBrandsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const result = await catalogue.listBrands(userId);
    return { ok: true as const, data: result };
  } catch (e) {
    return toError(e);
  }
});

export const saveCatalogueBrandFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id?: string } & Record<string, unknown>)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = data.id
        ? await catalogue.updateBrand(userId, data)
        : await catalogue.createBrand(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listCatalogueProductsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { q?: string } | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogue.listProducts(userId, data?.q);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const saveCatalogueProductFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogue.saveProduct(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const deleteCatalogueProductFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { sku: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogue.deleteProduct(userId, data.sku);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const importCatalogueProductsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { csv: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogue.importProducts(userId, data.csv);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const exportCatalogueProductsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as Record<string, unknown> | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueProducts.exportCatalogueWorkbook(userId, (data ?? {}) as catalogueProducts.CatalogueListQuery);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listCatalogueWorkspaceFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as catalogueProducts.CatalogueListQuery)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueProducts.listCataloguePage(userId, data ?? {});
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const createCatalogueProductFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueProducts.createProduct(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const getCatalogueProductFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueProducts.getProductWorkspace(userId, data.id);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const updateCatalogueProductFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueProducts.updateProductWorkspace(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const previewProductContentJsonFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { productId: string; jsonText: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await productContentJson.previewProductJsonImport(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const applyProductContentJsonFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { productId: string; jsonText: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await productContentJson.applyProductJsonImport(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const saveCatalogueProductVariantFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueProducts.saveProductVariant(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const attachCatalogueProductMediaFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueProducts.attachProductMedia(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const reorderCatalogueProductMediaFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueProducts.reorderProductMedia(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const detachCatalogueProductMediaFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueProducts.detachProductMedia(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const uploadProductImportFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { filename: string; csv?: string; workbookBase64?: string; mime?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueImport.uploadProductImport(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const downloadProductImportTemplateFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const result = await catalogueImport.downloadProductImportTemplate(userId);
    return { ok: true as const, data: result };
  } catch (e) {
    return toError(e);
  }
});

export const previewProductImportFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string; mapping?: unknown; brandActions?: unknown; categoryActions?: unknown })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = data.mapping
        ? await catalogueImport.updateImportMapping(userId, {
            id: data.id,
            mapping: data.mapping as never,
            brandActions: data.brandActions as never,
            categoryActions: data.categoryActions as never,
          })
        : await catalogueImport.previewImport(userId, data.id);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const confirmProductImportFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueImport.confirmImport(userId, data.id);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listProductImportsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const result = await catalogueImport.listImportJobs(userId);
    return { ok: true as const, data: result };
  } catch (e) {
    return toError(e);
  }
});

export const getProductImportFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueImport.getImportJob(userId, data.id);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const productImportErrorsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueImport.importErrorCsv(userId, data.id);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listPublicCatalogueFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { q?: string; brandSlug?: string; categorySlug?: string; page?: number } | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await optionalUserId();
      const result = await catalogueProducts.listPublicProducts({ userId, ...data });
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const getPublicProductFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { slug: string })
  .handler(async ({ data }) => {
    try {
      const userId = await optionalUserId();
      const result = await catalogueProducts.getPublicProduct(userId, data.slug);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listPublicBrandsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const result = await catalogueProducts.listPublicBrands();
    return { ok: true as const, data: result };
  } catch (e) {
    return toError(e);
  }
});

export const getPublicBrandFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { slug: string; q?: string; page?: number; categorySlug?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await optionalUserId();
      const result = await catalogueProducts.getPublicBrand(userId, data.slug, {
        q: data.q,
        page: data.page,
        categorySlug: data.categorySlug,
      });
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listStaffUsersFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const result = await staffUsers.listStaffUsers(userId);
    return { ok: true as const, data: result };
  } catch (e) {
    return toError(e);
  }
});

export const createStaffUserFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await staffUsers.createStaffUser(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const updateStaffUserFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await staffUsers.updateStaffUser(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const resetStaffUserPasswordFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await staffUsers.resetStaffUserPassword(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listAdminPriceListsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await pricing.listPriceLists(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const upsertPriceListFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.upsertPriceList(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listPriceListItemsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.listPriceListItems(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const upsertPriceListItemFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.upsertPriceListItem(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const deletePriceListItemFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.deletePriceListItem(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const listCustomerPricesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { companyId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.listCustomerPrices(userId, data.companyId) };
    } catch (e) {
      return toError(e);
    }
  });

export const upsertCustomerPriceFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.upsertCustomerPrice(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const deleteCustomerPriceFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.deleteCustomerPrice(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const listPromotionsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await pricing.listPromotions(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const upsertPromotionFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.upsertPromotion(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listQuantityBreaksFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { variantId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.listQuantityBreaks(userId, data.variantId) };
    } catch (e) {
      return toError(e);
    }
  });

export const upsertQuantityBreakFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.upsertQuantityBreak(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const deleteQuantityBreakFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.deleteQuantityBreak(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const searchPricingVariantsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { q: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.searchVariantsForPricing(userId, data.q) };
    } catch (e) {
      return toError(e);
    }
  });

export const previewTradePriceAsCustomerFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.previewTradePriceAsCustomer(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const pricingOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await pricing.pricingOverview(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const getPriceListFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.getPriceList(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const addPriceListItemsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.addPriceListItems(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const bulkUpdatePriceListItemsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.bulkUpdatePriceListItems(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listPriceListCompaniesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { priceListId: string; q?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.listPriceListCompanies(userId, data.priceListId, data.q) };
    } catch (e) {
      return toError(e);
    }
  });

export const searchPricingCompaniesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { q: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.searchCompaniesForPricing(userId, data.q) };
    } catch (e) {
      return toError(e);
    }
  });

export const assignCompanyPriceListFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.assignCompanyToPriceList(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportPriceListCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { priceListId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.exportPriceListCsv(userId, data.priceListId) };
    } catch (e) {
      return toError(e);
    }
  });

export const previewPriceListCsvFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.previewPriceListCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const applyPriceListCsvFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.applyPriceListCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const previewPromotionFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.previewPromotion(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listCommercialAuditFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { priceListId?: string; companyId?: string; variantId?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await pricing.listCommercialAudit(userId, data ?? {}) };
    } catch (e) {
      return toError(e);
    }
  });

export const stockOperationsOverviewFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await stock.stockOperationsOverview(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const listStockSyncRunsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await stock.listStockSyncRuns(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const getStockSyncRunFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await stock.getStockSyncRun(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const listStockSyncChangesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { runId: string; q?: string; page?: number; pageSize?: number })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await stock.listStockSyncChanges(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listUnmatchedStockSkusFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { q?: string; page?: number; pageSize?: number; lastRunId?: string } | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await stock.listUnmatchedStockSkus(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const runManualStockSyncFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { dryRun?: boolean; csv?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await stock.runManualStockSync(userId, { dryRun: Boolean(data?.dryRun), ...(data?.csv ? { csv: data.csv } : {}) } ) };
    } catch (e) {
      return toError(e);
    }
  });

export const getImapSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await stock.getImapSettings(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const saveImapSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as Record<string, unknown>)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await stock.saveImapSettings(userId, data ?? {}) };
    } catch (e) {
      return toError(e);
    }
  });

export const testImapConnectionFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await stock.testImapConnectionAction(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const pollImapNowFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { dryRun?: boolean })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await stock.pollImapNow(userId, Boolean(data?.dryRun)) };
    } catch (e) {
      return toError(e);
    }
  });

export const getBasketFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    return { ok: true as const, data: await basket.getBasket(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const getBasketSummaryFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await optionalUserId();
    if (!userId) return { ok: true as const, data: { basketId: null, companyId: null, lineCount: 0, unitCount: 0 } };
    return { ok: true as const, data: await basket.getBasketSummary(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const addToBasketFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { variantId: string; quantity: number })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await basket.addToBasket(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const updateBasketItemFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { itemId: string; quantity: number })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await basket.updateBasketItem(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const removeBasketItemFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { itemId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await basket.removeBasketItem(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getProductOrderingPanelFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { variantId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await optionalUserId();
      return { ok: true as const, data: await basket.getProductOrderingPanel(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const previewProductOrderQuantityFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { variantId: string; quantity: number })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      return { ok: true as const, data: await basket.previewProductOrderQuantity(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getMyTradeTestLevelFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const { getMyTradeTestLevel } = await import("@/server/admin-trade-test/service");
    return { ok: true as const, data: await getMyTradeTestLevel(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const setMyTradeTestLevelFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) =>
      data as
        | { mode: "NONE" }
        | { mode: "BASE_TRADE" }
        | { mode: "PRICE_LIST"; priceListId: string },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const { setMyTradeTestLevel } = await import("@/server/admin-trade-test/service");
      return { ok: true as const, data: await setMyTradeTestLevel(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const setCompanyAutopartCustomerCodeFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { companyId: string; code: string | null })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const { setCompanyAutopartCustomerCode } = await import("@/server/companies/autopart-account");
      return { ok: true as const, data: await setCompanyAutopartCustomerCode(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const verifyCompanyAutopartCustomerCodeFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { companyId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const { verifyCompanyAutopartCustomerCode } = await import(
        "@/server/companies/autopart-account"
      );
      return { ok: true as const, data: await verifyCompanyAutopartCustomerCode(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const clearCompanyAutopartCustomerCodeFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { companyId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const { clearCompanyAutopartCustomerCode } = await import(
        "@/server/companies/autopart-account"
      );
      return { ok: true as const, data: await clearCompanyAutopartCustomerCode(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getPublicTeamPageFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const team = await import("@/server/team/service");
    return { ok: true as const, data: await team.listPublicTeamPage() };
  } catch (e) {
    return toError(e);
  }
});

export const listFeaturedPublicTeamMembersFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { limit?: number } | undefined)
  .handler(async ({ data }) => {
    try {
      const team = await import("@/server/team/service");
      return {
        ok: true as const,
        data: await team.listFeaturedPublicTeamMembers(data?.limit ?? 4),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const listTeamDepartmentsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const team = await import("@/server/team/service");
    return { ok: true as const, data: await team.listTeamDepartmentsAdmin(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const upsertTeamDepartmentFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const team = await import("@/server/team/service");
      return { ok: true as const, data: await team.upsertTeamDepartment(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listTeamMembersFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as Record<string, unknown> | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const team = await import("@/server/team/service");
      return { ok: true as const, data: await team.listTeamMembersAdmin(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const upsertTeamMemberFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const team = await import("@/server/team/service");
      return { ok: true as const, data: await team.upsertTeamMember(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const deleteTeamMemberFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const team = await import("@/server/team/service");
      return { ok: true as const, data: await team.deleteTeamMember(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });


