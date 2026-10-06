/**
 * Sanitised Autopart day-end 504 TXT fixture.
 *
 * Mirrors the production report: Autopart System banner, title
 * LISTING OF INVOICES AND CREDITS BY CUSTOMER TYPE (504), fixed-width
 * columns, repeated page headers, ACCOUNT + CONSOL rows, and report totals.
 *
 * Document column is 9 characters so OIN025730 sits flush against 06 Oct 26
 * (OIN02573006 visually) — a formatting artefact, not the document number.
 *
 * Header label starts (production):
 * Type 0, Document 10, Date 19, Time 29, Name 35,
 * Goods 71, Vat 82, Value 92, Inits 98, Customer Order Number 105
 *
 * Goods/VAT amounts may overflow the naive Goods→Vat slice; the parser
 * recovers the three money tokens from the Goods…Inits span.
 */

function padEnd(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value + " ".repeat(width - value.length);
}

function money(value: string, width: number): string {
  return value.padStart(width, " ");
}

/** Production day-end column header — spacing is significant. */
export const AUTOPART_504_DAYEND_HEADER =
  "Type      Document Date      Time  Name.............................   Goods      Vat       Value Inits  Customer Order Number";

export const AUTOPART_504_DAYEND_SEPARATOR =
  "----------------------------------------------------------------------------------------------------------------------------------";

export const AUTOPART_504_DAYEND_TITLE = "LISTING OF INVOICES AND CREDITS BY CUSTOMER TYPE (504)";

/**
 * Authoritative production example: document OIN025730 flush against 06 Oct 26.
 * Do not treat OIN02573006 as the document number.
 */
export const AUTOPART_504_DAYEND_SAMPLE_OIN_ROW =
  "ACCOUNT   OIN02573006 Oct 26 10:54 Retail Amazon                       49.99    10.00       59.99 WR     206-1152538-1059517";

export function format504DayEndRow(args: {
  type: string;
  document: string;
  date: string;
  time: string;
  name: string;
  goods: string;
  vat: string;
  value: string;
  inits: string;
  orderNumber: string;
}): string {
  // Widths follow production header label starts:
  // Type 10, Document 9, Date 10, Time 6, Name 36,
  // Goods 10 + Vat 10 + Value 7 = 27 through Inits at 98, Inits 7, then order.
  return (
    padEnd(args.type, 10) +
    padEnd(args.document, 9) +
    padEnd(args.date, 10) +
    padEnd(args.time, 6) +
    padEnd(args.name, 36) +
    money(args.goods, 10) +
    money(args.vat, 10) +
    money(args.value, 7) +
    padEnd(args.inits, 7) +
    args.orderNumber
  );
}

function banner(page: number): string[] {
  return [
    `Page : ${page}            **********************************   11:02:24   06 Oct 2026`,
    "                    *  A U T O P A R T  S Y S T E M  *",
    "                    **********************************",
    "",
    AUTOPART_504_DAYEND_TITLE,
    "            [Select Branch ALL] [Start Date 06/10/2026] [Ending Date 06/10/2026]",
    AUTOPART_504_DAYEND_HEADER,
    AUTOPART_504_DAYEND_SEPARATOR,
  ];
}

export function buildAutopart504DayEndFixture(opts?: { includeCredit?: boolean; malformed?: boolean }): string {
  const rows = [
    AUTOPART_504_DAYEND_SAMPLE_OIN_ROW,
    format504DayEndRow({
      type: "ACCOUNT",
      document: "SS306229",
      date: "06 Oct 26",
      time: "08:06",
      name: "Car Shop Pit Stop Ltd",
      goods: "416.74",
      vat: "83.35",
      value: "500.09",
      inits: "RS",
      orderNumber: "KEITH051026",
    }),
    format504DayEndRow({
      type: "ACCOUNT",
      document: "SS306251",
      date: "06 Oct 26",
      time: "10:33",
      name: "RR Leisureways (Two) Ltd",
      goods: "579.38",
      vat: "115.88",
      value: "695.26",
      inits: "RS",
      orderNumber: "RPO0086648",
    }),
    format504DayEndRow({
      type: "CONSOL",
      document: "SS306238",
      date: "06 Oct 26",
      time: "09:21",
      name: "VERTU Motors",
      goods: "116.40",
      vat: "23.28",
      value: "139.68",
      inits: "RS",
      orderNumber: "157286-9176672",
    }),
    format504DayEndRow({
      type: "ACCOUNT",
      document: "SS306244",
      date: "06 Oct 26",
      time: "09:24",
      name: "Retail Power Maxed Orders",
      goods: "22.00",
      vat: "4.40",
      value: "26.40",
      inits: "PM",
      orderNumber: "PM13719",
    }),
  ];
  if (opts?.includeCredit) {
    rows.push(
      format504DayEndRow({
        type: "ACCOUNT",
        document: "SC100099",
        date: "06 Oct 26",
        time: "11:00",
        name: "Example Credit Customer",
        goods: "-10.00",
        vat: "-2.00",
        value: "-12.00",
        inits: "WR",
        orderNumber: "AB-001234",
      }),
    );
  }
  if (opts?.malformed) {
    rows.push(
      format504DayEndRow({
        type: "ACCOUNT",
        document: "SS306999",
        date: "06 Oct 26",
        time: "12:00",
        name: "Broken Amounts Customer",
        goods: "N/A",
        vat: "N/A",
        value: "N/A",
        inits: "XX",
        orderNumber: "BAD-ROW",
      }),
    );
  }

  const page2 = [
    ...banner(2),
    format504DayEndRow({
      type: "CONSOL",
      document: "SS306246",
      date: "06 Oct 26",
      time: "10:08",
      name: "Vertu Motors",
      goods: "80.00",
      vat: "16.00",
      value: "96.00",
      inits: "RS",
      orderNumber: "WEB-99",
    }),
    format504DayEndRow({
      type: "ACCOUNT",
      document: "SS306239",
      date: "06 Oct 26",
      time: "09:21",
      name: "Retail Web Orders",
      goods: "33.50",
      vat: "6.70",
      value: "40.20",
      inits: "WB",
      orderNumber: "SR2232",
    }),
  ];

  return [
    ...banner(1),
    ...rows,
    "---------",
    "         7315.17   1463.08    8778.25",
    ...page2,
    "---------",
    "          463.92     92.77     556.69",
    "---------",
    "         7779.09   1555.85    9334.94",
    "",
  ].join("\n");
}
