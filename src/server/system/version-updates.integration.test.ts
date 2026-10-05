/**
 * Version Updates / What's New — Super Admin manage + staff acknowledge.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  acknowledgeWhatsNew,
  archiveVersionUpdate,
  createVersionUpdateFromPaste,
  getPendingWhatsNew,
  getVersionUpdateAdmin,
  listVersionUpdatesAdmin,
  listWhatsNewHistory,
  previewVersionUpdate,
  publishVersionUpdate,
  upsertVersionUpdate,
} from "@/server/system/version-updates";

const prisma = new PrismaClient();
const stamp = Date.now();

let superAdminId = "";
let salesId = "";
let marketingId = "";
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

beforeAll(async () => {
  await bootstrapRbac(prisma);
  superAdminId = await ensureUser(`vu.admin.${stamp}@example.invalid`, ["SUPER_ADMIN"]);
  salesId = await ensureUser(`vu.sales.${stamp}@example.invalid`, ["SALES_REPRESENTATIVE"]);
  marketingId = await ensureUser(`vu.mkt.${stamp}@example.invalid`, ["MARKETING"]);
  tradeUserId = await ensureUser(`vu.trade.${stamp}@example.invalid`, [], "TRADE");
});

afterAll(async () => {
  await prisma.versionUpdateRead.deleteMany({});
  await prisma.versionUpdate.deleteMany({
    where: { createdById: superAdminId },
  });
  await prisma.$disconnect();
});

describe("version updates", () => {
  it("restricts management to Super Admin", async () => {
    await expect(listVersionUpdatesAdmin(salesId)).rejects.toBeInstanceOf(AuthError);
    await expect(listVersionUpdatesAdmin(tradeUserId)).rejects.toBeInstanceOf(AuthError);
    const list = await listVersionUpdatesAdmin(superAdminId);
    expect(Array.isArray(list)).toBe(true);
  });

  it("creates draft that staff cannot see; preview does not publish", async () => {
    const draft = await upsertVersionUpdate(superAdminId, {
      version: `1.${String(stamp).slice(-4)}`,
      title: "October Platform Update",
      summary: "SDS & Cost",
      content: {
        intro: "We've made several improvements.",
        sections: [
          {
            heading: "Product Safety Data Sheets",
            body: "We've added Safety Data Sheets to the product catalogue.",
          },
          {
            heading: "Cost Intelligence",
            body: "We've simplified the product Cost Intelligence section.",
          },
        ],
      },
      audience: { mode: "ALL_INTERNAL" },
    });
    expect(draft.status).toBe("DRAFT");

    const pendingSales = await getPendingWhatsNew(salesId);
    expect(pendingSales).toBeNull();

    const preview = await previewVersionUpdate(superAdminId, draft.id);
    expect(preview.isPreview).toBe(true);
    expect(preview.title).toBe("October Platform Update");

    const still = await prisma.versionUpdate.findUniqueOrThrow({ where: { id: draft.id } });
    expect(still.status).toBe("DRAFT");

    const published = await publishVersionUpdate(superAdminId, draft.id);
    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedAt).toBeTruthy();

    const pending = await getPendingWhatsNew(salesId);
    expect(pending?.id).toBe(draft.id);
    expect(pending?.earlierUnreadCount).toBe(0);

    await acknowledgeWhatsNew(salesId, draft.id);
    expect(await getPendingWhatsNew(salesId)).toBeNull();

    // Another "session" — still acknowledged
    expect(await getPendingWhatsNew(salesId)).toBeNull();

    const history = await listWhatsNewHistory(salesId);
    expect(history.items.some((i) => i.id === draft.id && i.acknowledged)).toBe(true);

    // Trade never receives
    await expect(getPendingWhatsNew(tradeUserId)).rejects.toBeInstanceOf(AuthError);

    // Acknowledge the all-staff update for marketing so role targeting is isolatable
    await acknowledgeWhatsNew(marketingId, draft.id);

    // Role-targeted update excludes non-matching staff
    const targeted = await upsertVersionUpdate(superAdminId, {
      version: `1.${String(stamp).slice(-3)}a`,
      title: "Marketing only",
      content: { intro: "CMS tip", sections: [{ heading: "Tip", body: "Use the media library." }] },
      audience: { mode: "ROLES", roleKeys: ["MARKETING"] },
    });
    await publishVersionUpdate(superAdminId, targeted.id);
    expect(await getPendingWhatsNew(salesId)).toBeNull();
    const mktPending = await getPendingWhatsNew(marketingId);
    expect(mktPending?.id).toBe(targeted.id);

    // Edit published does not reset ack for first update
    await upsertVersionUpdate(superAdminId, {
      id: draft.id,
      version: draft.version,
      title: "October Platform Update (typo fix)",
      content: draft.content,
      audience: { mode: "ALL_INTERNAL" },
    });
    expect(await getPendingWhatsNew(salesId)).toBeNull();

    // Multiple unread — only newest modal
    const older = await upsertVersionUpdate(superAdminId, {
      version: `0.${String(stamp).slice(-3)}`,
      title: "Older",
      content: { intro: "Older note", sections: [] },
      audience: { mode: "ALL_INTERNAL" },
    });
    await publishVersionUpdate(superAdminId, older.id);
    await prisma.versionUpdate.update({
      where: { id: older.id },
      data: { publishedAt: new Date(Date.now() - 86_400_000) },
    });
    const newer = await upsertVersionUpdate(superAdminId, {
      version: `2.${String(stamp).slice(-3)}`,
      title: "Newer",
      content: { intro: "Newer note", sections: [] },
      audience: { mode: "ALL_INTERNAL" },
    });
    await publishVersionUpdate(superAdminId, newer.id);

    const pendingMulti = await getPendingWhatsNew(salesId);
    expect(pendingMulti?.id).toBe(newer.id);
    expect(pendingMulti?.earlierUnreadCount).toBeGreaterThanOrEqual(1);

    await archiveVersionUpdate(superAdminId, newer.id);
    const afterArchive = await getPendingWhatsNew(salesId);
    expect(afterArchive?.id).not.toBe(newer.id);

    const audits = await prisma.auditEvent.findMany({
      where: {
        entityType: "VersionUpdate",
        action: { in: ["version_update.created", "version_update.published", "version_update.archived"] },
        actorUserId: superAdminId,
      },
      take: 20,
    });
    expect(audits.length).toBeGreaterThan(0);
  });

  it("creates a What's New item from a simple paste using the existing model", async () => {
    const paste = `
Purchasing Intelligence

We've added a new Purchasing Intelligence area to help plan future stock requirements.

• See current stock and incoming purchase orders
- Forecast demand using sales history
* Identify products running low or potentially overstocked
`;
    await expect(createVersionUpdateFromPaste(salesId, { paste })).rejects.toBeInstanceOf(AuthError);
    await expect(createVersionUpdateFromPaste(tradeUserId, { paste })).rejects.toBeInstanceOf(AuthError);
    await expect(createVersionUpdateFromPaste(superAdminId, { paste: "   \n" })).rejects.toBeInstanceOf(AuthError);

    const created = await createVersionUpdateFromPaste(superAdminId, { paste });
    expect(created.status).toBe("DRAFT");
    expect(created.title).toBe("Purchasing Intelligence");
    expect(created.createdById).toBe(superAdminId);
    expect(created.version).toMatch(/^\d{4}\.\d{2}\.\d{2}/);
    expect(created.content.intro).toContain("We've added a new Purchasing Intelligence area");
    expect(created.content.intro).toContain("• See current stock and incoming purchase orders");
    expect(created.content.intro).toContain("• Forecast demand using sales history");
    expect(created.content.intro).toContain("• Identify products running low or potentially overstocked");
    expect(created.audience.mode).toBe("ALL_INTERNAL");
    expect(new Date(created.createdAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const stored = await getVersionUpdateAdmin(superAdminId, created.id);
    expect(stored.content).toEqual(created.content);
    expect(stored.title).toBe(created.title);
    const preview = await previewVersionUpdate(superAdminId, created.id);
    expect(preview.title).toBe(created.title);
    expect(preview.content.intro).toBe(created.content.intro);
    expect(preview.isPreview).toBe(true);

    const unsafe = await createVersionUpdateFromPaste(superAdminId, {
      paste: "<script>alert(1)</script>Safe Title\n\nHello <b>staff</b>.",
    });
    expect(unsafe.title).toBe("Safe Title");
    expect(unsafe.content.intro).toBe("Hello staff.");
    expect(JSON.stringify(unsafe)).not.toMatch(/<script/i);

    const published = await createVersionUpdateFromPaste(superAdminId, {
      paste: "Published From Paste\n\nBody for staff.",
      publish: true,
    });
    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedAt).toBeTruthy();
    expect(new Date(published.publishedAt!).getTime()).toBeGreaterThan(Date.now() - 60_000);

    const pending = await getPendingWhatsNew(salesId);
    expect(pending?.title).toBe("Published From Paste");
    expect(pending?.content.intro).toBe("Body for staff.");
  });
});
