/**
 * Product Documents / SDS — upload, replace, public access, bulk match preview.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  archiveProductDocument,
  confirmBulkSdsImport,
  getProductDocumentBytes,
  listPublicProductDocuments,
  previewBulkSdsImport,
  uploadProductDocument,
} from "@/server/catalogue/product-documents";
import { getPublicProduct, listCataloguePage } from "@/server/catalogue/products";
import { sha256Hex } from "@/domain/product-documents";

const prisma = new PrismaClient();
const stamp = Date.now();
const PDF_A = Buffer.from("%PDF-1.4\n% product-doc-a\ntrailer\n%%EOF\n", "utf8");
const PDF_B = Buffer.from("%PDF-1.4\n% product-doc-b-replacement\ntrailer\n%%EOF\n", "utf8");

let adminId = "";
let tradeUserId = "";
let productId = "";
let productSlug = "";
let productSku = "";
let hiddenProductId = "";

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
});

afterAll(async () => {
  await prisma.productDocument.deleteMany({
    where: { productId: { in: [productId, hiddenProductId] } },
  });
  await prisma.product.deleteMany({
    where: { id: { in: [productId, hiddenProductId] } },
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
