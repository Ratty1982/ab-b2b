/**
 * Native 231PO3NEW printed-report fixture.
 *
 * When Incoming/P/Ord Qty is included, the trailing header matches the real
 * Autopart layout (usage history after Physical Stk, outstanding PO at P/Ord Qty).
 * Concatenated labels (`MaxOther Info`, `P/Ord QtySub Grp`) are intentional.
 */

export type Native231Po3NewRow = {
  sku: string;
  description: string;
  stk: string;
  avail: string;
  pick: string;
  physical: string;
  cost?: string;
  /** Outstanding PO qty (source field P/Ord Qty). Presence includes the column. */
  incoming?: string;
  ryr?: string;
  curr?: string;
  mth1?: string;
  min?: string;
  max?: string;
  /**
   * Single-character Autopart C column, between Part Number and Description.
   * Omit or blank for no condition. Width stays one character so other columns do not shift.
   */
  condition?: string;
  /** 231PO3NEW Group column, after Branch and before Part Number. Defaults to AA. */
  group?: string;
  /** Sub Grp column. Must not be read as the supplier Group. */
  subGrp?: string;
  /** Later GROUP column. Must not be read as the supplier Group. */
  trailerGroup?: string;
};

/** Identity + Avail/cost columns used by existing native tests. */
export const NATIVE_231PO3NEW_BASE_HEADER =
  "Branch  Group Part Number          C Description                     Latest Cost     Stk     Avail  Pick Qty Physical Stk";

/**
 * Real 05 Oct 2026 trailing columns after Physical Stk, including concatenated labels.
 * Source: STOCK USAGES AND REORDER INFORMATION WITH OUTSTANDING PO QTY'S (231PO3NEW).
 */
export const NATIVE_231PO3NEW_USAGE_AND_PORD_TRAIL =
  "   Ryr Curr Mth1 Mth2 Mth3 Mth4 Mth5 Mth6 Mth7 Mth8 Mth9Mth10Mth11  Min  MaxOther Info   P/Ord QtySub Grp GROUP";

export const NATIVE_231PO3NEW_PORD_HEADER =
  NATIVE_231PO3NEW_BASE_HEADER + NATIVE_231PO3NEW_USAGE_AND_PORD_TRAIL;

const P_ORD_QTY_RE = /P\s*\/\s*Ord\s*Qty/i;

function overlayRight(line: string, start: number, width: number, value: string): string {
  const cell = value.padStart(Math.max(width, 0)).slice(-Math.max(width, 0));
  const end = start + width;
  const base = line.padEnd(end);
  return base.slice(0, start) + cell + base.slice(end);
}

function labelStart(header: string, pattern: RegExp, from = 0): number {
  const slice = from > 0 ? header.slice(from) : header;
  const match = pattern.exec(slice);
  return match ? from + match.index : -1;
}

export function buildNative231Po3New(rows: Native231Po3NewRow[], page = 1): string {
  const withIncoming = rows.some((row) => row.incoming != null);
  const header = withIncoming ? NATIVE_231PO3NEW_PORD_HEADER : NATIVE_231PO3NEW_BASE_HEADER;
  const pordStart = labelStart(header, P_ORD_QTY_RE);
  const subGrpStart = pordStart >= 0 ? labelStart(header, /Sub\s*Grp/i, pordStart + 1) : -1;
  const ryrStart = header.indexOf("Ryr");
  const currStart = header.indexOf("Curr");
  const mth1Start = header.indexOf("Mth1");
  const mth2Start = header.indexOf("Mth2");
  const minStart = header.indexOf("Min");
  const maxStart = header.indexOf("Max");
  const otherStart = header.indexOf("Other Info") >= 0 ? header.indexOf("Other Info") : header.indexOf("Other");

  const body = rows.map((row) => {
    const cost = row.cost ?? "1.41";
    // Part Number is padded up to the header C column. The condition character
    // occupies that column; Description starts on the Description label.
    const conditionChar = (row.condition ?? "").trim().slice(0, 1).toUpperCase() || " ";
    const skuField = row.sku.padEnd(21).slice(0, 21);
    const group = (row.group ?? "AA").toUpperCase().padEnd(6).slice(0, 6);
    const left = `  01    ${group}${skuField}${conditionChar} ${row.description.padEnd(33)}`;
    const nums = `${cost}   ${row.stk}  ${row.avail}   ${row.pick}    ${row.physical}`;
    let line = left + nums;
    if (!withIncoming) return line;

    // Adjacent usage values deliberately differ from P/Ord Qty so a positional
    // "field after Physical Stk" parser cannot accidentally pass.
    const ryr = row.ryr ?? "111";
    const curr = row.curr ?? "9";
    const mth1 = row.mth1 ?? "14";
    const min = row.min ?? "48";
    const max = row.max ?? "96";
    const incoming = row.incoming ?? "";

    if (ryrStart >= 0 && currStart > ryrStart) {
      line = overlayRight(line, ryrStart, currStart - ryrStart, ryr);
    }
    if (currStart >= 0 && mth1Start > currStart) {
      line = overlayRight(line, currStart, mth1Start - currStart, curr);
    }
    if (mth1Start >= 0 && mth2Start > mth1Start) {
      line = overlayRight(line, mth1Start, mth2Start - mth1Start, mth1);
    }
    if (minStart >= 0 && maxStart > minStart) {
      line = overlayRight(line, minStart, maxStart - minStart, min);
    }
    if (maxStart >= 0 && otherStart > maxStart) {
      line = overlayRight(line, maxStart, otherStart - maxStart, max);
    }
    if (pordStart >= 0) {
      const width = subGrpStart > pordStart ? subGrpStart - pordStart : 9;
      line = overlayRight(line, pordStart, width, incoming);
    }
    const trailerStart = header.lastIndexOf("GROUP");
    if (row.subGrp != null && subGrpStart >= 0 && trailerStart > subGrpStart) {
      line = overlayRight(line, subGrpStart, trailerStart - subGrpStart, row.subGrp);
    }
    if (row.trailerGroup != null && trailerStart >= 0) {
      line = overlayRight(line, trailerStart, Math.max(row.trailerGroup.length, 8), row.trailerGroup);
    }
    return line;
  });

  return [
    `Page : ${page}`,
    "AUTOPART SYSTEM STOCK USAGES AND REORDER INFORMATION WITH OUTSTANDING PO QTY'S (231PO3NEW)",
    header,
    "--------------------------------------------------------------------------------",
    ...body,
  ].join("\n");
}

/** Two-page native report: repeated headers must not be parsed as products. */
export function buildNative231Po3NewTwoPages(
  page1: Native231Po3NewRow[],
  page2: Native231Po3NewRow[],
): string {
  return `${buildNative231Po3New(page1, 1)}\n${buildNative231Po3New(page2, 2)}`;
}
