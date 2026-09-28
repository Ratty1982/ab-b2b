import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { formatOperationalDateTime } from "@/lib/datetime";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import {
  confirmBulkAutopartCreditImportFn,
  getBulkCreditImportStatusFn,
  previewBulkAutopartCreditImportFn,
} from "@/server/phase2/fns";

type Status = Extract<
  Awaited<ReturnType<typeof getBulkCreditImportStatusFn>>,
  { ok: true }
>["data"];
type Preview = Extract<
  Awaited<ReturnType<typeof previewBulkAutopartCreditImportFn>>,
  { ok: true }
>["data"];
type ConfirmResult = Extract<
  Awaited<ReturnType<typeof confirmBulkAutopartCreditImportFn>>,
  { ok: true }
>["data"];

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function buttonClass(primary = false) {
  return cn(
    "h-10 rounded-md px-4 text-[12px] font-semibold uppercase tracking-wide disabled:cursor-wait disabled:opacity-50",
    primary
      ? "bg-primary text-primary-foreground"
      : "border border-border bg-surface/40 text-foreground hover:bg-surface",
  );
}

function gbp(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  return `£${value}`;
}

function matchTone(status: string): Tone {
  if (status === "MATCHED" || status === "MATCHED_ALIAS") return "good";
  if (status === "NOT_IN_AB") return "neutral";
  if (status === "DUPLICATE" || status === "INVALID") return "warn";
  return "neutral";
}

function changeLabel(row: Preview["rows"][number]): string {
  if (row.matchStatus === "NOT_IN_AB") return "—";
  if (row.matchStatus === "DUPLICATE" || row.matchStatus === "INVALID") return "—";
  if (row.changeKind === "NEW") return "NEW";
  if (row.changeKind === "UNCHANGED") return "UNCHANGED";
  if (row.deltas?.availableCredit || row.deltas?.usedCredit) {
    const parts: string[] = [];
    if (row.deltas.usedCredit) parts.push(`Used ${row.deltas.usedCredit}`);
    if (row.deltas.availableCredit) parts.push(`Avail ${row.deltas.availableCredit}`);
    return parts.join(" · ") || "UPDATE";
  }
  return "UPDATE";
}

async function readTextFile(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("File exceeds 10 MB limit");
  }
  const name = file.name.toLowerCase();
  if (!name.endsWith(".csv") && !name.endsWith(".txt") && !name.endsWith(".tsv")) {
    throw new Error("Accepts CSV or text report files only");
  }
  return file.text();
}

export function AutopartBulkCreditImportPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await getBulkCreditImportStatusFn();
    if (s.ok) {
      setStatus(s.data);
      setError(null);
    } else {
      setError(s.error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onPickFile(file: File | null) {
    if (!file) return;
    setBusy("preview");
    setError(null);
    setPreview(null);
    setResult(null);
    try {
      const text = await readTextFile(file);
      setFileText(text);
      setFilename(file.name);
      const r = await previewBulkAutopartCreditImportFn({
        data: { file407: text, filename: file.name },
      });
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      setPreview(r.data);
      if (r.data.alreadyImported) {
        toast.message("This file has already been imported");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not read file";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onConfirm() {
    if (!fileText || !preview?.canCommit) return;
    setBusy("confirm");
    setError(null);
    try {
      const r = await confirmBulkAutopartCreditImportFn({
        data: { file407: fileText, filename: filename ?? undefined },
      });
      if (!r.ok) {
        setError(r.error);
        toast.error(r.error);
        return;
      }
      setResult(r.data);
      setPreview(null);
      setFileText(null);
      toast.success(
        r.data.resultStatus === "SUCCESS_WITH_WARNINGS"
          ? "Credit import completed with warnings"
          : "Customer credit updated",
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4 lg:col-span-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold uppercase">Customer credit</h2>
          <p className="mt-1 text-[13px] text-steel">
            Manual bulk update from Autopart 407P100. Does not auto-release held orders.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.tsv,text/csv,text/plain"
          className="hidden"
          onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => fileRef.current?.click()}
          className={buttonClass(true)}
        >
          {busy === "preview" ? "Reading…" : "Import 407P100"}
        </button>
      </div>

      <div className="grid gap-3 rounded-lg border border-border p-4 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
            Current source
          </p>
          <p className="mt-1 font-semibold">{status?.source ?? "Autopart 407P100"}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">Mode</p>
          <p className="mt-1 font-semibold">{status?.mode ?? "Manual CSV Import"}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
            Last successful import
          </p>
          <p className="mt-1 font-semibold num">
            {status && status.hasImport
              ? (formatOperationalDateTime(status.lastImportAt) ?? "—")
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
            Customers updated
          </p>
          <p className="mt-1 font-semibold num">
            {status && status.hasImport ? String(status.customersUpdated) : "—"}
          </p>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[13px] text-bad">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-semibold uppercase">
              407P100 credit import
            </h3>
            {preview.alreadyImported ? (
              <StatusBadge tone="warn">Already imported</StatusBadge>
            ) : preview.resultStatus === "SUCCESS_WITH_WARNINGS" ? (
              <StatusBadge tone="warn">Warnings</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Dry-run</StatusBadge>
            )}
          </div>
          <dl className="grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-steel">File</dt>
              <dd className="font-semibold">{preview.filename ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-steel">Accounts in file</dt>
              <dd className="num font-semibold">{preview.summary.accountsInFile}</dd>
            </div>
            <div>
              <dt className="text-steel">Matched AB customers</dt>
              <dd className="num font-semibold">
                {preview.summary.matched + preview.summary.matchedAlias}
              </dd>
            </div>
            <div>
              <dt className="text-steel">Unmatched (not in AB)</dt>
              <dd className="num font-semibold">{preview.summary.notInAb}</dd>
            </div>
            <div>
              <dt className="text-steel">Duplicate accounts</dt>
              <dd className="num font-semibold">{preview.summary.duplicates}</dd>
            </div>
            <div>
              <dt className="text-steel">Invalid rows</dt>
              <dd className="num font-semibold">{preview.summary.invalid}</dd>
            </div>
            <div>
              <dt className="text-steel">Would update</dt>
              <dd className="num font-semibold">{preview.summary.wouldUpdate}</dd>
            </div>
            <div>
              <dt className="text-steel">Would remain unchanged</dt>
              <dd className="num font-semibold">{preview.summary.wouldRemainUnchanged}</dd>
            </div>
          </dl>

          {preview.alreadyImported && preview.priorImportAt ? (
            <p className="text-[13px] text-steel">
              This file has already been imported
              {" · "}
              {formatOperationalDateTime(preview.priorImportAt)}. Dry-run shown for inspection —
              confirm is blocked.
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[960px] text-[12px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-2 py-2 font-semibold">Autopart account</th>
                  <th className="px-2 py-2 font-semibold">Customer</th>
                  <th className="px-2 py-2 font-semibold">AB company</th>
                  <th className="px-2 py-2 font-semibold">Invoices</th>
                  <th className="px-2 py-2 font-semibold">Picking</th>
                  <th className="px-2 py-2 font-semibold">Other</th>
                  <th className="px-2 py-2 font-semibold">Used</th>
                  <th className="px-2 py-2 font-semibold">Limit</th>
                  <th className="px-2 py-2 font-semibold">Available</th>
                  <th className="px-2 py-2 font-semibold">Match</th>
                  <th className="px-2 py-2 font-semibold">Change</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 200).map((row) => (
                  <tr
                    key={`${row.lineNumberInFile}-${row.autopartAccount ?? "x"}`}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="num px-2 py-2 font-semibold">{row.autopartAccount ?? "—"}</td>
                    <td className="px-2 py-2">{row.customerName ?? "—"}</td>
                    <td className="px-2 py-2">{row.companyName ?? "—"}</td>
                    <td className="num px-2 py-2">{gbp(row.invoices)}</td>
                    <td className="num px-2 py-2">{gbp(row.picking)}</td>
                    <td className="num px-2 py-2">{gbp(row.otherExposure)}</td>
                    <td className="num px-2 py-2">{gbp(row.usedCredit)}</td>
                    <td className="num px-2 py-2">{gbp(row.creditLimit)}</td>
                    <td className="num px-2 py-2">{gbp(row.availableCredit)}</td>
                    <td className="px-2 py-2">
                      <StatusBadge tone={matchTone(row.matchStatus)}>{row.matchStatus}</StatusBadge>
                    </td>
                    <td className="px-2 py-2 text-steel">{changeLabel(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length > 200 ? (
              <p className="px-3 py-2 text-[12px] text-steel">
                Showing first 200 of {preview.rows.length} rows.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!preview.canCommit || Boolean(busy)}
              onClick={() => void onConfirm()}
              className={buttonClass(true)}
            >
              {busy === "confirm" ? "Updating…" : "Confirm credit update"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                setPreview(null);
                setFileText(null);
              }}
              className={buttonClass(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-3 rounded-lg border border-border p-4 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-semibold uppercase">Import result</h3>
            <StatusBadge tone={result.resultStatus === "SUCCESS" ? "good" : "warn"}>
              {result.resultStatus.replaceAll("_", " ")}
            </StatusBadge>
          </div>
          <dl className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <div>
              <dt className="text-steel">Accounts read</dt>
              <dd className="num font-semibold">{result.summary.accountsRead}</dd>
            </div>
            <div>
              <dt className="text-steel">Matched</dt>
              <dd className="num font-semibold">{result.summary.matched}</dd>
            </div>
            <div>
              <dt className="text-steel">Updated</dt>
              <dd className="num font-semibold">{result.summary.updated}</dd>
            </div>
            <div>
              <dt className="text-steel">Unchanged (freshness refreshed)</dt>
              <dd className="num font-semibold">{result.summary.unchanged}</dd>
            </div>
            <div>
              <dt className="text-steel">Not in AB</dt>
              <dd className="num font-semibold">{result.summary.notInAb}</dd>
            </div>
            <div>
              <dt className="text-steel">Invalid</dt>
              <dd className="num font-semibold">{result.summary.invalid}</dd>
            </div>
            <div>
              <dt className="text-steel">Duplicate</dt>
              <dd className="num font-semibold">{result.summary.duplicate}</dd>
            </div>
          </dl>
          {result.heldOrderHints.filter((h) => h.creditNowAvailable).length > 0 ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-steel">
                Credit now available — review and release
              </p>
              <ul className="mt-2 space-y-1">
                {result.heldOrderHints
                  .filter((h) => h.creditNowAvailable)
                  .slice(0, 20)
                  .map((h) => (
                    <li key={h.orderId}>
                      <Link
                        to="/admin/orders/$orderId"
                        params={{ orderId: h.orderId }}
                        className="font-semibold text-primary hover:underline"
                      >
                        {h.orderNumber}
                      </Link>
                      <span className="text-steel">
                        {" · "}
                        {h.message}
                        {h.effectiveAvailableCredit
                          ? ` · Available £${h.effectiveAvailableCredit}`
                          : ""}
                      </span>
                    </li>
                  ))}
              </ul>
              <a
                href={`${ROUTES.adminOrders}?credit=HOLD`}
                className="mt-2 inline-block text-[12px] font-semibold uppercase text-primary hover:underline"
              >
                Review orders
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
