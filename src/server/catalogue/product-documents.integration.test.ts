/**
 * Product Documents / SDS — upload, replace, public access, bulk match preview.
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
  previewBulkSdsImport,
  searchProductsForDocumentAttach,
  uploadProductDocument,
} from "@/server/catalogue/product-documents";
import { getPublicProduct, listCataloguePage } from "@/server/catalogue/products";
import { sha256Hex } from "@/domain/product-documents";
import { prisma as appPrisma } from "@/infra/database/client";

const prisma = new PrismaClient();
const stamp = Date.now();
const PDF_A = Buffer.from("%PDF-1.4\n% product-doc-a\ntrailer\n%%EOF\n", "utf8");
const PDF_B = Buffer.from("%PDF-1.4\n% product-doc-b-replacement\ntrailer\n%%EOF\n", "utf8");

let adminId = "";
let tradeUserId = "";
let salesRepId = "";
let productId = "";
let productSlug = "";
let productSku = "";
let hiddenProductId = "";
let extraProductId = "";
let extraSku = "";
let hyphenProductId = "";
let hyphenSku = "";
let nameProductId = "";
let nameProductName = "";
const extraCleanupIds: string[] = [];

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

beforeAll(async () => {
  await bootstrapRbac(prisma);
  adminId = await ensureUser(`pd.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  tradeUserId = await ensureUser(`pd.trade.${stamp}@example.invalid`, [], "TRADE");
  salesRepId = await ensureUser(`pd.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);

  const brand = await prisma.brand.create({
    data: {
      name: `PD Brand ${stamp}`,
      slug: `pd-brand-${stamp}`,
      isActive: true,
    },
  });
  const product = await prisma.product.create({
    data: {
      name: `All Purpose Cleaner ${stamp}`,
      slug: `pd-apc-${stamp}`,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
      brandId: brand.id,
      variants: {
        create: {
          sku: `PMAPC${String(stamp).slice(-6)}`,
          isDefault: true,
          isActive: true,
          tradePrice: 9.99,
        },
      },
    },
    include: { variants: true },
  });
  productId = product.id;
  productSlug = product.slug;
  productSku = product.variants[0]!.sku;

  const hidden = await prisma.product.create({
    data: {
      name: `Hidden Cleaner ${stamp}`,
      slug: `pd-hidden-${stamp}`,
      status: "DRAFT",
      isActive: false,
      isTradeVisible: false,
      brandId: brand.id,
      variants: {
        create: {
          sku: `HID${String(stamp).slice(-6)}`,
          isDefault: true,
          isActive: true,
        },
      },
    },
  });
  hiddenProductId = hidden.id;

  extraSku = `EXTR${String(stamp).slice(-6)}`;
  const extra = await prisma.product.create({
    data: {
      name: `Extra Bulk Cleaner ${stamp}`,
      slug: `pd-extra-${stamp}`,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
      brandId: brand.id,
      variants: {
        create: { sku: extraSku, isDefault: true, isActive: true, tradePrice: 3.5 },
      },
    },
  });
  extraProductId = extra.id;

  hyphenSku = `PM-HX-${String(stamp).slice(-4)}`;
  const hyphen = await prisma.product.create({
    data: {
      name: `Hyphen SKU Cleaner ${stamp}`,
      slug: `pd-hyphen-${stamp}`,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
      brandId: brand.id,
      variants: {
        create: { sku: hyphenSku, isDefault: true, isActive: true, tradePrice: 4.5 },
      },
    },
  });
  hyphenProductId = hyphen.id;

  nameProductName = `Unique Ultrasonic Degreaser ${stamp}`;
  const named = await prisma.product.create({
    data: {
      name: nameProductName,
      slug: `pd-named-${stamp}`,
      status: "ACTIVE",
      isActive: true,
      isTradeVisible: true,
      brandId: brand.id,
      variants: {
        create: {
          sku: `NM${String(stamp).slice(-6)}`,
          isDefault: true,
          isActive: true,
          tradePrice: 5.5,
        },
      },
    },
  });
  nameProductId = named.id;
  extraCleanupIds.push(extraProductId, hyphenProductId, nameProductId);
});

afterAll(async () => {
  const ids = [productId, hiddenProductId, ...extraCleanupIds].filter(Boolean);
  await prisma.productDocument.deleteMany({
    where: { productId: { in: ids } },
  });
  await prisma.product.deleteMany({
    where: { id: { in: ids } },
  });
  await prisma.brand.deleteMany({ where: { slug: `pd-brand-${stamp}` } });
  await prisma.$disconnect();
});

describe("product documents SDS", () => {
  it("rejects non-PDF and trade admin access", async () => {
    await expect(
      uploadProductDocument(adminId, {
        productId,
        type: "SAFETY_DATA_SHEET",
        filename: "x.pdf",
        contentType: "application/pdf",
        base64: b64(Buffer.from("not-pdf")),
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      uploadProductDocument(tradeUserId, {
        productId,
        type: "SAFETY_DATA_SHEET",
        filename: "ok.pdf",
        contentType: "application/pdf",
        base64: b64(PDF_A),
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("attaches SDS, exposes publicly, replaces safely, archives from public", async () => {
    const uploaded = await uploadProductDocument(adminId, {
      productId,
      type: "SAFETY_DATA_SHEET",
      filename: `${productSku} SDS 2025.pdf`,
      contentType: "application/pdf",
      base64: b64(PDF_A),
      revision: "2025",
    });
    expect(uploaded.status).toBe("CURRENT");
    expect(uploaded.checksumSha256).toBe(sha256Hex(PDF_A));

    const publicDocs = await listPublicProductDocuments(productId);
    expect(publicDocs.some((d) => d.id === uploaded.id)).toBe(true);
    expect(publicDocs[0]).not.toHaveProperty("notes");
    expect(publicDocs[0]).not.toHaveProperty("storageKey");
    expect(publicDocs[0]).not.toHaveProperty("uploadedById");

    const pub = await getPublicProduct(null, productSlug);
    expect(pub?.documents?.length).toBeGreaterThan(0);

    const bytes = await getProductDocumentBytes(uploaded.id, { actorUserId: null });
    expect(bytes?.bytes.equals(PDF_A)).toBe(true);

    const replaced = await uploadProductDocument(adminId, {
      productId,
      type: "SAFETY_DATA_SHEET",
      filename: `${productSku} SDS 2026.pdf`,
      contentType: "application/pdf",
      base64: b64(PDF_B),
      replaceExisting: true,
    });
    expect(replaced.status).toBe("CURRENT");
    expect(replaced.replacesDocumentId).toBe(uploaded.id);

    const afterReplace = await listPublicProductDocuments(productId);
    expect(afterReplace.map((d) => d.id)).toEqual([replaced.id]);

    const archivedBytesPublic = await getProductDocumentBytes(uploaded.id, {
      actorUserId: null,
    });
    expect(archivedBytesPublic).toBeNull();

    const archivedBytesStaff = await getProductDocumentBytes(uploaded.id, {
      actorUserId: adminId,
    });
    expect(archivedBytesStaff?.bytes.equals(PDF_A)).toBe(true);

    await archiveProductDocument(adminId, replaced.id);
    expect((await listPublicProductDocuments(productId)).length).toBe(0);
    const emptyPub = await getPublicProduct(null, productSlug);
    expect(emptyPub?.documents?.length ?? 0).toBe(0);
  });

  it("does not allow public download for hidden product documents", async () => {
    const doc = await uploadProductDocument(adminId, {
      productId: hiddenProductId,
      type: "SAFETY_DATA_SHEET",
      filename: "hidden-sds.pdf",
      contentType: "application/pdf",
      base64: b64(PDF_A),
    });
    const anon = await getProductDocumentBytes(doc.id, { actorUserId: null });
    expect(anon).toBeNull();
    const staff = await getProductDocumentBytes(doc.id, { actorUserId: adminId });
    expect(staff?.bytes.equals(PDF_A)).toBe(true);
  });

  it("supports other document types and catalogue SDS filter", async () => {
    const tds = await uploadProductDocument(adminId, {
      productId,
      type: "TECHNICAL_DATA_SHEET",
      filename: `${productSku}-tds.pdf`,
      contentType: "application/pdf",
      base64: b64(PDF_B),
      title: "TDS",
    });
    expect(tds.type).toBe("TECHNICAL_DATA_SHEET");

    const sds = await uploadProductDocument(adminId, {
      productId,
      type: "SAFETY_DATA_SHEET",
      filename: `${productSku}-again.pdf`,
      contentType: "application/pdf",
      base64: b64(PDF_A),
    });
    void sds;

    const attached = await listCataloguePage(adminId, { sds: "attached", q: productSku });
    expect(attached.items.some((p) => p.id === productId && p.hasSds)).toBe(true);

    const missing = await listCataloguePage(adminId, { sds: "missing", q: `Hidden ${stamp}` });
    // Hidden product has SDS from previous test — should not appear as missing
    expect(missing.items.some((p) => p.id === hiddenProductId)).toBe(false);
  });

  it("bulk preview matches SKU, requires replace for existing, detects duplicates", async () => {
    const preview = await previewBulkSdsImport(adminId, {
      files: [
        {
          clientKey: "1",
          filename: `${productSku} SDS.pdf`,
          contentType: "application/pdf",
          base64: b64(PDF_A),
        },
        {
          clientKey: "2",
          filename: "Totally Unknown Widget SDS.pdf",
          contentType: "application/pdf",
          base64: b64(PDF_B),
        },
        {
          clientKey: "3",
          filename: "bad.exe",
          contentType: "application/octet-stream",
          base64: b64(Buffer.from("MZ")),
        },
      ],
    });
    const matched = preview.items.find((i) => i.clientKey === "1");
    expect(matched?.status === "ALREADY_ATTACHED" || matched?.status === "EXISTING_SDS").toBe(
      true,
    );
    expect(preview.items.find((i) => i.clientKey === "2")?.status).toBe("NO_MATCH");
    expect(preview.items.find((i) => i.clientKey === "3")?.status).toBe("INVALID");

    const confirm = await confirmBulkSdsImport(adminId, {
      items: [
        {
          clientKey: "skip-dup",
          filename: `${productSku} SDS.pdf`,
          base64: b64(PDF_A),
          contentType: "application/pdf",
          productId,
          action: "SKIP",
        },
      ],
    });
    expect(confirm.skipped).toBe(1);
  });

  it("failed replacement without replaceExisting leaves current SDS", async () => {
    const current = await prisma.productDocument.findFirst({
      where: { productId, type: "SAFETY_DATA_SHEET", status: "CURRENT" },
    });
    expect(current).toBeTruthy();
    await expect(
      uploadProductDocument(adminId, {
        productId,
        type: "SAFETY_DATA_SHEET",
        filename: "another.pdf",
        contentType: "application/pdf",
        base64: b64(PDF_B),
        replaceExisting: false,
      }),
    ).rejects.toBeInstanceOf(AuthError);
    const still = await prisma.productDocument.findFirst({
      where: { productId, type: "SAFETY_DATA_SHEET", status: "CURRENT" },
    });
    expect(still?.id).toBe(current!.id);
  });
});

function pdfMarker(tag: string) {
  return Buffer.from(`%PDF-1.4\n% ${tag}\ntrailer\n%%EOF\n`, "utf8");
}

describe("manual bulk SDS workflow", () => {
  it("denies trade and unauthorised staff; allows admin", async () => {
    const file = {
      clientKey: "deny",
      filename: `${extraSku} SDS.pdf`,
      contentType: "application/pdf",
      base64: b64(pdfMarker("deny")),
    };
    await expect(previewBulkSdsImport(tradeUserId, { files: [file] })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(previewBulkSdsImport(salesRepId, { files: [file] })).rejects.toBeInstanceOf(
      AuthError,
    );
    await expect(
      confirmBulkSdsImport(tradeUserId, {
        items: [{ clientKey: "deny", filename: file.filename, action: "SKIP" }],
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const allowed = await previewBulkSdsImport(adminId, { files: [file] });
    expect(allowed.items).toHaveLength(1);
    expect(allowed.maxFiles).toBe(100);
  });

  it("matches exact SKU, normalised SKU, product name, review and no match", async () => {
    const preview = await previewBulkSdsImport(adminId, {
      files: [
        {
          clientKey: "exact",
          filename: `${extraSku} Safety Data Sheet.pdf`,
          contentType: "application/pdf",
          base64: b64(pdfMarker("exact")),
        },
        {
          clientKey: "norm",
          filename: `${hyphenSku.replace(/-/g, "")} SDS.pdf`,
          contentType: "application/pdf",
          base64: b64(pdfMarker("norm")),
        },
        {
          clientKey: "name",
          filename: `${nameProductName} SDS.pdf`,
          contentType: "application/pdf",
          base64: b64(pdfMarker("name")),
        },
        {
          clientKey: "none",
          filename: "Completely Unknown Widget SDS.pdf",
          contentType: "application/pdf",
          base64: b64(pdfMarker("none")),
        },
      ],
    });
    const exact = preview.items.find((i) => i.clientKey === "exact");
    expect(exact?.status).toBe("MATCHED");
    expect(exact?.matchMethod).toBe("EXACT_SKU");
    expect(exact?.productId).toBe(extraProductId);
    expect(exact?.brandName).toBeTruthy();

    const norm = preview.items.find((i) => i.clientKey === "norm");
    expect(norm?.status).toBe("MATCHED");
    expect(norm?.matchMethod).toBe("NORMALISED_SKU");
    expect(norm?.productId).toBe(hyphenProductId);

    const named = preview.items.find((i) => i.clientKey === "name");
    expect(named?.status).toBe("MATCHED");
    expect(named?.matchMethod).toBe("PRODUCT_NAME");
    expect(named?.productId).toBe(nameProductId);

    expect(preview.items.find((i) => i.clientKey === "none")?.status).toBe("NO_MATCH");
  });

  it("does not query products per file when matching a 30-file batch", async () => {
    const files = Array.from({ length: 30 }, (_, i) => ({
      clientKey: `b${i}`,
      filename: i === 0 ? `${extraSku} SDS.pdf` : `UnknownBatch${i} SDS.pdf`,
      contentType: "application/pdf",
      base64: b64(pdfMarker(`batch-${i}`)),
    }));
    const findUnique = vi.spyOn(appPrisma.product, "findUnique");
    const variantFind = vi.spyOn(appPrisma.productVariant, "findMany");
    try {
      const preview = await previewBulkSdsImport(adminId, { files });
      expect(preview.items).toHaveLength(30);
      expect(preview.items[0]?.status).toBe("MATCHED");
      expect(preview.items.filter((i) => i.status === "NO_MATCH").length).toBe(29);
      expect(findUnique).not.toHaveBeenCalled();
      expect(variantFind.mock.calls.length).toBeLessThanOrEqual(2);
    } finally {
      findUnique.mockRestore();
      variantFind.mockRestore();
    }
  }, 60_000);

  it("imports ready rows, skips unresolved/skipped, reports partial failure", async () => {
    const readyPdf = pdfMarker("ready-import");
    const skipPdf = pdfMarker("skip-me");
    const failPdf = pdfMarker("fail-missing-product");
    const result = await confirmBulkSdsImport(adminId, {
      items: [
        {
          clientKey: "ready",
          filename: `${extraSku} SDS.pdf`,
          contentType: "application/pdf",
          base64: b64(readyPdf),
          productId: extraProductId,
          action: "IMPORT",
        },
        {
          clientKey: "skipped",
          filename: "unmatched SDS.pdf",
          contentType: "application/pdf",
          base64: b64(skipPdf),
          action: "SKIP",
        },
        {
          clientKey: "unresolved",
          filename: "needs-review SDS.pdf",
          contentType: "application/pdf",
          base64: b64(pdfMarker("unresolved")),
          action: "IMPORT",
        },
        {
          clientKey: "failed",
          filename: "missing-product SDS.pdf",
          contentType: "application/pdf",
          base64: b64(failPdf),
          productId: "pd_missing_product_id",
          action: "IMPORT",
        },
      ],
    });
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(2);
    expect(result.results.find((r) => r.clientKey === "ready")?.status).toBe("IMPORTED");
    expect(result.results.find((r) => r.clientKey === "skipped")?.status).toBe("SKIPPED");
    expect(result.results.find((r) => r.clientKey === "unresolved")?.status).toBe("FAILED");
    expect(result.results.find((r) => r.clientKey === "failed")?.message).toMatch(
      /not found|failed/i,
    );

    const extraDocs = await prisma.productDocument.findMany({
      where: { productId: extraProductId, type: "SAFETY_DATA_SHEET" },
    });
    expect(extraDocs).toHaveLength(1);
    expect(extraDocs[0]?.status).toBe("CURRENT");
    expect(extraDocs[0]?.sourceMetadata).toMatchObject({ source: "MANUAL_UPLOAD" });

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "catalogue.bulk_document_import", actorUserId: adminId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.metadata).toMatchObject({
      filesSelected: 4,
      created: 1,
      replaced: 0,
      skipped: 1,
      failed: 2,
      source: "MANUAL_UPLOAD",
    });

    const pub = await listPublicProductDocuments(extraProductId);
    expect(pub).toHaveLength(1);
    expect(pub[0]?.id).toBe(extraDocs[0]?.id);
  });

  it("detects existing SDS, replaces/archives, and keeps archived off public current", async () => {
    const current = await prisma.productDocument.findFirstOrThrow({
      where: { productId: extraProductId, type: "SAFETY_DATA_SHEET", status: "CURRENT" },
    });
    const replacement = pdfMarker("replacement-sds");
    const preview = await previewBulkSdsImport(adminId, {
      files: [
        {
          clientKey: "rep",
          filename: `${extraSku} SDS.pdf`,
          contentType: "application/pdf",
          base64: b64(replacement),
        },
      ],
    });
    expect(preview.items[0]?.status).toBe("EXISTING_SDS");
    expect(preview.items[0]?.existingSds?.id).toBe(current.id);
    expect(preview.items[0]?.existingSds?.filename).toBeTruthy();

    const confirm = await confirmBulkSdsImport(adminId, {
      items: [
        {
          clientKey: "rep",
          filename: `${extraSku} SDS.pdf`,
          contentType: "application/pdf",
          base64: b64(replacement),
          productId: extraProductId,
          action: "REPLACE",
        },
      ],
    });
    expect(confirm.replaced).toBe(1);
    const after = await listProductDocumentsAdmin(adminId, extraProductId);
    expect(after.currentSds?.id).toBe(confirm.results[0]?.documentId);
    expect(after.archived.some((d) => d.id === current.id)).toBe(true);
    const pub = await listPublicProductDocuments(extraProductId);
    expect(pub.map((d) => d.id)).toEqual([after.currentSds?.id]);
    const archivedPublic = await getProductDocumentBytes(current.id, { actorUserId: null });
    expect(archivedPublic).toBeNull();
  });

  it("skips exact checksum duplicates on the same product and does not steal another product's checksum", async () => {
    const current = await prisma.productDocument.findFirstOrThrow({
      where: { productId: extraProductId, type: "SAFETY_DATA_SHEET", status: "CURRENT" },
    });
    const bytes = await getProductDocumentBytes(current.id, { actorUserId: adminId });
    expect(bytes).toBeTruthy();
    const preview = await previewBulkSdsImport(adminId, {
      files: [
        {
          clientKey: "dup",
          filename: `${extraSku} SDS.pdf`,
          contentType: "application/pdf",
          base64: b64(bytes!.bytes),
        },
      ],
    });
    expect(preview.items[0]?.status).toBe("ALREADY_ATTACHED");

    const skipDup = await confirmBulkSdsImport(adminId, {
      items: [
        {
          clientKey: "dup",
          filename: `${extraSku} SDS.pdf`,
          contentType: "application/pdf",
          base64: b64(bytes!.bytes),
          productId: extraProductId,
          action: "IMPORT",
        },
      ],
    });
    expect(skipDup.duplicates).toBe(1);
    expect(skipDup.imported).toBe(0);

    const elsewhere = await confirmBulkSdsImport(adminId, {
      items: [
        {
          clientKey: "else",
          filename: `${hyphenSku.replace(/-/g, "")} SDS.pdf`,
          contentType: "application/pdf",
          base64: b64(bytes!.bytes),
          productId: hyphenProductId,
          action: "IMPORT",
        },
      ],
    });
    expect(elsewhere.imported).toBe(1);
    const hyphenDoc = await prisma.productDocument.findFirst({
      where: { productId: hyphenProductId, type: "SAFETY_DATA_SHEET", status: "CURRENT" },
    });
    expect(hyphenDoc?.id).toBe(elsewhere.results[0]?.documentId);
    expect(hyphenDoc?.productId).toBe(hyphenProductId);
  });

  it("supports manual product selection via search and still serves the product Documents tab", async () => {
    const hits = await searchProductsForDocumentAttach(adminId, extraSku, 8);
    expect(hits.some((h) => h.productId === extraProductId)).toBe(true);
    expect(hits.find((h) => h.productId === extraProductId)?.existingSds).toBeTruthy();

    const orphan = pdfMarker("manual-select");
    const confirm = await confirmBulkSdsImport(adminId, {
      items: [
        {
          clientKey: "manual",
          filename: "orphan-manual SDS.pdf",
          contentType: "application/pdf",
          base64: b64(orphan),
          productId: nameProductId,
          action: "IMPORT",
        },
      ],
    });
    expect(confirm.imported).toBe(1);
    const tab = await listProductDocumentsAdmin(adminId, nameProductId);
    expect(tab.currentSds?.id).toBe(confirm.results[0]?.documentId);
  });

  it("rejects non-PDF, fake PDF and oversized files on upload", async () => {
    await expect(
      uploadProductDocument(adminId, {
        productId: extraProductId,
        type: "SAFETY_DATA_SHEET",
        filename: "notes.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        base64: b64(pdfMarker("docx")),
        replaceExisting: true,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    await expect(
      uploadProductDocument(adminId, {
        productId: extraProductId,
        type: "SAFETY_DATA_SHEET",
        filename: "fake.pdf",
        contentType: "application/pdf",
        base64: b64(Buffer.from("not-a-pdf")),
        replaceExisting: true,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const oversized = Buffer.alloc(20 * 1024 * 1024 + 8, 0);
    oversized.set(Buffer.from("%PDF-1.4"), 0);
    await expect(
      uploadProductDocument(adminId, {
        productId: extraProductId,
        type: "SAFETY_DATA_SHEET",
        filename: "huge.pdf",
        contentType: "application/pdf",
        base64: b64(oversized),
        replaceExisting: true,
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

