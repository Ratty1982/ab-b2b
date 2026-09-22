export function buildNative231Po3New(rows: Array<{
  sku: string;
  description: string;
  stk: string;
  avail: string;
  pick: string;
  physical: string;
  cost?: string;
}>): string {
  const header =
    "Branch  Group Part Number          C Description                     Latest Cost     Stk     Avail  Pick Qty Physical Stk";
  const body = rows.map((row) => {
    const cost = row.cost ?? "1.41";
    const left = `  01    AA    ${row.sku.padEnd(22)} C ${row.description.padEnd(33)}`;
    const nums = `${cost}   ${row.stk}  ${row.avail}   ${row.pick}    ${row.physical}`;
    return left + nums;
  });
  return [
    "Page : 1",
    "AUTOPART SYSTEM STOCK USAGES / REORDER INFORMATION (231PO3NEW)",
    header,
    "--------------------------------------------------------------------------------",
    ...body,
  ].join("\n");
}
