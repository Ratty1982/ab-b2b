/**
 * Sanitised Autopart 216V CSV fixtures matching the production header shape.
 *
 * Original truncated sample profile: 66 / 47 / 25 / 36 / 457 / £3,646.78
 * Expanded-width sample profile: 62 / 44 / 24 / 33 / 447 / £3,483.42
 *
 * Figures are fixture expectations only — not production constants.
 */

export const AUTOPART_216V_HEADER =
  `"Order No","Custome","r and Name","","Part Number","Description","","Ord No","OSQty","Unit","O/S Val"`;

export const AUTOPART_216V_PROFILE = {
  lines: 66,
  orders: 47,
  accounts: 25,
  skus: 36,
  units: 457,
  outstandingValue: "3646.78",
} as const;

/** Inspected expanded-width Autopart 216V profile (fuller name/ref/description). */
export const AUTOPART_216V_EXPANDED_PROFILE = {
  lines: 62,
  orders: 44,
  accounts: 24,
  skus: 33,
  units: 447,
  outstandingValue: "3483.42",
} as const;

function csvRow(args: {
  order: string;
  account: string;
  name: string;
  part: string;
  description: string;
  ref: string;
  qty: number;
  unit: string;
  value: string;
}): string {
  return [
    args.order,
    args.account,
    args.name,
    "",
    args.part,
    args.description,
    "",
    args.ref,
    String(args.qty),
    args.unit,
    args.value,
  ]
    .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
    .join(",");
}

type Row = {
  order: string;
  account: string;
  name: string;
  part: string;
  description: string;
  ref: string;
  qty: number;
  unit: string;
  value: string;
};

function money(qty: number, unit: string): string {
  return (qty * Number(unit)).toFixed(2);
}

export function buildAutopart216vFixture(): string {
  const accounts = [
    ["A2MOTORCRE", "A2 Motorparts Crew"],
    ["AUTOADDIT", "AUTO ADDITIVES WOR"],
    ["CARSHOP01", "Car Shop Pit Stop Ltd"],
    ["EBAYCUST", "eBay Customer"],
    ["VERTUMOT", "VERTU Motors"],
    ["WILLENBP", "Willenhall Body Panels"],
    ["RRLEISURE", "RR Leisureways (Two) Ltd"],
    ["POWERMAX", "Retail Power Maxed Orders"],
    ["WEBORDER", "Retail Web Orders"],
    ["AMAZONEU", "Retail Amazon"],
    ["KEITHFAC", "Keith Factors Ltd"],
    ["MIDLANDS", "Midlands Motor Factors"],
    ["NORTHTRA", "Northern Trade Supplies"],
    ["SOUTHCOA", "South Coast Autoparts"],
    ["VALETERS", "Valeters Direct"],
    ["BODYSHOP", "Body Shop Supplies"],
    ["FLEETCO", "Fleetco Services"],
    ["GARAGE12", "Garage Twelve Ltd"],
    ["TRADEABC", "ABC Trade Parts"],
    ["QUICKFIT", "Quickfit Motoring"],
    ["PANELPRO", "Panel Pro Ltd"],
    ["WAXSHINE", "Wax & Shine Ltd"],
    ["SEALFAST", "Sealfast Products"],
    ["JETWASH", "Jet Wash Supplies"],
    ["INDIAIMP", "India Import Lines"],
  ] as const;

  const skus = [
    ["WW1000RTU", "1 Litre Jet Wash & Wax"],
    ["SSIN", "Steel Seal (India)"],
    ["GC5000", "Engine Flush 500ml"],
    ["PM13719", "Power Maxed Cleaner"],
    ["BRK001", "Brake Cleaner 5L"],
    ["POLISH02", "Cutting Compound"],
    ["WAX330", "Carnauba Wax"],
    ["DEGREAS1", "Citrus Degreaser"],
    ["GLASS01", "Glass Cleaner"],
    ["TYRE400", "Tyre Shine 400ml"],
    ["AIRCON1", "Air Con Treatment"],
    ["RADFLUSH", "Rad Flush"],
    ["OILADD", "Oil Additive"],
    ["PETROL1", "Petrol Treatment"],
    ["DIESEL2", "Diesel Treatment"],
    ["HANDGEL", "Hand Gel 5L"],
    ["SOAP5L", "Workshop Soap 5L"],
    ["MOPHEAD", "Mop Head"],
    ["BUCKET1", "Wash Bucket"],
    ["SPONGE2", "Applicator Sponge"],
    ["CLOTH10", "Microfibre Cloth"],
    ["GLOVE100", "Nitrile Gloves"],
    ["MASK50", "Dust Masks"],
    ["TAPE25", "Masking Tape"],
    ["PAPER80", "Abrasive Paper"],
    ["PRIMER1", "Etch Primer"],
    ["FILLER2", "Body Filler"],
    ["HARDEN1", "Hardener"],
    ["THINNER", "Thinners 5L"],
    ["CLEAR1", "Clear Coat"],
    ["BASERED", "Basecoat Red"],
    ["BASEBLK", "Basecoat Black"],
    ["WHEEL1", "Alloy Wheel Cleaner"],
    ["DISCO2", "Disc Brake Quiet"],
    ["BULB12", "Bulb 12V"],
    ["FUSE10", "Fuse Assortment"],
  ] as const;

  const rows: Row[] = [
    {
      order: "SB294008",
      account: accounts[0]![0],
      name: accounts[0]![1],
      part: skus[0]![0],
      description: skus[0]![1],
      ref: "VALETING S",
      qty: 3,
      unit: "2.73",
      value: "8.19",
    },
    {
      order: "SB295193",
      account: accounts[1]![0],
      name: accounts[1]![1],
      part: skus[1]![0],
      description: skus[1]![1],
      ref: "INDIAQUOTE",
      qty: 120,
      unit: "16.20",
      value: "1944.00",
    },
  ];

  // Remaining: 64 lines, 45 orders, 334 units, 1694.59 value.
  // 19 two-line orders + 26 single-line = 45 orders / 64 lines.
  let orderSeq = 300001;
  let unitsLeft = 334;
  let valueLeft = 1694.59;
  let skuCursor = 2;
  let accountCursor = 2;

  function nextOrder(): string {
    const n = orderSeq;
    orderSeq += 1;
    return `SB${n}`;
  }

  function pushLine(order: string, qty: number, unit: string, value: string, ref: string) {
    const acc = accounts[accountCursor % accounts.length]!;
    const sku = skus[skuCursor % skus.length]!;
    accountCursor += 1;
    skuCursor += 1;
    rows.push({
      order,
      account: acc[0],
      name: acc[1],
      part: sku[0],
      description: sku[1],
      ref,
      qty,
      unit,
      value,
    });
    unitsLeft -= qty;
    valueLeft = Number((valueLeft - Number(value)).toFixed(2));
  }

  const extra: Array<{ qty: number; unit: string; value: string }> = [
    ...Array.from({ length: 60 }, () => ({ qty: 5, unit: "4.00", value: money(5, "4.00") })),
    ...Array.from({ length: 3 }, () => ({ qty: 8, unit: "12.00", value: money(8, "12.00") })),
    { qty: 10, unit: "20.66", value: "206.59" },
  ];
  let pairRemaining = 19;
  for (let i = 0; i < extra.length; i++) {
    const spec = extra[i]!;
    const attachToPrevious = pairRemaining > 0 && i > 0 && i % 2 === 1;
    const order = attachToPrevious ? rows[rows.length - 1]!.order : nextOrder();
    if (attachToPrevious) pairRemaining -= 1;
    pushLine(order, spec.qty, spec.unit, spec.value, i % 7 === 0 ? `REF${i}` : "");
  }

  void unitsLeft;
  void valueLeft;

  return [AUTOPART_216V_HEADER, ...rows.map(csvRow)].join("\n") + "\n";
}

