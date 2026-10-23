import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ab/Badges";
import { getCompanyAutopartMasterFn } from "@/server/companies/autopart-master-fns";

type Master = Extract<Awaited<ReturnType<typeof getCompanyAutopartMasterFn>>, { ok: true }>["data"];

export function AutopartMasterAccessPanel({ companyId }: { companyId: string }) {
  const [data, setData] = useState<Master | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getCompanyAutopartMasterFn({ data: { companyId } }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setData(null);
        return;
      }
      setError(null);
      setData(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (error) return <p className="text-[13px] text-steel">{error}</p>;
  if (!data) return <p className="text-[13px] text-steel">Loading Autopart accounts…</p>;

  return (
    <section className="mb-6 border border-border/80">
      <div className="border-b border-border/70 px-4 py-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-tight">
          Autopart master
        </h3>
        <p className="mt-1 text-[13px] text-steel">{data.historicalLabel}</p>
      </div>
      {data.accounts.length === 0 ? (
        <p className="px-4 py-4 text-[13px] text-steel">
          No 407EXP master account is linked. That is separate from a verified sales account, which
          is enough for this customer's own sales files. Link a master account from Customer master
          or the commercial tab when the 407EXP record should be attached. Linking does not import
          purchases or approve portal login.
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          {data.accounts.map((account) => (
            <li key={account.id} className="px-4 py-3">
              <div className="font-mono text-[13px]">{account.accountCode}</div>
              <div className="text-[13px]">{account.originalName || "—"}</div>
              <div className="mt-1 text-[12px] text-steel">
                Area {account.areaCode || "—"} · Rep {account.repCode || "—"}
                {account.nameTruncated ? " · Name may be truncated by the export" : ""}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge tone="neutral">
                  {account.classification.replaceAll("_", " ")}
                </StatusBadge>
                <StatusBadge tone="neutral">Linked Autopart account</StatusBadge>
                <StatusBadge tone="neutral">
                  {account.portalEligible ? "Portal flag on" : "No automatic portal access"}
                </StatusBadge>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-border/70 px-4 py-2 text-[12px] text-steel">
        Mapping: {data.mappingStatus === "LINKED" ? "Linked" : "Not linked"}
        {" · "}
        Ongoing sales appear from 504 invoices and TRM21QC product lines. A customer with no
        ongoing feed shows an empty purchase history.
      </p>
    </section>
  );
}
