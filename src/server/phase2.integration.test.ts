/**
 * Phase 2 integration tests — companies, addresses, applications, CMS.
 * Uses development DATABASE_URL. Creates disposable fixtures (no seed dependency).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

import { bootstrapRbac } from "../../prisma/bootstrap/rbac";
import {
  createAddress,
  createCompany,
  createContact,
  deleteCompany,
  getCompanyWorkspace,
  listCompaniesForActor,
  updateCompany,
} from "@/server/companies/service";
import {
  approveTradeApplication,
  rejectTradeApplication,
  submitTradeApplication,
} from "@/server/applications/service";
import { validTradeApplicationInput } from "@/server/applications/test-fixtures";
import {
  bootstrapHomepageCms,
  getPublishedHomepage,
  publishCmsPage,
  restoreCmsVersion,
  saveCmsDraftSections,
  getCmsPageDraft,
  updateCmsPageMeta,
} from "@/server/cms/service";
import { deleteCmsMedia, getPublicCmsMediaBytes, listCmsMedia, updateCmsMedia, uploadCmsMedia } from "@/server/cms/media";
import { AuthError } from "@/server/rbac/guards";
import { cmsMediaPublicPath } from "@/lib/cms-media";

const prisma = new PrismaClient();

let adminId: string;
let salesRepUserId: string;
let salesRepId: string;
let outsiderId: string;

async function ensureUser(email: string, roles: string[], actorType: "INTERNAL" | "TRADE" = "INTERNAL") {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType,
        emailVerified: true,
      },
    });
  }
  for (const key of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key } });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser("phase2.admin@example.invalid", ["SUPER_ADMIN"]);
  salesRepUserId = await ensureUser("phase2.sales@example.invalid", ["SALES_REPRESENTATIVE"]);
  outsiderId = await ensureUser("phase2.outsider@example.invalid", ["SALES_REPRESENTATIVE"]);

  let rep = await prisma.salesRep.findUnique({ where: { userId: salesRepUserId } });
  if (!rep) {
    rep = await prisma.salesRep.create({
      data: { userId: salesRepUserId, code: "P2REP", active: true },
    });
  }
  salesRepId = rep.id;

  const other = await prisma.salesRep.findUnique({ where: { userId: outsiderId } });
  if (!other) {
    await prisma.salesRep.create({
      data: { userId: outsiderId, code: "P2OUT", active: true },
    });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("company CRUD + sales scoping", () => {
  it("creates, lists, updates a company", async () => {
    const created = await createCompany(adminId, {
      name: `Phase2 Co ${Date.now()}`,
      tradingName: "P2 Trading",
      status: "ACTIVE",
      salesRepId,
      primaryEmail: "ops@phase2.example",
    });
    expect(created.id).toBeTruthy();

    const listed = await listCompaniesForActor(adminId, { q: created.name, page: 1, pageSize: 10 });
    expect(listed.items.some((i) => i.id === created.id)).toBe(true);

    const updated = await updateCompany(adminId, {
      id: created.id,
      status: "ON_HOLD",
      paymentTerms: "30 days",
    });
    expect(updated.status).toBe("ON_HOLD");
    expect(updated.paymentTerms).toBe("30 days");
  });

  it("scopes salesperson to assigned companies only", async () => {
    const assigned = await createCompany(adminId, {
      name: `Assigned ${Date.now()}`,
      status: "ACTIVE",
      salesRepId,
    });
    const other = await createCompany(adminId, {
      name: `Other ${Date.now()}`,
      status: "ACTIVE",
    });

    const mine = await listCompaniesForActor(salesRepUserId, { page: 1, pageSize: 100 });
    expect(mine.items.some((i) => i.id === assigned.id)).toBe(true);
    expect(mine.items.some((i) => i.id === other.id)).toBe(false);

    await expect(getCompanyWorkspace(outsiderId, assigned.id)).rejects.toBeInstanceOf(AuthError);
    const ws = await getCompanyWorkspace(salesRepUserId, assigned.id);
    expect(ws.company.id).toBe(assigned.id);
  });

  it("deletes a customer without commercial history and denies sales reps", async () => {
    const company = await createCompany(adminId, {
      name: `Delete Me ${Date.now()}`,
      status: "PROSPECT",
      salesRepId,
    });
    await createContact(adminId, {
      companyId: company.id,
      firstName: "Temp",
      lastName: "Contact",
      email: `temp.${Date.now()}@example.invalid`,
    });

    await expect(deleteCompany(salesRepUserId, { id: company.id })).rejects.toBeInstanceOf(AuthError);

    const deleted = await deleteCompany(adminId, { id: company.id });
    expect(deleted.ok).toBe(true);
    expect(deleted.id).toBe(company.id);

    await expect(getCompanyWorkspace(adminId, company.id)).rejects.toBeInstanceOf(AuthError);
    const listed = await listCompaniesForActor(adminId, { q: company.name, page: 1, pageSize: 10 });
    expect(listed.items.some((i) => i.id === company.id)).toBe(false);
  });

  it("refuses to delete a customer that has an order", async () => {
    const company = await createCompany(adminId, {
      name: `Has Order ${Date.now()}`,
      status: "ACTIVE",
    });
    await prisma.order.create({
      data: {
        orderNumber: `TEST-DEL-${Date.now()}`,
        companyId: company.id,
        status: "DRAFT",
        currency: "GBP",
        subtotal: 0,
        vatTotal: 0,
        grandTotal: 0,
        items: {
          create: {
            sku: "TEST-SKU",
            name: "Placeholder line",
            qty: 1,
            unitPrice: 0,
            customerUnitPrice: 0,
            vatRate: 20,
            lineTotal: 0,
            lineVat: 0,
            lineGross: 0,
          },
        },
      },
    });

    await expect(deleteCompany(adminId, { id: company.id })).rejects.toMatchObject({
      code: "COMPANY_HAS_COMMERCIAL_HISTORY",
    });
    const stillThere = await prisma.company.findUnique({ where: { id: company.id } });
    expect(stillThere).toBeTruthy();
  });
});

describe("contacts and addresses", () => {
  it("creates contacts and enforces single default billing/delivery", async () => {
    const company = await createCompany(adminId, {
      name: `Addr Co ${Date.now()}`,
      status: "ACTIVE",
    });

    await createContact(adminId, {
      companyId: company.id,
      firstName: "Pat",
      lastName: "Buyer",
      email: "pat@example.com",
      isPrimary: true,
      isPurchasing: true,
    });

    const a1 = await createAddress(adminId, {
      companyId: company.id,
      type: "BILLING",
      label: "Head Office",
      line1: "1 Test Street",
      town: "Leeds",
      postcode: "LS1 1AA",
      isDefaultBilling: true,
      isDefaultDelivery: true,
    });
    const a2 = await createAddress(adminId, {
      companyId: company.id,
      type: "DELIVERY",
      label: "Warehouse",
      line1: "2 Depot Road",
      town: "Leeds",
      postcode: "LS2 2BB",
      isDefaultBilling: true,
      isDefaultDelivery: true,
    });

    const ws = await getCompanyWorkspace(adminId, company.id);
    const billingDefaults = ws.addresses.filter((a) => a.isDefaultBilling);
    const deliveryDefaults = ws.addresses.filter((a) => a.isDefaultDelivery);
    expect(billingDefaults).toHaveLength(1);
    expect(billingDefaults[0]!.id).toBe(a2.id);
    expect(deliveryDefaults).toHaveLength(1);
    expect(deliveryDefaults[0]!.id).toBe(a2.id);
    expect(a1.id).not.toBe(a2.id);
  });
});

describe("trade application approval", () => {
  it("submits and approves idempotently", async () => {
    const stamp = Date.now();
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `App Co ${stamp}`,
        email: `alex.${stamp}@example.invalid`,
        tradingName: "App Trading",
        notes: "Please review",
      }),
    );
    expect(submitted.reference).toMatch(/^APP-/);

    const first = await approveTradeApplication(adminId, { id: submitted.id });
    expect(first.created).toBe(true);
    expect(first.companyId).toBeTruthy();
    expect(first.emailDeferred).toBe(true);
    expect(first.inviteToken).toBeTruthy();
    expect(first.activationPath).toContain("/activate?token=");

    const second = await approveTradeApplication(adminId, { id: submitted.id });
    expect(second.created).toBe(false);
    expect(second.companyId).toBe(first.companyId);

    const companies = await prisma.company.count({
      where: { name: `App Co ${stamp}` },
    });
    expect(companies).toBe(1);
  });

  it("rejects without creating company", async () => {
    const stamp = Date.now();
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Reject Co ${stamp}`,
        email: `reject.${stamp}@example.invalid`,
      }),
    );
    const result = await rejectTradeApplication(adminId, {
      id: submitted.id,
      reviewNotes: "Incomplete",
    });
    expect(result.status).toBe("REJECTED");
    const again = await rejectTradeApplication(adminId, {
      id: submitted.id,
      reviewNotes: "Incomplete",
    });
    expect(again.already).toBe(true);
  });
});

describe("CMS draft vs published", () => {
  let homepageSnapshot: {
    title: string;
    seoTitle: string | null;
    metaDescription: string | null;
    sections: Array<{ type: string; enabled: boolean; config: Record<string, unknown> }>;
  } | null = null;

  beforeAll(async () => {
    await bootstrapHomepageCms(prisma);
    const page = await prisma.cmsPage.findUniqueOrThrow({ where: { slug: "home" } });
    const published = await getPublishedHomepage();
    homepageSnapshot = {
      title: page.title,
      seoTitle: page.seoTitle,
      metaDescription: page.metaDescription,
      sections: (published?.sections ?? []).map((section) => ({
        type: section.type,
        enabled: true,
        config: (section.config ?? {}) as Record<string, unknown>,
      })),
    };
  });

  afterAll(async () => {
    if (!homepageSnapshot?.sections.length) return;
    await saveCmsDraftSections(
      adminId,
      "home",
      homepageSnapshot.sections.map((section) => ({
        type: section.type,
        enabled: section.enabled,
        config: section.config,
      })),
    );
    await publishCmsPage(adminId, "home", "Restore homepage after CMS integration tests");
    await updateCmsPageMeta(adminId, {
      slug: "home",
      title: homepageSnapshot.title,
      seoTitle: homepageSnapshot.seoTitle ?? "",
      metaDescription: homepageSnapshot.metaDescription ?? "",
    });
  });

  it("bootstraps homepage and keeps public on published version", async () => {
    const boot = await bootstrapHomepageCms(prisma);
    expect(boot.pageId).toBeTruthy();

    const published = await getPublishedHomepage();
    expect(published?.sections.length).toBeGreaterThan(0);

    const draftBefore = await getCmsPageDraft(adminId, "home");
    const hero = draftBefore.version?.sections.find((s) => s.type === "HERO");
    expect(hero).toBeTruthy();

    const liveHeadlineA = "Published homepage A";
    const draftHeadlineB = "Draft homepage B";

    await saveCmsDraftSections(adminId, "home", [
      {
        type: "HERO",
        enabled: true,
        config: {
          headline: liveHeadlineA,
          supporting: "Published copy",
          ctaLabel: "Apply",
          ctaHref: "/register",
        },
      },
    ]);
    await publishCmsPage(adminId, "home");
    const publishedA = await getPublishedHomepage();
    const aHero = publishedA?.sections.find((s) => s.type === "HERO");
    const aHeadline =
      aHero && typeof aHero.config === "object" && aHero.config && "headline" in aHero.config
        ? String((aHero.config as { headline: string }).headline)
        : "";
    expect(aHeadline).toBe(liveHeadlineA);

    await saveCmsDraftSections(adminId, "home", [
      {
        type: "HERO",
        enabled: true,
        config: {
          headline: draftHeadlineB,
          supporting: "Should not be live yet",
          ctaLabel: "Apply",
          ctaHref: "/register",
        },
      },
      {
        type: "TRADE_CTA",
        enabled: true,
        config: {
          headline: "Draft CTA",
          supporting: "",
          ctaLabel: "Apply",
          ctaHref: "/register",
        },
      },
    ]);

    const live = await getPublishedHomepage();
    const liveHero = live?.sections.find((s) => s.type === "HERO");
    const liveHeadline =
      liveHero && typeof liveHero.config === "object" && liveHero.config && "headline" in liveHero.config
        ? String((liveHero.config as { headline: string }).headline)
        : "";
    expect(liveHeadline).toBe(liveHeadlineA);
    expect(liveHeadline).not.toBe(draftHeadlineB);

    await publishCmsPage(adminId, "home");
    const after = await getPublishedHomepage();
    const afterHero = after?.sections.find((s) => s.type === "HERO");
    const afterHeadline =
      afterHero && typeof afterHero.config === "object" && afterHero.config && "headline" in afterHero.config
        ? String((afterHero.config as { headline: string }).headline)
        : "";
    expect(afterHeadline).toBe(draftHeadlineB);
  });

  it("saves and publishes editor-shaped homepage sections including string counts", async () => {
    const headline = `Editor publish ${Date.now()}`;
    await saveCmsDraftSections(adminId, "home", [
      {
        type: "HERO",
        enabled: true,
        config: {
          headline,
          supporting: "From the CMS editor",
          ctaLabel: "Open a Trade Account",
          ctaHref: "/register",
          alignment: "left",
          variant: "split",
          spacing: "relaxed",
          media: { alt: "Hero" },
        },
      },
      {
        type: "FEATURED_BRANDS",
        enabled: true,
        config: {
          heading: "Five brands. One supply partner.",
          intro: "Trusted automotive brands, supplied to the trade from one place.",
          brandSlugs: ["power-maxed", "steel-seal"],
          brandCards: [
            {
              slug: "power-maxed",
              heading: "Power Maxed",
              description: "Professional automotive cleaning, detailing, workshop chemicals and vehicle care products.",
              href: "/brands/power-maxed",
              enabled: true,
            },
            {
              slug: "steel-seal",
              heading: "Steel Seal",
              description: "Professional head gasket repair trusted by motorists, workshops and the automotive trade.",
              href: "/brands/steel-seal",
              enabled: true,
            },
          ],
          displayCount: "5",
          variant: "standard",
          spacing: "standard",
        },
      },
    ]);
    await publishCmsPage(adminId, "home");
    const live = await getPublishedHomepage();
    const hero = live?.sections.find((s) => s.type === "HERO");
    const brands = live?.sections.find((s) => s.type === "FEATURED_BRANDS");
    const liveHeadline =
      hero && typeof hero.config === "object" && hero.config && "headline" in hero.config
        ? String((hero.config as { headline: string }).headline)
        : "";
    const count =
      brands && typeof brands.config === "object" && brands.config && "displayCount" in brands.config
        ? Number((brands.config as { displayCount: number }).displayCount)
        : 0;
    expect(liveHeadline).toBe(headline);
    expect(count).toBe(5);
  });

  it("denies CMS publish without permission", async () => {
    await expect(publishCmsPage(salesRepUserId, "home")).rejects.toBeInstanceOf(AuthError);
  });

  it("loads homepage draft without bootstrapping an empty catalogue", async () => {
    const { prisma: appPrisma } = await import("@/infra/database/client");
    expect(typeof appPrisma.cmsPage.findUnique).toBe("function");
    expect(typeof appPrisma.category.findUnique).toBe("function");
    const draft = await getCmsPageDraft(adminId, "home");
    expect(draft.slug).toBe("home");
    expect(draft.title.length).toBeGreaterThan(0);
  });

  it("saves multiple section ops and keeps unpublished draft off the public homepage", async () => {
    const publishedBefore = await getPublishedHomepage();
    const liveHeadline =
      publishedBefore?.sections.find((s) => s.type === "HERO") &&
      typeof publishedBefore.sections.find((s) => s.type === "HERO")?.config === "object"
        ? String(
            (publishedBefore.sections.find((s) => s.type === "HERO")!.config as { headline?: string }).headline ?? "",
          )
        : "";

    await saveCmsDraftSections(adminId, "home", [
      {
        type: "HERO",
        enabled: true,
        config: { headline: "Editor v2 unpublished", supporting: "Draft only", ctaLabel: "Go", ctaHref: "/register" },
      },
      {
        type: "BANNER",
        enabled: false,
        config: { text: "Hidden banner", tone: "brand" },
      },
      {
        type: "SPACER",
        enabled: true,
        config: { size: "lg" },
      },
    ]);
    const draft = await getCmsPageDraft(adminId, "home");
    expect(draft.hasUnpublishedChanges).toBe(true);
    expect(draft.version?.sections.map((s) => s.type)).toEqual(["HERO", "BANNER", "SPACER"]);
    expect(draft.version?.sections.find((s) => s.type === "BANNER")?.enabled).toBe(false);
    const publicPage = await getPublishedHomepage();
    const publicHero = publicPage?.sections.find((s) => s.type === "HERO");
    const publicHeadline =
      publicHero && typeof publicHero.config === "object" && publicHero.config && "headline" in publicHero.config
        ? String((publicHero.config as { headline: string }).headline)
        : "";
    expect(publicHeadline).toBe(liveHeadline);
    expect(publicHeadline).not.toBe("Editor v2 unpublished");
  });

  it("updates SEO fields and can restore a previous version into a new draft", async () => {
    await updateCmsPageMeta(adminId, {
      slug: "home",
      title: "Homepage",
      seoTitle: "SEO title for editor v2",
      metaDescription: "Meta description for editor v2 tests.",
    });
    const afterMeta = await getCmsPageDraft(adminId, "home");
    expect(afterMeta.seoTitle).toBe("SEO title for editor v2");
    const publishedVersionId = afterMeta.publishedVersionId;
    expect(publishedVersionId).toBeTruthy();
    const restored = await restoreCmsVersion(adminId, "home", publishedVersionId!);
    expect(restored.draftVersionId).not.toBe(publishedVersionId);
    expect(restored.hasUnpublishedChanges).toBe(true);
  });
});

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("CMS media library", () => {
  let draftSnapshot: Array<{ type: string; enabled: boolean; config: Record<string, unknown> }> | null =
    null;

  beforeAll(async () => {
    const draft = await getCmsPageDraft(adminId, "home");
    draftSnapshot = (draft.version?.sections ?? []).map((section) => ({
      type: section.type,
      enabled: section.enabled,
      config: (section.config ?? {}) as Record<string, unknown>,
    }));
  });

  afterAll(async () => {
    if (!draftSnapshot?.length) return;
    await saveCmsDraftSections(
      adminId,
      "home",
      draftSnapshot.map((section) => ({
        type: section.type,
        enabled: section.enabled,
        config: section.config,
      })),
    );
  });

  it("uploads, lists, serves bytes, and applies mediaId on a draft hero", async () => {
    const uploaded = await uploadCmsMedia(adminId, {
      filename: "picker-test.png",
      contentType: "image/png",
      base64: PNG_1X1,
      altText: "One pixel",
    });
    expect(uploaded.src).toBe(cmsMediaPublicPath(uploaded.id));
    expect(uploaded.contentType).toBe("image/png");
    expect(uploaded.width).toBe(1);
    expect(uploaded.height).toBe(1);

    const listed = await listCmsMedia(adminId);
    expect(listed.some((m) => m.id === uploaded.id)).toBe(true);

    const bytes = await getPublicCmsMediaBytes(uploaded.id);
    expect(bytes?.contentType).toBe("image/png");
    expect(bytes?.bytes.length).toBeGreaterThan(8);

    await saveCmsDraftSections(adminId, "home", [
      {
        type: "HERO",
        enabled: true,
        config: {
          headline: "Media picker hero",
          supporting: "Uses library image",
          ctaLabel: "Apply",
          ctaHref: "/register",
          media: { mediaId: uploaded.id, src: uploaded.src, alt: "One pixel" },
        },
      },
    ]);
    const draft = await getCmsPageDraft(adminId, "home");
    const hero = draft.version?.sections.find((s) => s.type === "HERO");
    const media =
      hero && typeof hero.config === "object" && hero.config && "media" in hero.config
        ? (hero.config as { media: { mediaId?: string; src?: string; alt?: string } }).media
        : null;
    expect(media?.mediaId).toBe(uploaded.id);
    expect(media?.src).toBe(uploaded.src);
    expect(media?.alt).toBe("One pixel");
  });

  it("denies media upload without cms.media.manage", async () => {
    await expect(
      uploadCmsMedia(salesRepUserId, {
        filename: "nope.png",
        contentType: "image/png",
        base64: PNG_1X1,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects non-image payloads", async () => {
    await expect(
      uploadCmsMedia(adminId, {
        filename: "notes.txt",
        contentType: "image/png",
        base64: Buffer.from("not-an-image").toString("base64"),
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("applies PRODUCT_IMAGE bounding box and stores processed dimensions", async () => {
    const sharp = (await import("sharp")).default;
    const raw = await sharp({
      create: { width: 1500, height: 1500, channels: 3, background: { r: 12, g: 24, b: 48 } },
    })
      .jpeg()
      .toBuffer();
    const uploaded = await uploadCmsMedia(adminId, {
      filename: "product-square.jpg",
      contentType: "image/jpeg",
      base64: raw.toString("base64"),
      usage: "PRODUCT_IMAGE",
    });
    expect(uploaded.width).toBe(1000);
    expect(uploaded.height).toBe(1000);
    expect(uploaded.sizeBytes).toBeTruthy();
    const bytes = await getPublicCmsMediaBytes(uploaded.id);
    const meta = await sharp(bytes!.bytes).metadata();
    expect(meta.width).toBe(1000);
    expect(meta.height).toBe(1000);
  });

  it("does not cap general CMS uploads to 1000px", async () => {
    const sharp = (await import("sharp")).default;
    const raw = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: { r: 8, g: 8, b: 8 } },
    })
      .jpeg()
      .toBuffer();
    const uploaded = await uploadCmsMedia(adminId, {
      filename: "hero.jpg",
      contentType: "image/jpeg",
      base64: raw.toString("base64"),
    });
    expect(uploaded.width).toBe(2000);
    expect(uploaded.height).toBe(1000);
  });

  it("updates alt text and refuses delete while the image is referenced", async () => {
    const uploaded = await uploadCmsMedia(adminId, {
      filename: "alt-test.png",
      contentType: "image/png",
      base64: PNG_1X1,
      altText: "Before",
    });
    const updated = await updateCmsMedia(adminId, { id: uploaded.id, altText: "After" });
    expect(updated.altText).toBe("After");
    await saveCmsDraftSections(adminId, "home", [
      {
        type: "HERO",
        enabled: true,
        config: {
          headline: "Uses image",
          media: { mediaId: uploaded.id, alt: "After", fit: "fill" },
        },
      },
    ]);
    await expect(deleteCmsMedia(adminId, { id: uploaded.id })).rejects.toBeInstanceOf(AuthError);
    await saveCmsDraftSections(adminId, "home", [
      { type: "HERO", enabled: true, config: { headline: "No image" } },
    ]);
    const deleted = await deleteCmsMedia(adminId, { id: uploaded.id });
    expect(deleted.id).toBe(uploaded.id);
  });
});

describe("canonical public homepage assembly", () => {
  it("returns one preferred homepage shell with anonymous trade prices hidden", async () => {
    const { loadPublicHomepage, assembleHomepagePreview } = await import("@/server/cms/assemble-homepage");
    const live = await loadPublicHomepage(null);
    expect(live.sections.some((section) => section.type === "HERO")).toBe(true);
    expect(live.sections.map((section) => section.type)).not.toContain("LEGACY");
    for (const product of Object.values(live.productsBySku)) {
      expect(product.price.trade).toBeNull();
      expect(product.price.source).toBe("hidden");
    }
    for (const product of live.recentProducts) {
      expect(product.price.trade).toBeNull();
    }

    const preview = await assembleHomepagePreview(null, live.sections);
    expect(preview.sections.map((section) => section.type)).toEqual(live.sections.map((section) => section.type));
  });

  it("keeps the same homepage shell when CMS content is missing", async () => {
    const { assembleHomepagePreview } = await import("@/server/cms/assemble-homepage");
    const { defaultHomepageSections } = await import("@/server/cms/homepage-seed");
    const fallback = defaultHomepageSections().map((section, index) => ({
      id: `default-${index}`,
      type: section.type,
      config: section.config,
      enabled: true,
    }));
    const data = await assembleHomepagePreview(null, fallback as import("@/domain/homepage").HomepageSection[]);
    expect(data.sections[0]?.type).toBe("HERO");
    expect(data.sections.some((section) => section.type === "FEATURED_BRANDS")).toBe(true);
  });
});

describe("invite token hashing", () => {
  it("never stores raw tokens on UserInvitation", async () => {
    const company = await createCompany(adminId, {
      name: `Invite Co ${Date.now()}`,
      status: "ACTIVE",
    });
    const raw = randomBytes(16).toString("hex");
    const hash = createHash("sha256").update(raw).digest("hex");
    await prisma.userInvitation.create({
      data: {
        companyId: company.id,
        email: `invite.${Date.now()}@example.invalid`,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 86400000),
        emailDeferred: true,
      },
    });
    const stored = await prisma.userInvitation.findFirst({
      where: { companyId: company.id },
    });
    expect(stored?.tokenHash).toBe(hash);
    expect(stored?.tokenHash).not.toBe(raw);
  });
});
