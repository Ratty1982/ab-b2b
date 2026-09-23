import brakeDisc from "@/assets/prod-brake-disc.jpg";
import gasket from "@/assets/prod-gasket.jpg";
import wheel from "@/assets/prod-wheel.jpg";
import battery from "@/assets/prod-battery.jpg";

export const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export const gbp0 = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);

export type Stock = "in" | "low" | "backorder" | "out";

export interface QtyBreak {
  qty: number;
  price: number;
}

export interface Product {
  sku: string;
  name: string;
  brand: string;
  category: string;
  type: string;
  trade: number;
  rrp: number;
  stock: Stock;
  stockQty: number;
  packQty: number;
  caseQty: number;
  vat: "standard" | "zero";
  image: string;
  breaks: QtyBreak[];
  description: string;
  features: string[];
  specs: { label: string; value: string }[];
  applications?: string[];
  downloads: { name: string; type: string; size: string }[];
}

export const brands = [
  {
    slug: "power-maxed",
    name: "Power Maxed",
    category: "Performance Parts",
    blurb: "Braking, clutch and drivetrain components engineered for the UK aftermarket.",
    lines: 4820,
  },
  {
    slug: "steel-seal",
    name: "Steel Seal",
    category: "Gaskets & Seals",
    blurb: "Sealants, gaskets and chemical repair products trusted by workshops.",
    lines: 1140,
  },
  {
    slug: "street-rhino",
    name: "Street Rhino",
    category: "Off-Road & 4x4",
    blurb: "Wheels, lighting and protection for the 4x4 and light commercial market.",
    lines: 2260,
  },
  {
    slug: "bramley-power",
    name: "Bramley Power",
    category: "Electrical & Battery",
    blurb: "Batteries, charging and starting components with full UK warranty support.",
    lines: 980,
  },
  {
    slug: "kidzmotion",
    name: "Kidzmotion",
    category: "Child Safety",
    blurb: "Child seats, boosters and in-car safety accessories for retail ranges.",
    lines: 410,
  },
];

