import { products } from "./data";

/* ------------------------------------------------------------------ */
/* Public site content                                                  */
/* ------------------------------------------------------------------ */

export const categories = [
  { name: "Braking", lines: "Discs, pads, calipers, fluid", brand: "Power Maxed" },
  { name: "Engine Chemicals", lines: "Sealants, additives, cleaners", brand: "Steel Seal" },
  { name: "Wheels & Tyres", lines: "Alloys, spacers, fixings", brand: "Street Rhino" },
  { name: "Batteries & Electrical", lines: "Batteries, chargers, alternators", brand: "Bramley Power" },
  { name: "Lighting", lines: "LED bars, bulbs, work lamps", brand: "Street Rhino" },
  { name: "Servicing & Consumables", lines: "Filters, oils, workshop supplies", brand: "Power Maxed" },
  { name: "Child Safety", lines: "Seats, boosters, mirrors", brand: "Kidzmotion" },
  { name: "Body & Protection", lines: "Bars, steps, arch kits", brand: "Street Rhino" },
];

export const news = [
  {
    title: "Power Maxed braking range extended across 240 additional applications",
    kind: "Range update",
    date: "11/09/2026",
    summary:
      "New disc and pad references cover recent PSA, VAG and Ford light commercial platforms, all ECE R90 approved.",
  },
  {
    title: "Steel Seal case pricing confirmed for Q4 counter promotions",
    kind: "Promotion",
    date: "04/09/2026",
    summary:
      "Counter display cases and point-of-sale artwork are available to order alongside the chemical range.",
  },
  {
    title: "Bramley Power winter battery stock plan now open to trade accounts",
    kind: "Trade notice",
    date: "28/08/2026",
    summary:
      "Reserve winter battery volume ahead of the seasonal peak with agreed call-off dates and pallet pricing.",
  },
];

export const tradeCustomerTypes = [
  { name: "Motor factors", detail: "Counter and van stock across five brands on one delivery." },
  { name: "Workshops & garages", detail: "Fast reordering of the consumables you fit every day." },
  { name: "Retailers", detail: "Retail-ready packaging with approved imagery and POS." },
  { name: "Distributors", detail: "Contract pricing, call-off volume and pallet despatch." },
  { name: "Buying groups", detail: "Group terms applied automatically at the point of ordering." },
  { name: "Fleet & commercial", detail: "Consolidated ordering across multiple sites and depots." },
];

/* ------------------------------------------------------------------ */
/* Commercial mock records                                              */
/* ------------------------------------------------------------------ */

export type QuoteStatus = "Draft" | "Sent" | "Viewed" | "Accepted" | "Rejected" | "Expired";

export interface QuoteLine {
  sku: string;
  name: string;
  qty: number;
  unit: number;
  discount: number;
}

export interface Quote {
  id: string;
  company: string;
  customerId: string;
  contact: string;
  owner: string;
  created: string;
  expires: string;
  status: QuoteStatus;
  notes: string;
  lines: QuoteLine[];
}

export const quotes: Quote[] = [
  {
    id: "AB-10428",
    company: "ABC Motor Factors Ltd",
    customerId: "abc-motor-factors",
    contact: "Karen Doyle",
    owner: "James Whitfield",
    created: "08/09/2026",
    expires: "22/09/2026",
    status: "Sent",
    notes: "Display stand included free of charge on first order of 24 units.",
    lines: [
      { sku: "PM-4410", name: "Ceramic Brake Disc Kit 310mm", qty: 24, unit: 42.4, discount: 0 },
      { sku: "PM-2201", name: "Brake Caliper Grease 500g", qty: 12, unit: 6.1, discount: 5 },
      { sku: "SS-2287", name: "Head Gasket Sealer 500ml", qty: 24, unit: 11.4, discount: 0 },
    ],
  },
  {
    id: "AB-10431",
    company: "Seaforth Motor Spares",
    customerId: "seaforth-motor-spares",
    contact: "Alan Prentice",
    owner: "Priya Nayar",
    created: "11/09/2026",
    expires: "25/09/2026",
    status: "Viewed",
    notes: "Case pricing agreed verbally — awaiting purchase order.",
    lines: [
      { sku: "SS-2287", name: "Head Gasket Sealer 500ml", qty: 120, unit: 10.6, discount: 0 },
      { sku: "SS-1104", name: "RTV Silicone Gasket Maker", qty: 240, unit: 3.9, discount: 2.5 },
    ],
  },
  {
    id: "AB-10436",
    company: "Penrose Autoparts",
    customerId: "penrose-autoparts",
    contact: "Marie Penrose",
    owner: "James Whitfield",
    created: "13/09/2026",
    expires: "27/09/2026",
    status: "Draft",
    notes: "Kidzmotion retail rollout — six branches, staged delivery.",
    lines: [
      { sku: "KZ-0710", name: "Group 2/3 High Back Booster", qty: 60, unit: 31.8, discount: 0 },
    ],
  },
  {
    id: "AB-10402",
    company: "ABC Motor Factors Ltd",
    customerId: "abc-motor-factors",
    contact: "Karen Doyle",
    owner: "James Whitfield",
    created: "12/08/2026",
    expires: "26/08/2026",
    status: "Accepted",
    notes: "Converted to order AB-9714.",
    lines: [{ sku: "BP-5540", name: "AGM Battery 80Ah", qty: 18, unit: 78.4, discount: 0 }],
  },
  {
    id: "AB-10388",
    company: "Northgate Garage Group",
    customerId: "northgate-garage-group",
    contact: "Ryan Dodds",
    owner: "James Whitfield",
    created: "22/07/2026",
    expires: "05/08/2026",
    status: "Expired",
    notes: "No response after three follow-ups.",
    lines: [{ sku: "PM-4410", name: "Ceramic Brake Disc Kit 310mm", qty: 40, unit: 41.2, discount: 0 }],
  },
];

