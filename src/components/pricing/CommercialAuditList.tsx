import { useEffect, useState } from "react";
import { listCommercialAuditFn } from "@/server/phase2/fns";
import { InstantText } from "@/components/ab/InstantText";

export function CommercialAuditList(filter: {
  priceListId?: string;
  companyId?: string;
  variantId?: string;
}) {
  const [rows, setRows] = useState<Array<{ id: string; title: string; at: string; actor: string | null }>>([]);

  useEffect(() => {
    void listCommercialAuditFn({ data: filter }).then((r) => {
      if (r.ok) setRows(r.data);
    });
  }, [filter.priceListId, filter.companyId, filter.variantId]);

  return (
    <section>
      <h3 className="font-display text-lg font-semibold uppercase">Recent commercial activity</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-steel">No commercial changes recorded here yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row.id} className="px-3 py-2">
              <div className="text-[13px] font-medium">{row.title}</div>
              <div className="num text-[12px] text-steel">
                {row.actor ? `${row.actor} · ` : null}
                <InstantText value={row.at} variant="audit" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
