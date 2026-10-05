export function buildNative231Po3New(rows: Array<{
  sku: string;
  description: string;
  stk: string;
  avail: string;
  pick: string;
  physical: string;
  cost?: string;
  incoming?: string;
}>): string {
  const withIncoming = rows.some((row) => row.incoming != null);
  const header = withIncoming
    ? "Branch  Group Part Number          C Description                     Latest Cost     Stk     Avail  Pick Qty Physical Stk Incoming"
    : "Branch  Group Part Number          C Description                     Latest Cost     Stk     Avail  Pick Qty Physical Stk";
  const body = rows.map((row) => {
    const cost = row.cost ?? "1.41";
    const left = `  01    AA    ${row.sku.padEnd(22)} C ${row.description.padEnd(33)}`;
    const nums = `${cost}   ${row.stk}  ${row.avail}   ${row.pick}    ${row.physical}`;
    let line = left + nums;
    if (withIncoming) {
      const incomingStart = header.indexOf("Incoming");
      if (incomingStart >= 0) {
        if (line.length > incomingStart) line = line.slice(0, incomingStart);
        line = line.padEnd(incomingStart) + (row.incoming ?? "").padStart(8);
      }
    }
    return line;
  });
  return [
    "Page : 1",
    "AUTOPART SYSTEM STOCK USAGES / REORDER INFORMATION (231PO3NEW)",
    header,
    "--------------------------------------------------------------------------------",
    ...body,
  ].join("\n");
}
