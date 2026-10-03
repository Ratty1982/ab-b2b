/**
 * Shared Automotive Brands transactional HTML email shell.
 * Conservative table layout + inline styles for Outlook / Gmail / Apple Mail.
 */

import { getServerEnv } from "@/server/env";

const BRAND_NAVY = "#101826";
const BRAND_RED = "#e11d2e";
const BODY_BG = "#e8eaef";
const CONTENT_BG = "#ffffff";
const TEXT = "#1a1f2c";
const MUTED = "#5c6578";
const BORDER = "#d7dbe3";
const TEST_BG = "#fff7ed";
const TEST_BORDER = "#fdba74";
const TEST_TITLE = "#9a3412";

/** Unique marker so template-test decoration can inject a callout without rewriting builders. */
export const EMAIL_BODY_MARKER = "<!-- ab-email-body -->";

export const TEST_EMAIL_SUBJECT_PREFIX = "[TEST]";

export const TEST_EMAIL_CALLOUT_TITLE = "TEST EMAIL";

export const TEST_EMAIL_CALLOUT_BODY =
  "This is a template preview sent from Automotive Brands B2B. No real customer/order/application has been affected.";

export const TEST_EMAIL_CALLOUT_TEXT = `${TEST_EMAIL_CALLOUT_TITLE}\n${TEST_EMAIL_CALLOUT_BODY}`;

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appBaseUrl(): string {
  return getServerEnv().APP_URL.replace(/\/$/, "");
}

/** Absolute HTTPS (or APP_URL) logo for email clients. */
export function brandLogoUrl(): string {
  return `${appBaseUrl()}/brand/ab-logo.jpg`;
}

/** Supporting Power Maxed mark — static public asset for email clients. */
export function powerMaxedLogoUrl(): string {
  return `${appBaseUrl()}/brand/power-maxed-logo.png`;
}

/** Supporting Steel Seal mark — static public asset for email clients. */
export function steelSealLogoUrl(): string {
  return `${appBaseUrl()}/brand/steel-seal-logo.png`;
}

export function publicSiteUrl(): string {
  // Prefer public marketing site when APP_URL is the B2B host; still linked from APP_URL origin docs.
  return "https://automotivebrands.co.uk";
}

export type EmailShellOptions = {
  /** Inner HTML for the white content area (already escaped where needed). */
  bodyHtml: string;
  /** Optional preheader text (hidden preview line). */
  preheader?: string;
  /** Primary CTA */
  cta?: { label: string; href: string };
  /** Footer extras from Admin settings — no fabricated legal lines. */
  footer?: {
    fromName?: string | null;
    fromEmail?: string | null;
    replyToEmail?: string | null;
  };
  /**
   * `internal` is compact and operational (staff alerts).
   * `customer` is the default branded trade-customer shell.
   */
  variant?: "customer" | "internal";
  /** Diagnostic template-test banner. Never set for live transactional sends. */
  testBanner?: boolean;
};

