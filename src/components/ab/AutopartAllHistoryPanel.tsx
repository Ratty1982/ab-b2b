import { useEffect, useState } from "react";
import { getHistoricAllImportFn, listOpenHistoricReviewsFn } from "@/server/companies/autopart-history-all-fns";

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
};

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

  useEffect(() => {
    if (!importId || status?.status === "COMMITTED" || status?.status === "FAILED") return;
    const timer = window.setInterval(() => {
      void getHistoricAllImportFn({ data: { importId } }).then((result) => {
        if (result.ok) setStatus(result.data);
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

  async function preview() {
    setBusy(true);
    setError(null);
    try {
      const id = importId ?? (await uploadPair());
      const response = await fetch("/api/autopart-imports/history-all", {
        method: "POST",
        headers: { "x-autopart-action": "preview", "x-autopart-import-id": id },
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Preview failed");
      const current = await getHistoricAllImportFn({ data: { importId: id } });
      if (current.ok) setStatus(current.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Preview failed");
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
      if (current.ok) setStatus(current.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border border-border px-4 py-4 text-[13px]">
      <h2 className="text-[15px] font-semibold">Historical sales — all customers</h2>
      <p className="mt-2 text-steel">
        Upload the fresh 561L-ALL and SLRB-ALL files. Original bytes are stored privately and hashed
        before decoding. Verified Autopart accounts are written once. Other accounts stay in the
        review queue. Payments and opening balances are not sales. A difference between a 561L total
        and the SLRB goods figure is reported and neither amount is changed.
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
        <button type="button" className="border border-border px-3 py-1.5" disabled={busy} onClick={() => void preview()}>
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
