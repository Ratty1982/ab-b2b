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
import * as staffUsers from "@/server/users/service";

async function requireUserId(): Promise<string> {
  const headers = getRequestHeaders();
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) {
    throw new AuthError("Authentication required", "UNAUTHENTICATED", 401);
  }
  return session.user.id;
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

export const exportCatalogueProductsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const result = await catalogue.exportProductsCsv(userId);
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
