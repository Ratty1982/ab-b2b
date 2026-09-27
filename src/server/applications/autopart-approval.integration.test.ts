/**
 * Autopart account claim → approval verification → company link → order snapshot.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  approveTradeApplication,
  getTradeApplication,
  submitTradeApplication,
} from "@/server/applications/service";
import { validTradeApplicationInput } from "@/server/applications/test-fixtures";
import {
  clearCompanyAutopartCustomerCode,
  linkAndVerifyCompanyAutopartCustomerCode,
  setCompanyAutopartCustomerCode,
} from "@/server/companies/autopart-account";
import { getCompanyWorkspace } from "@/server/companies/service";
import {
  exportAutopartOrdersCsv,
  previewAutopartOrderExport,
} from "@/server/orders/autopart-export";
import { repairOrderAutopartCustomerCodeSnapshot } from "@/server/orders/service";
import { tradeApplicationDecisionSchema } from "@/domain/trade-application";

const prisma = new PrismaClient();
const suffix = `apfix-${Date.now()}`;
let adminId = "";
let tradeUserId = "";

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
  adminId = await ensureUser(`apfix.admin.${suffix}@example.invalid`, ["SUPER_ADMIN"]);
  tradeUserId = await ensureUser(`apfix.trade.${suffix}@example.invalid`, [], "TRADE");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Autopart claim / approval verification", () => {
  it("requires confirm + code together in decision schema", () => {
    expect(() =>
      tradeApplicationDecisionSchema.parse({
        id: "cjld2cjxh0000qzrmn831i7rn",
        confirmAutopartAccountVerified: true,
        verifiedAutopartCustomerCode: "   ",
      }),
    ).toThrow(/verified Autopart customer code/i);
  });

  it("registration without claim → approve → company code null", async () => {
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `No Claim ${suffix}`,
        email: `noclaim.${suffix}@example.invalid`,
        existingAccountClaim: "no",
      }),
    );
    expect(submitted.duplicate).toBe(false);
    const app = await getTradeApplication(adminId, submitted.id);
    expect(app.claimedAutopartCustomerCode).toBeNull();

    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: approved.companyId },
    });
    expect(company.autopartCustomerCode).toBeNull();
  });

  it("claim retained after approval without verification", async () => {
    const claim = `S${suffix.replace(/\D/g, "").slice(-5)}A`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Claim Keep ${suffix}`,
        email: `claimkeep.${suffix}@example.invalid`,
        existingAccountClaim: "yes",
        claimedAutopartCustomerCode: claim,
      }),
    );
    const approved = await approveTradeApplication(adminId, { id: submitted.id });
    const app = await getTradeApplication(adminId, submitted.id);
    expect(app.claimedAutopartCustomerCode).toBe(claim);
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: approved.companyId },
    });
    expect(company.autopartCustomerCode).toBeNull();
    expect(company.autopartCustomerCodeVerifiedAt).toBeNull();

    const workspace = await getCompanyWorkspace(adminId, company.id);
    expect(workspace.registrationAutopartClaim?.code).toBe(claim);
    expect(workspace.registrationAutopartClaim?.needsVerification).toBe(true);
  });

  it("approval with explicit verification links Company code", async () => {
    const claim = `S${suffix.replace(/\D/g, "").slice(-5)}B`;
    const corrected = `S${suffix.replace(/\D/g, "").slice(-5)}C`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Verify On Approve ${suffix}`,
        email: `verifyon.${suffix}@example.invalid`,
        existingAccountClaim: "yes",
        claimedAutopartCustomerCode: claim,
      }),
    );

    const approved = await approveTradeApplication(adminId, {
      id: submitted.id,
      verifiedAutopartCustomerCode: corrected,
      confirmAutopartAccountVerified: true,
    });

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: approved.companyId },
    });
    expect(company.autopartCustomerCode).toBe(corrected);
    expect(company.autopartCustomerCodeVerifiedAt).toBeTruthy();
    expect(company.autopartCustomerCodeVerifiedById).toBe(adminId);

    // Original claim preserved on application
    const app = await getTradeApplication(adminId, submitted.id);
    expect(app.claimedAutopartCustomerCode).toBe(claim);

    const audit = await prisma.auditEvent.findFirst({
      where: { entityId: submitted.id, action: "application.approved" },
      orderBy: { createdAt: "desc" },
    });
    const after = audit?.after as Record<string, unknown> | null;
    expect(after?.["autopartAccountVerified"]).toBe(true);
    expect(after?.["verifiedAutopartCustomerCode"]).toBe(corrected);
  });

  it("post-approval linkAndVerify + customer cannot self-verify", async () => {
    const claim = `S${suffix.replace(/\D/g, "").slice(-5)}D`;
    const submitted = await submitTradeApplication(
      validTradeApplicationInput({
        companyName: `Post Link ${suffix}`,
        email: `postlink.${suffix}@example.invalid`,
        existingAccountClaim: "yes",
        claimedAutopartCustomerCode: claim,
      }),
    );
    const approved = await approveTradeApplication(adminId, { id: submitted.id });

    await expect(
      linkAndVerifyCompanyAutopartCustomerCode(tradeUserId, {
        companyId: approved.companyId,
        code: claim,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const linked = await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId: approved.companyId,
      code: claim,
    });
    expect(linked.code).toBe(claim);
    expect(linked.verified).toBe(true);

    const cleared = await clearCompanyAutopartCustomerCode(adminId, {
      companyId: approved.companyId,
    });
    expect(cleared.code).toBeNull();

    await setCompanyAutopartCustomerCode(adminId, {
      companyId: approved.companyId,
      code: `${claim}X`,
    });
    const workspace = await getCompanyWorkspace(adminId, approved.companyId);
    // Code set but unverified → still needs verification relative to claim discrepancy
    expect(workspace.company.autopartAccount.verified).toBe(false);
  });

  it("order snapshot uses verified company code; later company change does not rewrite; CSV blocks null", async () => {
    const code = `S${suffix.replace(/\D/g, "").slice(-5)}E`;
    const company = await prisma.company.create({
      data: {
        name: `Snap Co ${suffix}`,
        status: "ACTIVE",
        autopartCustomerCode: code,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: adminId,
      },
    });

    const order = await prisma.order.create({
      data: {
        orderNumber: `AB-${String(970000 + (Date.now() % 20000)).padStart(6, "0")}`,
        companyId: company.id,
        status: "SUBMITTED",
        subtotal: 10,
        vatTotal: 2,
        deliveryTotal: 5.95,
        grandTotal: 17.95,
        placedAt: new Date(),
        autopartCustomerCodeSnapshot: code,
        autopartAccountLinked: true,
        contactSnapshot: { name: "A", email: "a@example.test" },
        deliveryAddress: {
          line1: "1 Road",
          town: "Leeds",
          postcode: "LS1 1AA",
          country: "GB",
        },
        items: {
          create: [
            {
              sku: "SKU-1",
              name: "Line",
              qty: 1,
              unitPrice: 10,
              customerUnitPrice: 10,
              vatRate: 20,
              lineTotal: 10,
            },
          ],
        },
      },
    });

    await setCompanyAutopartCustomerCode(adminId, {
      companyId: company.id,
      code: `${code}-NEW`,
    });
    await linkAndVerifyCompanyAutopartCustomerCode(adminId, {
      companyId: company.id,
      code: `${code}-NEW`,
    });

    const refreshed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.autopartCustomerCodeSnapshot).toBe(code);

    const preview = await previewAutopartOrderExport(adminId, [order.id]);
    expect(preview.ready).toBe(1);

    // Cannot overwrite existing snapshot (before export)
    await expect(
      repairOrderAutopartCustomerCodeSnapshot(adminId, order.id),
    ).rejects.toMatchObject({ code: "SNAPSHOT_ALREADY_SET" });

    const exported = await exportAutopartOrdersCsv(adminId, [order.id]);
    expect(exported.csv).toContain(code);
    expect(exported.csv).not.toContain(`${code}-NEW`);

    // Order without snapshot → blocked
    const bare = await prisma.order.create({
      data: {
        orderNumber: `AB-${String(980000 + (Date.now() % 10000)).padStart(6, "0")}`,
        companyId: company.id,
        status: "SUBMITTED",
        subtotal: 10,
        vatTotal: 2,
        deliveryTotal: 0,
        grandTotal: 12,
        placedAt: new Date(),
        autopartCustomerCodeSnapshot: null,
        autopartAccountLinked: false,
        contactSnapshot: { name: "A", email: "a@example.test" },
        deliveryAddress: {
          line1: "1 Road",
          town: "Leeds",
          postcode: "LS1 1AA",
          country: "GB",
        },
        items: {
          create: [
            {
              sku: "SKU-2",
              name: "Line",
              qty: 1,
              unitPrice: 10,
              customerUnitPrice: 10,
              vatRate: 20,
              lineTotal: 10,
            },
          ],
        },
      },
    });
    const blocked = await previewAutopartOrderExport(adminId, [bare.id]);
    expect(blocked.items[0]!.reason).toBe("MISSING_AUTOPART_SNAPSHOT");

    const repaired = await repairOrderAutopartCustomerCodeSnapshot(adminId, bare.id);
    expect(repaired.autopartCustomerCodeSnapshot).toBe(`${code}-NEW`);
  });
});
