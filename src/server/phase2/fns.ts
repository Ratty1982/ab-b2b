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
import * as callback from "@/server/callback/service";

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

export const getAdminDashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const dash = await import("@/server/admin/dashboard");
    return { ok: true as const, data: await dash.getAdminDashboard(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const listSalesRepProfilesFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const sales = await import("@/server/sales/service");
    return { ok: true as const, data: await sales.listSalesRepProfiles(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const getSalesRepProfileFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const sales = await import("@/server/sales/service");
      return { ok: true as const, data: await sales.getSalesRepProfile(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const updateSalesRepProfileFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const sales = await import("@/server/sales/service");
      return { ok: true as const, data: await sales.updateSalesRepProfile(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const createSalesRepFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const sales = await import("@/server/sales/service");
      return { ok: true as const, data: await sales.createSalesRep(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listLinkableUsersForSalesRepFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const sales = await import("@/server/sales/service");
    return { ok: true as const, data: await sales.listLinkableUsersForSalesRep(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const searchCompaniesForSalesAssignmentFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { q?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const sales = await import("@/server/sales/service");
      return {
        ok: true as const,
        data: await sales.searchCompaniesForSalesAssignment(userId, data?.q ?? ""),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const assignCompanyToSalesRepFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const sales = await import("@/server/sales/service");
      return { ok: true as const, data: await sales.assignCompanyToSalesRep(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const unassignCompanyFromSalesRepFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const sales = await import("@/server/sales/service");
      return { ok: true as const, data: await sales.unassignCompanyFromSalesRep(userId, data) };
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

export const getCallbackPrefillFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await optionalUserId();
    const data = await callback.getCallbackPrefill(userId);
    return { ok: true as const, data };
  } catch (e) {
    return toError(e);
  }
});

export const submitCallbackEnquiryFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const headers = getRequestHeaders();
      const ip =
        headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
      const userId = await optionalUserId();
      const result = await callback.submitCallbackEnquiry(data, { ip, userId });
      if (!result.ok) {
        return {
          ok: false as const,
          error: result.error,
          ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
        };
      }
      return {
        ok: true as const,
        data: {
          enquiryId: result.enquiryId,
          kind: result.kind,
          duplicate: result.duplicate ?? false,
          accountManagerName: result.accountManagerName,
          customerFirstName: result.customerFirstName,
        },
      };
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

/** Safe backfill: APPROVED applications whose linked Company is still PROSPECT → ACTIVE. */
export const repairApprovedTradeCompanyStatusesFn = createServerFn({ method: "POST" }).handler(
  async () => {
    try {
      const userId = await requireUserId();
      const result = await applications.repairApprovedTradeCompanyStatuses(userId);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  },
);

export const resendTradeApplicationActivationEmailFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await applications.resendTradeApplicationActivationEmail(userId, data);
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

/* ─── Product Documents / SDS ─────────────────────────────────────────────── */

export const listProductDocumentsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { productId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const docs = await import("@/server/catalogue/product-documents");
      return { ok: true as const, data: await docs.listProductDocumentsAdmin(userId, data.productId) };
    } catch (e) {
      return toError(e);
    }
  });

export const uploadProductDocumentFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const docs = await import("@/server/catalogue/product-documents");
      return { ok: true as const, data: await docs.uploadProductDocument(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const archiveProductDocumentFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { documentId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const docs = await import("@/server/catalogue/product-documents");
      return { ok: true as const, data: await docs.archiveProductDocument(userId, data.documentId) };
    } catch (e) {
      return toError(e);
    }
  });

export const getSdsCoverageSummaryFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { population?: "active" | "inactive" | "all" } | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const coverage = await import("@/server/catalogue/sds-coverage");
      return { ok: true as const, data: await coverage.getSdsCoverageSummary(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listSdsCoverageFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const coverage = await import("@/server/catalogue/sds-coverage");
      return { ok: true as const, data: await coverage.listSdsCoveragePage(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportSdsCoverageCsvFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const coverage = await import("@/server/catalogue/sds-coverage");
      return { ok: true as const, data: await coverage.exportSdsCoverageCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const setProductSdsRequirementFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const coverage = await import("@/server/catalogue/sds-coverage");
      return { ok: true as const, data: await coverage.setProductSdsRequirement(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const previewBulkSdsImportFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as {
    files: Array<{ filename: string; contentType?: string; base64: string; clientKey?: string }>;
  })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const docs = await import("@/server/catalogue/product-documents");
      return { ok: true as const, data: await docs.previewBulkSdsImport(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const confirmBulkSdsImportFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const docs = await import("@/server/catalogue/product-documents");
      return { ok: true as const, data: await docs.confirmBulkSdsImport(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const searchProductsForDocumentAttachFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { q: string; limit?: number })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const docs = await import("@/server/catalogue/product-documents");
      return {
        ok: true as const,
        data: await docs.searchProductsForDocumentAttach(userId, data.q, data.limit),
      };
    } catch (e) {
      return toError(e);
    }
  });

/* ─── SharePoint SDS import ───────────────────────────────────────────────── */

export const getSharePointSdsSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const mod = await import("@/server/catalogue/sharepoint-sds-settings");
    return { ok: true as const, data: await mod.getSharePointSdsSettingsForActor(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const updateSharePointSdsSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/catalogue/sharepoint-sds-settings");
      return { ok: true as const, data: await mod.updateSharePointSdsSettings(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const testSharePointSdsConnectionFn = createServerFn({ method: "POST" }).handler(
  async () => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/catalogue/sharepoint-sds-settings");
      return { ok: true as const, data: await mod.testSharePointSdsConnection(userId) };
    } catch (e) {
      return toError(e);
    }
  },
);

export const resolveSharePointSdsFolderFn = createServerFn({ method: "POST" }).handler(
  async () => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/catalogue/sharepoint-sds-settings");
      return { ok: true as const, data: await mod.resolveSharePointSdsFolder(userId) };
    } catch (e) {
      return toError(e);
    }
  },
);

export const scanSharePointSdsFolderFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const mod = await import("@/server/catalogue/sharepoint-sds-import");
    return { ok: true as const, data: await mod.scanSharePointSdsFolder(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const listSharePointSdsScanFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: unknown) =>
      data as { sessionId: string; page?: number; pageSize?: number; status?: string },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/catalogue/sharepoint-sds-import");
      return { ok: true as const, data: await mod.listSharePointScanPage(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const updateSharePointSdsScanItemFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) => data as { sessionId: string; clientKey: string; productId: string },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/catalogue/sharepoint-sds-import");
      return {
        ok: true as const,
        data: await mod.updateSharePointScanItemProduct(userId, data),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const confirmSharePointSdsImportFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/catalogue/sharepoint-sds-import");
      return { ok: true as const, data: await mod.confirmSharePointSdsImport(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

/* ─── Version Updates / What's New ────────────────────────────────────────── */

export const listVersionUpdatesAdminFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { status?: string } | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/system/version-updates");
      return { ok: true as const, data: await mod.listVersionUpdatesAdmin(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getVersionUpdateAdminFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/system/version-updates");
      return { ok: true as const, data: await mod.getVersionUpdateAdmin(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const upsertVersionUpdateFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/system/version-updates");
      return { ok: true as const, data: await mod.upsertVersionUpdate(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const createVersionUpdateFromPasteFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/system/version-updates");
      return { ok: true as const, data: await mod.createVersionUpdateFromPaste(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const publishVersionUpdateFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/system/version-updates");
      return { ok: true as const, data: await mod.publishVersionUpdate(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const archiveVersionUpdateFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/system/version-updates");
      return { ok: true as const, data: await mod.archiveVersionUpdate(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const previewVersionUpdateFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/system/version-updates");
      return { ok: true as const, data: await mod.previewVersionUpdate(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const getPendingWhatsNewFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const mod = await import("@/server/system/version-updates");
    return { ok: true as const, data: await mod.getPendingWhatsNew(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const acknowledgeWhatsNewFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/system/version-updates");
      return { ok: true as const, data: await mod.acknowledgeWhatsNew(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const listWhatsNewHistoryFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const mod = await import("@/server/system/version-updates");
    return { ok: true as const, data: await mod.listWhatsNewHistory(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const getWhatsNewItemFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/system/version-updates");
      return { ok: true as const, data: await mod.getWhatsNewItem(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const bulkUpdateBackorderPolicyFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await catalogueProducts.bulkUpdateBackorderPolicy(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const getTradeOrderingSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const settings = await import("@/server/ordering/settings");
    return { ok: true as const, data: await settings.getTradeOrderingSettingsForActor(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const saveTradeOrderingSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { allowBackordersByDefault?: boolean })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const settings = await import("@/server/ordering/settings");
      return {
        ok: true as const,
        data: await settings.updateTradeOrderingSettings(userId, {
          allowBackordersByDefault: Boolean(data?.allowBackordersByDefault),
        }),
      };
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

export const getStaffUserActivityFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const { getStaffUserActivity } = await import("@/server/audit/staff-activity-service");
      const result = await getStaffUserActivity(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const listStaffLoginHistoryFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const { listStaffLoginHistory } = await import("@/server/audit/staff-activity-service");
      const result = await listStaffLoginHistory(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const touchLastActiveFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const { touchLastActive } = await import("@/server/audit/last-active");
    await touchLastActive(userId);
    return { ok: true as const };
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

export const resendStaffInvitationFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await staffUsers.resendStaffInvitation(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const deactivateStaffUserFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await staffUsers.deactivateStaffUser(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const reactivateStaffUserFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await staffUsers.reactivateStaffUser(userId, data);
      return { ok: true as const, data: result };
    } catch (e) {
      return toError(e);
    }
  });

export const deleteStaffUserFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await staffUsers.deleteStaffUser(userId, data);
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

export const sendUserPasswordResetEmailFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { userId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const result = await staffUsers.sendUserPasswordResetEmail(userId, data.userId);
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

export const listAutopartProductsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const { listAutopartProducts } = await import("@/server/stock/autopart-products");
      return { ok: true as const, data: await listAutopartProducts(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getAutopartProductFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { sku: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const { getAutopartProduct } = await import("@/server/stock/autopart-products");
      return { ok: true as const, data: await getAutopartProduct(userId, data.sku) };
    } catch (e) {
      return toError(e);
    }
  });

export const linkAutopartProductToVariantFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { sku: string; variantSku: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const { linkAutopartProductToVariant } = await import("@/server/stock/autopart-products");
      return { ok: true as const, data: await linkAutopartProductToVariant(userId, data) };
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

export const getProductAutopartCostFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { variantId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const { getProductCostPositionByVariantId } = await import("@/server/stock/product-cost");
      return {
        ok: true as const,
        data: await getProductCostPositionByVariantId(userId, data.variantId),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const getProductAutopartCostHistoryFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { variantId: string; range?: "30d" | "90d" | "12m" | "all" })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const { getProductCostHistoryByVariantId } = await import("@/server/stock/product-cost");
      return {
        ok: true as const,
        data: await getProductCostHistoryByVariantId(userId, data.variantId, data.range ?? "90d"),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const getCostIntelligenceWorkspaceFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const ci = await import("@/server/stock/cost-intelligence");
      return { ok: true as const, data: await ci.getCostIntelligenceWorkspace(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportCostIntelligenceCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const ci = await import("@/server/stock/cost-intelligence");
      return { ok: true as const, data: await ci.exportCostIntelligenceCsv(userId, data) };
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

export const linkAndVerifyCompanyAutopartCustomerCodeFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { companyId: string; code: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const { linkAndVerifyCompanyAutopartCustomerCode } = await import(
        "@/server/companies/autopart-account"
      );
      return {
        ok: true as const,
        data: await linkAndVerifyCompanyAutopartCustomerCode(userId, data),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const searchCompaniesForAutopartMappingFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { q?: string; limit?: number } | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/autopart-account-mapping");
      return {
        ok: true as const,
        data: await mod.searchCompaniesForAutopartMapping(userId, data ?? {}),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const getAutopartAccountMappingStatusFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { accountCode: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/autopart-account-mapping");
      return {
        ok: true as const,
        data: await mod.getAutopartAccountMappingStatus(userId, data.accountCode),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const mapAutopartCustomerAccountFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as Record<string, unknown>)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/autopart-account-mapping");
      return { ok: true as const, data: await mod.mapAutopartCustomerAccount(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const unmapAutopartCustomerAccountFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { accountCode: string; companyId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/autopart-account-mapping");
      return { ok: true as const, data: await mod.unmapAutopartCustomerAccount(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listAutopartAccountMappingWorkspaceFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: unknown) =>
      data as
        | { status?: string; q?: string; sort?: string; page?: number; pageSize?: number }
        | undefined,
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/autopart-account-mapping");
      return {
        ok: true as const,
        data: await mod.listAutopartAccountMappingWorkspace(userId, data),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const listCompanyAutopartAccountsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { companyId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/autopart-account-mapping");
      return {
        ok: true as const,
        data: await mod.listCompanyAutopartAccounts(userId, data.companyId),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const createCompanyAndMapAutopartAccountFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as Record<string, unknown>)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/autopart-account-mapping");
      return {
        ok: true as const,
        data: await mod.createCompanyAndMapAutopartAccount(userId, data),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const reprocessSkippedAutopartSalesFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) => data as { text: string; filename?: string; accountCode?: string },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/autopart-account-mapping");
      return {
        ok: true as const,
        data: await mod.reprocessSkippedAutopartSales(userId, data),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const listCustomerGroupsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { q?: string; includeInactive?: boolean } | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/customer-groups");
      return { ok: true as const, data: await mod.listCustomerGroups(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getCustomerGroupFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { groupId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/customer-groups");
      return { ok: true as const, data: await mod.getCustomerGroup(userId, data.groupId) };
    } catch (e) {
      return toError(e);
    }
  });

export const createCustomerGroupFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as Record<string, unknown>)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/customer-groups");
      return { ok: true as const, data: await mod.createCustomerGroup(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const updateCustomerGroupFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as Record<string, unknown>)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/customer-groups");
      return { ok: true as const, data: await mod.updateCustomerGroup(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const addCompanyToCustomerGroupFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { groupId: string; companyId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/customer-groups");
      return { ok: true as const, data: await mod.addCompanyToCustomerGroup(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const removeCompanyFromCustomerGroupFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { companyId: string; groupId?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/customer-groups");
      return { ok: true as const, data: await mod.removeCompanyFromCustomerGroup(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const setCompanyCustomerGroupFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) => data as { companyId: string; customerGroupId: string | null },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/customer-groups");
      return { ok: true as const, data: await mod.setCompanyCustomerGroup(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getCustomerGroupSalesSummaryFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/customer-group-sales");
      return { ok: true as const, data: await mod.getCustomerGroupSalesSummary(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listCustomerGroupDocumentsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/customer-group-sales");
      return { ok: true as const, data: await mod.listCustomerGroupDocuments(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listCustomerGroupProductLinesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/customer-group-sales");
      return { ok: true as const, data: await mod.listCustomerGroupProductLines(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportCustomerGroupSalesCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const mod = await import("@/server/companies/customer-group-sales");
      return { ok: true as const, data: await mod.exportCustomerGroupSalesCsv(userId, data) };
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

export const deleteTeamDepartmentFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const team = await import("@/server/team/service");
      return { ok: true as const, data: await team.deleteTeamDepartment(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

// ─── Phase 6B checkout / orders ──────────────────────────────────────────────

export const getCheckoutContextFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const orders = await import("@/server/orders/service");
    return { ok: true as const, data: await orders.getCheckoutContext(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const previewCheckoutFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const orders = await import("@/server/orders/service");
      return { ok: true as const, data: await orders.previewCheckout(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const placeOrderFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const orders = await import("@/server/orders/service");
      return { ok: true as const, data: await orders.placeOrder(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listPortalOrdersFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: unknown) =>
      data as
        | { page?: number; pageSize?: number; filter?: "ALL" | "OPEN" | "BACKORDERS" }
        | undefined,
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const orders = await import("@/server/orders/service");
      return { ok: true as const, data: await orders.listPortalOrders(userId, data ?? {}) };
    } catch (e) {
      return toError(e);
    }
  });

export const listAdminBackorderLinesFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: unknown) =>
      data as
        | {
            q?: string;
            stockNowAvailable?: boolean;
            fullyBackordered?: boolean;
            partBackordered?: boolean;
          }
        | undefined,
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const orders = await import("@/server/orders/service");
      return { ok: true as const, data: await orders.listAdminBackorderLines(userId, data ?? {}) };
    } catch (e) {
      return toError(e);
    }
  });

export const getPortalOrderFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { orderId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const orders = await import("@/server/orders/service");
      return { ok: true as const, data: await orders.getPortalOrder(userId, data.orderId) };
    } catch (e) {
      return toError(e);
    }
  });

export const getPortalDashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const portal = await import("@/server/portal/dashboard");
    return { ok: true as const, data: await portal.getPortalDashboard(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const getPortalSupportContactFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const portal = await import("@/server/portal/dashboard");
    return { ok: true as const, data: await portal.getPortalSupportContact(userId) };
  } catch (e) {
    return toError(e);
  }
});
export const listAdminOrdersFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: unknown) =>
      data as
        | {
            page?: number;
            pageSize?: number;
            companyId?: string;
            q?: string;
            autopartExport?: "READY" | "EXPORTED" | "BLOCKED" | "ALL";
            backorders?: "ALL" | "CONTAINS" | "FULL";
          }
        | undefined,
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const orders = await import("@/server/orders/service");
      return { ok: true as const, data: await orders.listAdminOrders(userId, data ?? {}) };
    } catch (e) {
      return toError(e);
    }
  });

export const getAdminOrderFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { orderId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const orders = await import("@/server/orders/service");
      return { ok: true as const, data: await orders.getAdminOrder(userId, data.orderId) };
    } catch (e) {
      return toError(e);
    }
  });

export const deleteAdminOrderFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { orderId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const orders = await import("@/server/orders/service");
      return { ok: true as const, data: await orders.deleteAdminOrder(userId, data.orderId) };
    } catch (e) {
      return toError(e);
    }
  });

export const deleteAdminOrdersFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const orders = await import("@/server/orders/service");
      return { ok: true as const, data: await orders.deleteAdminOrders(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const repairOrderAutopartSnapshotFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { orderId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const orders = await import("@/server/orders/service");
      return {
        ok: true as const,
        data: await orders.repairOrderAutopartCustomerCodeSnapshot(userId, data.orderId),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const previewAutopartOrderExportFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) =>
      data as { orderIds: string[]; allowAlreadyExported?: boolean },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const exp = await import("@/server/orders/autopart-export");
      return {
        ok: true as const,
        data: await exp.previewAutopartOrderExport(userId, data.orderIds, {
          ...(data.allowAlreadyExported !== undefined
            ? { allowAlreadyExported: data.allowAlreadyExported }
            : {}),
        }),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const exportAutopartOrdersCsvFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) =>
      data as { orderIds: string[]; confirmReexport?: boolean },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const exp = await import("@/server/orders/autopart-export");
      return {
        ok: true as const,
        data: await exp.exportAutopartOrdersCsv(userId, data.orderIds, {
          ...(data.confirmReexport !== undefined
            ? { confirmReexport: data.confirmReexport }
            : {}),
        }),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const listOrderEmailsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { orderId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const email = await import("@/server/email/transactional");
      return { ok: true as const, data: await email.listOrderEmails(userId, data.orderId) };
    } catch (e) {
      return toError(e);
    }
  });

export const retryTransactionalEmailFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { emailId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const email = await import("@/server/email/transactional");
      return {
        ok: true as const,
        data: await email.retryTransactionalEmail(userId, data.emailId),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const getEmailSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const settings = await import("@/server/email/settings");
    return { ok: true as const, data: await settings.getEmailSettingsForActor(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const saveEmailSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as Record<string, unknown>)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const settings = await import("@/server/email/settings");
      return { ok: true as const, data: await settings.updateEmailSettings(userId, data ?? {}) };
    } catch (e) {
      return toError(e);
    }
  });

export const testSmtpConnectionFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const settings = await import("@/server/email/settings");
    return { ok: true as const, data: await settings.testSmtpConnection(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const sendTestEmailFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { toEmail: string; toName?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const settings = await import("@/server/email/settings");
      return { ok: true as const, data: await settings.sendTestEmail(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getEmailPreviewCentreFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const preview = await import("@/server/email/preview/service");
    return { ok: true as const, data: await preview.getEmailPreviewCentre(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const previewEmailTemplateFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { templateId: string; scenarioId?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const preview = await import("@/server/email/preview/service");
      return {
        ok: true as const,
        data: await preview.previewEmailTemplate(userId, data.templateId, data.scenarioId),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const sendEmailTemplateTestFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) => data as { templateId: string; scenarioId?: string; toEmail: string },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const preview = await import("@/server/email/preview/service");
      return { ok: true as const, data: await preview.sendEmailTemplateTest(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listTransactionalEmailsFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: unknown) => data as { status?: string; purpose?: string; limit?: number } | undefined,
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const email = await import("@/server/email/transactional");
      return {
        ok: true as const,
        data: await email.listTransactionalEmails(userId, data ?? {}),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const getAutopart504cFeedSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const feed = await import("@/server/orders/autopart-504c");
    return { ok: true as const, data: await feed.getAutopart504cFeedSettingsForActor(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const updateAutopart504cFeedSettingsFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) =>
      data as { configured?: boolean; enabled?: boolean; allowedSender?: string | null },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/orders/autopart-504c");
      return {
        ok: true as const,
        data: await feed.updateAutopart504cFeedSettings(userId, data),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const dryRunAutopart504cFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { text: string; filename?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/orders/autopart-504c");
      return {
        ok: true as const,
        data: await feed.dryRunAutopart504cFile(userId, data),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const listAutopart504cImportRunsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { limit?: number } | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/orders/autopart-504c");
      return {
        ok: true as const,
        data: await feed.listAutopart504cImportRuns(userId, data?.limit ?? 25),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const getAutopart504cImportRunDetailFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { runId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/orders/autopart-504c");
      return {
        ok: true as const,
        data: await feed.getAutopart504cImportRunDetail(userId, data.runId),
      };
    } catch (e) {
      return toError(e);
    }
  });

/** Live mailbox poll — blocked while feed is disabled (default). */
export const pollAutopart504cMailboxFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const feed = await import("@/server/orders/autopart-504c");
    return {
      ok: true as const,
      data: await feed.pollAutopart504cMailboxNow(userId),
    };
  } catch (e) {
    return toError(e);
  }
});

/* ─── 504 + TRM21QC order fulfilment ─────────────────────────────────────── */

export const get504TrmFulfilmentSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const feed = await import("@/server/orders/autopart-504-trm-fulfilment");
    return { ok: true as const, data: await feed.get504TrmFulfilmentSettingsForActor(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const update504TrmFulfilmentSettingsFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) =>
      data as {
        fulfilmentMode?: "OFF" | "PREVIEW" | "ACTIVE";
        fulfilmentFrom?: string | null;
        retire504c?: boolean;
      },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/orders/autopart-504-trm-fulfilment");
      return { ok: true as const, data: await feed.update504TrmFulfilmentSettings(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const preview504TrmFulfilmentFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const feed = await import("@/server/orders/autopart-504-trm-fulfilment");
    return { ok: true as const, data: await feed.preview504TrmFulfilment(userId) };
  } catch (e) {
    return toError(e);
  }
});

/* ─── Ongoing Autopart 504 + TRM21QC ─────────────────────────────────────── */

export const getOngoingSalesFeedSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const feed = await import("@/server/companies/autopart-ongoing-sales");
    return { ok: true as const, data: await feed.getOngoingSalesFeedSettings(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const updateOngoingSalesFeedSettingsFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: unknown) =>
      data as { enabled?: boolean; configured?: boolean; allowedSender?: string | null },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/companies/autopart-ongoing-sales");
      return { ok: true as const, data: await feed.updateOngoingSalesFeedSettings(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const previewAutopart504Fn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { text: string; filename?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/companies/autopart-ongoing-sales");
      return { ok: true as const, data: await feed.previewAutopart504Import(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const confirmAutopart504Fn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { text: string; filename?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/companies/autopart-ongoing-sales");
      return { ok: true as const, data: await feed.confirmAutopart504Import(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const previewAutopartTrm21qcFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { text: string; filename?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/companies/autopart-ongoing-sales");
      return { ok: true as const, data: await feed.previewAutopartTrm21qcImport(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const confirmAutopartTrm21qcFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { text: string; filename?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/companies/autopart-ongoing-sales");
      return { ok: true as const, data: await feed.confirmAutopartTrm21qcImport(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listOngoingSalesImportRunsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { limit?: number } | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/companies/autopart-ongoing-sales");
      return {
        ok: true as const,
        data: await feed.listOngoingSalesImportRuns(userId, data?.limit ?? 25),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const getOngoingSalesImportRunDetailFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { runId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/companies/autopart-ongoing-sales");
      return {
        ok: true as const,
        data: await feed.getOngoingSalesImportRunDetail(userId, data.runId),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const listOngoingSalesImportDiagnosticsFn = createServerFn({ method: "GET" })
  .inputValidator(
    (data: unknown) =>
      data as {
        runId: string;
        filter?: string;
        q?: string;
        page?: number;
        pageSize?: number;
      },
  )
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/companies/autopart-ongoing-sales");
      return {
        ok: true as const,
        data: await feed.listOngoingSalesImportDiagnostics(userId, data),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const exportOngoingSalesImportDiagnosticsCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { runId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const feed = await import("@/server/companies/autopart-ongoing-sales");
      return {
        ok: true as const,
        data: await feed.exportOngoingSalesImportDiagnosticsCsv(userId, data.runId),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const getOngoingSalesFreshnessFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const feed = await import("@/server/companies/autopart-ongoing-sales");
    return { ok: true as const, data: await feed.getOngoingSalesFreshness(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const getSalesIntelligenceFreshnessFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const feed = await import("@/server/companies/autopart-ongoing-sales");
    return { ok: true as const, data: await feed.getSalesDataFreshnessForIntelligence(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const pollOngoingSalesMailboxFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const poll = await import("@/server/companies/autopart-ongoing-sales-poll");
    return { ok: true as const, data: await poll.pollOngoingSalesMailboxNow(userId) };
  } catch (e) {
    return toError(e);
  }
});

/* ─── Production B2B Quotes ─────────────────────────────────────────────── */

export const listStaffQuotesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return { ok: true as const, data: await quotes.listQuotesForStaff(userId, data ?? {}) };
    } catch (e) {
      return toError(e);
    }
  });

export const getStaffQuoteFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return { ok: true as const, data: await quotes.getQuoteForStaff(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const getQuoteCompanyContextFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { companyId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return {
        ok: true as const,
        data: await quotes.getCompanyQuoteContext(userId, data.companyId),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const searchQuoteProductsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { companyId: string; q: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return {
        ok: true as const,
        data: await quotes.searchQuoteProducts(userId, data),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const createQuoteFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return { ok: true as const, data: await quotes.createQuote(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const updateQuoteDraftFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return { ok: true as const, data: await quotes.updateQuoteDraft(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const sendQuoteFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return { ok: true as const, data: await quotes.sendQuote(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const duplicateQuoteFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return { ok: true as const, data: await quotes.duplicateQuote(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const deleteStaffQuoteFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return { ok: true as const, data: await quotes.deleteStaffQuote(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const acceptQuoteOnBehalfFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return { ok: true as const, data: await quotes.acceptQuoteOnBehalf(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listQuoteEmailsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { quoteId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return {
        ok: true as const,
        data: await quotes.listQuoteEmailsForStaff(userId, data.quoteId),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const listPortalQuotesFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const quotes = await import("@/server/quotes/service");
    return { ok: true as const, data: await quotes.listQuotesForPortal(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const getPortalQuoteFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return { ok: true as const, data: await quotes.getQuoteForPortal(userId, data.id) };
    } catch (e) {
      return toError(e);
    }
  });

export const acceptPortalQuoteFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return { ok: true as const, data: await quotes.acceptQuoteAsCustomer(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const declinePortalQuoteFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const quotes = await import("@/server/quotes/service");
      return { ok: true as const, data: await quotes.declineQuote(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getCompanyAutopartHistoryWorkspaceFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { companyId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const hist = await import("@/server/companies/autopart-history");
      return {
        ok: true as const,
        data: await hist.getCompanyAutopartHistoryWorkspace(userId, data.companyId),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const verifyAutopartAccountAliasFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const hist = await import("@/server/companies/autopart-history");
      return { ok: true as const, data: await hist.verifyAutopartAccountAlias(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const previewAutopartHistoryImportFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const hist = await import("@/server/companies/autopart-history");
      return { ok: true as const, data: await hist.previewAutopartHistoryImport(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const confirmAutopartHistoryImportFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const hist = await import("@/server/companies/autopart-history");
      return { ok: true as const, data: await hist.confirmAutopartHistoryImport(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getHistoricImportRunStatusFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { runId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const hist = await import("@/server/companies/autopart-history");
      return {
        ok: true as const,
        data: await hist.getHistoricImportRunStatus(userId, data.runId),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const listPortalHistoricPurchasesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { q?: string; filter?: "ALL" | "AVAILABLE" | "UNAVAILABLE" } | undefined)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const hist = await import("@/server/companies/purchase-history");
      return { ok: true as const, data: await hist.listPortalHistoricPurchases(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listPortalPurchaseHistoryFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const hist = await import("@/server/companies/purchase-history");
      return { ok: true as const, data: await hist.listPortalPurchaseHistory(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getPortalPurchaseProductInsightFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { sku: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const hist = await import("@/server/companies/purchase-history");
      return { ok: true as const, data: await hist.getPortalPurchaseProductInsight(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const searchSalesIntelligenceCustomersFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const si = await import("@/server/sales-intelligence/enquiry");
      return { ok: true as const, data: await si.searchSalesIntelligenceCustomers(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const searchSalesIntelligenceProductsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const si = await import("@/server/sales-intelligence/enquiry");
      return { ok: true as const, data: await si.searchSalesIntelligenceProducts(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getCustomerSalesEnquiryFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const si = await import("@/server/sales-intelligence/enquiry");
      return { ok: true as const, data: await si.getCustomerSalesEnquiry(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getProductSalesEnquiryFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const si = await import("@/server/sales-intelligence/enquiry");
      return { ok: true as const, data: await si.getProductSalesEnquiry(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportCustomerSalesEnquiryCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const si = await import("@/server/sales-intelligence/enquiry");
      return { ok: true as const, data: await si.exportCustomerSalesEnquiryCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportProductSalesEnquiryCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const si = await import("@/server/sales-intelligence/enquiry");
      return { ok: true as const, data: await si.exportProductSalesEnquiryCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getCustomerGapAnalysisFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const gap = await import("@/server/sales-intelligence/gap");
      return { ok: true as const, data: await gap.getCustomerGapAnalysis(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getProductGapAnalysisFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const gap = await import("@/server/sales-intelligence/gap");
      return { ok: true as const, data: await gap.getProductGapAnalysis(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportCustomerGapCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const gap = await import("@/server/sales-intelligence/gap");
      return { ok: true as const, data: await gap.exportCustomerGapCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportProductGapCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const gap = await import("@/server/sales-intelligence/gap");
      return { ok: true as const, data: await gap.exportProductGapCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getCustomerRangeOpportunitiesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const opp = await import("@/server/sales-intelligence/opportunity");
      return { ok: true as const, data: await opp.getCustomerRangeOpportunities(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getSalesRepPortfolioFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const portfolio = await import("@/server/sales-intelligence/portfolio");
      return { ok: true as const, data: await portfolio.getSalesRepPortfolio(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getDailySalesBriefFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const brief = await import("@/server/sales-intelligence/daily-brief");
      return { ok: true as const, data: await brief.getDailySalesBrief(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const completeDailyBriefFollowUpFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const brief = await import("@/server/sales-intelligence/daily-brief");
      return { ok: true as const, data: await brief.completeDailyBriefFollowUp(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportSalesRepPortfolioCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const portfolio = await import("@/server/sales-intelligence/portfolio");
      return { ok: true as const, data: await portfolio.exportSalesRepPortfolioCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getPortfolioCustomerDetailFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const portfolio = await import("@/server/sales-intelligence/portfolio");
      return { ok: true as const, data: await portfolio.getPortfolioCustomerDetail(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportCustomerRangeOpportunitiesCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const opp = await import("@/server/sales-intelligence/opportunity");
      return { ok: true as const, data: await opp.exportCustomerRangeOpportunitiesCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getCustomerRebateAnalysisFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const rebate = await import("@/server/sales-intelligence/rebate");
      return { ok: true as const, data: await rebate.getCustomerRebateAnalysis(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getMultiCustomerRebateAnalysisFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const rebate = await import("@/server/sales-intelligence/rebate");
      return { ok: true as const, data: await rebate.getMultiCustomerRebateAnalysis(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportCustomerRebateSummaryCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const rebate = await import("@/server/sales-intelligence/rebate");
      return { ok: true as const, data: await rebate.exportCustomerRebateSummaryCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportCustomerRebateDocumentsCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const rebate = await import("@/server/sales-intelligence/rebate");
      return { ok: true as const, data: await rebate.exportCustomerRebateDocumentsCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportCustomerRebateProductsCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const rebate = await import("@/server/sales-intelligence/rebate");
      return { ok: true as const, data: await rebate.exportCustomerRebateProductsCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportMultiCustomerRebateCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const rebate = await import("@/server/sales-intelligence/rebate");
      return { ok: true as const, data: await rebate.exportMultiCustomerRebateCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const previewSalesIntelligenceFollowUpFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const followup = await import("@/server/sales-intelligence/followup");
      return { ok: true as const, data: await followup.previewSalesIntelligenceFollowUp(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const createSalesIntelligenceFollowUpFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const followup = await import("@/server/sales-intelligence/followup");
      return { ok: true as const, data: await followup.createSalesIntelligenceFollowUp(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listCrmTasksFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const followup = await import("@/server/sales-intelligence/followup");
      return { ok: true as const, data: await followup.listCrmTasks(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getCrmTaskFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const followup = await import("@/server/sales-intelligence/followup");
      return { ok: true as const, data: await followup.getCrmTask(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const completeCrmTaskFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const followup = await import("@/server/sales-intelligence/followup");
      return { ok: true as const, data: await followup.completeCrmTask(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const rescheduleCrmTaskFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const followup = await import("@/server/sales-intelligence/followup");
      return { ok: true as const, data: await followup.rescheduleCrmTask(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getCrmOverviewFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const overview = await import("@/server/crm/overview");
      return { ok: true as const, data: await overview.getCrmOverview(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listCrmLeadsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const leads = await import("@/server/crm/leads");
      return { ok: true as const, data: await leads.listCrmLeads(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getCrmLeadFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const leads = await import("@/server/crm/leads");
      return { ok: true as const, data: await leads.getCrmLead(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const createCrmLeadFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const leads = await import("@/server/crm/leads");
      return { ok: true as const, data: await leads.createCrmLead(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const updateCrmLeadFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const leads = await import("@/server/crm/leads");
      return { ok: true as const, data: await leads.updateCrmLead(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const markCrmLeadLostFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const leads = await import("@/server/crm/leads");
      return { ok: true as const, data: await leads.markCrmLeadLost(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const convertCrmLeadFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const leads = await import("@/server/crm/leads");
      return { ok: true as const, data: await leads.convertCrmLead(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const searchCompaniesForLeadConvertFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const leads = await import("@/server/crm/leads");
      return { ok: true as const, data: await leads.searchCompaniesForLeadConvert(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listCrmOpportunitiesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const opps = await import("@/server/crm/opportunities");
      return { ok: true as const, data: await opps.listCrmOpportunities(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getCrmOpportunityFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const opps = await import("@/server/crm/opportunities");
      return { ok: true as const, data: await opps.getCrmOpportunity(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const createCrmOpportunityFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const opps = await import("@/server/crm/opportunities");
      return { ok: true as const, data: await opps.createCrmOpportunity(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const updateCrmOpportunityStageFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const opps = await import("@/server/crm/opportunities");
      return { ok: true as const, data: await opps.updateCrmOpportunityStage(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const updateCrmOpportunityFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const opps = await import("@/server/crm/opportunities");
      return { ok: true as const, data: await opps.updateCrmOpportunity(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listCrmActivitiesFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const acts = await import("@/server/crm/activities");
      return { ok: true as const, data: await acts.listCrmActivities(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const logCrmActivityFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const acts = await import("@/server/crm/activities");
      return { ok: true as const, data: await acts.logCrmActivity(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const createCrmTaskFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const acts = await import("@/server/crm/activities");
      return { ok: true as const, data: await acts.createCrmTask(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getCompanyCrmWorkspaceFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const customer = await import("@/server/crm/customer");
      return { ok: true as const, data: await customer.getCompanyCrmWorkspace(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getPurchasingDashboardFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const purchasing = await import("@/server/purchasing/service");
    return { ok: true as const, data: await purchasing.getPurchasingDashboard(userId) };
  } catch (e) {
    return toError(e);
  }
});

export const listPurchasingForecastFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const purchasing = await import("@/server/purchasing/service");
      return { ok: true as const, data: await purchasing.listPurchasingForecast(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getPurchasingSkuFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { sku: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const purchasing = await import("@/server/purchasing/service");
      return { ok: true as const, data: await purchasing.getPurchasingSku(userId, data.sku) };
    } catch (e) {
      return toError(e);
    }
  });

export const listPurchasePlannerFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const purchasing = await import("@/server/purchasing/service");
      return { ok: true as const, data: await purchasing.listPurchasePlanner(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listPurchasingSuppliersFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const purchasing = await import("@/server/purchasing/service");
      return { ok: true as const, data: await purchasing.listSuppliersWorkspace(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getPurchasingSupplierFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const purchasing = await import("@/server/purchasing/service");
      return { ok: true as const, data: await purchasing.getSupplierWorkspace(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getProductPurchasingPanelFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { sku: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const purchasing = await import("@/server/purchasing/service");
      return { ok: true as const, data: await purchasing.getProductPurchasingPanel(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const searchPurchasingProductsFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { q: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const suppliers = await import("@/server/purchasing/suppliers");
      return { ok: true as const, data: await suppliers.searchPurchasingProducts(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const createPurchasingSupplierFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const suppliers = await import("@/server/purchasing/suppliers");
      return { ok: true as const, data: await suppliers.createSupplier(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const updatePurchasingSupplierFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const suppliers = await import("@/server/purchasing/suppliers");
      return { ok: true as const, data: await suppliers.updateSupplier(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const setPurchasingSupplierActiveFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string; active: boolean })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const suppliers = await import("@/server/purchasing/suppliers");
      return { ok: true as const, data: await suppliers.setSupplierActive(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const addProductSupplierFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const suppliers = await import("@/server/purchasing/suppliers");
      return { ok: true as const, data: await suppliers.addProductSupplier(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const updateProductSupplierFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const suppliers = await import("@/server/purchasing/suppliers");
      return { ok: true as const, data: await suppliers.updateProductSupplier(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const setPreferredProductSupplierFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const suppliers = await import("@/server/purchasing/suppliers");
      return { ok: true as const, data: await suppliers.setPreferredProductSupplier(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const setProductSupplierActiveFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { id: string; active: boolean })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const suppliers = await import("@/server/purchasing/suppliers");
      return { ok: true as const, data: await suppliers.setProductSupplierActive(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const listPurchasingOverstockFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const purchasing = await import("@/server/purchasing/service");
      return { ok: true as const, data: await purchasing.listOverstock(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportPurchasePlannerCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const purchasing = await import("@/server/purchasing/service");
      return { ok: true as const, data: await purchasing.exportPurchasePlannerCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const updatePurchasingSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const purchasing = await import("@/server/purchasing/service");
      return { ok: true as const, data: await purchasing.updatePurchasingSettings(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const updateSkuPurchasingSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const purchasing = await import("@/server/purchasing/service");
      return { ok: true as const, data: await purchasing.updateSkuPurchasingSettings(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const updatePurchasingPlanFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const purchasing = await import("@/server/purchasing/service");
      return { ok: true as const, data: await purchasing.updatePurchasingPlan(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getPurchasingBackordersFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const backorders = await import("@/server/purchasing/backorders");
      return { ok: true as const, data: await backorders.getBackorderWorkspace(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const getPurchasingBackorderLineFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data as { lineId: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const backorders = await import("@/server/purchasing/backorders");
      return { ok: true as const, data: await backorders.getBackorderLineDetail(userId, data.lineId) };
    } catch (e) {
      return toError(e);
    }
  });

export const exportPurchasingBackordersCsvFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const backorders = await import("@/server/purchasing/backorders");
      return { ok: true as const, data: await backorders.exportBackordersCsv(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const previewAutopart216vFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { text: string; filename?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const importing = await import("@/server/purchasing/backorder-import");
      return { ok: true as const, data: await importing.previewAutopart216vImport(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const confirmAutopart216vFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { text: string; filename?: string })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const importing = await import("@/server/purchasing/backorder-import");
      return {
        ok: true as const,
        data: await importing.confirmAutopart216vImport(userId, { ...data, source: "MANUAL" }),
      };
    } catch (e) {
      return toError(e);
    }
  });

export const updateBackorderFeedSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => data as { enabled?: boolean; allowedSender?: string | null })
  .handler(async ({ data }) => {
    try {
      const userId = await requireUserId();
      const backorders = await import("@/server/purchasing/backorders");
      return { ok: true as const, data: await backorders.updateBackorderFeedSettings(userId, data) };
    } catch (e) {
      return toError(e);
    }
  });

export const pollBackorderMailboxNowFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await requireUserId();
    const poll = await import("@/server/purchasing/backorder-poll");
    return { ok: true as const, data: await poll.pollBackorderMailboxNow(userId) };
  } catch (e) {
    return toError(e);
  }
});



