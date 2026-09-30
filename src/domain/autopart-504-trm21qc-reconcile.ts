/**
 * 504 Goods (NET) ↔ sum(TRM21QC Sales NET) reconciliation.
 */

import { addMoney, moneyToString, moneyZero, parseMoney, subMoney, type Money } from "@/domain/money";

/** ±1p tolerance on document goods vs sum of line net sales. */
export const AUTOPART_504_TRM_RECONCILE_TOLERANCE_MINOR = 1;

export type Autopart504TrmReconcileStatus =
  | "MATCHED"
  | "VALUE_MISMATCH"
  | "AWAITING_504"
  | "AWAITING_LINES";

export function sumTrm21qcSalesNet(sales: Array<string | null | undefined>): Money {
  let total = moneyZero();
  for (const s of sales) {
    const m = parseMoney(s ?? "");
    if (m) total = addMoney(total, m);
  }
  return total;
}

export function reconcile504GoodsToTrmSales(input: {
  goods504: string | null | undefined;
  trmSalesNets: Array<string | null | undefined>;
  has504: boolean;
  hasTrm21qc: boolean;
}): {
  status: Autopart504TrmReconcileStatus;
  goods: string | null;
  linesNetSum: string | null;
  mismatchMinor: number | null;
} {
  if (!input.has504 && input.hasTrm21qc) {
    return {
      status: "AWAITING_504",
      goods: null,
      linesNetSum: moneyToString(sumTrm21qcSalesNet(input.trmSalesNets), 2),
      mismatchMinor: null,
    };
  }
  if (input.has504 && !input.hasTrm21qc) {
    return {
      status: "AWAITING_LINES",
      goods: input.goods504 ?? null,
      linesNetSum: null,
      mismatchMinor: null,
    };
  }
  const goods = parseMoney(input.goods504 ?? "");
  const lines = sumTrm21qcSalesNet(input.trmSalesNets);
  if (!goods) {
    return {
      status: "VALUE_MISMATCH",
      goods: input.goods504 ?? null,
      linesNetSum: moneyToString(lines, 2),
      mismatchMinor: null,
    };
  }
  const diff = subMoney(goods, lines);
  const mismatchMinor = Number(diff.minor / 100n); // Money uses 4dp scale — convert carefully
  // money minor is 4 decimal places (0.0001). 1 penny = 100 minor units at 4dp? Check MONEY_SCALE.
  const absMinor4 = diff.minor < 0n ? -diff.minor : diff.minor;
  // 1p = 0.01 = 100 units if scale is 4 (0.0001)
  const pennyUnits = 100n;
  const within = absMinor4 <= pennyUnits * BigInt(AUTOPART_504_TRM_RECONCILE_TOLERANCE_MINOR);
  return {
    status: within ? "MATCHED" : "VALUE_MISMATCH",
    goods: moneyToString(goods, 2),
    linesNetSum: moneyToString(lines, 2),
    mismatchMinor: Number(absMinor4 / pennyUnits) * (diff.minor < 0n ? -1 : 1),
  };
}
