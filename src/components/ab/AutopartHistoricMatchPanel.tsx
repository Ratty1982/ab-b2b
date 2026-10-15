import { useEffect, useState } from "react";
import { HISTORIC_MATCH_VERIFY_PHRASE } from "@/domain/historic-account-match";
import {
  approveHistoricAccountMatchesFn,
  historicAccountMatchReportFn,
} from "@/server/companies/historic-account-match-fns";

type Report = Extract<Awaited<ReturnType<typeof historicAccountMatchReportFn>>, { ok: true }>["data"];
type Category = Report["categories"][number]["category"];

const PHRASE = HISTORIC_MATCH_VERIFY_PHRASE;

export function AutopartHistoricMatchPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [category, setCategory] = useState<Category>("EXACT_EVIDENCE");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function load(nextCategory = category, nextPage = page, nextQuery = query) {
    const response = await historicAccountMatchReportFn({
      data: { category: nextCategory, page: nextPage, pageSize: 25, query: nextQuery },
    });
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setReport(response.data);
    setError(null);
  }

  useEffect(() => {
    void load("EXACT_EVIDENCE", 1, "");
  }, []);

  function toggle(code: string, on: boolean) {
    setSelected((current) => {
      const without = current.filter((item) => item !== code);
      return on ? [...without, code] : without;
    });
  }

  const pageCodes = (report?.rows ?? []).filter((row) => row.selectable).map((row) => row.accountCode);
  const allSelected = pageCodes.length > 0 && pageCodes.every((code) => selected.includes(code));

  async function approve() {
    if (phrase !== PHRASE || selected.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await approveHistoricAccountMatchesFn({
        data: { accountCodes: selected.slice(0, 100), confirmation: phrase },
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      const saved = response.data;
      setResult(
        `Approved ${saved.approved.length}. Published existing verified mappings ${saved.republished.length}. Kept already verified ${saved.preserved.length}. Skipped ${saved.skipped.length}. Incomplete ${saved.incomplete.length}.`,
      );
      setSelected([]);
      setPhrase("");
      await load(category, page, query);
    } finally {
      setBusy(false);
    }
  }

  const pages = Math.max(1, Math.ceil((report?.total ?? 0) / (report?.pageSize ?? 25)));

  return (
    <section className="border border-border px-4 py-4 text-[13px]">
      <h2 className="text-[15px] font-semibold">Customer matching</h2>
      <p className="mt-2 text-steel">
        Review which 407EXP accounts can be tied to one CRM company. Approval saves that mapping and
        publishes staged history for the selected rows. It does not activate a trade account or send an invitation.
      </p>
      {report ? (
        <div className="mt-3 border border-border px-3 py-2">
          <p>{report.environment.summary}</p>
          <p className="mt-1 text-steel">
            Safely reviewable accounts on this database: {report.reviewableAccounts.toLocaleString()}. Verified
            mappings still waiting to publish: {report.verifiedPublicationPending.toLocaleString()}. Companies with a
            verified Autopart code and no 407EXP master: {report.verifiedCompanyCodesNotOnMaster.toLocaleString()}.
          </p>
        </div>
      ) : null}
      <ul className="mt-3 list-disc pl-5 text-steel">
        {(report?.rules ?? []).map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      {report ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-steel">
                <th className="py-1 pr-3 font-medium">Category</th>
                <th className="py-1 pr-3 font-medium">Accounts</th>
                <th className="py-1 pr-3 font-medium">Customer history</th>
                <th className="py-1 pr-3 font-medium">Global invoice lines</th>
                <th className="py-1 font-medium">Staged ALL lines</th>
              </tr>
            </thead>
            <tbody>
              {report.categories.map((item) => (
                <tr key={item.category} className="border-b border-border">
                  <td className="py-1 pr-3">{item.label}</td>
                  <td className="py-1 pr-3">{item.accounts.toLocaleString()}</td>
                  <td className="py-1 pr-3">
                    {item.customerHistory.lines.toLocaleString()} · {item.customerHistory.net}
                  </td>
                  <td className="py-1 pr-3">
                    {item.globalInvoices.lines.toLocaleString()} · {item.globalInvoices.net}
                  </td>
                  <td className="py-1">
                    {item.staged.lines.toLocaleString()} · {item.staged.net}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-steel">
            Lines on codes that are not 407EXP master accounts stay outside these categories. Customer history{" "}
            {report.outsideMaster.customerHistory.lines.toLocaleString()} ({report.outsideMaster.customerHistory.net}).
            Global invoice lines {report.outsideMaster.globalInvoices.lines.toLocaleString()} (
            {report.outsideMaster.globalInvoices.net}). Staged lines {report.outsideMaster.staged.lines.toLocaleString()} (
            {report.outsideMaster.staged.net}).
          </p>
          <p className="mt-1 text-steel">
            Existing import readiness on this database: {report.readiness.masterAccounts.toLocaleString()} master
            accounts, {report.readiness.verifiedCompanyCodes.toLocaleString()} verified codes including aliases,{" "}
            {report.readiness.masterSplit.import.toLocaleString()} eligible to import,{" "}
            {report.readiness.masterSplit.UNLINKED.toLocaleString()} unlinked,{" "}
            {report.readiness.masterSplit.NOT_VERIFIED.toLocaleString()} not verified,{" "}
            {report.readiness.masterSplit.AMBIGUOUS.toLocaleString()} ambiguous,{" "}
            {report.readiness.masterSplit.UNKNOWN.toLocaleString()} unknown.
          </p>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <select
          className="border border-border px-2 py-1"
          value={category}
          onChange={(event) => {
            const next = event.target.value as Category;
            setCategory(next);
            setPage(1);
            setSelected([]);
            void load(next, 1, query);
          }}
        >
          {(report?.categories ?? []).map((item) => (
            <option key={item.category} value={item.category}>
              {item.label}
            </option>
          ))}
        </select>
        <input
          className="border border-border px-2 py-1"
          value={query}
          placeholder="Account code"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="border border-border px-3 py-1"
          onClick={() => {
            setPage(1);
            void load(category, 1, query);
          }}
        >
          Search
        </button>
      </div>
      {report && report.rows.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-steel">
                <th className="py-1 pr-2 font-medium">
                  <input
                    type="checkbox"
                    aria-label="Select reviewable rows on this page"
                    checked={allSelected}
                    disabled={pageCodes.length === 0 || !report.canApprove}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setSelected((current) => [...new Set([...current, ...pageCodes])].slice(0, 100));
                      } else {
                        setSelected((current) => current.filter((code) => !pageCodes.includes(code)));
                      }
                    }}
                  />
                </th>
                <th className="py-1 pr-3 font-medium">Account</th>
                <th className="py-1 pr-3 font-medium">Company</th>
                <th className="py-1 pr-3 font-medium">Evidence</th>
                <th className="py-1 font-medium">History</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.accountId} className="border-b border-border align-top">
                  <td className="py-2 pr-2">
                    {row.selectable ? (
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.accountCode}`}
                        checked={selected.includes(row.accountCode)}
                        disabled={!report.canApprove}
                        onChange={(event) => toggle(row.accountCode, event.target.checked)}
                      />
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    <div className="font-medium">{row.accountCode}</div>
                    <div className="text-steel">{row.originalName}</div>
                  </td>
                  <td className="py-2 pr-3">
                    <div>{row.companyName ?? "No company"}</div>
                    <div className="text-steel">{row.companyStatus ?? ""}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {row.evidence.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                    {row.conflicts.map((item) => (
                      <p key={item} className="text-bad">
                        {item}
                      </p>
                    ))}
                    {row.pendingPublication ? <p>Staged history is still waiting to publish.</p> : null}
                  </td>
                  <td className="py-2">
                    <p>Customer history {row.customerHistory.lines.toLocaleString()} · {row.customerHistory.net}</p>
                    <p>Global invoices {row.globalInvoices.lines.toLocaleString()} · {row.globalInvoices.net}</p>
                    <p>Staged {row.staged.lines.toLocaleString()} · {row.staged.net}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : report ? (
        <p className="mt-3 text-steel">No accounts in this category.</p>
      ) : (
        <p className="mt-3 text-steel">Loading matching report…</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="border border-border px-3 py-1"
          disabled={page <= 1}
          onClick={() => {
            const next = page - 1;
            setPage(next);
            void load(category, next, query);
          }}
        >
          Previous
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button
          type="button"
          className="border border-border px-3 py-1"
          disabled={page >= pages}
          onClick={() => {
            const next = page + 1;
            setPage(next);
            void load(category, next, query);
          }}
        >
          Next
        </button>
      </div>
      {report?.canApprove ? (
        <div className="mt-4 border-t border-border pt-3">
          <p>
            Selected {selected.length}. Type {PHRASE} to save the ticked rows. Existing verified mappings are kept.
            Company status, portal access, and invitations stay unchanged.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className="min-w-72 border border-border px-2 py-1"
              value={phrase}
              aria-label="Verification confirmation"
              onChange={(event) => setPhrase(event.target.value)}
            />
            <button
              type="button"
              className="border border-border px-3 py-1.5"
              disabled={busy || phrase !== PHRASE || selected.length === 0}
              onClick={() => void approve()}
            >
              Approve selected mappings
            </button>
          </div>
        </div>
      ) : report ? (
        <p className="mt-3 text-steel">Approval needs Autopart import management permission.</p>
      ) : null}
      {error ? <p className="mt-3 text-bad">{error}</p> : null}
      {result ? <p className="mt-3">{result}</p> : null}
    </section>
  );
}
