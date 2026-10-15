/**
 * Document-level comparison for a historical file and the daily sales feed.
 * Equal money is agreement. A difference is reported once per document.
 * Line count and document value are never used to pick a winner.
 */

export type OverlapMoney = {
  reference: string;
  documentType: string;
  goodsNet: string | null;
  lineNet: string | null;
};

export type OverlapSummary = {
  /** Daily-feed documents this file also contains, without a demonstrated money difference. */
  leftUnchanged: string[];
  /** Same document reference where both sides have money and they differ. */
  differs: Array<{ reference: string; documentType: string }>;
};

function money(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameMoney(left: string | null, right: string | null): boolean | null {
  const a = money(left);
  const b = money(right);
  if (a == null || b == null) return null;
  return Math.abs(a - b) <= 0.01;
}

export function summariseHistoricOverlap(input: {
  incoming: OverlapMoney[];
  ongoing: OverlapMoney[];
}): OverlapSummary {
  const ongoingByRef = new Map<string, OverlapMoney>();
  for (const row of input.ongoing) ongoingByRef.set(row.reference, row);

  const leftUnchanged: string[] = [];
  const differs: Array<{ reference: string; documentType: string }> = [];
  const seen = new Set<string>();

  for (const row of input.incoming) {
    if (seen.has(row.reference)) continue;
    const current = ongoingByRef.get(row.reference);
    if (!current) continue;
    seen.add(row.reference);
    const goods = sameMoney(row.goodsNet, current.goodsNet);
    const lines = sameMoney(row.lineNet, current.lineNet);
    const compared = [goods, lines].filter((item) => item != null);
    const agreed = compared.length > 0 && compared.every(Boolean);
    const conflict = compared.some((item) => item === false);
    if (conflict && !agreed) {
      differs.push({ reference: row.reference, documentType: row.documentType });
      continue;
    }
    leftUnchanged.push(row.reference);
  }

  return { leftUnchanged, differs };
}
