/**
 * Production system bootstrap entrypoint.
 *
 * Usage:
 *   bun run db:bootstrap:production
 *   node .output/bootstrap/run-production.mjs   (Docker runtime)
 *
 * Sequence:
 *   1. RBAC permissions + system roles + role-permission maps
 *   2. Optional INITIAL_ADMIN_* administrator (idempotent; never resets password)
 *
 * Does NOT create demo companies, sample users, or commercial fixtures.
 */
import { PrismaClient } from "@prisma/client";

import { bootstrapRbac } from "./rbac";
import { bootstrapInitialAdmin } from "./initial-admin";
import { bootstrapHomepageCms, bootstrapMarketingCmsPages } from "../../src/server/cms/service";
import { bootstrapCatalogue } from "../../src/server/catalogue/service";

async function main() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("[ab:bootstrap] DATABASE_URL is required");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    console.log("[ab:bootstrap] Starting production system bootstrap…");

    const rbac = await bootstrapRbac(prisma);
    console.log("[ab:bootstrap] RBAC complete", {
      permissions: rbac.permissionsUpserted,
      roles: rbac.rolesUpserted,
      rolePermissionLinks: rbac.rolePermissionLinks,
    });

    const admin = await bootstrapInitialAdmin(prisma);
    if (admin.status === "misconfigured") {
      console.error(`[ab:bootstrap] ${admin.message}`);
      process.exit(1);
    }
    if (admin.status === "skipped") {
      console.log(`[ab:bootstrap] ${admin.message}`);
    } else if (admin.status === "created") {
      console.log(`[ab:bootstrap] ${admin.message} (${admin.email})`);
    } else {
      console.log(`[ab:bootstrap] ${admin.message} (${admin.email})`);
    }

    const cms = await bootstrapHomepageCms(prisma);
    console.log("[ab:bootstrap] CMS homepage", {
      created: cms.created,
      pageId: cms.pageId,
    });

    const marketing = await bootstrapMarketingCmsPages(prisma);
    console.log("[ab:bootstrap] CMS marketing pages", marketing);

    const catalogue = await bootstrapCatalogue(prisma);
    console.log("[ab:bootstrap] Catalogue taxonomy", catalogue);

    const { ensureAutopartWarehouse } = await import("../../src/server/stock/service");
    const warehouse = await ensureAutopartWarehouse();
    console.log("[ab:bootstrap] Autopart warehouse", { id: warehouse.id, code: warehouse.code });

    console.log("[ab:bootstrap] Done.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("[ab:bootstrap] Failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
