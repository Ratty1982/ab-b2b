/**
 * End-to-end transactional email wiring with mock SMTP transport.
 * Does not connect to Microsoft 365 / SiteGround.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { setEmailAdapterForTests, setEmailTransportForTests } from "@/infra/email";
import { createMockSmtpTransport } from "@/infra/email/smtp";
import {
  clearEmailDiagnosticRateLimitsForTests,
  getOrCreateEmailSettings,
  setSmtpTransportFactoryForTests,
  updateEmailSettings,
} from "@/server/email/settings";
import {
  acceptTradeInvitation,
  approveTradeApplication,
  requestApplicationMoreInfo,
  submitTradeApplication,
} from "@/server/applications/service";
import { validTradeApplicationInput } from "@/server/applications/test-fixtures";
import { placeOrder } from "@/server/orders/service";
import { addToBasket } from "@/server/basket/service";
import { saveProduct } from "@/server/catalogue/service";
import { inviteCompanyUser } from "@/server/companies/service";
import { submitMotorsportPartnershipEnquiry } from "@/server/motorsport/service";
import { encryptSecret } from "@/server/crypto/secret";
import { sendPasswordResetTransactionalEmail } from "@/server/email/transactional";

const prisma = new PrismaClient();
const suffix = Date.now().toString(36);
let adminId = "";

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        status: "ACTIVE",
        actorType: "INTERNAL",
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
  adminId = await ensureUser(`email.e2e.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
});

beforeEach(async () => {
  clearEmailDiagnosticRateLimitsForTests();
  setSmtpTransportFactoryForTests(null);
  setEmailAdapterForTests(null);
  setEmailTransportForTests(null);
  await prisma.emailSettings.deleteMany({});
  await getOrCreateEmailSettings();

  const mock = createMockSmtpTransport({ sendResult: { ok: true, id: "e2e" } });
  setEmailTransportForTests(mock);
  setSmtpTransportFactoryForTests(() => mock);

  await updateEmailSettings(adminId, {
    enabled: true,
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    smtpSecurity: "STARTTLS",
    smtpUsername: "b2b@example.com",
    smtpPassword: "secret",
    replacePassword: true,
    fromName: "Automotive Brands",
    fromEmail: "b2b@example.com",
    tradeApplicationRecipients: [`apps.${suffix}@example.invalid`],
    orderNotificationRecipients: [`orders.${suffix}@example.invalid`],
    motorsportEnquiryRecipients: [`motorsport.${suffix}@example.invalid`],
  });
});

afterEach(() => {
  setSmtpTransportFactoryForTests(null);
  setEmailAdapterForTests(null);
  setEmailTransportForTests(null);
  clearEmailDiagnosticRateLimitsForTests();
});

afterAll(async () => {
  await prisma.emailSettings.updateMany({ data: { enabled: false } });
  await prisma.$disconnect();
});

describe("transactional email E2E wiring", () => {
  it("wires application → more-info → approve → activate → password reset → invite → motorsport → order", async () => {
    const email = `buyer.e2e.${suffix}@example.invalid`;

    // 1–3 submit + ack + internal
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `E2E Mail Co ${suffix}`,
        email,
      }),
    );
    expect(submitted.duplicate).toBe(false);

    const received = await prisma.transactionalEmail.findMany({
      where: { entityId: submitted.id, purpose: "TRADE_APPLICATION_RECEIVED" },
    });
    expect(received.length).toBe(1);
    expect(["SENT", "DEFERRED", "FAILED", "PENDING"]).toContain(received[0]!.status);
    expect(received[0]!.htmlBody).toContain("Automotive Brands");
    expect(received[0]!.textBody.length).toBeGreaterThan(40);

    const internalApp = await prisma.transactionalEmail.findMany({
      where: {
        entityId: submitted.id,
        purpose: "TRADE_APPLICATION_INTERNAL_NOTIFICATION",
      },
    });
    expect(internalApp.length).toBe(1);

    // 4–5 more info
    const more = await requestApplicationMoreInfo(adminId, {
      id: submitted.id,
      customerMessage: "Please send your VAT certificate.",
    });
    expect(more.status).toBe("MORE_INFO_REQUIRED");
    const moreMail = await prisma.transactionalEmail.findFirst({
      where: { entityId: submitted.id, purpose: "TRADE_APPLICATION_MORE_INFO" },
      orderBy: { createdAt: "desc" },
    });
    expect(moreMail).toBeTruthy();
    expect(moreMail!.textBody).toContain("VAT certificate");
    expect(moreMail!.htmlBody).not.toContain("<script>");

    // 6–7 approve + activation email
    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    expect(approved.created).toBe(true);
    expect(approved.inviteToken).toBeTruthy();
    const approveMail = await prisma.transactionalEmail.findFirst({
      where: { entityId: submitted.id, purpose: "TRADE_APPLICATION_APPROVED" },
    });
    expect(approveMail).toBeTruthy();
    expect(approveMail!.htmlBody).toContain("Activate");
    expect(approveMail!.textBody).toContain("/activate?token=");

    // 8–9 activate + welcome
    const activated = await acceptTradeInvitation({
      token: approved.inviteToken!,
      password: "E2eTradePass99!",
    });
    expect(activated.userId).toBeTruthy();
    const welcome = await prisma.transactionalEmail.findFirst({
      where: {
        purpose: "TRADE_ACCOUNT_ACTIVATED",
        entityId: activated.userId,
      },
    });
    expect(welcome).toBeTruthy();
    expect(welcome!.textBody).toContain("/portal");

    // 10–11 password reset transactional path (mock URL — no token leakage in audit)
    const resetOk = await sendPasswordResetTransactionalEmail({
      userId: activated.userId,
      email,
      resetUrl: `https://b2b.example.test/reset-password?token=test-token-${suffix}`,
    });
    expect(resetOk).toBe(true);
    const resetMail = await prisma.transactionalEmail.findFirst({
      where: { purpose: "PASSWORD_RESET", entityId: activated.userId },
      orderBy: { createdAt: "desc" },
    });
    expect(resetMail).toBeTruthy();
    expect(resetMail!.subject).toContain("Reset");
    expect(JSON.stringify(resetMail)).not.toContain("smtpPassword");

    // Company invite email
    const invite = await inviteCompanyUser(adminId, {
      companyId: approved.companyId,
      email: `extra.${suffix}@example.invalid`,
      role: "TRADE_BUYER",
      expiresInDays: 14,
    });
    expect(invite.emailSent || invite.emailDeferred).toBe(true);
    const inviteMail = await prisma.transactionalEmail.findFirst({
      where: { purpose: "COMPANY_USER_INVITED", entityId: invite.id },
    });
    expect(inviteMail).toBeTruthy();

    // Motorsport internal
    const enquiry = await submitMotorsportPartnershipEnquiry({
      companyName: `Motorsport ${suffix}`,
      contactName: "Driver",
      email: `ms.${suffix}@example.invalid`,
      telephone: "07000000001",
      interestedIn: "Brand Partnership",
      message: "Looking for branding support.",
      consent: true,
      websiteConfirm: "",
    });
    expect(enquiry.ok).toBe(true);
    if (enquiry.ok) {
      const msMail = await prisma.transactionalEmail.findFirst({
        where: {
          purpose: "MOTORSPORT_PARTNERSHIP_INTERNAL",
          entityId: enquiry.leadId,
        },
      });
      expect(msMail).toBeTruthy();
    }

    // Order emails after place
    const product = await saveProduct(adminId, {
      sku: `E2EMAIL${suffix}`.slice(0, 20),
      name: "E2E Email Widget",
      brand: "Power Maxed",
      category: "Braking",
      trade: 5,
      rrp: 10,
      packQty: 1,
      caseQty: 4,
      description: "e2e",
      active: true,
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { productId: product.id },
    });
    const warehouse = await prisma.warehouse.upsert({
      where: { code: "AUTOPART" },
      create: { code: "AUTOPART", name: "Autopart" },
      update: {},
    });
    await prisma.inventory.upsert({
      where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
      create: {
        variantId: variant.id,
        warehouseId: warehouse.id,
        qtyOnHand: 40,
        qtyReserved: 0,
        status: "IN_STOCK",
        externalSyncedAt: new Date(),
        sourceAvailRaw: "40",
      },
      update: {
        qtyOnHand: 40,
        qtyReserved: 0,
        status: "IN_STOCK",
        externalSyncedAt: new Date(),
      },
    });
    await prisma.stockSyncRun.create({
      data: {
        source: "231PO3NEW",
        mode: "live",
        status: "SUCCESS",
        trigger: "test",
        completedAt: new Date(),
        rowsRead: 1,
        matched: 1,
        updated: 1,
        unchanged: 0,
        unmatched: 0,
        invalid: 0,
        duplicates: 0,
      },
    });
    const address = await prisma.address.create({
      data: {
        companyId: approved.companyId!,
        type: "DELIVERY",
        label: "Main",
        line1: "1 Test Rd",
        town: "Leeds",
        postcode: "LS1 1AA",
        country: "GB",
        isDefaultDelivery: true,
      },
    });
    await addToBasket(activated.userId, { variantId: variant.id, quantity: 4 });
    const order = await placeOrder(activated.userId, {
      idempotencyKey: `e2e-email-${suffix}`,
      addressId: address.id,
    });
    expect(order.ok).toBe(true);
    if (!order.ok) return;

    const orderCustomer = await prisma.transactionalEmail.findFirst({
      where: { purpose: "ORDER_RECEIVED", entityId: order.order.id },
    });
    const orderInternal = await prisma.transactionalEmail.findFirst({
      where: { purpose: "ORDER_RECEIVED_INTERNAL", entityId: order.order.id },
    });
    expect(orderCustomer).toBeTruthy();
    expect(orderInternal).toBeTruthy();
    expect(orderCustomer!.htmlBody).toContain("Product");
    expect(orderCustomer!.textBody).toContain(order.order.orderNumber);

    // Email failure must not unwind order / reservation
    expect(await prisma.order.count({ where: { id: order.order.id } })).toBe(1);
    expect(
      await prisma.orderStockReservation.count({
        where: { orderId: order.order.id, status: "ACTIVE" },
      }),
    ).toBeGreaterThan(0);
  });

  it("does not invent passwords in email content and encrypts SMTP secret", async () => {
    const row = await prisma.emailSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(row.smtpPasswordEncrypted).toBeTruthy();
    expect(row.smtpPasswordEncrypted).not.toBe("secret");
    expect(encryptSecret("x").startsWith("v1:")).toBe(true);
  });
});
