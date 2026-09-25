/**
 * Default commercial pricing for new trade accounts.
 *
 * New companies are created with Company.priceListId = null.
 * The trade price resolver then uses ProductVariant.tradePrice (source BASE)
 * until a salesperson assigns a PriceList or CustomerPrice override.
 */

export const DEFAULT_TRADE_PRICE_LABEL = "Default Trade Price";

export const DEFAULT_TRADE_PRICE_HELP =
  "Catalogue trade price (ProductVariant.tradePrice). Assigned automatically when an account is created. Sales can later assign a price list or set special prices per product.";

/** Human label for a company's assigned list, or Default Trade Price when none. */
export function companyPriceListLabel(priceListName: string | null | undefined): string {
  const name = priceListName?.trim();
  return name ? name : DEFAULT_TRADE_PRICE_LABEL;
}
