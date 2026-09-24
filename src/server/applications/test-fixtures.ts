/**
 * Shared valid trade-application payload for tests.
 */
export function validTradeApplicationInput(partial: {
  companyName?: string;
  tradingName?: string | null;
  email?: string;
  existingAccountClaim?: "yes" | "no" | "not_sure";
  claimedAutopartCustomerCode?: string | null;
  businessType?: string;
  businessTypeOther?: string | null;
  companyNumber?: string | null;
  vatNumber?: string | null;
  website?: string | null;
  estimatedSpend?: string | null;
  howHeardAboutUs?: string | null;
  brandsInterest?: string[];
  notes?: string | null;
  websiteConfirm?: string;
  primaryContact?: Partial<{
    firstName: string;
    lastName: string;
    role: string | null;
    email: string;
    phone: string;
  }>;
  tradingAddress?: Partial<{
    line1: string;
    line2: string | null;
    town: string;
    county: string | null;
    postcode: string;
    country: string;
  }>;
} = {}) {
  const stamp = Date.now();
  const email = partial.email ?? `applicant.${stamp}@example.invalid`;

  return {
    companyName: partial.companyName ?? `Test Factors ${stamp}`,
    tradingName: partial.tradingName ?? null,
    companyNumber: partial.companyNumber ?? null,
    vatNumber: partial.vatNumber ?? null,
    businessType: partial.businessType ?? "Motor Factor",
    businessTypeOther: partial.businessTypeOther ?? null,
    website: partial.website ?? null,
    tradingAddress: {
      line1: "12 Trade Street",
      line2: null as string | null,
      town: "Birmingham",
      county: "West Midlands" as string | null,
      postcode: "B1 1AA",
      country: "GB",
      ...partial.tradingAddress,
    },
    primaryContact: {
      firstName: "Sam",
      lastName: "Applicant",
      role: "Buyer" as string | null,
      phone: "01214567890",
      ...partial.primaryContact,
      email,
    },
    existingAccountClaim: partial.existingAccountClaim ?? ("no" as const),
    claimedAutopartCustomerCode: partial.claimedAutopartCustomerCode ?? null,
    estimatedSpend: partial.estimatedSpend ?? "£1,000–£2,500",
    howHeardAboutUs: partial.howHeardAboutUs ?? "Web search",
    brandsInterest: partial.brandsInterest ?? ["power-maxed"],
    notes: partial.notes ?? null,
    consentAccepted: true as const,
    websiteConfirm: partial.websiteConfirm ?? "",
  };
}
