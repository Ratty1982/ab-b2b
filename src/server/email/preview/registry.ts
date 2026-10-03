/**
 * Registry of live transactional templates for Super Admin preview / test.
 * Each entry calls the same production body builder used for real sends.
 */

import {
  buildTradeAccountActivatedBodies,
  buildTradeApplicationApprovedBodies,
  buildTradeApplicationInternalBodies,
  buildTradeApplicationMoreInfoBodies,
  buildTradeApplicationReceivedBodies,
  buildTradeApplicationRejectedBodies,
} from "@/server/email/application-templates";
import {
  buildCallbackRequestInternalBodies,
  buildCompanyUserInviteBodies,
  buildMotorsportEnquiryInternalBodies,
  buildPasswordResetBodies,
} from "@/server/email/extra-templates";
import { buildUserInvitationBodies } from "@/server/email/user-invitation-template";
import {
  buildOrderDespatchedCustomerBodies,
  buildOrderPartDespatchedCustomerBodies,
  buildOrderReceivedCustomerBodies,
  buildOrderReceivedInternalBodies,
  buildOrderRemainingDespatchedCustomerBodies,
} from "@/server/orders/email";
import {
  buildQuoteDeclinedInternalBodies,
  buildQuoteSentBodies,
} from "@/server/quotes/quote-email";
import { getServerEnv } from "@/server/env";
import {
  PREVIEW_ACCOUNT_MANAGER,
  PREVIEW_COMPANY,
  PREVIEW_CUSTOMER,
  previewApplicationSnapshot,
  previewFooter,
  previewOrderSnapshot,
  previewQuoteDeclinedSnapshot,
  previewQuoteSentSnapshot,
} from "@/server/email/preview/fixtures";

export type PreviewAudience = "customer" | "internal" | "staff";

export type PreviewScenario = {
  id: string;
  label: string;
};

export type PreviewTemplateMeta = {
  id: string;
  name: string;
  purpose: string;
  audience: PreviewAudience;
  description: string;
  group: "customer" | "internal";
  scenarios: PreviewScenario[];
};

export type RenderedPreview = {
  templateId: string;
  scenarioId: string;
  name: string;
  purpose: string;
  audience: PreviewAudience;
  description: string;
  subject: string;
  preheader: string | null;
  text: string;
  html: string;
};

function appBaseUrl(): string {
  return getServerEnv().APP_URL.replace(/\/$/, "");
}

function extractPreheader(html: string): string | null {
  const match = html.match(
    /mso-hide:all;">([^<]*)<\/div>/,
  );
  return match?.[1]?.trim() || null;
}

type Renderer = (scenarioId: string) => { subject: string; text: string; html: string };

type RegistryEntry = PreviewTemplateMeta & { render: Renderer };

const SCENARIO_DEFAULT: PreviewScenario[] = [{ id: "default", label: "Default" }];

