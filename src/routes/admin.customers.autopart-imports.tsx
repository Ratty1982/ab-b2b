import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { AutopartProspectConversionPanel } from "@/components/ab/AutopartProspectConversionPanel";
import { StatusBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import { searchCompaniesForAutopartMappingFn } from "@/server/phase2/fns";
import {
  cancelAutopartImportFn,
  classifyAutopartAccountFn,
  confirmAutopartImportFn,
  createCompanyForAutopartAccountFn,
  getAutopartHistoricalSummaryFn,
  getAutopartImportBatchFn,
  linkAutopartMasterAccountFn,
  listAutopartImportBatchesFn,
  listAutopartImportIssuesFn,
  listAutopartInvoiceLinesFn,
  listAutopartLedgerFn,
  listAutopartMasterAccountsFn,
  listAutopartReconciliationFn,
  listDuplicateAutopartNamesFn,
  previewAutopartImportFn,
} from "@/server/companies/autopart-master-fns";

export const Route = createFileRoute("/admin/customers/autopart-imports")({
  head: () => ({
    meta: [{ title: "Autopart Imports — Automotive Brands Admin" }],
  }),
  component: AutopartImportsPage,
});

type BatchList = Extract<
  Awaited<ReturnType<typeof listAutopartImportBatchesFn>>,
  { ok: true }
>["data"];
type Batch = Extract<Awaited<ReturnType<typeof getAutopartImportBatchFn>>, { ok: true }>["data"];
type Accounts = Extract<
  Awaited<ReturnType<typeof listAutopartMasterAccountsFn>>,
  { ok: true }
>["data"];
type Issues = Extract<Awaited<ReturnType<typeof listAutopartImportIssuesFn>>, { ok: true }>["data"];
type Summary = Extract<
  Awaited<ReturnType<typeof getAutopartHistoricalSummaryFn>>,
  { ok: true }
>["data"];
type Lines = Extract<Awaited<ReturnType<typeof listAutopartInvoiceLinesFn>>, { ok: true }>["data"];
type Ledger = Extract<Awaited<ReturnType<typeof listAutopartLedgerFn>>, { ok: true }>["data"];
type Reconciliation = Extract<
  Awaited<ReturnType<typeof listAutopartReconciliationFn>>,
  { ok: true }
>["data"];
type Duplicates = Extract<
  Awaited<ReturnType<typeof listDuplicateAutopartNamesFn>>,
  { ok: true }
>["data"];

const KINDS = [
  { kind: "CUSTOMER_MASTER", label: "407EXP customer master", accept: ".txt,text/plain" },
  { kind: "INVOICE_LINES", label: "561L invoice lines", accept: ".csv,text/csv" },
  { kind: "LEDGER", label: "SLRB ledger", accept: ".csv,text/csv" },
] as const;

const CLASSIFICATIONS = [
  "TRADE_CANDIDATE",
  "INTERNAL",
  "CASH",
  "STAFF",
  "OBSOLETE",
  "DO_NOT_USE",
  "UNIDENTIFIED",
  "REQUIRES_REVIEW",
] as const;

const INVOICE_FIELDS = [
  ["account", "Account"],
  ["invLn", "Inv & Ln"],
  ["part", "Part number"],
  ["description", "Description"],
  ["units", "Units"],
  ["sales", "Sales"],
] as const;

const LEDGER_FIELDS = [
  ["account", "A/C"],
  ["name", "Name"],
  ["sacct", "Sacct"],
  ["type", "Type"],
  ["ref", "Ref"],
  ["date", "Date"],
  ["goods", "Tot Goods"],
  ["vat", "Tot VAT"],
  ["total", "Total"],
  ["balance", "Run Bal"],
] as const;

type Diagnostics = {
  needsMapping?: boolean;
  headers?: string[];
  missingColumns?: string[];
  samples?: unknown[];
  issues?: {
    explanation?: string;
    issueType?: string;
    rowNumber?: number;
    sourceRowNumber?: number;
    redacted?: string;
  }[];
  summary?: {
    distinctAccounts?: number;
    duplicateAccounts?: number;
    truncatedNames?: number;
    blankArea?: number;
    blankRep?: number;
    classifications?: Record<string, number>;
  };
  recoveredQuotes?: number;
  sourceRecords?: number;
  validRecords?: number;
  recoveredRecords?: number;
  rejectedRecords?: number;
  acceptedSales?: string | null;
  recoveredSales?: string | null;
  rejectionReasons?: { issueType: string; count: number }[];
  unresolvedParsing?: boolean;
  distinctAccounts?: number;
  salesMeasure?: string | null;
  provisionalHeaders?: boolean;
  issueLogTruncated?: boolean;
};

function diagnosticsOf(batch: Batch | null): Diagnostics {
  const value = batch?.diagnostics;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Diagnostics;
}

function AutopartImportsPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<BatchList | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [accountQuery, setAccountQuery] = useState("");
  const [accountLink, setAccountLink] = useState<"all" | "linked" | "unlinked">("unlinked");
  const [accountClass, setAccountClass] = useState<(typeof CLASSIFICATIONS)[number] | "ALL">("ALL");
  const [accountPage, setAccountPage] = useState(1);
  const [issues, setIssues] = useState<Issues | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicates | null>(null);
  const [lines, setLines] = useState<Lines | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [historyAccount, setHistoryAccount] = useState("");
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyHits, setCompanyHits] = useState<{ id: string; name: string }[]>([]);
  const [linkAccountId, setLinkAccountId] = useState("");

  const loadBatches = useCallback(async () => {
    const result = await listAutopartImportBatchesFn({ data: { page: 1 } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBatches(result.data);
  }, []);

  const loadAccounts = useCallback(async () => {
    const result = await listAutopartMasterAccountsFn({
      data: {
        q: accountQuery,
        link: accountLink,
        classification: accountClass,
        page: accountPage,
      },
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAccounts(result.data);
  }, [accountClass, accountLink, accountPage, accountQuery]);

  useEffect(() => {
    const account = new URLSearchParams(window.location.search).get("account")?.trim() ?? "";
    if (!account) return;
    setAccountQuery(account);
    setAccountLink("all");
    setAccountPage(1);
  }, []);

  useEffect(() => {
    void loadBatches();
    void getAutopartHistoricalSummaryFn().then((result) => {
      if (result.ok) setSummary(result.data);
    });
    void listDuplicateAutopartNamesFn({ data: { page: 1 } }).then((result) => {
      if (result.ok) setDuplicates(result.data);
    });
  }, [loadBatches]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (batch?.status !== "RUNNING") return;
    const timer = window.setInterval(() => {
      void getAutopartImportBatchFn({ data: { batchId: batch.id } }).then((result) => {
        if (!result.ok) return;
        setBatch(result.data);
        if (result.data.status !== "RUNNING") void loadBatches();
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [batch?.id, batch?.status, loadBatches]);

  async function openBatch(batchId: string) {
    setConfirmWrite(false);
    setColumnMap({});
    const result = await getAutopartImportBatchFn({ data: { batchId } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBatch(result.data);
    const issueResult = await listAutopartImportIssuesFn({ data: { batchId, page: 1 } });
    if (issueResult.ok) setIssues(issueResult.data);
  }

  async function upload(kind: (typeof KINDS)[number]["kind"], file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setConfirmWrite(false);
    try {
      const response = await fetch("/api/autopart-imports/upload", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/octet-stream",
          "x-autopart-kind": kind,
          "x-autopart-filename": file.name,
        },
        body: file,
      });
      const payload = (await response.json()) as {
        ok: boolean;
        error?: string;
        data?: { batchId: string };
      };
      if (!response.ok || !payload.ok || !payload.data) {
        setError(payload.error ?? "Upload failed");
        return;
      }
      const preview = await previewAutopartImportFn({ data: { batchId: payload.data.batchId } });
      if (!preview.ok) {
        setError(preview.error);
        return;
      }
      setBatch(preview.data);
      await loadBatches();
    } finally {
      setBusy(false);
    }
  }

  async function remap() {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      const preview = await previewAutopartImportFn({ data: { batchId: batch.id, columnMap } });
      if (!preview.ok) {
        setError(preview.error);
        return;
      }
      setBatch(preview.data);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!batch || !confirmWrite) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirmAutopartImportFn({ data: { batchId: batch.id } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBatch(result.data);
      await loadBatches();
    } finally {
      setBusy(false);
    }
  }

  async function loadHistory() {
    const accountCode = historyAccount.trim();
    const [lineResult, ledgerResult, matchResult] = await Promise.all([
      listAutopartInvoiceLinesFn({ data: accountCode ? { accountCode, page: 1 } : { page: 1 } }),
      listAutopartLedgerFn({ data: accountCode ? { accountCode, page: 1 } : { page: 1 } }),
      listAutopartReconciliationFn({ data: accountCode ? { accountCode, page: 1 } : { page: 1 } }),
    ]);
    if (!lineResult.ok) setError(lineResult.error);
    else setLines(lineResult.data);
    if (!ledgerResult.ok) setLedger(null);
    else setLedger(ledgerResult.data);
    if (!matchResult.ok) setError(matchResult.error);
    else setReconciliation(matchResult.data);
  }

  const diagnostics = diagnosticsOf(batch);
  const fields = batch?.kind === "LEDGER" ? LEDGER_FIELDS : INVOICE_FIELDS;

  return (
    <div>
      <PanelHeader
        title="Autopart Imports"
        sub="Internal historical imports. Nothing here creates orders, stock movements, invoices, or customer logins."
        crumbs={[
          { label: "CRM" },
          { label: "Customers", to: ROUTES.adminCustomers },
          { label: "Autopart Imports" },
        ]}
      />
      <div className="space-y-6 px-4 py-4 sm:px-6">
        {error ? <p className="text-[13px] text-bad">{error}</p> : null}
        <p className="text-[13px] text-steel">
          Uploads stay private. Preview does not write historical rows. A database import starts
          only after the confirmation box is ticked. Historical access stays off.
        </p>
        <AutopartProspectConversionPanel />

        <section className="grid gap-3 md:grid-cols-3">
          {KINDS.map((item) => (
            <label key={item.kind} className="border border-border px-4 py-3 text-[13px]">
              <span className="font-semibold">{item.label}</span>
              <input
                className="mt-3 block w-full text-[12px]"
                type="file"
                accept={item.accept}
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  void upload(item.kind, file);
                }}
              />
            </label>
          ))}
        </section>

        {summary ? (
          <section className="border border-border px-4 py-3 text-[13px]">
            <h2 className="font-display text-sm font-semibold uppercase">Historical summary</h2>
            <p className="mt-1 text-steel">{summary.label}</p>
            <p className="mt-2">
              Accounts {summary.accounts.toLocaleString("en-GB")} · Product lines{" "}
              {summary.invoiceLines.toLocaleString("en-GB")} · Committed invoice rows{" "}
              {summary.committedInvoiceRows.toLocaleString("en-GB")} · Updated existing identities{" "}
              {summary.updatedInvoiceRows.toLocaleString("en-GB")} · Line sales{" "}
              {summary.historicalLineSales} ({summary.salesMeasure})
            </p>
            <p className="mt-1 text-steel">{summary.countNote}</p>
          </section>
        ) : null}

        {batch ? (
          <section className="border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="font-display text-sm font-semibold uppercase">{batch.filename}</h2>
                <p className="text-[12px] text-steel">
                  {batch.kind} · {batch.dryRun ? "Dry run" : "Database write"} · Source records{" "}
                  {(diagnostics.sourceRecords ?? batch.totalRows).toLocaleString("en-GB")} · Valid{" "}
                  {(diagnostics.validRecords ?? batch.validRows).toLocaleString("en-GB")} ·
                  Recovered{" "}
                  {(
                    diagnostics.recoveredRecords ??
                    diagnostics.recoveredQuotes ??
                    0
                  ).toLocaleString("en-GB")}{" "}
                  · Rejected{" "}
                  {(diagnostics.rejectedRecords ?? batch.rejectedRows).toLocaleString("en-GB")}
                </p>
              </div>
              <StatusBadge
                tone={
                  batch.status === "FAILED" ? "bad" : batch.status === "COMMITTED" ? "good" : "warn"
                }
              >
                {batch.status}
              </StatusBadge>
            </div>
            <div className="space-y-3 px-4 py-3 text-[13px]">
              {batch.errorSummary ? <p className="text-bad">{batch.errorSummary}</p> : null}
              {diagnostics.provisionalHeaders ? (
                <p className="text-steel">
                  CSV headers are matched from the documented layout until this file is inspected.
                </p>
              ) : null}
              {diagnostics.salesMeasure ? (
                <p className="text-steel">
                  Product line sales measure: {diagnostics.salesMeasure}. This is not the invoice
                  total.
                </p>
              ) : null}
              {batch.status === "COMMITTED" && batch.kind === "INVOICE_LINES" ? (
                <p className="text-steel">
                  New stored rows {batch.importedRows.toLocaleString("en-GB")} · Updated existing
                  source identities {batch.updatedRows.toLocaleString("en-GB")} · Accepted rows{" "}
                  {(batch.importedRows + batch.updatedRows).toLocaleString("en-GB")}. Stored product
                  lines count unique source identities. Updating an existing identity does not add a
                  row and does not change the stored sales amount.
                </p>
              ) : null}
              {diagnostics.summary ? (
                <p className="text-steel">
                  Distinct accounts {diagnostics.summary.distinctAccounts ?? 0} · Duplicate codes{" "}
                  {diagnostics.summary.duplicateAccounts ?? 0} · Possible truncated names{" "}
                  {diagnostics.summary.truncatedNames ?? 0} · Blank area{" "}
                  {diagnostics.summary.blankArea ?? 0} · Blank rep{" "}
                  {diagnostics.summary.blankRep ?? 0}
                </p>
              ) : null}
              {diagnostics.unresolvedParsing ? (
                <p className="text-bad">
                  This file still has unresolved parsing errors. Rejected rows stay out of the
                  accepted sales total and are not imported.
                </p>
              ) : null}
              {diagnostics.acceptedSales != null ? (
                <p className="text-steel">
                  Accepted signed sales {diagnostics.acceptedSales} · Recovered signed sales{" "}
                  {diagnostics.recoveredSales ?? "0.00"} ({diagnostics.salesMeasure ?? "NET_EX_VAT"}
                  ). Recovered rows are included in the accepted total. Rejected rows are not.
                </p>
              ) : null}
              {diagnostics.recoveredRecords ? (
                <p className="text-steel">
                  Safely recovered records: {diagnostics.recoveredRecords.toLocaleString("en-GB")}.
                  These rows are separate from records that remain rejected.
                </p>
              ) : null}
              {diagnostics.rejectionReasons?.length ? (
                <ul className="space-y-1 text-steel">
                  {diagnostics.rejectionReasons.map((reason) => (
                    <li key={reason.issueType}>
                      {reason.issueType}: {reason.count.toLocaleString("en-GB")}
                    </li>
                  ))}
                </ul>
              ) : null}
              {diagnostics.needsMapping && diagnostics.headers ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {fields.map(([key, label]) => (
                    <Field key={key} label={label}>
                      <select
                        className={inputClass}
                        value={columnMap[key] ?? ""}
                        onChange={(event) =>
                          setColumnMap((current) => ({ ...current, [key]: event.target.value }))
                        }
                      >
                        <option value="">Select a column</option>
                        {diagnostics.headers?.filter(Boolean).map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                  <button
                    type="button"
                    className="h-10 border border-border px-3 text-[11px] font-semibold uppercase"
                    onClick={() => void remap()}
                  >
                    Apply column map
                  </button>
                </div>
              ) : null}
              {diagnostics.issues?.length ? (
                <div className="space-y-2">
                  <p className="font-semibold">Rejected rows</p>
                  <ul className="space-y-2 text-steel">
                    {diagnostics.issues.map((issue, index) => (
                      <li key={`${issue.issueType ?? "issue"}-${issue.rowNumber ?? index}`}>
                        <p>
                          Rejected · row {issue.rowNumber ?? issue.sourceRowNumber ?? "—"} ·{" "}
                          {issue.issueType}: {issue.explanation}
                        </p>
                        {issue.redacted ? (
                          <p className="font-mono text-[11px] text-steel">{issue.redacted}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {diagnostics.samples?.length ? (
                <pre className="max-h-48 overflow-auto bg-surface/50 p-3 text-[11px]">
                  {JSON.stringify(diagnostics.samples, null, 2)}
                </pre>
              ) : null}
              {batch.status === "PREVIEWED" || batch.status === "FAILED" ? (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={confirmWrite}
                    onChange={(event) => setConfirmWrite(event.target.checked)}
                  />
                  <span>
                    Write these validated rows into the database. This is not a dry run, and it
                    still does not activate customers.
                  </span>
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    busy ||
                    !confirmWrite ||
                    (batch.status !== "PREVIEWED" && batch.status !== "FAILED")
                  }
                  className="h-9 bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground disabled:opacity-40"
                  onClick={() => void confirmImport()}
                >
                  Import into database
                </button>
                <button
                  type="button"
                  className="h-9 border border-border px-3 text-[11px] font-semibold uppercase"
                  onClick={() =>
                    void cancelAutopartImportFn({ data: { batchId: batch.id } }).then(() =>
                      openBatch(batch.id),
                    )
                  }
                >
                  Cancel
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section>
          <h2 className="font-display text-sm font-semibold uppercase">Import batches</h2>
          <div className="mt-2 overflow-x-auto border border-border">
            <table className="min-w-full text-left text-[12px]">
              <thead className="border-b border-border text-[10px] uppercase text-steel">
                <tr>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Rows</th>
                  <th className="px-3 py-2">Rejected</th>
                  <th className="px-3 py-2">Unmatched</th>
                </tr>
              </thead>
              <tbody>
                {batches?.items.map((item) => (
                  <tr key={item.id} className="border-b border-border/70">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-cyan underline"
                        onClick={() => void openBatch(item.id)}
                      >
                        {item.filename}
                      </button>
                    </td>
                    <td className="px-3 py-2">{item.kind}</td>
                    <td className="px-3 py-2">
                      {item.status}
                      {item.dryRun ? " · dry run" : ""}
                    </td>
                    <td className="px-3 py-2">{item.totalRows}</td>
                    <td className="px-3 py-2">{item.rejectedRows}</td>
                    <td className="px-3 py-2">{item.unmatchedAccounts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {issues && issues.total > 0 ? (
          <section>
            <h2 className="font-display text-sm font-semibold uppercase">
              Stored issues ({issues.total})
            </h2>
            <ul className="mt-2 space-y-1 text-[12px] text-steel">
              {issues.items.map((issue) => (
                <li key={issue.id}>
                  Row {issue.sourceRowNumber ?? "—"} · {issue.issueType} · {issue.explanation}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="font-display text-sm font-semibold uppercase">Accounts</h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Search">
              <input
                className={inputClass}
                value={accountQuery}
                onChange={(event) => setAccountQuery(event.target.value)}
              />
            </Field>
            <Field label="Link">
              <select
                className={inputClass}
                value={accountLink}
                onChange={(event) =>
                  setAccountLink(event.target.value as "all" | "linked" | "unlinked")
                }
              >
                <option value="unlinked">Unlinked</option>
                <option value="linked">Linked</option>
                <option value="all">All</option>
              </select>
            </Field>
            <Field label="Classification">
              <select
                className={inputClass}
                value={accountClass}
                onChange={(event) => setAccountClass(event.target.value as typeof accountClass)}
              >
                <option value="ALL">All</option>
                {CLASSIFICATIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="text-[12px] text-steel">
            {accounts ? `${accounts.total.toLocaleString("en-GB")} accounts` : "Loading accounts…"}
          </p>
          <div className="overflow-x-auto border border-border">
            <table className="min-w-full text-left text-[12px]">
              <thead className="border-b border-border text-[10px] uppercase text-steel">
                <tr>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Area / Rep</th>
                  <th className="px-3 py-2">Class</th>
                  <th className="px-3 py-2">Company</th>
                </tr>
              </thead>
              <tbody>
                {accounts?.items.map((account) => (
                  <tr key={account.id} className="border-b border-border/70 align-top">
                    <td className="px-3 py-2 font-mono">{account.accountCode}</td>
                    <td className="px-3 py-2">
                      {account.originalName || "—"}
                      {account.nameTruncated ? (
                        <span className="block text-steel">Name may be truncated</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      {account.areaCode || "—"} / {account.repCode || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        className={inputClass}
                        value={account.classification}
                        onChange={(event) => {
                          void classifyAutopartAccountFn({
                            data: {
                              accountId: account.id,
                              classification: event.target
                                .value as (typeof CLASSIFICATIONS)[number],
                            },
                          }).then((result) => {
                            if (!result.ok) setError(result.error);
                            else void loadAccounts();
                          });
                        }}
                      >
                        {CLASSIFICATIONS.map((item) => (
                          <option key={item} value={item}>
                            {item}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {account.company ? (
                        <Link
                          to="/admin/customers/$id"
                          params={{ id: account.company.id }}
                          className="text-cyan underline"
                        >
                          {account.company.name}
                        </Link>
                      ) : (
                        <div className="space-y-1">
                          <button
                            type="button"
                            className="block text-[11px] font-semibold uppercase text-cyan"
                            onClick={() => {
                              void createCompanyForAutopartAccountFn({
                                data: { accountId: account.id },
                              }).then((result) => {
                                if (!result.ok) setError(result.error);
                                else void loadAccounts();
                              });
                            }}
                          >
                            Create prospect
                          </button>
                          <p className="text-[11px] text-steel">
                            Creates a prospect and links this account. Does not approve customer
                            portal history.
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="h-8 border border-border px-3 text-[11px] uppercase"
              disabled={accountPage <= 1}
              onClick={() => setAccountPage((page) => Math.max(1, page - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="h-8 border border-border px-3 text-[11px] uppercase"
              onClick={() => setAccountPage((page) => page + 1)}
            >
              Next
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Account to link">
              <select
                className={inputClass}
                value={linkAccountId}
                onChange={(event) => setLinkAccountId(event.target.value)}
              >
                <option value="">Select an unlinked account</option>
                {accounts?.items
                  .filter((account) => !account.companyId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.accountCode}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Existing company">
              <input
                className={inputClass}
                value={companyQuery}
                placeholder="Company name"
                onChange={(event) => {
                  const value = event.target.value;
                  setCompanyQuery(value);
                  if (value.trim().length < 2) {
                    setCompanyHits([]);
                    return;
                  }
                  void searchCompaniesForAutopartMappingFn({ data: { q: value, limit: 8 } }).then(
                    (result) => {
                      if (!result.ok) return;
                      setCompanyHits(
                        result.data.items.map((item) => ({ id: item.id, name: item.name })),
                      );
                    },
                  );
                }}
              />
            </Field>
          </div>
          {linkAccountId && companyHits.length > 0 ? (
            <ul className="text-[12px]">
              {companyHits.map((company) => (
                <li key={company.id}>
                  <button
                    type="button"
                    className="text-cyan underline"
                    onClick={() => {
                      void linkAutopartMasterAccountFn({
                        data: { accountId: linkAccountId, companyId: company.id },
                      }).then((result) => {
                        if (!result.ok) setError(result.error);
                        else {
                          setCompanyHits([]);
                          setLinkAccountId("");
                          void loadAccounts();
                        }
                      });
                    }}
                  >
                    Link selected account to {company.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {duplicates && duplicates.total > 0 ? (
          <section>
            <h2 className="font-display text-sm font-semibold uppercase">
              Same name, different account codes
            </h2>
            <p className="mt-1 text-[12px] text-steel">
              These stay separate. A matching name does not merge accounts.
            </p>
            <ul className="mt-2 space-y-2 text-[12px]">
              {duplicates.items.slice(0, 8).map((group) => (
                <li key={group.originalName}>
                  <span className="font-semibold">{group.originalName}</span>
                  <span className="text-steel">
                    {" "}
                    · {group.accounts.map((account) => account.accountCode).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-3">
          <h2 className="font-display text-sm font-semibold uppercase">
            History and reconciliation
          </h2>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Account code">
              <input
                className={inputClass}
                value={historyAccount}
                onChange={(event) => setHistoryAccount(event.target.value)}
              />
            </Field>
            <button
              type="button"
              className="h-10 border border-border px-3 text-[11px] font-semibold uppercase"
              onClick={() => void loadHistory()}
            >
              Load
            </button>
            <a
              className="inline-flex h-10 items-center border border-border px-3 text-[11px] font-semibold uppercase"
              href={`/api/autopart-imports/reconciliation/csv${historyAccount.trim() ? `?account=${encodeURIComponent(historyAccount.trim())}` : ""}`}
            >
              Export reconciliation
            </a>
          </div>
          {reconciliation ? <p className="text-[12px] text-steel">{reconciliation.note}</p> : null}
          {reconciliation?.statuses.length ? (
            <p className="text-[12px] text-steel">
              {reconciliation.statuses.map((item) => `${item.status} ${item.count}`).join(" · ")}
            </p>
          ) : null}
          {lines ? (
            <div className="overflow-x-auto border border-border">
              <table className="min-w-full text-left text-[12px]">
                <thead className="text-[10px] uppercase text-steel">
                  <tr>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Reference</th>
                    <th className="px-3 py-2">Part</th>
                    <th className="px-3 py-2">Qty</th>
                    <th className="px-3 py-2">Line sales</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.items.map((line) => (
                    <tr key={line.id} className="border-t border-border/70">
                      <td className="px-3 py-2 font-mono">{line.accountCode}</td>
                      <td className="px-3 py-2">{line.rawInvAndLn}</td>
                      <td className="px-3 py-2">{line.partNumber}</td>
                      <td className="px-3 py-2">{line.quantity}</td>
                      <td className="px-3 py-2">{line.salesAmount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {ledger ? (
            <div>
              <p className="mb-2 text-[12px] text-steel">{ledger.balanceNote}</p>
              <div className="overflow-x-auto border border-border">
                <table className="min-w-full text-left text-[12px]">
                  <thead className="text-[10px] uppercase text-steel">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2">Goods</th>
                      <th className="px-3 py-2">VAT</th>
                      <th className="px-3 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.items.map((row) => (
                      <tr key={row.id} className="border-t border-border/70">
                        <td className="px-3 py-2">{row.transactionDate ?? "—"}</td>
                        <td className="px-3 py-2">{row.rawType}</td>
                        <td className="px-3 py-2">{row.reference}</td>
                        <td className="px-3 py-2">{row.goodsAmount ?? "—"}</td>
                        <td className="px-3 py-2">{row.vatAmount ?? "—"}</td>
                        <td className="px-3 py-2">{row.totalAmount ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
