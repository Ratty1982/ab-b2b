/**
 * Representative Autopart 504C fixed-width fixture.
 * Header labels match the real report:
 * Document Date Time .Acct. Customer Name Goods Vat Value Inits Customer Order Number
 *
 * Includes AB invoices, AB credit, Amazon/eBay/web (non-AB), subtotals.
 */

function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value + " ".repeat(width - value.length);
}

function money(value: string, width = 10): string {
  return value.padStart(width, " ");
}

/** Build one aligned 504C data line using the canonical header positions. */
export function format504cDataRow(args: {
  document: string;
  date: string;
  time: string;
  account: string;
  customer: string;
  goods: string;
  vat: string;
  value: string;
  inits: string;
  orderNumber: string;
}): string {
  // Widths must match AUTOPART_504C_HEADER label starts (detectLayout):
  // Document 10, Date 11, Time 6, Acct 8, Customer 28, Goods 14, Vat 10, Value 10, Inits 6, Order…
  return (
    pad(args.document, 10) +
    pad(args.date, 11) +
    pad(args.time, 6) +
    pad(args.account, 8) +
    pad(args.customer, 28) +
    money(args.goods, 14) +
    money(args.vat, 10) +
    money(args.value, 10) +
    pad(` ${args.inits}`.slice(0, 6), 6) +
    pad(args.orderNumber, 24)
  );
}

/**
 * Header labels at fixed columns — Value/Inits/Goods wide enough for Autopart amounts.
 * Positions used by detectLayout via label indexOf.
 */
export const AUTOPART_504C_HEADER =
  "Document  Date       Time  .Acct.  Customer Name               Goods         Vat       Value     Inits Customer Order Number";

export const AUTOPART_504C_SEPARATOR =
  "--------- ---------- ----- ------- --------------------------- ------------ --------- --------- ----- -----------------------";


export function buildAutopart504cSampleFixture(): string {
  const lines = [
    "AUTOPART SYSTEM",
    "LISTING OF INVOICES AND CREDITS BY CUSTOMER (504C)",
    "Page : 1",
    "",
    AUTOPART_504C_HEADER,
    AUTOPART_504C_SEPARATOR,
    format504cDataRow({
      document: "I123456",
      date: "25/09/2026",
      time: "14:12",
      account: "AB001",
      customer: "EXAMPLE MOTOR FACTORS",
      goods: "44.28",
      vat: "10.05",
      value: "60.28",
      inits: "WR",
      orderNumber: "AB-000002",
    }),
    format504cDataRow({
      document: "I123457",
      date: "25/09/2026",
      time: "14:18",
      account: "AB001",
      customer: "EXAMPLE MOTOR FACTORS",
      goods: "150.00",
      vat: "30.00",
      value: "180.00",
      inits: "WR",
      orderNumber: "AB-000003",
    }),
    format504cDataRow({
      document: "C998877",
      date: "25/09/2026",
      time: "14:40",
      account: "AB001",
      customer: "EXAMPLE MOTOR FACTORS",
      goods: "-12.00",
      vat: "-2.40",
      value: "-14.40",
      inits: "WR",
      orderNumber: "AB-000002",
    }),
    "  CUSTOMER TOTAL AB001                                                   182.28    37.65    225.88",
    format504cDataRow({
      document: "I555001",
      date: "25/09/2026",
      time: "13:05",
      account: "AMZ01",
      customer: "AMAZON EU SARL",
      goods: "22.00",
      vat: "4.40",
      value: "26.40",
      inits: "AZ",
      orderNumber: "026-1234567-8901234",
    }),
    format504cDataRow({
      document: "I555002",
      date: "25/09/2026",
      time: "13:22",
      account: "EBY01",
      customer: "EBAY CHANNEL",
      goods: "9.50",
      vat: "1.90",
      value: "11.40",
      inits: "EB",
      orderNumber: "12-34567-89012",
    }),
    format504cDataRow({
      document: "I555003",
      date: "25/09/2026",
      time: "13:45",
      account: "WEB01",
      customer: "WEB SHOP CUSTOMER",
      goods: "35.00",
      vat: "7.00",
      value: "42.00",
      inits: "WS",
      orderNumber: "WEB-998877",
    }),
    format504cDataRow({
      document: "I555004",
      date: "25/09/2026",
      time: "15:01",
      account: "TRD99",
      customer: "OTHER TRADE LTD",
      goods: "100.00",
      vat: "20.00",
      value: "120.00",
      inits: "JD",
      orderNumber: "PO696969",
    }),
    "",
    "*** END OF REPORT ***",
  ];
  return lines.join("\r\n");
}