export function renderTestEmailCalloutHtml(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 20px;background-color:${TEST_BG};border:1px solid ${TEST_BORDER};">
  <tr>
    <td style="padding:12px 14px;">
      <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${TEST_TITLE};">${TEST_EMAIL_CALLOUT_TITLE}</p>
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.45;color:${TEXT};">${escapeEmailHtml(TEST_EMAIL_CALLOUT_BODY)}</p>
    </td>
  </tr>
</table>`;
}

/**
 * Prefix subject + inject the TEST EMAIL callout into an already-rendered production body.
 * Used only by the Super Admin template preview/test centre.
 */
export function decorateAsTemplateTest(bodies: {
  subject: string;
  text: string;
  html: string;
}): { subject: string; text: string; html: string } {
  const subject = bodies.subject.startsWith(`${TEST_EMAIL_SUBJECT_PREFIX} `)
    ? bodies.subject
    : `${TEST_EMAIL_SUBJECT_PREFIX} ${bodies.subject}`;
  const text = bodies.text.includes(TEST_EMAIL_CALLOUT_TITLE)
    ? bodies.text
    : `${TEST_EMAIL_CALLOUT_TEXT}\n\n${bodies.text}`;
  let html = bodies.html;
  if (!html.includes(TEST_EMAIL_CALLOUT_TITLE)) {
    const banner = renderTestEmailCalloutHtml();
    if (html.includes(EMAIL_BODY_MARKER)) {
      html = html.replace(EMAIL_BODY_MARKER, `${EMAIL_BODY_MARKER}${banner}`);
    } else {
      html = banner + html;
    }
  }
  return { subject, text, html };
}

const MOBILE_CSS = `<style type="text/css">
  @media only screen and (max-width: 480px) {
    .ab-email-outer { width: 100% !important; }
    .ab-email-pad { padding-left: 16px !important; padding-right: 16px !important; }
    .ab-col-unit { display: none !important; width: 0 !important; max-width: 0 !important; overflow: hidden !important; font-size: 0 !important; line-height: 0 !important; }
    .ab-order-table th.ab-col-unit, .ab-order-table td.ab-col-unit { display: none !important; }
    .ab-order-table { width: 100% !important; }
  }
</style>`;

/**
 * Wrap content in the shared Automotive Brands B2B email shell (~600px).
 *
 * Header hierarchy:
 *   [AB logo]  AUTOMOTIVE BRANDS
 *              [Power Maxed]  [Steel Seal]
 */
export function renderTransactionalEmailShell(options: EmailShellOptions): string {
  const logo = brandLogoUrl();
  const powerMaxed = powerMaxedLogoUrl();
  const steelSeal = steelSealLogoUrl();
  const site = publicSiteUrl();
  const internal = options.variant === "internal";
  const preheader = options.preheader
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeEmailHtml(options.preheader)}</div>`
    : "";

  const ctaBlock = options.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px;">
  <tr>
    <td align="center" bgcolor="${BRAND_RED}" style="border-radius:4px;background-color:${BRAND_RED};">
      <a href="${escapeEmailHtml(options.cta.href)}"
         style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#ffffff;text-decoration:none;">
        ${escapeEmailHtml(options.cta.label)}
      </a>
    </td>
  </tr>
</table>`
    : "";

  const footerName = options.footer?.fromName?.trim() || "Automotive Brands";
  const replyHint = options.footer?.replyToEmail?.trim()
    ? `Reply to: ${escapeEmailHtml(options.footer.replyToEmail.trim())}`
    : options.footer?.fromEmail?.trim()
      ? `Contact: ${escapeEmailHtml(options.footer.fromEmail.trim())}`
      : "";

  const supportingLogos = internal
    ? ""
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.04em;color:#c5cad6;line-height:1.35;margin-top:4px;">
                    Power Maxed · Steel Seal
                  </div>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
                    <tr>
                      <td valign="middle" style="vertical-align:middle;padding-right:12px;">
                        <img src="${escapeEmailHtml(powerMaxed)}" width="88" height="48" alt="" style="display:block;border:0;width:88px;height:auto;max-width:88px;max-height:48px;" />
                      </td>
                      <td valign="middle" style="vertical-align:middle;">
                        <img src="${escapeEmailHtml(steelSeal)}" width="96" height="44" alt="" style="display:block;border:0;width:96px;height:auto;max-width:96px;max-height:44px;" />
                      </td>
                    </tr>
                  </table>`;

  const headerPad = internal ? "14px 20px 12px" : "18px 24px 16px";
  const contentPad = internal ? "20px 20px 8px" : "28px 28px 8px";
  const footerPad = internal ? "14px 20px 20px" : "20px 28px 28px";
  const testBanner = options.testBanner ? renderTestEmailCalloutHtml() : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Automotive Brands</title>
<!--[if mso]>
<style type="text/css">
  body, table, td { font-family: Arial, Helvetica, sans-serif !important; }
</style>
<![endif]-->
${MOBILE_CSS}
</head>
<body style="margin:0;padding:0;background-color:${BODY_BG};">
${preheader}
<table role="presentation" class="ab-email-outer" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BODY_BG};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background-color:${CONTENT_BG};border:1px solid ${BORDER};">
        <tr>
          <td bgcolor="${BRAND_NAVY}" class="ab-email-pad" style="background-color:${BRAND_NAVY};padding:${headerPad};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td valign="middle" width="52" style="width:52px;vertical-align:middle;">
                  <img src="${escapeEmailHtml(logo)}" width="48" height="46" alt="Automotive Brands" style="display:block;border:0;width:48px;height:auto;max-width:48px;background-color:#ffffff;border-radius:2px;" />
                </td>
                <td valign="middle" style="padding-left:12px;vertical-align:middle;">
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:${internal ? "13" : "15"}px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ffffff;line-height:1.2;">
                    Automotive Brands
                  </div>
                  ${supportingLogos}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td class="ab-email-pad" style="padding:${contentPad};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:${TEXT};">
            ${EMAIL_BODY_MARKER}
            ${testBanner}
            ${options.bodyHtml}
            ${ctaBlock}
          </td>
        </tr>
        <tr>
          <td class="ab-email-pad" style="padding:${footerPad};border-top:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};">
            <strong style="color:${TEXT};">${escapeEmailHtml(footerName)}</strong><br/>
            <a href="${escapeEmailHtml(site)}" style="color:${BRAND_RED};text-decoration:none;">automotivebrands.co.uk</a>
            ${replyHint ? `<br/>${replyHint}` : ""}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Primary CTA button HTML fragment (for embedding inside bodyHtml if needed). */
export function renderEmailCtaButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">
  <tr>
    <td align="center" bgcolor="${BRAND_RED}" style="border-radius:4px;background-color:${BRAND_RED};">
      <a href="${escapeEmailHtml(href)}"
         style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#ffffff;text-decoration:none;">
        ${escapeEmailHtml(label)}
      </a>
    </td>
  </tr>
</table>`;
}

export const EMAIL_SHELL_COLORS = {
  navy: BRAND_NAVY,
  red: BRAND_RED,
  bodyBg: BODY_BG,
  contentBg: CONTENT_BG,
} as const;
