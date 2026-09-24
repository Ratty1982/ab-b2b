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
};

/**
 * Wrap content in the shared Automotive Brands B2B email shell (~600px).
 */
export function renderTransactionalEmailShell(options: EmailShellOptions): string {
  const logo = brandLogoUrl();
  const site = publicSiteUrl();
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Automotive Brands</title>
</head>
<body style="margin:0;padding:0;background-color:${BODY_BG};">
${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BODY_BG};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;background-color:${CONTENT_BG};border:1px solid ${BORDER};">
        <tr>
          <td bgcolor="${BRAND_NAVY}" style="background-color:${BRAND_NAVY};padding:22px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td valign="middle" style="vertical-align:middle;">
                  <img src="${escapeEmailHtml(logo)}" width="48" height="46" alt="Automotive Brands" style="display:block;border:0;width:48px;height:auto;background-color:#ffffff;border-radius:2px;" />
                </td>
                <td valign="middle" style="padding-left:14px;vertical-align:middle;">
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ffffff;">
                    Automotive Brands
                  </div>
                  <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#a8b0c0;padding-top:4px;">
                    Trade Supply
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:${TEXT};">
            ${options.bodyHtml}
            ${ctaBlock}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 28px 28px;border-top:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};">
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
