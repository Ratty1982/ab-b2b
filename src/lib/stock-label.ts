/** Display labels for stock availability bands used in badges. */

export type Stock = "in" | "low" | "backorder" | "out";

export const stockLabel: Record<Stock, string> = {
  in: "In stock",
  low: "Low stock",
  backorder: "Backorder",
  out: "Out of stock",
};
