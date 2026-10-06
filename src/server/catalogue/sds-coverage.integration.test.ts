/**
 * SDS coverage — product-level missing / current / archived-only / not-required.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  archiveProductDocument,
  confirmBulkSdsImport,
  getProductDocumentBytes,
  listProductDocumentsAdmin,
  listPublicProductDocuments,
  uploadProductDocument,
} from "@/server/catalogue/product-documents";
import {
  exportSdsCoverageCsv,
  getSdsCoverageSummary,
  listSdsCoveragePage,
  setProductSdsRequirement,
} from "@/server/catalogue/sds-coverage";
import { getPublicProduct, listCataloguePage } from "@/server/catalogue/products";
import { prisma as appPrisma } from "@/infra/database/client";

const prisma = new PrismaClient();
const stamp = Date.now();
const PDF_A = Buffer.from("%PDF-1.4\n% cov-a\ntrailer\n%%EOF\n", "utf8");
const PDF_B = Buffer.from("%PDF-1.4\n% cov-b-replace\ntrailer\n%%EOF\n", "utf8");

let adminId = "";
let tradeUserId = "";
let salesRepId = "";
let brandId = "";
let currentProductId = "";
let currentSku = "";
let missingProductId = "";
let missingSku = "";
let archivedProductId = "";
let notRequiredProductId = "";
let variantShareProductId = "";
let inactiveProductId = "";
let historicProductId = "";

const extraIds: string[] = [];

async function ensureUser(
  email: string,
  roles: string[],
  actorType: "INTERNAL" | "TRADE" = "INTERNAL",
) {
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
  } else if (user.actorType !== actorType) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { actorType },
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

function b64(buf: Buffer) {
  return buf.toString("base64");
}

async function createActiveProduct(name: string, sku: string, extra?: { mpn?: string; variants?: number }) {
  const product = await prisma.product.create({
    data: {
      name,
      slug: `sds-cov-${sku.toLowerCase()}-${stamp}`,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
      brandId,
      variants: {
        create: [
          {
            sku,
            mpn: extra?.mpn ?? null,
            isDefault: true,
            isActive: true,
            tradePrice: 4.5,
          },
          ...(extra?.variants === 2
            ? [
                {
                  sku: `${sku}-B`,
                  isDefault: false,
                  isActive: true,
                  tradePrice: 7.5,
                },
              ]
            : []),
        ],
      },
    },
  });
  extraIds.push(product.id);
  return product.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`sds.cov.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  tradeUserId = await ensureUser(`sds.cov.trade.${stamp}@example.invalid`, [], "TRADE");
  salesRepId = await ensureUser(`sds.cov.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);

  const brand = await prisma.brand.create({
    data: {
      name: `SDS Cov Brand ${stamp}`,
      slug: `sds-cov-brand-${stamp}`,
      isActive: true,
    },
  });
  brandId = brand.id;

  currentSku = `CVCUR${String(stamp).slice(-6)}`;
  currentProductId = await createActiveProduct(`Coverage Current ${stamp}`, currentSku);
  await uploadProductDocument(adminId, {
    productId: currentProductId,
    type: "SAFETY_DATA_SHEET",
    filename: `${currentSku} SDS.pdf`,
    contentType: "application/pdf",
    base64: b64(PDF_A),
    revision: "2.0",
  });

  missingSku = `CVMIS${String(stamp).slice(-6)}`;
  missingProductId = await createActiveProduct(`Coverage Missing ${stamp}`, missingSku, {
    mpn: `MPN-${missingSku}`,
  });

  archivedProductId = await createActiveProduct(
    `Coverage Archived ${stamp}`,
    `CVARC${String(stamp).slice(-6)}`,
  );
  const archivedDoc = await uploadProductDocument(adminId, {
    productId: archivedProductId,
    type: "SAFETY_DATA_SHEET",
    filename: "old-sds.pdf",
    contentType: "application/pdf",
    base64: b64(PDF_A),
  });
  await archiveProductDocument(adminId, archivedDoc.id);

  notRequiredProductId = await createActiveProduct(
    `Coverage Accessory ${stamp}`,
    `CVNRQ${String(stamp).slice(-6)}`,
  );
  await setProductSdsRequirement(adminId, {
    productIds: [notRequiredProductId],
    requirement: "NOT_REQUIRED",
    reason: "Non-chemical accessory",
    confirm: true,
  });

  variantShareProductId = await createActiveProduct(
    `Coverage Shared SDS ${stamp}`,
    `CVSHR${String(stamp).slice(-6)}`,
    { variants: 2 },
  );
  await uploadProductDocument(adminId, {
    productId: variantShareProductId,
    type: "SAFETY_DATA_SHEET",
    filename: "shared-sds.pdf",
    contentType: "application/pdf",
    base64: b64(PDF_B),
  });

  const inactive = await prisma.product.create({
    data: {
      name: `Coverage Inactive ${stamp}`,
      slug: `sds-cov-inactive-${stamp}`,
      status: "INACTIVE",
      isActive: false,
      isTradeVisible: false,
      brandId,
      variants: { create: { sku: `CVINA${String(stamp).slice(-6)}`, isDefault: true, isActive: true } },
    },
  });
  inactiveProductId = inactive.id;
  extraIds.push(inactive.id);

  const historic = await prisma.product.create({
    data: {
      name: `Coverage Historic ${stamp}`,
      slug: `sds-cov-historic-${stamp}`,
      status: "DISCONTINUED",
      isActive: false,
      isTradeVisible: false,
      brandId,
      variants: { create: { sku: `CVHIS${String(stamp).slice(-6)}`, isDefault: true, isActive: true } },
    },
  });
  historicProductId = historic.id;
  extraIds.push(historic.id);
});

afterAll(async () => {
  await prisma.productDocument.deleteMany({ where: { productId: { in: extraIds } } });
  await prisma.product.deleteMany({ where: { id: { in: extraIds } } });
  if (brandId) await prisma.brand.deleteMany({ where: { id: brandId } });
  await prisma.$disconnect();
});

async function rowFor(productId: string, status?: "ALL" | "CURRENT" | "MISSING" | "ARCHIVED_ONLY" | "NOT_REQUIRED") {
  const page = await listSdsCoveragePage(adminId, {
    brandId,
    status: status ?? "ALL",
    population: "active",
    pageSize: 100,
  });
  return page.items.find((r) => r.productId === productId);
}

describe("SDS coverage classification", () => {
  it("1. active product + current SDS → Current", async () => {
    const row = await rowFor(currentProductId, "CURRENT");
    expect(row?.sdsStatus).toBe("CURRENT");
    expect(row?.currentSdsFilename).toBe(`${currentSku}_SDS.pdf`);
    expect(row?.currentSdsDetail).toContain("Revision 2.0");
  });

  it("2. active product + no SDS → Missing", async () => {
    expect((await rowFor(missingProductId, "MISSING"))?.sdsStatus).toBe("MISSING");
  });

  it("3. active product + archived SDS only → Archived only", async () => {
    const row = await rowFor(archivedProductId, "ARCHIVED_ONLY");
    expect(row?.sdsStatus).toBe("ARCHIVED_ONLY");
  });

  it("4. NOT_REQUIRED → Not required", async () => {
    expect((await rowFor(notRequiredProductId, "NOT_REQUIRED"))?.sdsStatus).toBe("NOT_REQUIRED");
  });

  it("5–7. Not Required counts as covered; archived-only and missing do not", async () => {
    const summary = await getSdsCoverageSummary(adminId);
    expect(summary.formula).toContain("Current SDS + Not Required");
    expect(summary.coveragePercent).toBe(
      summary.activeProducts
        ? Math.round(((summary.currentSds + summary.notRequired) / summary.activeProducts) * 1000) / 10
        : 0,
    );
    expect(summary.currentSds + summary.missingSds + summary.archivedOnly + summary.notRequired).toBe(
      summary.activeProducts,
    );
    const covered = summary.currentSds + summary.notRequired;
    const notCovered = summary.missingSds + summary.archivedOnly;
    expect(covered + notCovered).toBe(summary.activeProducts);
  });

  it("8. multiple variants sharing product SDS produce one product-level state", async () => {
    const page = await listSdsCoveragePage(adminId, {
      brandId,
      q: "Coverage Shared SDS",
      pageSize: 25,
    });
    const hits = page.items.filter((r) => r.productId === variantShareProductId);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.sdsStatus).toBe("CURRENT");
    expect(hits[0]?.sku).toMatch(/\+/);
  });

  it("9. inactive/archived product excluded from default active coverage", async () => {
    const active = await listSdsCoveragePage(adminId, { brandId, population: "active", pageSize: 100 });
    expect(active.items.some((r) => r.productId === inactiveProductId)).toBe(false);
    expect(active.items.some((r) => r.productId === historicProductId)).toBe(false);
    const inactive = await listSdsCoveragePage(adminId, { brandId, population: "inactive", pageSize: 100 });
    expect(inactive.items.some((r) => r.productId === inactiveProductId)).toBe(true);
  });

  it("10–11. external Autopart and historic-only Autopart products are excluded", async () => {
    const before = await getSdsCoverageSummary(adminId);
    const extSku = `CVEXT${String(stamp).slice(-6)}`;
    const histSku = `CVHAP${String(stamp).slice(-6)}`;
    await prisma.autopartProduct.create({
      data: {
        sku: extSku,
        matchKey: extSku,
        description: "External torch",
        presentInLatestFeed: true,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    await prisma.autopartProduct.create({
      data: {
        sku: histSku,
        matchKey: histSku,
        description: "Historic only",
        presentInLatestFeed: false,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    const after = await getSdsCoverageSummary(adminId);
    expect(after.activeProducts).toBe(before.activeProducts);
    await prisma.autopartProduct.deleteMany({ where: { matchKey: { in: [extSku, histSku] } } });
  });
});

describe("SDS requirement mutations", () => {
  it("12–13. mark Not Required stores reason and audits", async () => {
    const target = await createActiveProduct(`Coverage Mark NR ${stamp}`, `CVMNR${String(stamp).slice(-6)}`);
    const result = await setProductSdsRequirement(adminId, {
      productIds: [target],
      requirement: "NOT_REQUIRED",
      reason: "Manufacturer does not issue SDS",
      confirm: true,
    });
    expect(result.items[0]?.newStatus).toBe("NOT_REQUIRED");
    const row = await prisma.product.findUniqueOrThrow({ where: { id: target } });
    expect(row.sdsRequirement).toBe("NOT_REQUIRED");
    expect(row.sdsNotRequiredReason).toBe("Manufacturer does not issue SDS");
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "catalogue.sds_marked_not_required", entityId: target },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
    const meta = audit?.metadata as Record<string, unknown>;
    expect(meta["reason"]).toBe("Manufacturer does not issue SDS");
    expect(JSON.stringify(meta)).not.toMatch(/%PDF/);
  });

  it("14–15. restore Require SDS with no document → Missing", async () => {
    const target = await createActiveProduct(`Coverage Restore Missing ${stamp}`, `CVRMI${String(stamp).slice(-6)}`);
    await setProductSdsRequirement(adminId, {
      productIds: [target],
      requirement: "NOT_REQUIRED",
      confirm: true,
    });
    const restored = await setProductSdsRequirement(adminId, {
      productIds: [target],
      requirement: "REQUIRED",
      confirm: true,
    });
    expect(restored.items[0]?.newStatus).toBe("MISSING");
    expect((await rowFor(target, "MISSING"))?.sdsStatus).toBe("MISSING");
  });

  it("16. restore with archived document only → Archived only", async () => {
    const target = await createActiveProduct(`Coverage Restore Arch ${stamp}`, `CVRAR${String(stamp).slice(-6)}`);
    const doc = await uploadProductDocument(adminId, {
      productId: target,
      type: "SAFETY_DATA_SHEET",
      filename: "was-current.pdf",
      contentType: "application/pdf",
      base64: b64(PDF_A),
    });
    await archiveProductDocument(adminId, doc.id);
    await setProductSdsRequirement(adminId, {
      productIds: [target],
      requirement: "NOT_REQUIRED",
      confirm: true,
    });
    const restored = await setProductSdsRequirement(adminId, {
      productIds: [target],
      requirement: "REQUIRED",
      confirm: true,
    });
    expect(restored.items[0]?.newStatus).toBe("ARCHIVED_ONLY");
  });

  it("17. restore with current document → Current", async () => {
    const target = await createActiveProduct(`Coverage Restore Cur ${stamp}`, `CVRCU${String(stamp).slice(-6)}`);
    await uploadProductDocument(adminId, {
      productId: target,
      type: "SAFETY_DATA_SHEET",
      filename: "keep-current.pdf",
      contentType: "application/pdf",
      base64: b64(PDF_B),
    });
    await setProductSdsRequirement(adminId, {
      productIds: [target],
      requirement: "NOT_REQUIRED",
      confirm: true,
    });
    const restored = await setProductSdsRequirement(adminId, {
      productIds: [target],
      requirement: "REQUIRED",
      confirm: true,
    });
    expect(restored.items[0]?.newStatus).toBe("CURRENT");
  });

  it("18. current SDS replacement remains Current", async () => {
    await uploadProductDocument(adminId, {
      productId: currentProductId,
      type: "SAFETY_DATA_SHEET",
      filename: `${currentSku} SDS-rev.pdf`,
      contentType: "application/pdf",
      base64: b64(PDF_B),
      replaceExisting: true,
    });
    expect((await rowFor(currentProductId, "CURRENT"))?.sdsStatus).toBe("CURRENT");
    const admin = await listProductDocumentsAdmin(adminId, currentProductId);
    expect(admin.sdsCoverage.status).toBe("CURRENT");
  });

  it("19. archive current SDS → Archived only", async () => {
    const target = await createActiveProduct(`Coverage Archive Cur ${stamp}`, `CVACU${String(stamp).slice(-6)}`);
    const doc = await uploadProductDocument(adminId, {
      productId: target,
      type: "SAFETY_DATA_SHEET",
      filename: "to-archive.pdf",
      contentType: "application/pdf",
      base64: b64(PDF_A),
    });
    expect((await rowFor(target, "CURRENT"))?.sdsStatus).toBe("CURRENT");
    await archiveProductDocument(adminId, doc.id);
    expect((await rowFor(target, "ARCHIVED_ONLY"))?.sdsStatus).toBe("ARCHIVED_ONLY");
  });

  it("20. bulk SDS import updates coverage", async () => {
    const sku = `CVBLK${String(stamp).slice(-6)}`;
    const target = await createActiveProduct(`Coverage Bulk ${stamp}`, sku);
    expect((await rowFor(target, "MISSING"))?.sdsStatus).toBe("MISSING");
    await confirmBulkSdsImport(adminId, {
      items: [
        {
          clientKey: "bulk-cov",
          filename: `${sku} SDS.pdf`,
          contentType: "application/pdf",
          base64: b64(PDF_A),
          action: "IMPORT",
          productId: target,
        },
      ],
    });
    expect((await rowFor(target, "CURRENT"))?.sdsStatus).toBe("CURRENT");
  });
});

describe("SDS coverage filters, export, permissions, public", () => {
  it("21. brand filter", async () => {
    const page = await listSdsCoveragePage(adminId, { brandId, pageSize: 100 });
    expect(page.items.every((r) => r.brand.includes("SDS Cov Brand"))).toBe(true);
  });

  it("22. status filter", async () => {
    const missing = await listSdsCoveragePage(adminId, { brandId, status: "MISSING", pageSize: 100 });
    expect(missing.items.every((r) => r.sdsStatus === "MISSING")).toBe(true);
    expect(missing.items.some((r) => r.productId === missingProductId)).toBe(true);
  });

  it("23. product-name search", async () => {
    const page = await listSdsCoveragePage(adminId, { brandId, q: "Coverage Missing", pageSize: 25 });
    expect(page.items.some((r) => r.productId === missingProductId)).toBe(true);
  });

  it("24. SKU search", async () => {
    const page = await listSdsCoveragePage(adminId, { brandId, q: missingSku, pageSize: 25 });
    expect(page.items.some((r) => r.productId === missingProductId)).toBe(true);
  });

  it("25. CSV filtered export", async () => {
    const exported = await exportSdsCoverageCsv(adminId, { brandId, status: "MISSING" });
    expect(exported.csv.startsWith("\uFEFF")).toBe(true);
    expect(exported.csv).toContain("Product,Brand,SKU,MPN,SDS Status");
    expect(exported.csv).toContain(`Coverage Missing ${stamp}`);
    expect(exported.csv).toContain(missingSku);
    expect(exported.csv).toContain(`MPN-${missingSku}`);
    expect(exported.csv).toContain("Missing");
    const audit = await prisma.auditEvent.findFirst({
      where: { action: "catalogue.sds_coverage_exported", actorUserId: adminId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toBeTruthy();
  });

  it("26. unauthorised staff denied mutation", async () => {
    await expect(
      setProductSdsRequirement(salesRepId, {
        productIds: [missingProductId],
        requirement: "NOT_REQUIRED",
        confirm: true,
      }),
    ).rejects.toBeInstanceOf(AuthError);
    const listed = await listSdsCoveragePage(salesRepId, { brandId, q: missingSku });
    expect(listed.items.some((r) => r.productId === missingProductId)).toBe(true);
  });

  it("27. trade denied", async () => {
    await expect(getSdsCoverageSummary(tradeUserId)).rejects.toBeInstanceOf(AuthError);
    await expect(listSdsCoveragePage(tradeUserId, {})).rejects.toBeInstanceOf(AuthError);
    await expect(
      setProductSdsRequirement(tradeUserId, {
        productIds: [missingProductId],
        requirement: "NOT_REQUIRED",
        confirm: true,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("28. public denied", async () => {
    await expect(getSdsCoverageSummary("")).rejects.toBeInstanceOf(AuthError);
  });

  it("29–31. public SDS behaviour unchanged; Not Required reason not exposed", async () => {
    const pubCurrent = await listPublicProductDocuments(currentProductId);
    expect(pubCurrent.some((d) => d.type === "SAFETY_DATA_SHEET")).toBe(true);
    const pubArchived = await listPublicProductDocuments(archivedProductId);
    expect(pubArchived.some((d) => d.type === "SAFETY_DATA_SHEET")).toBe(false);
    const archivedBytes = await getProductDocumentBytes(
      (await prisma.productDocument.findFirstOrThrow({ where: { productId: archivedProductId } })).id,
      { actorUserId: null },
    );
    expect(archivedBytes).toBeNull();

    const publicProduct = await getPublicProduct(null, missingSku);
    const blob = JSON.stringify(publicProduct);
    expect(blob).not.toContain("Non-chemical accessory");
    expect(blob).not.toContain("NOT_REQUIRED");
    expect(blob).not.toContain("sdsNotRequiredReason");

    const nrProduct = await prisma.product.findUniqueOrThrow({
      where: { id: notRequiredProductId },
      include: { variants: true },
    });
    const nrPublic = await getPublicProduct(null, nrProduct.variants[0]!.sku);
    expect(JSON.stringify(nrPublic)).not.toContain("Non-chemical accessory");
    expect(nrPublic?.documents?.some((d) => d.type === "SAFETY_DATA_SHEET") ?? false).toBe(false);
  });

  it("32. no N+1 ProductDocument queries on the coverage table", async () => {
    const findUnique = vi.spyOn(appPrisma.productDocument, "findUnique");
    const findFirst = vi.spyOn(appPrisma.productDocument, "findFirst");
    await listSdsCoveragePage(adminId, { brandId, pageSize: 25 });
    expect(findUnique).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
    findUnique.mockRestore();
    findFirst.mockRestore();
  });

  it("catalogue list compact SDS status and product workspace coverage", async () => {
    const list = await listCataloguePage(adminId, { brandId, q: missingSku, pageSize: 25 });
    const item = list.items.find((p) => p.id === missingProductId);
    expect(item?.sdsStatus).toBe("MISSING");
    expect(item?.hasSds).toBe(false);
    const workspace = await listProductDocumentsAdmin(adminId, notRequiredProductId);
    expect(workspace.sdsCoverage.status).toBe("NOT_REQUIRED");
    expect(workspace.sdsCoverage.notRequiredReason).toBe("Non-chemical accessory");
  });
});
