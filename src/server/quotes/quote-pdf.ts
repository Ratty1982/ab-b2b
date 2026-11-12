/**
 * Printable A4 quotation PDF from a saved quote.
 * Prices and quantities are copied from the quote row. Nothing is repriced.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const NAVY = rgb(0.063, 0.094, 0.149);
const RED = rgb(0.882, 0.114, 0.18);
const MUTED = rgb(0.36, 0.4, 0.47);
const LINE = rgb(0.84, 0.86, 0.89);

export type QuotePdfSource = {
  quoteNumber: string;
  createdAt: Date;
  expiresAt: Date | null;
  currency: string;
  subtotal: string;
  deliveryTotal: string;
  vatTotal: string;
  grandTotal: string;
  customerNotes: string | null;
  internalNotes: string | null;
  poNumber: string | null;
  paymentTerms: string | null;
  companyName: string;
  companyPhone: string | null;
  companyEmail: string | null;
  contactLines: string[];
  addressLines: string[];
  salespersonLines: string[];
  items: Array<{
    sku: string;
    name: string;
    qty: number;
    unitPrice: string;
    lineTotal: string;
  }>;
};

function money(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return `£${n.toFixed(2)}`;
}

function formatDate(value: Date | null): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(value);
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (!words[0]) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderQuotePdf(source: QuotePdfSource): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT;

  const drawHeader = (target: PDFPage, continued: boolean) => {
    target.drawRectangle({ x: 0, y: PAGE_HEIGHT - 72, width: PAGE_WIDTH, height: 72, color: NAVY });
    target.drawRectangle({ x: 0, y: PAGE_HEIGHT - 76, width: PAGE_WIDTH, height: 4, color: RED });
    target.drawText("AUTOMOTIVE BRANDS", {
      x: MARGIN,
      y: PAGE_HEIGHT - 36,
      size: 16,
      font: bold,
      color: rgb(1, 1, 1),
    });
    target.drawText(continued ? "Quotation continued" : "Trade quotation", {
      x: MARGIN,
      y: PAGE_HEIGHT - 56,
      size: 10,
      font: regular,
      color: rgb(0.85, 0.88, 0.92),
    });
    target.drawText(source.quoteNumber, {
      x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(source.quoteNumber, 14),
      y: PAGE_HEIGHT - 40,
      size: 14,
      font: bold,
      color: rgb(1, 1, 1),
    });
  };

  const newPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(page, true);
    y = PAGE_HEIGHT - 96;
  };

  const ensure = (height: number) => {
    if (y - height < 48) newPage();
  };

  const text = (value: string, x: number, size: number, font: PDFFont, color = NAVY) => {
    page.drawText(value, { x, y, size, font, color });
  };

  drawHeader(page, false);
  y = PAGE_HEIGHT - 100;

  const meta = [
    `Quote date: ${formatDate(source.createdAt)}`,
    `Valid until: ${formatDate(source.expiresAt)}`,
    source.poNumber ? `Customer PO: ${source.poNumber}` : "Customer PO: Not set",
    `Currency: ${source.currency || "GBP"}`,
  ];
  for (const line of meta) {
    text(line, MARGIN, 10, regular, MUTED);
    y -= 14;
  }
  y -= 8;

  const columnWidth = 240;
  const left = source.contactLines.length
    ? source.contactLines
    : ["Contact details were not saved on this quote"];
  const address = source.addressLines.length
    ? source.addressLines
    : ["Delivery address was not saved on this quote"];
  const seller = source.salespersonLines.length
    ? source.salespersonLines
    : ["Salesperson details were not saved on this quote"];

  const blocks: Array<{ title: string; lines: string[]; x: number }> = [
    {
      title: "Customer",
      x: MARGIN,
      lines: [source.companyName, source.companyPhone, source.companyEmail, ...left, ...address].filter(
        (line): line is string => Boolean(line),
      ),
    },
    { title: "Prepared by", x: MARGIN + columnWidth + 20, lines: seller },
  ];
  const blockTop = y;
  let lowest = y;
  for (const block of blocks) {
    y = blockTop;
    text(block.title.toUpperCase(), block.x, 9, bold, RED);
    y -= 16;
    for (const line of block.lines) {
      for (const wrapped of wrap(line, regular, 10, columnWidth)) {
        text(wrapped, block.x, 10, regular);
        y -= 13;
      }
    }
    lowest = Math.min(lowest, y);
  }
  y = lowest - 16;

  ensure(36);
  page.drawRectangle({ x: MARGIN, y: y - 4, width: PAGE_WIDTH - MARGIN * 2, height: 18, color: NAVY });
  const columns = [
    { label: "SKU", x: MARGIN + 4, width: 80 },
    { label: "Description", x: MARGIN + 88, width: 210 },
    { label: "Qty", x: MARGIN + 304, width: 40 },
    { label: "Unit", x: MARGIN + 348, width: 70 },
    { label: "Line", x: MARGIN + 422, width: 70 },
  ];
  for (const column of columns) {
    page.drawText(column.label, { x: column.x, y: y, size: 8, font: bold, color: rgb(1, 1, 1) });
  }
  y -= 22;

  if (!source.items.length) {
    text("No product lines are saved on this quote.", MARGIN, 10, regular, MUTED);
    y -= 18;
  }

  for (const item of source.items) {
    const description = wrap(item.name, regular, 9, 200);
    const height = Math.max(16, description.length * 12 + 4);
    ensure(height + 8);
    text(item.sku, MARGIN + 4, 9, bold);
    description.forEach((line, index) => {
      page.drawText(line, {
        x: MARGIN + 88,
        y: y - index * 12,
        size: 9,
        font: regular,
        color: NAVY,
      });
    });
    page.drawText(String(item.qty), { x: MARGIN + 304, y, size: 9, font: regular, color: NAVY });
    page.drawText(money(item.unitPrice), { x: MARGIN + 348, y, size: 9, font: regular, color: NAVY });
    page.drawText(money(item.lineTotal), { x: MARGIN + 422, y, size: 9, font: bold, color: NAVY });
    y -= height;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.4,
      color: LINE,
    });
    y -= 8;
  }

  y -= 8;
  const totals: Array<[string, string]> = [
    ["Goods net", money(source.subtotal)],
    ["Delivery", money(source.deliveryTotal)],
    ["VAT", money(source.vatTotal)],
    ["Gross total", money(source.grandTotal)],
  ];
  for (const [label, value] of totals) {
    ensure(18);
    const strong = label === "Gross total";
    text(label, 360, strong ? 11 : 10, strong ? bold : regular);
    const font = strong ? bold : regular;
    page.drawText(value, {
      x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(value, strong ? 11 : 10),
      y,
      size: strong ? 11 : 10,
      font,
      color: NAVY,
    });
    y -= 16;
  }

  const notes = [
    source.customerNotes ? `Notes\n${source.customerNotes}` : "Notes\nNo customer notes are saved on this quote.",
    source.internalNotes ? `Internal notes\n${source.internalNotes}` : null,
    source.paymentTerms
      ? `Terms\n${source.paymentTerms}`
      : "Terms\nPayment terms were not saved on this quote.",
  ].filter((section): section is string => Boolean(section));

  y -= 8;
  for (const section of notes) {
    const [heading = "Notes", ...rest] = section.split("\n");
    ensure(28);
    text(heading.toUpperCase(), MARGIN, 9, bold, RED);
    y -= 14;
    const body = rest.join(" ").trim();
    if (!body) continue;
    for (const wrapped of wrap(body, regular, 10, PAGE_WIDTH - MARGIN * 2)) {
      ensure(14);
      text(wrapped, MARGIN, 10, regular);
      y -= 13;
    }
    y -= 8;
  }

  const pages = doc.getPages();
  pages.forEach((printed, index) => {
    printed.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: MARGIN,
      y: 24,
      size: 8,
      font: regular,
      color: MUTED,
    });
    printed.drawText("Prices and quantities are the saved quotation.", {
      x: 250,
      y: 24,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  doc.setTitle(`${source.quoteNumber} quotation`);
  doc.setAuthor("Automotive Brands");
  return doc.save();
}