export const products: Product[] = [
  {
    sku: "PM-4410",
    name: "Ceramic Brake Disc Kit 310mm",
    brand: "Power Maxed",
    category: "Braking",
    type: "Brake Discs",
    trade: 46.8,
    rrp: 61.2,
    stock: "in",
    stockQty: 412,
    packQty: 2,
    caseQty: 8,
    vat: "standard",
    image: brakeDisc,
    breaks: [
      { qty: 1, price: 46.8 },
      { qty: 4, price: 44.9 },
      { qty: 12, price: 42.4 },
      { qty: 48, price: 39.95 },
    ],
    description:
      "Vented ceramic-coated front brake disc kit for high-duty applications. Supplied as a matched pair with fitting hardware, finished with a corrosion-resistant coating for extended shelf and service life.",
    features: [
      "Matched pair, balanced to 5g",
      "Ceramic anti-corrosion coating",
      "ECE R90 approved",
      "Fitting hardware included",
    ],
    specs: [
      { label: "Diameter", value: "310mm" },
      { label: "Thickness", value: "28mm" },
      { label: "Type", value: "Vented" },
      { label: "Bolt pattern", value: "5 x 112" },
      { label: "Approval", value: "ECE R90" },
      { label: "Weight", value: "9.4kg per pair" },
    ],
    applications: [
      "Audi A4 B8 2.0 TDI (2008–2015)",
      "VW Passat B7 2.0 TDI (2010–2014)",
      "Skoda Superb II 2.0 TDI (2008–2015)",
    ],
    downloads: [
      { name: "Fitting Instructions", type: "PDF", size: "840 KB" },
      { name: "ECE R90 Certificate", type: "PDF", size: "210 KB" },
      { name: "Product Imagery Pack", type: "ZIP", size: "18.2 MB" },
    ],
  },
  {
    sku: "SS-2287",
    name: "Head Gasket Set Pro",
    brand: "Steel Seal",
    category: "Engine",
    type: "Gaskets",
    trade: 28.4,
    rrp: 39.99,
    stock: "backorder",
    stockQty: 0,
    packQty: 1,
    caseQty: 4,
    vat: "standard",
    image: gasket,
    breaks: [
      { qty: 1, price: 28.4 },
      { qty: 4, price: 27.1 },
      { qty: 20, price: 25.6 },
    ],
    description:
      "Complete multi-layer steel head gasket set including valve stem seals, cam cover gasket and manifold gaskets. Engineered for repeat-repair reliability in independent workshops.",
    features: [
      "Multi-layer steel construction",
      "Complete set — 38 pieces",
      "OE-equivalent material spec",
      "Temperature rated to 320°C",
    ],
    specs: [
      { label: "Pieces", value: "38" },
      { label: "Material", value: "MLS / NBR" },
      { label: "Bore", value: "82.5mm" },
      { label: "Temp rating", value: "320°C" },
    ],
    applications: ["Ford 2.0 EcoBlue (2016–)", "Ford Transit Custom 2.0 TDCi (2016–)"],
    downloads: [
      { name: "Technical Data Sheet", type: "PDF", size: "620 KB" },
      { name: "Safety Data Sheet", type: "PDF", size: "310 KB" },
    ],
  },
  {
    sku: "SR-8812",
    name: 'Alloy Wheel 18" 5x120 Matte Gunmetal',
    brand: "Street Rhino",
    category: "Wheels & Tyres",
    type: "Alloy Wheels",
    trade: 112.0,
    rrp: 159.0,
    stock: "in",
    stockQty: 96,
    packQty: 1,
    caseQty: 4,
    vat: "standard",
    image: wheel,
    breaks: [
      { qty: 1, price: 112.0 },
      { qty: 4, price: 106.5 },
      { qty: 16, price: 101.0 },
    ],
    description:
      "Load-rated 18-inch alloy wheel with beadlock-style outer ring, finished in matte gunmetal. Popular fitment across pickup and 4x4 conversions.",
    features: [
      "1,250kg load rating",
      "TÜV documentation available",
      "Matte gunmetal powder coat",
      "Centre cap included",
    ],
    specs: [
      { label: "Diameter", value: '18"' },
      { label: "Width", value: '9J' },
      { label: "PCD", value: "5 x 120" },
      { label: "Offset", value: "ET20" },
      { label: "Load rating", value: "1,250kg" },
    ],
    applications: ["VW Amarok (2010–)", "Ford Ranger T6 (2011–)", "Isuzu D-Max (2012–)"],
    downloads: [
      { name: "TÜV Report", type: "PDF", size: "1.4 MB" },
      { name: "Marketing Imagery", type: "ZIP", size: "26.8 MB" },
    ],
  },
  {
    sku: "BP-5540",
    name: "AGM Battery 12V 95Ah 850CCA",
    brand: "Bramley Power",
    category: "Electrical",
    type: "Batteries",
    trade: 89.99,
    rrp: 139.0,
    stock: "in",
    stockQty: 240,
    packQty: 1,
    caseQty: 2,
    vat: "standard",
    image: battery,
    breaks: [
      { qty: 1, price: 89.99 },
      { qty: 6, price: 86.5 },
      { qty: 24, price: 82.0 },
    ],
    description:
      "Absorbent glass mat battery for stop-start and high electrical demand vehicles. Three-year pro-rata trade warranty with UK-based claims handling.",
    features: [
      "Stop-start compatible",
      "3 year trade warranty",
      "850 CCA cold cranking",
      "Fully sealed, maintenance free",
    ],
    specs: [
      { label: "Voltage", value: "12V" },
      { label: "Capacity", value: "95Ah" },
      { label: "CCA", value: "850A" },
      { label: "Terminal", value: "0 (right positive)" },
      { label: "Dimensions", value: "353 x 175 x 190mm" },
    ],
    downloads: [
      { name: "Safety Data Sheet", type: "PDF", size: "420 KB" },
      { name: "Warranty Terms", type: "PDF", size: "180 KB" },
    ],
  },
  {
    sku: "PM-2201",
    name: "Performance Brake Pad Set Front",
    brand: "Power Maxed",
    category: "Braking",
    type: "Brake Pads",
    trade: 21.4,
    rrp: 32.5,
    stock: "in",
    stockQty: 1860,
    packQty: 4,
    caseQty: 10,
    vat: "standard",
    image: brakeDisc,
    breaks: [
      { qty: 1, price: 21.4 },
      { qty: 10, price: 20.1 },
      { qty: 50, price: 18.75 },
    ],
    description:
      "Low-dust ceramic friction compound front pad set with shims and wear sensor. High-volume fast-moving line.",
    features: ["Low dust compound", "Shims and sensor included", "ECE R90 approved"],
    specs: [
      { label: "Position", value: "Front axle" },
      { label: "Compound", value: "Ceramic" },
      { label: "Approval", value: "ECE R90" },
    ],
    downloads: [{ name: "Fitting Instructions", type: "PDF", size: "512 KB" }],
  },
  {
    sku: "SS-1104",
    name: "RTV Silicone Sealant Black 200ml",
    brand: "Steel Seal",
    category: "Chemicals",
    type: "Sealants",
    trade: 4.85,
    rrp: 8.99,
    stock: "in",
    stockQty: 3200,
    packQty: 1,
    caseQty: 24,
    vat: "standard",
    image: gasket,
    breaks: [
      { qty: 1, price: 4.85 },
      { qty: 24, price: 4.35 },
      { qty: 144, price: 3.9 },
    ],
    description:
      "High temperature oxime-cure RTV silicone for engine and gearbox sealing applications. Sold singly or by the case of 24.",
    features: ["-60°C to +300°C", "Oil and coolant resistant", "Non-corrosive cure"],
    specs: [
      { label: "Volume", value: "200ml" },
      { label: "Cure", value: "Oxime" },
      { label: "Temp range", value: "-60°C to +300°C" },
    ],
    downloads: [{ name: "Safety Data Sheet", type: "PDF", size: "290 KB" }],
  },
  {
    sku: "SR-3390",
    name: "LED Light Bar 22in Combo Beam",
    brand: "Street Rhino",
    category: "Lighting",
    type: "Auxiliary Lighting",
    trade: 64.0,
    rrp: 99.0,
    stock: "low",
    stockQty: 14,
    packQty: 1,
    caseQty: 4,
    vat: "standard",
    image: wheel,
    breaks: [
      { qty: 1, price: 64.0 },
      { qty: 4, price: 61.0 },
    ],
    description:
      "Dual-row LED light bar with combination spot and flood optics, IP68 rated housing and pre-wired harness.",
    features: ["IP68 rated", "Harness included", "9–32V input"],
    specs: [
      { label: "Length", value: '22"' },
      { label: "Output", value: "9,600 lumens" },
      { label: "Rating", value: "IP68" },
    ],
    downloads: [{ name: "Wiring Diagram", type: "PDF", size: "340 KB" }],
  },
  {
    sku: "KZ-0710",
    name: "Group 2/3 High Back Booster Seat",
    brand: "Kidzmotion",
    category: "Child Safety",
    type: "Car Seats",
    trade: 32.0,
    rrp: 54.99,
    stock: "in",
    stockQty: 320,
    packQty: 1,
    caseQty: 2,
    vat: "zero",
    image: battery,
    breaks: [
      { qty: 1, price: 32.0 },
      { qty: 6, price: 30.5 },
    ],
    description:
      "ECE R44/04 approved high back booster for 15–36kg. Retail-ready packaging with UK barcode and shelf-hanger.",
    features: ["ECE R44/04 approved", "Retail-ready packaging", "Washable covers"],
    specs: [
      { label: "Group", value: "2/3 (15–36kg)" },
      { label: "Approval", value: "ECE R44/04" },
    ],
    downloads: [{ name: "Approval Certificate", type: "PDF", size: "260 KB" }],
  },
];