/**
 * Expanded-width 216V fixture — fuller customer name / reference / description
 * values Autopart now supplies. No duplicate Order+Account+SKU bases in this
 * snapshot (matches the inspected production expanded file).
 */
export function buildAutopart216vExpandedFixture(): string {
  const accounts = [
    ["A2MOTORCRE", "A2 Motorparts Crew Limited"],
    ["AUTOADDIT", "AUTO ADDITIVES WORLDWIDE"],
    ["CARSHOP01", "Car Shop Pit Stop Limited"],
    ["EBAYCUST", "eBay Marketplace Customer"],
    ["VERTUMOT", "VERTU Motors plc"],
    ["WILLENBP", "Willenhall Body Panels Ltd"],
    ["RRLEISURE", "RR Leisureways (Two) Limited"],
    ["POWERMAX", "Retail Power Maxed Orders"],
    ["WEBORDER", "Retail Web Orders"],
    ["AMAZONEU", "Retail Amazon EU"],
    ["KEITHFAC", "Keith Factors Limited"],
    ["MIDLANDS", "Midlands Motor Factors Ltd"],
    ["NORTHTRA", "Northern Trade Supplies Ltd"],
    ["SOUTHCOA", "South Coast Autoparts Ltd"],
    ["VALETERS", "Valeters Direct Limited"],
    ["BODYSHOP", "Body Shop Supplies Limited"],
    ["FLEETCO", "Fleetco Services Limited"],
    ["GARAGE12", "Garage Twelve Limited"],
    ["TRADEABC", "ABC Trade Parts Limited"],
    ["QUICKFIT", "Quickfit Motoring Limited"],
    ["PANELPRO", "Panel Pro Limited"],
    ["WAXSHINE", "Wax & Shine Limited"],
    ["SEALFAST", "Sealfast Products Limited"],
    ["JETWASH", "Jet Wash Supplies Limited"],
  ] as const;

  const skus = [
    ["WW1000RTU", "1 Litre Jet Wash & Wax Ready To Use"],
    ["SSIN", "Steel Seal India Formula"],
    ["GC5000", "Engine Flush 500ml Concentrate"],
    ["PM13719", "Power Maxed All Purpose Cleaner"],
    ["BRK001", "Brake Cleaner 5 Litre"],
    ["POLISH02", "Cutting Compound Professional"],
    ["WAX330", "Carnauba Wax Paste 330g"],
    ["DEGREAS1", "Citrus Degreaser Concentrate"],
    ["GLASS01", "Glass Cleaner Ammonia Free"],
    ["TYRE400", "Tyre Shine 400ml Aerosol"],
    ["AIRCON1", "Air Con Treatment Complete"],
    ["RADFLUSH", "Radiator Flush Treatment"],
    ["OILADD", "Oil Additive Engine Protect"],
    ["PETROL1", "Petrol Treatment System Clean"],
    ["DIESEL2", "Diesel Treatment Injector Clean"],
    ["HANDGEL", "Hand Gel 5 Litre Workshop"],
    ["SOAP5L", "Workshop Soap 5 Litre"],
    ["MOPHEAD", "Industrial Mop Head Replacement"],
    ["BUCKET1", "Heavy Duty Wash Bucket"],
    ["SPONGE2", "Applicator Sponge Twin Pack"],
    ["CLOTH10", "Microfibre Cloth Pack of 10"],
    ["GLOVE100", "Nitrile Gloves Box of 100"],
    ["MASK50", "Dust Masks Box of 50"],
    ["TAPE25", "Masking Tape 25mm"],
    ["PAPER80", "Abrasive Paper 80 Grit"],
    ["PRIMER1", "Etch Primer 1 Litre"],
    ["FILLER2", "Body Filler 2kg Tin"],
    ["HARDEN1", "Hardener Tube Standard"],
    ["THINNER", "Thinners 5 Litre"],
    ["CLEAR1", "Clear Coat Lacquer"],
    ["BASERED", "Basecoat Red Mixing"],
    ["BASEBLK", "Basecoat Black Mixing"],
    ["WHEEL1", "Alloy Wheel Cleaner Acid Free"],
  ] as const;

  const rows: Row[] = [
    {
      order: "SB294008",
      account: accounts[0]![0],
      name: accounts[0]![1],
      part: skus[0]![0],
      description: skus[0]![1],
      ref: "VALETING STOCK ORDER",
      qty: 3,
      unit: "2.73",
      value: "8.19",
    },
    {
      order: "SB295193",
      account: accounts[1]![0],
      name: accounts[1]![1],
      part: skus[1]![0],
      description: skus[1]![1],
      ref: "ADDITIVELAUNCHSTOCK",
      qty: 120,
      unit: "16.20",
      value: "1944.00",
    },
  ];

  // Remaining: 60 lines, 42 orders, 324 units, 1531.23 value.
  // 18 two-line orders + 24 single-line = 42 orders / 60 lines.
  let orderSeq = 310001;
  let skuCursor = 2;
  let accountCursor = 2;

  function nextOrder(): string {
    const n = orderSeq;
    orderSeq += 1;
    return `SB${n}`;
  }

  function pushLine(order: string, qty: number, unit: string, value: string, ref: string) {
    const acc = accounts[accountCursor % accounts.length]!;
    const sku = skus[skuCursor % skus.length]!;
    accountCursor += 1;
    skuCursor += 1;
    rows.push({
      order,
      account: acc[0],
      name: acc[1],
      part: sku[0],
      description: sku[1],
      ref,
      qty,
      unit,
      value,
    });
  }

  // Remaining 60 lines → 324 units / £1,531.23 (totals 447 / £3,483.42).
  const tuned: Array<{ qty: number; unit: string; value: string }> = [
    ...Array.from({ length: 54 }, () => ({ qty: 5, unit: "3.50", value: money(5, "3.50") })),
    ...Array.from({ length: 4 }, () => ({ qty: 8, unit: "12.00", value: money(8, "12.00") })),
    { qty: 12, unit: "5.00", value: money(12, "5.00") },
    { qty: 10, unit: "14.223", value: "142.23" },
  ];

  let pairRemaining = 18;
  for (let i = 0; i < tuned.length; i++) {
    const spec = tuned[i]!;
    const attachToPrevious = pairRemaining > 0 && i > 0 && i % 2 === 1;
    const order = attachToPrevious ? rows[rows.length - 1]!.order : nextOrder();
    if (attachToPrevious) pairRemaining -= 1;
    pushLine(order, spec.qty, spec.unit, spec.value, i % 5 === 0 ? `EXPANDEDREF${i}` : `PO-${order}`);
  }

  return [AUTOPART_216V_HEADER, ...rows.map(csvRow)].join("\n") + "\n";
}
