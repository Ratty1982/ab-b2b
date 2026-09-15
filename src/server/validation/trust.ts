/**
 * Commercial trust boundary — documented for all future server functions.
 *
 * NEVER accept the following from the client as authoritative:
 * - unit prices / RRP / trade prices
 * - discounts / promotions
 * - VAT amounts or rates (except selecting a declared VAT code where allowed)
 * - credit limits / available credit
 * - stock quantities / availability
 * - permission / role claims
 * - company identity (except choosing among companies the user is already authorised for)
 *
 * Always recompute from the database (and later Autopart) on the server.
 */
export const CLIENT_UNTRUSTED_FIELDS = [
  "price",
  "unitPrice",
  "tradePrice",
  "rrp",
  "discount",
  "vat",
  "vatAmount",
  "creditLimit",
  "availableCredit",
  "stockQty",
  "permissions",
  "roles",
] as const;