export const stockLabel: Record<Stock, string> = {
  in: "In stock",
  low: "Low stock",
  backorder: "Backorder",
  out: "Out of stock",
};

export const account = {
  company: "ABC Motor Factors Ltd",
  number: "ABC001",
  status: "Active",
  manager: "James Whitfield",
  priceGroup: "Trade A",
  terms: "30 Days Net",
  creditLimit: 15000,
  creditUsed: 6060,
};

export const recentOrders = [
  {
    id: "AB-9821",
    po: "PO-44120",
    date: "10/09/2026",
    lines: 12,
    status: "Delivered",
    value: 1247.4,
    delivery: "Next Day",
    tracking: "DPD 7742 1188 4402",
  },
  {
    id: "AB-9840",
    po: "PO-44133",
    date: "12/09/2026",
    lines: 4,
    status: "Dispatched",
    value: 388.6,
    delivery: "Next Day",
    tracking: "DPD 7742 1190 8871",
  },
  {
    id: "AB-9866",
    po: "PO-44158",
    date: "14/09/2026",
    lines: 21,
    status: "Picking",
    value: 2914.05,
    delivery: "Pallet",
    tracking: "—",
  },
  {
    id: "AB-9871",
    po: "PO-44162",
    date: "15/09/2026",
    lines: 6,
    status: "Awaiting Stock",
    value: 512.2,
    delivery: "Next Day",
    tracking: "—",
  },
];

