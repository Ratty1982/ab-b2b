/**
 * Ongoing 504/TRM21QC rows are stored only for an Active company whose
 * Autopart account is uniquely verified and whose sales cutover is complete.
 */
import { prisma } from "@/infra/database/client";
import type { AutopartImportReasonCode } from "@/domain/autopart-import-diagnostics";
import {
  foreignAutopartClaims,
  resolveAutopartCodeOwnership,
} from "@/server/companies/autopart-account-verification";

export type OngoingSalesWriteDecision =
  | {
      persist: true;
      companyId: string;
      autopartCode: string;
      authority: "verified-code" | "verified-alias";
    }
  | { persist: false; reasonCode: AutopartImportReasonCode; reason: string };

const VERIFIED = new Set(["verified-code", "verified-alias"]);

export async function assessOngoingSalesWrite(input: {
  companyId: string | null;
  autopartCode: string | null;
}): Promise<OngoingSalesWriteDecision> {
  const code = input.autopartCode?.trim().toUpperCase() || null;
  let companyId = input.companyId;
  let autopartCode = code && code !== "UNKNOWN" ? code : "";
  let authority: string = companyId ? "supplied" : "unresolved";

  if (code && code !== "UNKNOWN") {
    const ownership = await resolveAutopartCodeOwnership(code);
    authority = ownership.authority;
    if (!companyId) companyId = ownership.companyId;
    if (ownership.companyId && companyId && ownership.companyId !== companyId) {
      return {
        persist: false,
        reasonCode: "OWNERSHIP_NOT_UNIQUE",
        reason: `Autopart account ${code} belongs to another customer. The row was not stored.`,
      };
    }
    if (ownership.code) autopartCode = ownership.code;
    if (ownership.authority === "ambiguous" || ownership.authority === "unresolved") {
      return {
        persist: false,
        reasonCode: ownership.authority === "ambiguous" ? "OWNERSHIP_NOT_UNIQUE" : "UNMAPPED_CUSTOMER",
        reason:
          ownership.authority === "ambiguous"
            ? `Autopart account ${code} is linked to more than one customer. The row was not stored.`
            : `Autopart account ${code} is not verified to a customer. No sales document or product line was stored.`,
      };
    }
    if (!VERIFIED.has(ownership.authority)) {
      return {
        persist: false,
        reasonCode: "OWNERSHIP_NOT_UNIQUE",
        reason: `Autopart account ${code} is not a uniquely verified customer code or alias. The row was not stored.`,
      };
    }
  }

  if (!companyId) {
    return {
      persist: false,
      reasonCode: "UNMAPPED_CUSTOMER",
      reason: "No uniquely verified customer owns this row. No sales document or product line was stored.",
    };
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      status: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      salesCutover: { select: { historyStatus: true } },
    },
  });
  if (!company) {
    return {
      persist: false,
      reasonCode: "UNMAPPED_CUSTOMER",
      reason: "The customer for this row no longer exists. Nothing was stored.",
    };
  }
  if (!company.autopartCustomerCode || !company.autopartCustomerCodeVerifiedAt) {
    return {
      persist: false,
      reasonCode: "OWNERSHIP_NOT_UNIQUE",
      reason: "This customer does not have a uniquely verified Autopart account. Nothing was stored.",
    };
  }
  if (authority === "supplied") {
    const foreign = await foreignAutopartClaims(company.autopartCustomerCode, company.id);
    if (foreign.length > 0) {
      return {
        persist: false,
        reasonCode: "OWNERSHIP_NOT_UNIQUE",
        reason: "This customer's Autopart account is also held by another company. Nothing was stored.",
      };
    }
  }
  if (company.status !== "ACTIVE") {
    return {
      persist: false,
      reasonCode: "NOT_ACTIVE",
      reason: "This customer is not Active. Imported sales were not stored.",
    };
  }
  if (company.salesCutover?.historyStatus !== "COMPLETE") {
    return {
      persist: false,
      reasonCode: "HISTORY_CUTOVER_INCOMPLETE",
      reason: "Historical sales import and cutover are not complete for this customer. Ongoing sales were not stored.",
    };
  }
  return {
    persist: true,
    companyId: company.id,
    autopartCode: autopartCode || company.autopartCustomerCode,
    authority: authority === "verified-alias" ? "verified-alias" : "verified-code",
  };
}
