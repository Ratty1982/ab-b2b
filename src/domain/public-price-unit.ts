/**
 * Public catalogue unit-price qualifier.
 *
 * The displayed trade price is always the UNIT / sale-unit price.
 * Never multiply by caseQty in the product hero.
 *
 * ProductVariant.unit defaults to EA. Map known codes to a customer-facing
 * word that sits in "YOUR PRICE · {qualifier} · EX VAT".
 */
export function publicUnitPriceQualifier(unit?: string | null): string {
  const raw = (unit ?? "EA").trim().toUpperCase();
  if (!raw || raw === "EA" || raw === "EACH" || raw === "UNIT" || raw === "UN" || raw === "PC" || raw === "PCS") {
    return "each";
  }
  if (raw === "PR" || raw === "PAIR") return "pair";
  if (raw === "SET") return "set";
  if (raw === "KIT") return "kit";
  if (raw === "L" || raw === "LTR" || raw === "LITRE" || raw === "LITRES") return "litre";
  return raw.toLowerCase();
}