export const customers = [
  {
    id: "abc-motor-factors",
    company: "ABC Motor Factors Ltd",
    number: "ABC001",
    location: "Birmingham",
    manager: "James Whitfield",
    lastOrder: "8 days ago",
    ytd: 38420,
    openOpps: 2,
    nextActivity: "Call — 17/09",
    status: "Active",
    risk: "At risk",
  },
  {
    id: "penrose-autoparts",
    company: "Penrose Autoparts",
    number: "PEN014",
    location: "Bristol",
    manager: "James Whitfield",
    lastOrder: "2 days ago",
    ytd: 74210,
    openOpps: 1,
    nextActivity: "Visit — 22/09",
    status: "Active",
    risk: "High value",
  },
  {
    id: "northgate-garage-group",
    company: "Northgate Garage Group",
    number: "NOR008",
    location: "Leeds",
    manager: "James Whitfield",
    lastOrder: "41 days ago",
    ytd: 12840,
    openOpps: 0,
    nextActivity: "—",
    status: "Active",
    risk: "No recent order",
  },
  {
    id: "seaforth-motor-spares",
    company: "Seaforth Motor Spares",
    number: "SEA022",
    location: "Liverpool",
    manager: "Priya Nandra",
    lastOrder: "5 days ago",
    ytd: 29105,
    openOpps: 3,
    nextActivity: "Quote follow-up — 16/09",
    status: "Active",
    risk: "High value",
  },
  {
    id: "caldwell-commercials",
    company: "Caldwell Commercials",
    number: "CAL031",
    location: "Glasgow",
    manager: "James Whitfield",
    lastOrder: "—",
    ytd: 0,
    openOpps: 1,
    nextActivity: "Intro call — 18/09",
    status: "Prospect",
    risk: "New customer",
  },
  {
    id: "hartley-tyre-service",
    company: "Hartley Tyre & Service",
    number: "HAR045",
    location: "Sheffield",
    manager: "Priya Nandra",
    lastOrder: "16 days ago",
    ytd: 18660,
    openOpps: 0,
    nextActivity: "Email — 19/09",
    status: "Active",
    risk: "Falling spend",
  },
  {
    id: "mersey-motor-factors",
    company: "Mersey Motor Factors",
    number: "MER019",
    location: "Warrington",
    manager: "James Whitfield",
    lastOrder: "3 days ago",
    ytd: 51380,
    openOpps: 2,
    nextActivity: "Visit — 24/09",
    status: "Active",
    risk: "High value",
  },
  {
    id: "tamar-vehicle-supplies",
    company: "Tamar Vehicle Supplies",
    number: "TAM007",
    location: "Plymouth",
    manager: "Dee Okafor",
    lastOrder: "27 days ago",
    ytd: 9420,
    openOpps: 1,
    nextActivity: "Call — 16/09",
    status: "Active",
    risk: "At risk",
  },
];

export type Customer = (typeof customers)[number];

export const pipelineStages = [
  "New Lead",
  "Qualified",
  "Contacted",
  "Meeting / Discussion",
  "Quote Required",
  "Quote Sent",
  "Negotiation",
  "Won",
  "Lost",
] as const;

export type PipelineStage = (typeof pipelineStages)[number];

export interface Opportunity {
  id: string;
  company: string;
  title: string;
  value: number;
  owner: string;
  close: string;
  lastActivity: string;
  nextAction: string;
  stage: PipelineStage;
}

