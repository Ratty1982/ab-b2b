/**
 * Integration-test helpers for companies that may place staff sales orders.
 *
 * Does not weaken READY_FOR_SALES validation. Uses the documented pre-enforcement
 * LEGACY_ELIGIBLE path (ACTIVE company created before CUSTOMER_SALES_READY_ENFORCE_FROM)
 * so order/placement suites exercise ordering without re-seeding the full setup wizard
 * in every file.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { CUSTOMER_SALES_READY_ENFORCE_FROM } from "@/domain/customer-sales-readiness";

/** Stable createdAt strictly before enforcement — qualifies ACTIVE accounts as LEGACY_ELIGIBLE. */
export const PRE_ENFORCEMENT_COMPANY_CREATED_AT = new Date(
  Date.parse(CUSTOMER_SALES_READY_ENFORCE_FROM) - 24 * 60 * 60 * 1000,
);

type CompanyCreate = Prisma.CompanyCreateInput;

/**
 * Create an ACTIVE trading company eligible for staff order placement under the
 * pre-rollout compatibility policy. Callers that need full READY_FOR_SALES should
 * use the customer-setup wizard helpers instead.
 */
export async function createLegacyEligibleTradingCompany(
  db: PrismaClient,
  data: Omit<CompanyCreate, "createdAt" | "status"> & { status?: "ACTIVE" },
) {
  return db.company.create({
    data: {
      ...data,
      status: data.status ?? "ACTIVE",
      createdAt: PRE_ENFORCEMENT_COMPANY_CREATED_AT,
    },
  });
}
