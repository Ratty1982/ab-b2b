import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/infra/auth";
import { formatZodError } from "@/domain/cms";
import { AuthError } from "@/server/rbac/guards";
import * as companies from "@/server/companies/service";
import * as applications from "@/server/applications/service";
import * as cms from "@/server/cms/service";
import * as cmsMedia from "@/server/cms/media";
import * as catalogue from "@/server/catalogue/service";
import * as catalogueProducts from "@/server/catalogue/products";
import * as catalogueImport from "@/server/catalogue/import";
import * as staffUsers from "@/server/users/service";

async function requireUserId(): Promise<string> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) {
    throw new AuthError("Authentication required", "UNAUTHENTICATED", 401);
  }
  return session.user.id;
}

async function optionalUserId(): Promise<string | null> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  return session?.user?.id ?? null;
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

export const listTradeApplicationsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { status?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await applications.listTradeApplications(userId, data?.status);
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
      const result = await catalogueProducts.exportCatalogueCsv(userId, (data ?? {}) as catalogueProducts.CatalogueListQuery);
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
  .inputValidator((data: unknown) => data as { filename: string; csv: string; mime?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueImport.uploadProductImport(userId, data);
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
  .inputValidator((data: unknown) => data as { slug: string })
  .handler(async ({ data }) => {
    try {
      const userId = await optionalUserId();
      const result = await catalogueProducts.getPublicBrand(userId, data.slug);
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