export const opportunities: Opportunity[] = [
  {
    id: "OPP-2041",
    company: "Caldwell Commercials",
    title: "Full Power Maxed braking range",
    value: 18400,
    owner: "James W.",
    close: "31/10/2026",
    lastActivity: "2 days ago",
    nextAction: "Intro call 18/09",
    stage: "New Lead",
  },
  {
    id: "OPP-2042",
    company: "Hartley Tyre & Service",
    title: "Street Rhino wheel programme",
    value: 9600,
    owner: "Priya N.",
    close: "14/10/2026",
    lastActivity: "5 days ago",
    nextAction: "Send range deck",
    stage: "Qualified",
  },
  {
    id: "OPP-2043",
    company: "Mersey Motor Factors",
    title: "Bramley battery supply agreement",
    value: 42000,
    owner: "James W.",
    close: "30/11/2026",
    lastActivity: "Yesterday",
    nextAction: "Site visit 24/09",
    stage: "Meeting / Discussion",
  },
  {
    id: "OPP-2044",
    company: "ABC Motor Factors Ltd",
    title: "Power Maxed display stand",
    value: 2840,
    owner: "James W.",
    close: "26/09/2026",
    lastActivity: "7 days ago",
    nextAction: "Chase quote AB-10428",
    stage: "Quote Sent",
  },
  {
    id: "OPP-2045",
    company: "Seaforth Motor Spares",
    title: "Steel Seal chemical range",
    value: 7250,
    owner: "Priya N.",
    close: "03/10/2026",
    lastActivity: "3 days ago",
    nextAction: "Agree case pricing",
    stage: "Negotiation",
  },
  {
    id: "OPP-2046",
    company: "Penrose Autoparts",
    title: "Kidzmotion retail rollout",
    value: 15300,
    owner: "James W.",
    close: "19/09/2026",
    lastActivity: "Today",
    nextAction: "Prepare quote",
    stage: "Quote Required",
  },
  {
    id: "OPP-2047",
    company: "Northgate Garage Group",
    title: "Reactivation — braking lines",
    value: 6100,
    owner: "James W.",
    close: "10/10/2026",
    lastActivity: "12 days ago",
    nextAction: "Call decision maker",
    stage: "Contacted",
  },
  {
    id: "OPP-2048",
    company: "Tamar Vehicle Supplies",
    title: "Lighting range trial",
    value: 3400,
    owner: "Dee O.",
    close: "05/09/2026",
    lastActivity: "18 days ago",
    nextAction: "Closed — order placed",
    stage: "Won",
  },
];

export const activities = [
  {
    when: "Today — 10:32",
    type: "Note",
    who: "James Whitfield",
    body: "Interested in taking a Power Maxed display stand. Follow up Friday.",
  },
  {
    when: "12/09",
    type: "Quote",
    who: "James Whitfield",
    body: "Quote AB-10428 sent — £2,840",
  },
  {
    when: "10/09",
    type: "Order",
    who: "System",
    body: "Order AB-9821 placed — £1,247.40",
  },
  {
    when: "04/09",
    type: "Visit",
    who: "James Whitfield",
    body: "Trade counter visit. Reviewed Steel Seal stock rotation and shelf placement.",
  },
  {
    when: "28/08",
    type: "Call",
    who: "Customer Service",
    body: "Reported short delivery on AB-9714. Credit note CN-2210 raised.",
  },
];

export const promos = [
  { code: "PM-AUTUMN", title: "Power Maxed braking — extra 5% on 12+", ends: "30/09" },
  { code: "SS-CASE24", title: "Steel Seal RTV case deals from £3.90", ends: "14/10" },
  { code: "BP-WINTER", title: "Bramley battery winter stock-up", ends: "31/10" },
];

export const orderLists = [
  { name: "Weekly Braking Top-Up", lines: 18, updated: "3 days ago" },
  { name: "Steel Seal Counter Lines", lines: 9, updated: "2 weeks ago" },
  { name: "Battery Stock Rotation", lines: 6, updated: "1 month ago" },
];

export const revenueTrend = [
  { month: "Apr", value: 4120 },
  { month: "May", value: 5380 },
  { month: "Jun", value: 4890 },
  { month: "Jul", value: 6210 },
  { month: "Aug", value: 5740 },
  { month: "Sep", value: 3980 },
];