const registry: RegistryEntry[] = [
  {
    id: "trade-application-received",
    name: "Trade application received",
    purpose: "TRADE_APPLICATION_RECEIVED",
    audience: "customer",
    group: "customer",
    description: "Confirms a trade application has been received.",
    scenarios: SCENARIO_DEFAULT,
    render: () => buildTradeApplicationReceivedBodies(previewApplicationSnapshot(), previewFooter()),
  },
  {
    id: "trade-application-more-info",
    name: "More information required",
    purpose: "TRADE_APPLICATION_MORE_INFO",
    audience: "customer",
    group: "customer",
    description: "Requests further information using the staff-entered customer message.",
    scenarios: SCENARIO_DEFAULT,
    render: () =>
      buildTradeApplicationMoreInfoBodies(
        previewApplicationSnapshot({
          customerMessage: "Please send a copy of your letterhead and current trade account references.",
        }),
        previewFooter(),
      ),
  },
  {
    id: "trade-application-approved",
    name: "Trade application approved",
    purpose: "TRADE_APPLICATION_APPROVED",
    audience: "customer",
    group: "customer",
    description: "Application approved — customer activates and sets a password.",
    scenarios: SCENARIO_DEFAULT,
    render: () => buildTradeApplicationApprovedBodies(previewApplicationSnapshot(), previewFooter()),
  },
  {
    id: "trade-application-rejected",
    name: "Trade application rejected",
    purpose: "TRADE_APPLICATION_REJECTED",
    audience: "customer",
    group: "customer",
    description: "Neutral application update with the customer-facing reason only.",
    scenarios: SCENARIO_DEFAULT,
    render: () =>
      buildTradeApplicationRejectedBodies(
        previewApplicationSnapshot({
          customerMessage: "We are unable to offer a trade account based on the information provided.",
        }),
        previewFooter(),
      ),
  },
  {
    id: "trade-account-activated",
    name: "Trade account activated / Welcome",
    purpose: "TRADE_ACCOUNT_ACTIVATED",
    audience: "customer",
    group: "customer",
    description: "Welcome email after the trade account is activated.",
    scenarios: [
      { id: "with-account-manager", label: "Assigned account manager" },
      { id: "no-account-manager", label: "No account manager" },
    ],
    render: (scenarioId) =>
      buildTradeAccountActivatedBodies(
        {
          contactName: PREVIEW_CUSTOMER.name,
          contactEmail: PREVIEW_CUSTOMER.email,
          companyName: PREVIEW_COMPANY.name,
          accountManager: scenarioId === "no-account-manager" ? null : PREVIEW_ACCOUNT_MANAGER,
        },
        previewFooter(),
      ),
  },
  {
    id: "company-user-invited",
    name: "Company portal invitation",
    purpose: "COMPANY_USER_INVITED",
    audience: "customer",
    group: "customer",
    description: "Invites a colleague onto an existing trade account.",
    scenarios: SCENARIO_DEFAULT,
    render: () =>
      buildCompanyUserInviteBodies(
        {
          companyName: PREVIEW_COMPANY.name,
          role: "Trade Buyer",
          activationPath: `${appBaseUrl()}/activate?token=preview-invite-not-live`,
          inviteeEmail: "invitee.preview@example.invalid",
        },
        previewFooter(),
      ),
  },
  {
    id: "password-reset",
    name: "Password reset",
    purpose: "PASSWORD_RESET",
    audience: "customer",
    group: "customer",
    description: "Password reset requested for a trade or staff account.",
    scenarios: SCENARIO_DEFAULT,
    render: () =>
      buildPasswordResetBodies(
        { resetUrl: `${appBaseUrl()}/reset-password?token=preview-reset-not-live` },
        previewFooter(),
      ),
  },
  {
    id: "order-received",
    name: "Order received",
    purpose: "ORDER_RECEIVED",
    audience: "customer",
    group: "customer",
    description: "Customer order confirmation using historical snapshot prices.",
    scenarios: [
      { id: "normal", label: "Normal order" },
      { id: "backorder", label: "Order with backorder" },
    ],
    render: (scenarioId) =>
      buildOrderReceivedCustomerBodies(
        previewOrderSnapshot({
          withBackorder: scenarioId === "backorder",
          withAccountManager: true,
        }),
        previewFooter(),
      ),
  },
  {
    id: "order-part-despatched",
    name: "Order part despatched",
    purpose: "ORDER_PART_DESPATCHED",
    audience: "customer",
    group: "customer",
    description: "Partial despatch. Unknown 504C quantities never invent SKU lines.",
    scenarios: [
      { id: "known-qty", label: "Known line quantities" },
      { id: "unknown-qty", label: "Order-level confirmation / quantities unavailable" },
    ],
    render: (scenarioId) =>
      buildOrderPartDespatchedCustomerBodies(
        previewOrderSnapshot({ withBackorder: true }),
        {
          lineQuantitiesKnown: scenarioId !== "unknown-qty",
          footer: previewFooter(),
        },
      ),
  },
  {
    id: "order-despatched",
    name: "Order despatched",
    purpose: "ORDER_DESPATCHED",
    audience: "customer",
    group: "customer",
    description: "Full despatch confirmation. Does not invent tracking.",
    scenarios: SCENARIO_DEFAULT,
    render: () =>
      buildOrderDespatchedCustomerBodies(previewOrderSnapshot(), previewFooter()),
  },
  {
    id: "order-remaining-despatched",
    name: "Remaining backorder despatched",
    purpose: "ORDER_DESPATCHED",
    audience: "customer",
    group: "customer",
    description: "Remaining backordered items have now been despatched.",
    scenarios: SCENARIO_DEFAULT,
    render: () =>
      buildOrderRemainingDespatchedCustomerBodies(
        previewOrderSnapshot({ withBackorder: true }),
        previewFooter(),
      ),
  },
  {
    id: "quote-sent",
    name: "Quote ready",
    purpose: "QUOTE_SENT",
    audience: "customer",
    group: "customer",
    description: "Quotation is ready in the trade portal.",
    scenarios: SCENARIO_DEFAULT,
    render: () => buildQuoteSentBodies(previewQuoteSentSnapshot(), previewFooter()),
  },
  {
    id: "trade-application-internal",
    name: "New trade application",
    purpose: "TRADE_APPLICATION_INTERNAL_NOTIFICATION",
    audience: "internal",
    group: "internal",
    description: "Internal alert that a trade application was submitted.",
    scenarios: SCENARIO_DEFAULT,
    render: () => buildTradeApplicationInternalBodies(previewApplicationSnapshot(), previewFooter()),
  },
  {
    id: "order-received-internal",
    name: "New B2B order",
    purpose: "ORDER_RECEIVED_INTERNAL",
    audience: "internal",
    group: "internal",
    description: "Internal new-order alert with operational stock and Autopart detail.",
    scenarios: [
      { id: "normal", label: "Normal order" },
      { id: "backorder", label: "Order with backorder" },
    ],
    render: (scenarioId) =>
      buildOrderReceivedInternalBodies(
        previewOrderSnapshot({ withBackorder: scenarioId === "backorder" }),
        previewFooter(),
      ),
  },
  {
    id: "quote-declined-internal",
    name: "Quote declined",
    purpose: "QUOTE_DECLINED_INTERNAL",
    audience: "internal",
    group: "internal",
    description: "Internal notice that a quotation was declined.",
    scenarios: SCENARIO_DEFAULT,
    render: () => buildQuoteDeclinedInternalBodies(previewQuoteDeclinedSnapshot(), previewFooter()),
  },
  {
    id: "callback-request-internal",
    name: "Callback request",
    purpose: "CALLBACK_REQUEST_INTERNAL",
    audience: "internal",
    group: "internal",
    description: "Internal callback request from the public contact form.",
    scenarios: SCENARIO_DEFAULT,
    render: () =>
      buildCallbackRequestInternalBodies(
        {
          customerName: PREVIEW_CUSTOMER.name,
          companyName: PREVIEW_COMPANY.name,
          email: PREVIEW_CUSTOMER.email,
          telephone: "01527 000000",
          accountLabel: "Trade account",
          accountManagerName: PREVIEW_ACCOUNT_MANAGER.name,
          message: "Please call about a bulk order for Steel Seal.",
          submittedAtLabel: "03/10/2026 10:15",
          ctaLabel: "Open CRM",
          ctaUrl: `${appBaseUrl()}/sales/crm`,
        },
        previewFooter(),
      ),
  },
  {
    id: "motorsport-partnership-internal",
    name: "Motorsport partnership enquiry",
    purpose: "MOTORSPORT_PARTNERSHIP_INTERNAL",
    audience: "internal",
    group: "internal",
    description: "Internal motorsport partnership enquiry alert.",
    scenarios: SCENARIO_DEFAULT,
    render: () =>
      buildMotorsportEnquiryInternalBodies(
        {
          leadId: "preview-lead-001",
          companyName: PREVIEW_COMPANY.name,
          contactName: PREVIEW_CUSTOMER.name,
          email: PREVIEW_CUSTOMER.email,
          telephone: "01527 000000",
          messagePreview: "We would like to discuss a club championship partnership for 2027.",
          adminLeadUrl: `${appBaseUrl()}/sales/crm`,
          submittedAtLabel: "03/10/2026 11:40",
        },
        previewFooter(),
      ),
  },
  {
    id: "user-invitation",
    name: "Staff invitation",
    purpose: "USER_INVITATION",
    audience: "staff",
    group: "internal",
    description: "Staff account invitation to set a password.",
    scenarios: SCENARIO_DEFAULT,
    render: () =>
      buildUserInvitationBodies(
        {
          email: "staff.preview@example.invalid",
          displayName: "Alex Harper",
          roleLabel: "Sales Representative",
          activationUrl: `${appBaseUrl()}/activate?token=preview-staff-invite-not-live`,
        },
        previewFooter(),
      ),
  },
];

