/**
 * Scaled-integer money for trade price resolution.
 * Scale 4 matches ProductVariant.tradePrice Decimal(12,4).
 * Do not use IEEE floats for authoritative arithmetic.
 */

export const MONEY_SCALE = 4;
const SCALE = 10n ** BigInt(MONEY_SCALE);

export type Money = { readonly minor: bigint };

export function moneyFromUnknown(value: unknown): Money | null {
  if (value == null || value === "") return null;
  if (
    typeof value === "object" &&
    value !== null &&
    "toFixed" in value &&
    typeof (value as { toFixed: (n: number) => string }).toFixed === "function"
  ) {
    return parseMoney((value as { toFixed: (n: number) => string }).toFixed(MONEY_SCALE));
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return parseMoney(String(value));
  }
  if (typeof value === "string") return parseMoney(value);
  return null;
}

export function parseMoney(raw: string): Money | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2] ?? "0");
  const fracRaw = match[3] ?? "";
  const fracPadded = (fracRaw + "0".repeat(MONEY_SCALE)).slice(0, MONEY_SCALE);
  const extraDigit = fracRaw.length > MONEY_SCALE ? Number(fracRaw[MONEY_SCALE]) : 0;
  let frac = BigInt(fracPadded);
  if (fracRaw.length > MONEY_SCALE && extraDigit >= 5) frac += 1n;
  if (frac >= SCALE) {
    return { minor: sign * ((whole + 1n) * SCALE) };
  }
  return { minor: sign * (whole * SCALE + frac) };
}

export function moneyZero(): Money {
  return { minor: 0n };
}

export function moneyToString(value: Money, places = MONEY_SCALE): string {
  const rounded = places === MONEY_SCALE ? value : roundMoney(value, places);
  const factor = 10n ** BigInt(places);
  const storedFactor = SCALE;
  const absStored = rounded.minor < 0n ? -rounded.minor : rounded.minor;
  const asPlaces = places === MONEY_SCALE ? absStored : (absStored / (storedFactor / factor));
  const neg = rounded.minor < 0n;
  const whole = asPlaces / factor;
  const frac = (asPlaces % factor).toString().padStart(places, "0");
  if (places === 0) return `${neg ? "-" : ""}${whole.toString()}`;
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

/** Round a 4dp money amount to `places` (0–4) using half-up, remaining stored at 4dp. */
export function roundMoney(value: Money, places: number): Money {
  if (places >= MONEY_SCALE) return value;
  const drop = MONEY_SCALE - places;
  const factor = 10n ** BigInt(drop);
  const sign = value.minor < 0n ? -1n : 1n;
  const abs = value.minor < 0n ? -value.minor : value.minor;
  const rem = abs % factor;
  const q = abs / factor;
  const half = factor / 2n;
  const up = rem >= half ? q + 1n : q;
  return { minor: sign * up * factor };
}

export function roundGbpDisplay(value: Money): Money {
  return roundMoney(value, 2);
}

/**
 * Customer sell unit price for B2B ordering.
 *
 * Commercial resolution may stay at 4dp internally. The price the customer
 * sees and buys at is half-up rounded to 2dp first; that 2dp amount is then
 * multiplied by quantity for the line net.
 */
export function toCustomerSellUnitPrice(resolvedCommercialUnit: Money): Money {
  return roundGbpDisplay(resolvedCommercialUnit);
}

/**
 * Customer order line net ex VAT: sellUnit(2dp) × quantity.
 * Do not multiply the unresolved 4dp commercial price for customer lines.
 */
export function customerLineNetExVat(resolvedCommercialUnit: Money, quantity: number): Money {
  return mulQty(toCustomerSellUnitPrice(resolvedCommercialUnit), quantity);
}

/**
 * Format the customer-facing unit sell price as standard UK currency digits (x.xx).
 * Never exposes commercial 3dp/4dp fractions on public/trade surfaces.
 */
export function formatCustomerSellUnitPrice(
  resolvedCommercialUnit4dp: string | null | undefined,
): string | null {
  if (resolvedCommercialUnit4dp == null || resolvedCommercialUnit4dp === "") return null;
  const money = parseMoney(resolvedCommercialUnit4dp);
  if (!money) return null;
  return moneyToString(toCustomerSellUnitPrice(money), 2);
}

/**
 * @deprecated Use formatCustomerSellUnitPrice — customer-facing sell prices are always 2dp.
 */
export function formatTradeOrderingUnitPrice(
  unitPriceExVat4dp: string | null | undefined,
): string | null {
  return formatCustomerSellUnitPrice(unitPriceExVat4dp);
}

export function addMoney(a: Money, b: Money): Money {
  return { minor: a.minor + b.minor };
}

export function subMoney(a: Money, b: Money): Money {
  return { minor: a.minor - b.minor };
}

export function isLowerMoney(a: Money, b: Money): boolean {
  return a.minor < b.minor;
}

export function clampNonNegative(value: Money): Money {
  return value.minor < 0n ? moneyZero() : value;
}

/** Multiply money by num/den with half-up back to 4dp. */
export function mulRatio(value: Money, numerator: bigint, denominator: bigint): Money {
  if (denominator === 0n) return moneyZero();
  const prod = value.minor * numerator;
  const sign = prod < 0n ? -1n : 1n;
  const abs = prod < 0n ? -prod : prod;
  const rem = abs % denominator;
  const q = abs / denominator;
  const up = rem * 2n >= denominator ? q + 1n : q;
  return { minor: sign * up };
}

export function mulQty(value: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) return moneyZero();
  return { minor: value.minor * BigInt(quantity) };
}

export function moneyToNumber(value: Money): number {
  return Number(moneyToString(value));
}

export function vatRateForCodes(input: {
  vatCode?: string | null;
  companyTaxStatus?: string | null;
}): { rate: Money; percent: number } {
  const tax = (input.companyTaxStatus ?? "STANDARD").toUpperCase();
  if (tax === "ZERO_RATED" || tax === "EXEMPT" || tax === "OUTSIDE_SCOPE") {
    return { rate: parseMoney("0")!, percent: 0 };
  }
  const code = (input.vatCode ?? "STANDARD").toUpperCase();
  if (code === "ZERO_RATED" || code === "ZERO") {
    return { rate: parseMoney("0")!, percent: 0 };
  }
  return { rate: parseMoney("0.20")!, percent: 20 };
}

/** Inc-VAT at 2dp half-up: ex * (1 + rate). */
export function applyVatInc(unitExVat: Money, vatRate: Money): Money {
  const one = parseMoney("1")!;
  const factor = addMoney(one, vatRate);
  const prod = unitExVat.minor * factor.minor; // 8dp
  const to2 = 10n ** 6n;
  const pennies = prod / to2 + (prod % to2 >= to2 / 2n ? 1n : 0n);
  return { minor: pennies * 100n };
}
