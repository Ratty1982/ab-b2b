import { useEffect, useState } from "react";
import { listOpenHistoricReviewsFn } from "@/server/companies/autopart-history-all-fns";

type PreviewAccount = {
  accountCode: string;
  outcome: "import" | "review";
  reason: string | null;
  invoiceDocuments: number;
  creditDocuments: number;
  lineCount: number;
  lineNet: string;
  goodsNet: string;
  warnings: string[];
};

type Preview = {
  importedAccounts: number;
  reviewAccounts: number;
  accounts: PreviewAccount[];
};

export function AutopartAllHistoryPanel() {
  const [file561l, setFile561l] = useState<File | null>(null);
  const [fileSlrb, setFileSlrb] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Array<{ accountCode: string; reason: string; lineCount: number; lineNet: string }>>([]);

  async function loadReviews() {
    const result = await listOpenHistoricReviewsFn();
    if (result.ok) setReviews(result.data.reviews);
  }

  useEffect(() => {
    void loadReviews();
  }, []);

  async function submit(mode: "preview" | "commit") {
    if (!file561l || !fileSlrb) {
      setError("Choose both the 561L-ALL and SLRB-ALL files.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("mode", mode);
      body.set("file561l", file561l);
      body.set("fileSlrb", fileSlrb);
      const response = await fetch("/api/autopart-imports/history-all", { method: "POST", body });
      const payload = (await response.json()) as { ok: boolean; error?: string; data?: Preview };
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error ?? "The historical import did not complete.");
        return;
      }
      setPreview(payload.data);
      if (mode === "commit") {
        setConfirmed(false);
        await loadReviews();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border border-border px-4 py-4 text-[13px]">
      <h2 className="text-[15px] font-semibold">Historical sales — all customers</h2>
      <p className="mt-2 text-steel">
        Upload the fresh 561L-ALL product lines and SLRB-ALL document report together. Verified
        Autopart accounts are written once. Other accounts stay in the review queue until that
        account is verified. This does not import 407EXP again and does not create a second global
        invoice copy.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label>
          561L-ALL
          <input className="mt-1 block w-full" type="file" onChange={(event) => setFile561l(event.target.files?.[0] ?? null)} />
        </label>
        <label>
          SLRB-ALL
          <input className="mt-1 block w-full" type="file" onChange={(event) => setFileSlrb(event.target.files?.[0] ?? null)} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="border border-border px-3 py-1.5" disabled={busy} onClick={() => void submit("preview")}>
          Preview
        </button>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          Import these files into historical sales
        </label>
        <button
          type="button"
          className="border border-border px-3 py-1.5"
          disabled={busy || !confirmed}
          onClick={() => void submit("commit")}
        >
          Import
        </button>
      </div>
      {error ? <p className="mt-3 text-bad">{error}</p> : null}
      {preview ? (
        <div className="mt-4 overflow-x-auto">
          <p>
            Verified accounts: {preview.importedAccounts}. Review queue: {preview.reviewAccounts}.
          </p>
          <table className="mt-2 w-full min-w-[640px] text-left">
            <thead>
              <tr>
                <th>Account</th>
                <th>Result</th>
                <th>Invoices</th>
                <th>Credits</th>
                <th>Lines</th>
                <th>Line net</th>
                <th>Goods</th>
              </tr>
            </thead>
            <tbody>
              {preview.accounts.slice(0, 50).map((account) => (
                <tr key={account.accountCode}>
                  <td>{account.accountCode}</td>
                  <td>{account.outcome === "import" ? "Import" : account.reason}</td>
                  <td>{account.invoiceDocuments}</td>
                  <td>{account.creditDocuments}</td>
                  <td>{account.lineCount}</td>
                  <td>{account.lineNet}</td>
                  <td>{account.goodsNet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {reviews.length ? (
        <div className="mt-4">
          <h3 className="font-semibold">Open review queue</h3>
          <ul className="mt-2 space-y-1">
            {reviews.map((review) => (
              <li key={review.accountCode}>
                {review.accountCode} — {review.reason} — {review.lineCount} lines — {review.lineNet}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