const byId = new Map(registry.map((entry) => [entry.id, entry]));

export function listPreviewTemplateMeta(): PreviewTemplateMeta[] {
  return registry.map(({ render: _render, ...meta }) => meta);
}

export function getPreviewTemplate(templateId: string): RegistryEntry | null {
  return byId.get(templateId) ?? null;
}

export function renderPreviewTemplate(templateId: string, scenarioId?: string): RenderedPreview {
  const entry = getPreviewTemplate(templateId);
  if (!entry) {
    throw new Error(`Unknown email template: ${templateId}`);
  }
  const scenario = entry.scenarios.find((s) => s.id === scenarioId) ?? entry.scenarios[0]!;
  const bodies = entry.render(scenario.id);
  return {
    templateId: entry.id,
    scenarioId: scenario.id,
    name: entry.name,
    purpose: entry.purpose,
    audience: entry.audience,
    description: entry.description,
    subject: bodies.subject,
    preheader: extractPreheader(bodies.html),
    text: bodies.text,
    html: bodies.html,
  };
}

export function renderAllPreviewTemplates(): RenderedPreview[] {
  const out: RenderedPreview[] = [];
  for (const entry of registry) {
    for (const scenario of entry.scenarios) {
      out.push(renderPreviewTemplate(entry.id, scenario.id));
    }
  }
  return out;
}
