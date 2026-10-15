import { useEffect, useState } from "react";
import {
  getHistoricAllImportFn,
  historicMatchingReadinessFn,
  listHistoricReviewsFn,
  searchCompaniesForHistoricVerifyFn,
  verifyHistoricReviewAccountFn,
} from "@/server/companies/autopart-history-all-fns";

type ImportStatus = {
  id: string;
  status: string;
  parsed561l: number;
  parsedSlrb: number;
  malformed561l: number;
  malformedSlrb: number;
  excludedLedger: number;
  stagedLineCount: number;
  importedLineCount: number;
  discrepancyCount: number;
  accountsCommitted: number;
  accountsReviewed: number;
  elapsedMs: number | null;
  peakRssBytes: number | null;
  summary: unknown;
};

type Preview = {
  parsed561: number;
  malformed561: number;
  parsedSlrb: number;
  malformedSlrb: number;
  excludedLedger: number;
  invoiceLines: number;
  creditLines: number;
  lineNet: string;
  goodsNet: string;
  excludedLedgerNet: string;
  discrepancyCount: number;
  discrepancyNet: string;
  matchedAccounts: number;
  unmatchedAccounts: number;
  matchedLines: number;
  unmatchedLines: number;
  reasons: Record<string, number>;
  ongoingOverlaps: { documents: number; lines: number };
  storage: { directory: string; persistent: boolean; requirement: string };
};

type Review = {
  id: string;
  accountCode: string;
  reason: string;
  lineCount: number;
  lineNet: string;
};

type Readiness = {
  environment: { kind: string; database: string | null; host: string | null; summary: string };
  storage: { persistent: boolean; requirement: string; directory: string };
  verifiedCompanyCodes: number;
  masterAccounts: number;
  masterSplit: { import: number; UNKNOWN: number; AMBIGUOUS: number; UNLINKED: number; NOT_VERIFIED: number };
  customerHistoryLines: { importLines: number; stagedLines: number; importNet: string; stagedNet: string };
  globalInvoiceLines: { importLines: number; stagedLines: number; importNet: string; stagedNet: string };
  allImportTablesPresent: boolean;
  latestCommittedImport: { importedLineCount: number; stagedLineCount: number } | null;
  note: string;
};

const REASONS = ["", "UNKNOWN", "AMBIGUOUS", "UNLINKED", "NOT_VERIFIED"] as const;

async function uploadFile(slot: "561l" | "slrb", file: File, importId: string | null) {
  const response = await fetch("/api/autopart-imports/history-all", {
    method: "POST",
    headers: {
      "x-autopart-history-file": slot,
      "x-autopart-filename": file.name,
      ...(importId ? { "x-autopart-import-id": importId } : {}),
    },
    body: file,
  });
  const payload = (await response.json()) as { ok: boolean; error?: string; data?: { importId: string } };
  if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error ?? "Upload failed");
  return payload.data.importId;
}

