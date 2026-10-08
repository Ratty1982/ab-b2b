import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/ab/Badges";
import {
  getCompanyAutopartMasterFn,
  setAutopartHistoricalAccessFn,
} from "@/server/companies/autopart-master-fns";

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
          No Autopart customer-master account is linked to this company.
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          {data.accounts.map((account) => (
            <li
              key={account.id}
              className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div>
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
                  <StatusBadge tone={account.historicalAccessEnabled ? "good" : "warn"}>
                    {account.historicalAccessEnabled
                      ? "Historical access on"
                      : "Historical access off"}
                  </StatusBadge>
                  <StatusBadge tone="neutral">
                    {account.portalEligible ? "Portal flag on" : "No automatic portal access"}
                  </StatusBadge>
                </div>
              </div>
              <button
                type="button"
                className="h-9 border border-border px-3 text-[12px] font-semibold uppercase tracking-[0.12em]"
                onClick={() => {
                  void setAutopartHistoricalAccessFn({
                    data: { accountId: account.id, enabled: !account.historicalAccessEnabled },
                  }).then((result) => {
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setData((current) =>
                      current
                        ? {
                            ...current,
                            accounts: current.accounts.map((item) =>
                              item.id === account.id
                                ? {
                                    ...item,
                                    historicalAccessEnabled: result.data.historicalAccessEnabled,
                                  }
                                : item,
                            ),
                          }
                        : current,
                    );
                  });
                }}
              >
                {account.historicalAccessEnabled ? "Revoke history" : "Enable history"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-border/70 px-4 py-2 text-[12px] text-steel">
        Historical product lines:{" "}
        {data.lineCount == null ? "restricted" : data.lineCount.toLocaleString("en-GB")}
        {" · "}
        Ledger rows:{" "}
        {data.ledgerCount == null ? "restricted" : data.ledgerCount.toLocaleString("en-GB")}
      </p>
    </section>
  );
}