export const quoteTotal = (q: Quote) =>
  q.lines.reduce((s, l) => s + l.qty * l.unit * (1 - l.discount / 100), 0);

export interface Contact {
  id: string;
  customerId: string;
  name: string;
  jobTitle: string;
  department: string;
  role: "Owner" | "Buyer" | "Accounts" | "Branch Manager" | "Marketing" | "Other";
  telephone: string;
  mobile: string;
  email: string;
  preferred: "Telephone" | "Mobile" | "Email";
  lastContact: string;
}

export const contacts: Contact[] = [
  {
    id: "c-1",
    customerId: "abc-motor-factors",
    name: "Karen Doyle",
    jobTitle: "Purchasing Manager",
    department: "Buying",
    role: "Buyer",
    telephone: "0121 496 0114",
    mobile: "07700 900431",
    email: "karen@abcmotorfactors.co.uk",
    preferred: "Mobile",
    lastContact: "Today",
  },
  {
    id: "c-2",
    customerId: "abc-motor-factors",
    name: "Derek Hallam",
    jobTitle: "Managing Director",
    department: "Board",
    role: "Owner",
    telephone: "0121 496 0110",
    mobile: "07700 900118",
    email: "derek@abcmotorfactors.co.uk",
    preferred: "Telephone",
    lastContact: "04/09/2026",
  },
  {
    id: "c-3",
    customerId: "abc-motor-factors",
    name: "Sue Marchant",
    jobTitle: "Accounts Supervisor",
    department: "Finance",
    role: "Accounts",
    telephone: "0121 496 0122",
    mobile: "—",
    email: "accounts@abcmotorfactors.co.uk",
    preferred: "Email",
    lastContact: "29/08/2026",
  },
  {
    id: "c-4",
    customerId: "abc-motor-factors",
    name: "Tom Ashby",
    jobTitle: "Branch Manager — Tyseley",
    department: "Trade counter",
    role: "Branch Manager",
    telephone: "0121 496 0140",
    mobile: "07700 900622",
    email: "tyseley@abcmotorfactors.co.uk",
    preferred: "Mobile",
    lastContact: "12/09/2026",
  },
  {
    id: "c-5",
    customerId: "seaforth-motor-spares",
    name: "Alan Prentice",
    jobTitle: "Owner",
    department: "Board",
    role: "Owner",
    telephone: "0151 933 2210",
    mobile: "07700 900884",
    email: "alan@seaforthspares.co.uk",
    preferred: "Mobile",
    lastContact: "11/09/2026",
  },
];

export interface Invoice {
  id: string;
  order: string;
  date: string;
  due: string;
  value: number;
  status: "Paid" | "Due" | "Overdue";
}

export const invoices: Invoice[] = [
  { id: "INV-88214", order: "AB-9821", date: "10/09/2026", due: "10/10/2026", value: 1496.88, status: "Due" },
  { id: "INV-88190", order: "AB-9714", date: "28/08/2026", due: "27/09/2026", value: 1693.44, status: "Due" },
  { id: "INV-88122", order: "AB-9644", date: "12/08/2026", due: "11/09/2026", value: 842.3, status: "Overdue" },
  { id: "INV-88041", order: "AB-9588", date: "24/07/2026", due: "23/08/2026", value: 2210.16, status: "Paid" },
];