export function AutopartAllHistoryPanel() {
  const [file561l, setFile561l] = useState<File | null>(null);
  const [fileSlrb, setFileSlrb] = useState<File | null>(null);
  const [importId, setImportId] = useState<string | null>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [page, setPage] = useState(1);
  const [companyQuery, setCompanyQuery] = useState("");
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; autopartCustomerCode: string | null; verified: boolean }>>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [verifyConfirmed, setVerifyConfirmed] = useState(false);

  async function loadReviews(nextPage = page) {
    const result = await listHistoricReviewsFn({
      data: { query, reason: reason || undefined, page: nextPage, pageSize: 25 },
    });
    if (result.ok) {
      setReviews(result.data.reviews);
      setReviewTotal(result.data.total);
      setPage(result.data.page);
    }
  }

  useEffect(() => {
    void historicMatchingReadinessFn().then((result) => {
      if (result.ok) setReadiness(result.data as Readiness);
    });
    void loadReviews(1);
  }, []);

  useEffect(() => {
    if (!importId || status?.status === "COMMITTED" || status?.status === "FAILED") return;
    const timer = window.setInterval(() => {
      void getHistoricAllImportFn({ data: { importId } }).then((result) => {
        if (result.ok) setStatus(result.data as ImportStatus);
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [importId, status?.status]);

  async function uploadPair() {
    if (!file561l || !fileSlrb) throw new Error("Choose both the 561L-ALL and SLRB-ALL files.");
    const first = await uploadFile("561l", file561l, null);
    await uploadFile("slrb", fileSlrb, first);
    setImportId(first);
    return first;
  }

  async function previewFiles() {
    setBusy(true);
    setError(null);
    try {
      const id = importId ?? (await uploadPair());
      const response = await fetch("/api/autopart-imports/history-all", {
        method: "POST",
        headers: { "x-autopart-action": "preview", "x-autopart-import-id": id },
      });
      const payload = (await response.json()) as { ok: boolean; error?: string; data?: Preview };
      if (!response.ok || !payload.ok || !payload.data) throw new Error(payload.error ?? "Preview failed");
      setPreview(payload.data);
      const current = await getHistoricAllImportFn({ data: { importId: id } });
      if (current.ok) setStatus(current.data as ImportStatus);
    } catch (reasonCaught) {
      setError(reasonCaught instanceof Error ? reasonCaught.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const id = importId ?? (await uploadPair());
      const response = await fetch("/api/autopart-imports/history-all", {
        method: "POST",
        headers: { "x-autopart-action": "commit", "x-autopart-import-id": id },
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Import failed");
      const current = await getHistoricAllImportFn({ data: { importId: id } });
      if (current.ok) setStatus(current.data as ImportStatus);
    } catch (reasonCaught) {
      setError(reasonCaught instanceof Error ? reasonCaught.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function verify(review: Review) {
    if (!selectedCompanyId || !verifyConfirmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifyHistoricReviewAccountFn({
        data: { reviewId: review.id, companyId: selectedCompanyId, confirmation: "VERIFY HISTORIC ACCOUNT" },
      });
      if (!result.ok) throw new Error(result.error);
      setVerifyConfirmed(false);
      await loadReviews(page);
    } catch (reasonCaught) {
      setError(reasonCaught instanceof Error ? reasonCaught.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  const pages = Math.max(1, Math.ceil(reviewTotal / 25));

  return (
    <section className="border border-border px-4 py-4 text-[13px]">
      <h2 className="text-[15px] font-semibold">Historical sales — all customers</h2>
      <p className="mt-2 text-steel">
        Upload the fresh 561L-ALL and SLRB-ALL files. Original bytes are stored privately and hashed
        before decoding. Exact verified accounts are written. Other accounts stay in the review queue.
        Payments and opening balances are not sales. A difference between a 561L total and the SLRB
        goods figure is reported and neither amount is changed.
      </p>
      {readiness ? (
        <div className="mt-3 border border-border px-3 py-3">
          <p className="font-semibold">Matching readiness — {readiness.environment.kind}</p>
          <p className="mt-1 text-steel">{readiness.environment.summary}</p>
          <p className="mt-2">
            Database {readiness.environment.database ?? "unknown"} on {readiness.environment.host ?? "unknown"}.
            Verified company codes {readiness.verifiedCompanyCodes.toLocaleString()}. 407EXP accounts{" "}
            {readiness.masterAccounts.toLocaleString()}: {readiness.masterSplit.import.toLocaleString()} would import,{" "}
            {(readiness.masterAccounts - readiness.masterSplit.import).toLocaleString()} would stay staged
            ({readiness.masterSplit.UNLINKED} unlinked, {readiness.masterSplit.NOT_VERIFIED} not verified,{" "}
            {readiness.masterSplit.AMBIGUOUS} ambiguous, {readiness.masterSplit.UNKNOWN} unknown).
          </p>
          <p className="mt-1">
            Customer history lines that would import {readiness.customerHistoryLines.importLines.toLocaleString()} (
            {readiness.customerHistoryLines.importNet}). Lines that would stay staged{" "}
            {readiness.customerHistoryLines.stagedLines.toLocaleString()} ({readiness.customerHistoryLines.stagedNet}).
            Global 561L rows that would import {readiness.globalInvoiceLines.importLines.toLocaleString()}. Global rows
            that would stay staged {readiness.globalInvoiceLines.stagedLines.toLocaleString()}.
          </p>
          {readiness.allImportTablesPresent ? null : (
            <p className="mt-1">The all-accounts import tables are not on this database yet.</p>
          )}
          {readiness.latestCommittedImport ? (
            <p className="mt-1">
              Latest committed ALL import: {readiness.latestCommittedImport.importedLineCount.toLocaleString()} imported
              lines, {readiness.latestCommittedImport.stagedLineCount.toLocaleString()} staged lines.
            </p>
          ) : null}
          <p className="mt-2 text-steel">{readiness.storage.requirement}</p>
        </div>
      ) : null}
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
        <button type="button" className="border border-border px-3 py-1.5" disabled={busy} onClick={() => void previewFiles()}>
          Preview
        </button>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          Import these files into historical sales
        </label>
        <button type="button" className="border border-border px-3 py-1.5" disabled={busy || !confirmed} onClick={() => void commit()}>
          Import
        </button>
      </div>
      {error ? <p className="mt-3 text-bad">{error}</p> : null}
      {preview ? (
        <div className="mt-3">
          <p>
            Preview. Matched accounts {preview.matchedAccounts.toLocaleString()} ({preview.matchedLines.toLocaleString()} lines).
            Unmatched accounts {preview.unmatchedAccounts.toLocaleString()} ({preview.unmatchedLines.toLocaleString()} lines).
            561L net {preview.lineNet}. SLRB goods {preview.goodsNet}. Excluded payments and opening balances{" "}
            {preview.excludedLedger.toLocaleString()} ({preview.excludedLedgerNet}). Discrepancies{" "}
            {preview.discrepancyCount.toLocaleString()} (signed difference {preview.discrepancyNet}). Ongoing 504/TRM
            overlaps {preview.ongoingOverlaps.documents.toLocaleString()} documents, {preview.ongoingOverlaps.lines.toLocaleString()} TRM lines.
          </p>
          <p className="mt-1 text-steel">
            Unknown {preview.reasons["UNKNOWN"] ?? 0}. Ambiguous {preview.reasons["AMBIGUOUS"] ?? 0}. Unlinked{" "}
            {preview.reasons["UNLINKED"] ?? 0}. Not verified {preview.reasons["NOT_VERIFIED"] ?? 0}. Malformed 561L{" "}
            {preview.malformed561.toLocaleString()}, SLRB {preview.malformedSlrb.toLocaleString()}.
          </p>
          <p className="mt-1 text-steel">{preview.storage.requirement}</p>
        </div>
      ) : null}
      {status ? (
        <p className="mt-3">
          Status {status.status}. 561L {status.parsed561l.toLocaleString()} ({status.malformed561l.toLocaleString()} malformed).
          SLRB {status.parsedSlrb.toLocaleString()} ({status.excludedLedger.toLocaleString()} payments or opening balances excluded).
          Imported lines {status.importedLineCount.toLocaleString()}. Staged lines {status.stagedLineCount.toLocaleString()}.
          Discrepancies {status.discrepancyCount.toLocaleString()}.
          {status.elapsedMs != null ? ` Elapsed ${Math.round(status.elapsedMs / 1000)}s.` : ""}
          {status.peakRssBytes != null ? ` Peak memory ${Math.round(status.peakRssBytes / 1048576)} MB.` : ""}
        </p>
      ) : null}
      <div className="mt-4">
        <h3 className="font-semibold">Open review queue</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className="border border-border px-2 py-1"
            value={query}
            placeholder="Account code"
            onChange={(event) => setQuery(event.target.value)}
          />
          <select className="border border-border px-2 py-1" value={reason} onChange={(event) => setReason(event.target.value)}>
            {REASONS.map((item) => (
              <option key={item || "all"} value={item}>
                {item || "All reasons"}
              </option>
            ))}
          </select>
          <button type="button" className="border border-border px-3 py-1" onClick={() => void loadReviews(1)}>
            Search
          </button>
        </div>
        <ul className="mt-2 space-y-1">
          {reviews.map((review) => (
            <li key={review.id}>
              {review.accountCode} — {review.reason} — {review.lineCount} lines — {review.lineNet}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <button type="button" className="border border-border px-2 py-1" disabled={page <= 1} onClick={() => void loadReviews(page - 1)}>
            Previous
          </button>
          <span>
            Page {page} of {pages} ({reviewTotal.toLocaleString()} open)
          </span>
          <button type="button" className="border border-border px-2 py-1" disabled={page >= pages} onClick={() => void loadReviews(page + 1)}>
            Next
          </button>
        </div>
        <div className="mt-3">
          <p className="font-semibold">Verify an exact account</p>
          <p className="mt-1 text-steel">
            Unknown and ambiguous codes cannot be verified here. Choose the customer that already owns the 407EXP
            account, or an unlinked customer with no different code.
          </p>
          <input
            className="mt-2 border border-border px-2 py-1"
            value={companyQuery}
            placeholder="Customer name or account"
            onChange={(event) => setCompanyQuery(event.target.value)}
          />
          <button
            type="button"
            className="ml-2 border border-border px-3 py-1"
            onClick={() => {
              void searchCompaniesForHistoricVerifyFn({ data: { query: companyQuery } }).then((result) => {
                if (result.ok) setCompanies(result.data);
              });
            }}
          >
            Find customer
          </button>
          <ul className="mt-2 space-y-1">
            {companies.map((company) => (
              <li key={company.id}>
                <button type="button" className="underline" onClick={() => setSelectedCompanyId(company.id)}>
                  {company.name}
                  {company.autopartCustomerCode ? ` — ${company.autopartCustomerCode}` : ""}
                  {selectedCompanyId === company.id ? " (selected)" : ""}
                </button>
              </li>
            ))}
          </ul>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" checked={verifyConfirmed} onChange={(event) => setVerifyConfirmed(event.target.checked)} />
            Verify this exact account and import its staged history
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {reviews
              .filter((review) => review.reason === "UNLINKED" || review.reason === "NOT_VERIFIED")
              .slice(0, 10)
              .map((review) => (
                <button
                  key={review.id}
                  type="button"
                  className="border border-border px-2 py-1"
                  disabled={busy || !selectedCompanyId || !verifyConfirmed}
                  onClick={() => void verify(review)}
                >
                  Verify {review.accountCode}
                </button>
              ))}
          </div>
        </div>
      </div>
    </section>
  );
}
