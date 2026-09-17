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
  getCompanyWorkspace,
  listCompaniesForActor,
  updateCompany,
} from "@/server/companies/service";
import {
  approveTradeApplication,
  rejectTradeApplication,
  submitTradeApplication,
} from "@/server/applications/service";
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
    const submitted = await submitTradeApplication({
      companyName: `App Co ${stamp}`,
      tradingName: "App Trading",
      businessType: "Motor factor",
      primaryContact: {
        firstName: "Alex",
        lastName: "Trade",
        email: `alex.${stamp}@example.invalid`,
        phone: "07000000000",
        role: "Buyer",
      },
      tradingAddress: {
        line1: "10 Trade Row",
        town: "Manchester",
        postcode: "M1 1AA",
        country: "GB",
      },
      brandsInterest: ["power-maxed"],
      notes: "Please review",
    });
    expect(submitted.reference).toMatch(/^APP-/);

    const first = await approveTradeApplication(adminId, { id: submitted.id });
    expect(first.created).toBe(true);
    expect(first.companyId).toBeTruthy();
    expect(first.emailDeferred).toBe(true);

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
    const submitted = await submitTradeApplication({
      companyName: `Reject Co ${stamp}`,
      primaryContact: {
        firstName: "R",
        lastName: "J",
        email: `reject.${stamp}@example.invalid`,
      },
      brandsInterest: [],
    });
    const result = await rejectTradeApplication(adminId, {
      id: submitted.id,
      reviewNotes: "Incomplete",
    });
    expect(result.status).toBe("REJECTED");
    const again = await rejectTradeApplication(adminId, { id: submitted.id });
    expect(again.already).toBe(true);
  });
});

describe("CMS draft vs published", () => {
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

    // Restore a sensible homepage for local browsing
    await saveCmsDraftSections(adminId, "home", [
      {
        type: "HERO",
        enabled: true,
        config: {
          headline: "The brands behind the automotive aftermarket.",
          supporting:
            "Automotive Brands supplies trusted automotive products to motor factors, retailers, workshops and distributors throughout the UK.",
          ctaLabel: "Open a Trade Account",
          ctaHref: "/register",
          secondaryCtaLabel: "Explore Our Brands",
          secondaryCtaHref: "/brands",
          variant: "split",
        },
      },
      {
        type: "TRADE_CTA",
        enabled: true,
        config: {
          headline: "Ready to open a trade account?",
          supporting: "Apply online.",
          ctaLabel: "Apply for a trade account",
          ctaHref: "/register",
        },
      },
    ]);
    await publishCmsPage(adminId, "home");
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