export const monthlySales = [
  { month: "Oct 25", value: 2940, ly: 2610 },
  { month: "Nov 25", value: 3480, ly: 3120 },
  { month: "Dec 25", value: 2210, ly: 2380 },
  { month: "Jan 26", value: 3150, ly: 2740 },
  { month: "Feb 26", value: 3620, ly: 2980 },
  { month: "Mar 26", value: 4180, ly: 3410 },
  { month: "Apr 26", value: 4120, ly: 3650 },
  { month: "May 26", value: 5380, ly: 4020 },
  { month: "Jun 26", value: 4890, ly: 4110 },
  { month: "Jul 26", value: 6210, ly: 4480 },
  { month: "Aug 26", value: 5740, ly: 4260 },
  { month: "Sep 26", value: 3980, ly: 4390 },
];

export const salesByBrand = [
  { brand: "Steel Seal", value: 16240, change: -34 },
  { brand: "Power Maxed", value: 11880, change: 12 },
  { brand: "Bramley Power", value: 7460, change: 4 },
  { brand: "Street Rhino", value: 2840, change: -6 },
  { brand: "Kidzmotion", value: 0, change: 0 },
];

export const topProducts = products.slice(0, 6).map((p, i) => ({
  sku: p.sku,
  name: p.name,
  brand: p.brand,
  qty: [148, 96, 72, 54, 40, 26][i] ?? 20,
  value: [6240, 4180, 3120, 2460, 1880, 1240][i] ?? 900,
}));

export interface Insight {
  id: string;
  tone: "warn" | "info" | "brand" | "bad";
  title: string;
  body: string;
  action: string;
}

export const accountInsights: Insight[] = [
  {
    id: "i1",
    tone: "warn",
    title: "Order frequency has slipped",
    body: "Customer normally orders every 14 days. Last order was 31 days ago.",
    action: "Log call",
  },
  {
    id: "i2",
    tone: "bad",
    title: "Steel Seal purchasing down 34%",
    body: "Steel Seal purchasing is down 34% compared with the previous 90 days.",
    action: "Review lines",
  },
  {
    id: "i3",
    tone: "info",
    title: "Cross-sell opportunity",
    body: "Customer purchases Steel Seal but currently buys no Power Maxed products.",
    action: "Build quote",
  },
  {
    id: "i4",
    tone: "brand",
    title: "Quote open 7 days",
    body: "Quote AB-10428 worth £2,840 has been open for 7 days.",
    action: "Chase quote",
  },
];

export const salesTeam = [
  { name: "James Whitfield", region: "Midlands", mtd: 68420, target: 95000, pipeline: 84640, quotes: 6, conversion: 41, accounts: 62 },
  { name: "Priya Nayar", region: "North West", mtd: 81250, target: 90000, pipeline: 61300, quotes: 9, conversion: 48, accounts: 71 },
  { name: "Dee Okafor", region: "South East", mtd: 54900, target: 85000, pipeline: 47820, quotes: 4, conversion: 33, accounts: 55 },
  { name: "Mark Ellison", region: "Scotland & North", mtd: 39680, target: 60000, pipeline: 28140, quotes: 3, conversion: 37, accounts: 38 },
];

export type ApplicationStatus =
  | "New"
  | "Under Review"
  | "More Information Required"
  | "Approved"
  | "Rejected";

export interface Application {
  id: string;
  company: string;
  type: string;
  town: string;
  submitted: string;
  status: ApplicationStatus;
  companyNumber: string;
  vat: string;
  tradingAddress: string;
  deliveryAddress: string;
  contact: string;
  contactRole: string;
  accountsContact: string;
  telephone: string;
  email: string;
  website: string;
  volume: string;
  interest: string[];
  documents: { name: string; type: string; size: string }[];
}

