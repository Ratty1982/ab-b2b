/**
 * Reusable Automotive Brands transactional email fragments.
 * Table-based, inline CSS, Outlook/Gmail/Apple Mail compatible. No JS.
 */

import { escapeEmailHtml, EMAIL_SHELL_COLORS } from "@/server/email/shell";

const TEXT = "#1a1f2c";
const MUTED = "#5c6578";
const BORDER = "#d7dbe3";
const PANEL_BG = "#f4f5f8";
const NAVY = EMAIL_SHELL_COLORS.navy;
const RED = EMAIL_SHELL_COLORS.red;
const GOOD = "#166534";
const GOOD_BG = "#ecfdf3";
const WARN = "#9a3412";
const WARN_BG = "#fff7ed";
const WARN_BORDER = "#fdba74";
const INFO_BG = "#eef2f7";

export type EmailKv = { label: string; value: string };

export type EmailAccountManager = {
  name: string;
  jobTitle?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
};

export type EmailOrderLine = {
  sku: string;
  name: string;
  qty: number;
  unitPrice?: string | null;
  lineTotal?: string | null;
  availableQty?: number | null;
  backorderQty?: number | null;
};

export function firstNameFrom(fullName: string | null | undefined): string {
  const trimmed = fullName?.trim() ?? "";
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

export function emailHero(kicker: string, heading: string): string {
  return `<p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${RED};">
  ${escapeEmailHtml(kicker)}
</p>
<h1 style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.3;font-weight:700;color:${TEXT};">
  ${escapeEmailHtml(heading)}
</h1>`;
}

export function emailParagraph(text: string, last = false): string {
  return `<p style="margin:0 0 ${last ? "0" : "16px"};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:${TEXT};">${escapeEmailHtml(text)}</p>`;
}

export function emailHtmlParagraph(innerHtml: string, last = false): string {
  return `<p style="margin:0 0 ${last ? "0" : "16px"};font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:${TEXT};">${innerHtml}</p>`;
}

export function emailReferencePanel(rows: EmailKv[]): string {
  const cells = rows
    .map(
      (row) => `<tr>
  <td style="padding:8px 0 2px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">${escapeEmailHtml(row.label)}</td>
</tr>
<tr>
  <td style="padding:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:${TEXT};">${escapeEmailHtml(row.value)}</td>
</tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 20px;background-color:${PANEL_BG};border:1px solid ${BORDER};">
  <tr>
    <td style="padding:14px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${cells}</table>
    </td>
  </tr>
</table>`;
}

export function emailInfoPanel(title: string | null, lines: string[]): string {
  const body = lines
    .filter((line) => line.trim())
    .map((line) => escapeEmailHtml(line))
    .join("<br/>");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 20px;border:1px solid ${BORDER};">
  <tr>
    <td style="padding:14px 16px;">
      ${
        title
          ? `<p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">${escapeEmailHtml(title)}</p>`
          : ""
      }
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${TEXT};">${body}</p>
    </td>
  </tr>
</table>`;
}

export function emailNumberedList(items: string[]): string {
  const rows = items
    .map(
      (item, i) => `<tr>
  <td valign="top" width="28" style="width:28px;padding:0 8px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:${NAVY};">${i + 1}.</td>
  <td valign="top" style="padding:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${TEXT};">${escapeEmailHtml(item)}</td>
</tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 16px;">${rows}</table>`;
}

export function emailBulletList(items: string[]): string {
  const rows = items
    .map(
      (item) => `<tr>
  <td valign="top" width="16" style="width:16px;padding:0 8px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${RED};">•</td>
  <td valign="top" style="padding:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${TEXT};">${escapeEmailHtml(item)}</td>
</tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 16px;">${rows}</table>`;
}

export function emailStatusCallout(
  title: string,
  body: string,
  tone: "neutral" | "success" | "warning" = "neutral",
): string {
  const bg = tone === "success" ? GOOD_BG : tone === "warning" ? WARN_BG : INFO_BG;
  const border = tone === "warning" ? WARN_BORDER : BORDER;
  const titleColor = tone === "success" ? GOOD : tone === "warning" ? WARN : NAVY;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 20px;background-color:${bg};border:1px solid ${border};">
  <tr>
    <td style="padding:14px 16px;">
      <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${titleColor};">${escapeEmailHtml(title)}</p>
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${TEXT};">${escapeEmailHtml(body)}</p>
    </td>
  </tr>
</table>`;
}

export function emailProgressSteps(currentLabel: string, steps: string[]): string {
  const found = steps.findIndex((step) => step.toLowerCase() === currentLabel.toLowerCase());
  const active = found >= 0 ? found : 0;
  const rows = steps
    .map((step, i) => {
      const reached = i <= active;
      const current = i === active;
      const mark = reached ? "✓" : "○";
      const color = current ? GOOD : reached ? TEXT : MUTED;
      const weight = current ? "700" : "400";
      return `<tr>
  <td style="padding:2px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:${weight};color:${color};">
    ${mark}&nbsp;&nbsp;${escapeEmailHtml(step)}
  </td>
</tr>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 20px;">
  <tr><td style="padding:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">Status</td></tr>
  ${rows}
</table>`;
}

export function emailProductTable(lines: EmailOrderLine[], opts?: { showPrices?: boolean }): string {
  const showPrices = opts?.showPrices !== false;
  const rows = lines
    .map((item) => {
      const bo = item.backorderQty ?? 0;
      const availNote =
        bo > 0
          ? `<br/><span style="font-size:12px;color:${WARN};">${escapeEmailHtml(String(bo))} currently on backorder${
              item.availableQty != null ? ` · ${item.availableQty} available` : ""
            }</span>`
          : "";
      return `<tr>
  <td class="ab-col-product" style="padding:10px 8px;border-bottom:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT};vertical-align:top;">
    <strong>${escapeEmailHtml(item.name)}</strong><br/>
    <span class="ab-col-sku" style="font-family:Consolas,monospace;font-size:12px;color:${MUTED};">${escapeEmailHtml(item.sku)}</span>
    ${availNote}
  </td>
  <td class="ab-col-qty" style="padding:10px 8px;border-bottom:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;font-size:14px;text-align:right;vertical-align:top;white-space:nowrap;">${item.qty}</td>
  ${
    showPrices
      ? `<td class="ab-col-unit" style="padding:10px 8px;border-bottom:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;font-size:14px;text-align:right;vertical-align:top;white-space:nowrap;">${
          item.unitPrice ? `£${escapeEmailHtml(item.unitPrice)}` : "—"
        }</td>
  <td class="ab-col-total" style="padding:10px 8px;border-bottom:1px solid ${BORDER};font-family:Arial,Helvetica,sans-serif;font-size:14px;text-align:right;vertical-align:top;white-space:nowrap;">${
    item.lineTotal ? `£${escapeEmailHtml(item.lineTotal)}` : "—"
  }</td>`
      : ""
  }
</tr>`;
    })
    .join("\n");

  return `<p style="margin:16px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">Order items</p>
<table role="presentation" class="ab-order-table" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:0 0 8px;">
<thead>
<tr>
  <th align="left" style="padding:8px;border-bottom:2px solid ${NAVY};font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">Product</th>
  <th align="right" style="padding:8px;border-bottom:2px solid ${NAVY};font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">Qty</th>
  ${
    showPrices
      ? `<th class="ab-col-unit" align="right" style="padding:8px;border-bottom:2px solid ${NAVY};font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">Unit Price</th>
  <th align="right" style="padding:8px;border-bottom:2px solid ${NAVY};font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">Total</th>`
      : ""
  }
</tr>
</thead>
<tbody>${rows}</tbody>
</table>`;
}

export function emailTotalsBlock(input: {
  goods: string;
  delivery: string;
  vat: string;
  orderTotal: string;
  currency?: string;
}): string {
  const deliveryDisplay = input.delivery === "0.00" || input.delivery === "FREE" ? "FREE" : `£${input.delivery}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:8px 0 20px;">
  <tr>
    <td style="padding:4px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${MUTED};">Goods ex VAT</td>
    <td align="right" style="padding:4px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT};">£${escapeEmailHtml(input.goods)}</td>
  </tr>
  <tr>
    <td style="padding:4px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${MUTED};">Delivery</td>
    <td align="right" style="padding:4px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT};">${deliveryDisplay === "FREE" ? "FREE" : escapeEmailHtml(deliveryDisplay)}</td>
  </tr>
  <tr>
    <td style="padding:4px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${MUTED};">VAT</td>
    <td align="right" style="padding:4px 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${TEXT};">£${escapeEmailHtml(input.vat)}</td>
  </tr>
  <tr>
    <td style="padding:10px 8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${TEXT};border-top:1px solid ${BORDER};">Order total</td>
    <td align="right" style="padding:10px 8px 4px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:${TEXT};border-top:1px solid ${BORDER};">£${escapeEmailHtml(input.orderTotal)}${input.currency ? ` ${escapeEmailHtml(input.currency)}` : ""}</td>
  </tr>
</table>`;
}

export function emailQtyList(title: string, lines: string[]): string {
  const items = lines.length ? lines.map((line) => escapeEmailHtml(line)).join("<br/>") : "—";
  return `<p style="margin:16px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">${escapeEmailHtml(title)}</p>
<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:${TEXT};">${items}</p>`;
}

export function emailAccountManagerCard(
  am: EmailAccountManager | null | undefined,
  heading = "Your account manager",
): string {
  if (!am?.name?.trim()) return "";
  const lines = [
    escapeEmailHtml(am.name.trim()),
    am.jobTitle?.trim() ? escapeEmailHtml(am.jobTitle.trim()) : null,
    am.email?.trim() ? escapeEmailHtml(am.email.trim()) : null,
    am.phone?.trim() ? escapeEmailHtml(am.phone.trim()) : null,
    am.mobile?.trim() ? escapeEmailHtml(am.mobile.trim()) : null,
  ].filter(Boolean);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:8px 0 16px;border:1px solid ${BORDER};">
  <tr>
    <td style="padding:14px 16px;">
      <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">${escapeEmailHtml(heading)}</p>
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:${TEXT};">${lines.join("<br/>")}</p>
    </td>
  </tr>
</table>`;
}

export function emailSecondaryLink(label: string, href: string): string {
  return `<p style="margin:12px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${MUTED};">
  <a href="${escapeEmailHtml(href)}" style="color:${RED};text-decoration:underline;">${escapeEmailHtml(label)}</a>
</p>`;
}

export function emailSectionLabel(label: string): string {
  return `<p style="margin:8px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">${escapeEmailHtml(label)}</p>`;
}
