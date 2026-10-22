import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  confirmCustomerSalesImportFn,
  listCustomerSalesAccountsFn,
  previewCustomerSalesImportFn,
} from "@/server/phase2/fns";

type Accounts = Extract<Awaited<ReturnType<typeof listCustomerSalesAccountsFn>>, { ok: true }>["data"];
type Preview = Extract<Awaited<ReturnType<typeof previewCustomerSalesImportFn>>, { ok: true }>["data"];

export function CustomerSalesImportPanel({ companyId }: { companyId: string }) {
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [accountCode, setAccountCode] = useState("");
  const [filename, setFilename] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listCustomerSalesAccountsFn({ data: { companyId } }).then((result) => {
      if (cancelled || !result.ok) return;
      setAccounts(result.data);
      const first = result.data.accounts.find((account) => account.verified);
      setAccountCode(first?.code ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (!accounts) return null;
  if (!accounts.verified || accounts.accounts.length === 0) {
    return (
      <section className="mb-6 border border-border/80 px-4 py-4">
        <h3 className="font-display text-sm font-semibold uppercase tracking-tight">
          Import this customer's sales
        </h3>
        <p className="mt-2 text-[13px] text-steel">
          Verify an Autopart account on this Active customer, then complete Import Sales History,
          before uploading a 504 or TRM21QC report.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-6 border border-border/80">
      <div className="border-b border-border/70 px-4 py-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-tight">
          Import this customer's sales
        </h3>
        <p className="mt-1 text-[13px] text-steel">{accounts.assessment}</p>
        <p className="mt-1 text-[12px] text-steel">
          Cutover: {accounts.historyStatus === "COMPLETE" ? "complete" : "not started"}
          {accounts.historyFrom ? ` (${accounts.historyFrom} to ${accounts.historyTo ?? accounts.historyFrom})` : ""}
        </p>
      </div>
      <form
        className="grid gap-3 px-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            setBusy(true);
            const result = await previewCustomerSalesImportFn({
              data: { companyId, accountCode, text, filename },
            });
            setBusy(false);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            setPreview(result.data);
          })();
        }}
      >
        <label className="grid gap-1 text-[12px] font-semibold">
          Verified Autopart account
          <select
            value={accountCode}
            onChange={(event) => {
              setAccountCode(event.target.value);
              setPreview(null);
            }}
            className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] font-normal"
          >
            {accounts.accounts
              .filter((account) => account.verified)
              .map((account) => (
                <option key={account.code} value={account.code}>
                  {account.code} {account.kind === "alias" ? "(alias)" : "(primary)"}
                </option>
              ))}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] font-semibold">
          Original Autopart report
          <input
            type="file"
            accept=".csv,.txt,.tsv,text/plain,text/csv"
            className="text-[13px] font-normal"
            onChange={(event) => {
              const file = event.target.files?.[0];
              setPreview(null);
              if (!file) return;
              setFilename(file.name);
              void file.text().then(setText);
            }}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !text || !accountCode}
          className="h-9 w-fit rounded-md border border-border px-3 text-[12px] font-semibold disabled:opacity-50"
        >
          {busy ? "Checking…" : "Preview import"}
        </button>
      </form>
      {preview ? (
        <div className="border-t border-border/70 px-4 py-4">
          <p className="text-[13px]" role="status">
            {preview.kind === "504"
              ? "504 invoices and credits"
              : preview.kind === "TRM21QC"
                ? "TRM21QC product lines"
                : "Report not accepted"}
            {" for "}
            <span className="font-mono">{preview.accountCode}</span>
            {". "}
            Import {preview.counts.import}, update {preview.counts.update}, duplicate{" "}
            {preview.counts.duplicate}, skipped {preview.counts.skipped}, rejected{" "}
            {preview.counts.rejected}.
          </p>
          {preview.message ? <p className="mt-2 text-[13px] text-steel">{preview.message}</p> : null}
          <ul className="mt-2 text-[12px] text-steel">
            {preview.effects.map((effect) => (
              <li key={effect}>{effect}</li>
            ))}
          </ul>
          {preview.rows.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead className="text-[11px] uppercase tracking-wider text-steel">
                  <tr>
                    <th className="py-2 pr-3">Document</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Account</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, index) => (
                    <tr key={`${row.document}-${index}`} className="border-t border-border/60">
                      <td className="py-2 pr-3 font-mono">{row.document || "—"}</td>
                      <td className="py-2 pr-3">{row.type}</td>
                      <td className="py-2 pr-3 font-mono">{row.account || "—"}</td>
                      <td className="num py-2 pr-3">{row.amount || "—"}</td>
                      <td className="py-2 pr-3">
                        <span className="font-semibold uppercase">{row.disposition}</span>
                        <div className="text-steel">{row.reason}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <button
            type="button"
            disabled={!preview.canCommit || busy}
            className="mt-3 h-9 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => {
              void (async () => {
                setBusy(true);
                const result = await confirmCustomerSalesImportFn({
                  data: { companyId, accountCode, text, filename },
                });
                setBusy(false);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Customer sales import stored");
                const again = await previewCustomerSalesImportFn({
                  data: { companyId, accountCode, text, filename },
                });
                if (again.ok) setPreview(again.data);
              })();
            }}
          >
            Import for this customer
          </button>
        </div>
      ) : null}
    </section>
  );
}