export const applications: Application[] = [
  {
    id: "APP-2026-0418",
    company: "Fairoak Autocentre Ltd",
    type: "Workshop / garage",
    town: "Derby",
    submitted: "Today, 09:14",
    status: "New",
    companyNumber: "09881245",
    vat: "GB 344 1120 88",
    tradingAddress: "Unit 6 Fairoak Trading Estate, Derby, DE21 6BR",
    deliveryAddress: "As trading address",
    contact: "Lisa Farrow",
    contactRole: "Owner",
    accountsContact: "Lisa Farrow",
    telephone: "01332 660 114",
    email: "lisa@fairoakauto.co.uk",
    website: "fairoakauto.co.uk",
    volume: "£1,000 – £2,500 per month",
    interest: ["Power Maxed", "Steel Seal"],
    documents: [
      { name: "Headed letter", type: "PDF", size: "180 KB" },
      { name: "VAT certificate", type: "PDF", size: "94 KB" },
    ],
  },
  {
    id: "APP-2026-0417",
    company: "Kestrel Vehicle Parts Ltd",
    type: "Motor factor",
    town: "Norwich",
    submitted: "Yesterday, 16:40",
    status: "Under Review",
    companyNumber: "11204778",
    vat: "GB 288 4410 21",
    tradingAddress: "14 Mousehold Way, Norwich, NR3 1LR",
    deliveryAddress: "14 Mousehold Way, Norwich, NR3 1LR",
    contact: "Gary Sandell",
    contactRole: "Purchasing Manager",
    accountsContact: "Nina Bell",
    telephone: "01603 221 480",
    email: "gary@kestrelparts.co.uk",
    website: "kestrelparts.co.uk",
    volume: "£5,000 – £10,000 per month",
    interest: ["Power Maxed", "Bramley Power", "Street Rhino"],
    documents: [
      { name: "Trade references", type: "PDF", size: "240 KB" },
      { name: "Companies House filing", type: "PDF", size: "310 KB" },
    ],
  },
  {
    id: "APP-2026-0414",
    company: "Bexley Tyre & Exhaust",
    type: "Workshop / garage",
    town: "Bexleyheath",
    submitted: "12/09/2026",
    status: "More Information Required",
    companyNumber: "07741220",
    vat: "Not supplied",
    tradingAddress: "88 Erith Road, Bexleyheath, DA7 6HA",
    deliveryAddress: "As trading address",
    contact: "Sam Oduya",
    contactRole: "Director",
    accountsContact: "Sam Oduya",
    telephone: "020 8300 2211",
    email: "sam@bexleytyre.co.uk",
    website: "—",
    volume: "£500 – £1,000 per month",
    interest: ["Street Rhino"],
    documents: [{ name: "Headed letter", type: "PDF", size: "120 KB" }],
  },
  {
    id: "APP-2026-0409",
    company: "Tamar Vehicle Supplies Ltd",
    type: "Distributor",
    town: "Plymouth",
    submitted: "08/09/2026",
    status: "Approved",
    companyNumber: "05512308",
    vat: "GB 190 4482 10",
    tradingAddress: "Faraday Mill, Plymouth, PL4 0ST",
    deliveryAddress: "Faraday Mill Goods In, Plymouth, PL4 0ST",
    contact: "Helen Vickers",
    contactRole: "Head of Buying",
    accountsContact: "Paul Vickers",
    telephone: "01752 440 118",
    email: "helen@tamarvs.co.uk",
    website: "tamarvs.co.uk",
    volume: "£10,000+ per month",
    interest: ["Power Maxed", "Steel Seal", "Bramley Power", "Kidzmotion"],
    documents: [
      { name: "Trade references", type: "PDF", size: "210 KB" },
      { name: "Credit application", type: "PDF", size: "340 KB" },
    ],
  },
  {
    id: "APP-2026-0402",
    company: "Redline Car Spares",
    type: "Retailer",
    town: "Swansea",
    submitted: "02/09/2026",
    status: "Rejected",
    companyNumber: "Not supplied",
    vat: "Not supplied",
    tradingAddress: "22 High Street, Swansea, SA1 1LG",
    deliveryAddress: "As trading address",
    contact: "Owen Price",
    contactRole: "Owner",
    accountsContact: "Owen Price",
    telephone: "01792 110 224",
    email: "owen@redlinespares.co.uk",
    website: "—",
    volume: "Under £500 per month",
    interest: ["Kidzmotion"],
    documents: [],
  },
];

export const priceGroups = ["Trade List", "Trade A", "Trade B", "Trade C", "Distributor", "Buying Group"];
export const paymentTermsOptions = ["Pro-forma", "30 Days Net", "45 Days Net", "60 Days Net"];

export const deliveryAddresses = [
  { id: "d1", label: "Main branch — Tyseley", line: "Unit 12 Kings Road Industrial Park, Birmingham, B11 2AU" },
  { id: "d2", label: "Branch — Wolverhampton", line: "44 Steelhouse Way, Wolverhampton, WV2 4NG" },
  { id: "d3", label: "Branch — Coventry", line: "Bay 3 Herald Trade Park, Coventry, CV3 4FH" },
];

export const usualProducts = products.slice(0, 5).map((p, i) => ({
  sku: p.sku,
  name: p.name,
  qty: [24, 12, 6, 4, 8][i] ?? 6,
}));

export const opportunityDetail = {
  probability: 65,
  source: "Trade counter visit",
  competitor: "Current supplier — Unipart",
  brandsInvolved: ["Power Maxed", "Steel Seal"],
  rangesInvolved: ["Braking — discs and pads", "Engine chemicals — sealants"],
  primaryContact: "Karen Doyle",
};

export const managerTotals = {
  mtd: 244250,
  ytd: 1984600,
  target: 330000,
  newAccounts: 18,
  lostAccounts: 5,
  conversion: 41,
};
