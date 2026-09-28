import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/datetime";
import {
  confirmAutopartCreditImportFn,
  confirmAutopartHistoryImportFn,
  getCompanyAutopartHistoryWorkspaceFn,
  previewAutopartCreditImportFn,
  previewAutopartHistoryImportFn,
  verifyAutopartAccountAliasFn,
} from "@/server/phase2/fns";

type Workspace = Extract<
  Awaited<ReturnType<typeof getCompanyAutopartHistoryWorkspaceFn>>,
  { ok: true }
>["data"];
type HistoryPreview = Extract<
  Awaited<ReturnType<typeof previewAutopartHistoryImportFn>>,
  { ok: true }
>["data"];
type CreditPreview = Extract<
  Awaited<ReturnType<typeof previewAutopartCreditImportFn>>,
  { ok: true }
>["data"];

function gbp(v: string | number | null | undefined) {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return `£${v}`;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

async function readFileText(file: File | null): Promise<string | null> {
  if (!file) return null;
  return file.text();
}

export function AutopartCustomerHistoryPanel({ companyId }: { companyId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [file561, setFile561] = useState<File | null>(null);
  const [fileSlrb, setFileSlrb] = useState<File | null>(null);
  const [file407, setFile407] = useState<File | null>(null);
  const [historyPreview, setHistoryPreview] = useState<HistoryPreview | null>(null);
  const [creditPreview, setCreditPreview] = useState<CreditPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingHistory, setConfirmingHistory] = useState(false);
  const [alias, setAlias] = useState("");
  const [aliasNote, setAliasNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await getCompanyAutopartHistoryWorkspaceFn({ data: { companyId } });
    if (!r.ok) {
      setError(r.error);
      setWorkspace(null);
    } else {
      setWorkspace(r.data);
      setError(null);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onPreviewHistory() {
    if (!file561 || !fileSlrb) {
      toast.error("Select both 561L and SLRB files");
      return;
    }
    setBusy(true);
    const [t561, tSlrb] = await Promise.all([readFileText(file561), readFileText(fileSlrb)]);
    const r = await previewAutopartHistoryImportFn({
      data: {
        companyId,
        file561l: t561!,
        fileSlrb: tSlrb!,
        filename561l: file561.name,
        filenameSlrb: fileSlrb.name,
      },
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setHistoryPreview(r.data);
    toast.message(r.data.canCommit ? "Preview ready — review then confirm" : "Preview blocked");
  }

  async function onConfirmHistory() {
    if (!file561 || !fileSlrb || !historyPreview?.canCommit || busy || confirmingHistory) return;
    setBusy(true);
    setConfirmingHistory(true);
    try {
      const [t561, tSlrb] = await Promise.all([readFileText(file561), readFileText(fileSlrb)]);
      const r = await confirmAutopartHistoryImportFn({
        data: {
          companyId,
          file561l: t561!,
          fileSlrb: tSlrb!,
          filename561l: file561.name,
          filenameSlrb: fileSlrb.name,
          previewRunId: historyPreview.runId ?? undefined,
        },
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Historic Autopart data imported");
      setHistoryPreview(null);
      setWorkspace(r.data.workspace);
    } finally {
      setConfirmingHistory(false);
      setBusy(false);
    }
  }

  async function onPreviewCredit() {
    if (!file407) {
      toast.error("Select a 407P100 file");
      return;
    }
    setBusy(true);
    const text = await readFileText(file407);
    const r = await previewAutopartCreditImportFn({
      data: { companyId, file407: text!, filename: file407.name },
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setCreditPreview(r.data);
  }

  async function onConfirmCredit() {
    if (!file407 || !creditPreview?.canCommit) return;
    setBusy(true);
    const text = await readFileText(file407);
    const r = await confirmAutopartCreditImportFn({
      data: { companyId, file407: text!, filename: file407.name },
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Credit position updated");
    setCreditPreview(null);
    setWorkspace(r.data.workspace);
  }

  async function onAddAlias() {
    if (!alias.trim()) return;
    setBusy(true);
    const r = await verifyAutopartAccountAliasFn({
      data: { companyId, alias: alias.trim(), note: aliasNote || null },
    });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    toast.success("Alias verified");
    setAlias("");
    setAliasNote("");
    setWorkspace(r.data);
  }

  if (loading) return <p className="p-4 text-[13px] text-steel">Loading Autopart workspace…</p>;
  if (error || !workspace) {
    return <p className="p-4 text-[13px] text-bad">{error ?? "Unable to load"}</p>;
  }

  const credit = workspace.credit;

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <section className="rounded-lg border border-border p-5">
        <h2 className="font-display text-base font-semibold uppercase">Autopart account</h2>
        <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
          <div>
            <dt className="text-steel">Verified account</dt>
            <dd className="font-mono font-semibold">
              {workspace.company.autopartCustomerCode || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-steel">Verification status</dt>
            <dd>{workspace.company.verified ? "Verified" : "Not verified"}</dd>
          </div>
          <div>
            <dt className="text-steel">Historic purchase data</dt>
            <dd>{workspace.historic.imported ? "Imported" : "Not imported"}</dd>
          </div>
          <div>
            <dt className="text-steel">Current credit position</dt>
            <dd>
              {!credit.imported
                ? "Not imported"
                : credit.freshness === "STALE"
                  ? "Stale"
                  : "Current"}
            </dd>
          </div>
          <div>
            <dt className="text-steel">Last historic import</dt>
            <dd>
              {workspace.historic.lastImportedAt
                ? formatDateTime(workspace.historic.lastImportedAt)
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-steel">Last credit import</dt>
            <dd>
              {credit.lastImportedAt ? formatDateTime(credit.lastImportedAt) : "—"}
            </dd>
          </div>
        </dl>

        {workspace.historic.imported ? (
          <dl className="mt-4 grid gap-2 border-t border-border pt-4 text-[13px] sm:grid-cols-4">
            <div>
              <dt className="text-steel">Historic net spend</dt>
              <dd className="font-semibold">{gbp(workspace.historic.netSpend)}</dd>
            </div>
            <div>
              <dt className="text-steel">Historic net units</dt>
              <dd className="font-semibold">{workspace.historic.netUnits}</dd>
            </div>
            <div>
              <dt className="text-steel">Products</dt>
              <dd className="font-semibold">{workspace.historic.productsPurchased}</dd>
            </div>
            <div>
              <dt className="text-steel">Last historic purchase</dt>
              <dd className="font-semibold">
                {workspace.historic.lastHistoricPurchaseDate || "—"}
              </dd>
            </div>
          </dl>
        ) : null}

        {credit.imported ? (
          <dl className="mt-4 grid gap-2 border-t border-border pt-4 text-[13px] sm:grid-cols-3">
            <div>
              <dt className="text-steel">Credit limit</dt>
              <dd className="font-semibold">{gbp(credit.creditLimit)}</dd>
            </div>
            <div>
              <dt className="text-steel">Used credit</dt>
              <dd className="font-semibold">{gbp(credit.usedCredit)}</dd>
            </div>
            <div>
              <dt className="text-steel">Available credit</dt>
              <dd className="font-semibold">{gbp(credit.availableCreditDisplay)}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      <section className="rounded-lg border border-border p-5">
        <h2 className="font-display text-base font-semibold uppercase">Verified account aliases</h2>
        <p className="mt-2 text-[12px] text-steel">
          Aliases are only required for genuine alternative Autopart account codes. Legacy
          shortened account fields used by supported reports such as 561L are validated
          automatically.
        </p>
        {workspace.aliases.length ? (
          <ul className="mt-3 space-y-1 text-[13px]">
            {workspace.aliases.map((a) => (
              <li key={a.id} className="font-mono">
                {a.alias}{" "}
                <span className="text-steel">
                  · {a.verifiedByName} · {formatDateTime(a.verifiedAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13px] text-steel">No aliases.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="h-9 rounded-md border border-border px-3 text-[13px]"
            placeholder="Alias (exact)"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />
          <input
            className="h-9 min-w-[200px] flex-1 rounded-md border border-border px-3 text-[13px]"
            placeholder="Note (optional)"
            value={aliasNote}
            onChange={(e) => setAliasNote(e.target.value)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void onAddAlias()}
            className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
          >
            Verify alias
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border p-5">
        <h2 className="font-display text-base font-semibold uppercase">Import historic data</h2>
        <p className="mt-2 text-[12px] text-steel">
          Upload 561L (lines) and SLRB (document dates). Format is detected from file content —
          extension does not matter. Dry-run first — no database writes until confirm.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-[12px]">
            561L report
            <span className="mt-0.5 block text-[11px] text-steel">Accepted: .txt, .csv</span>
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="mt-1 block w-full text-[12px]"
              onChange={(e) => setFile561(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="text-[12px]">
            SLRB report
            <span className="mt-0.5 block text-[11px] text-steel">Accepted: .txt, .csv</span>
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="mt-1 block w-full text-[12px]"
              onChange={(e) => setFileSlrb(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPreviewHistory()}
            className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase"
          >
            Preview
          </button>
          <button
            type="button"
            disabled={busy || !historyPreview?.canCommit}
            onClick={() => void onConfirmHistory()}
            className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-40"
          >
            {confirmingHistory ? "Importing…" : "Confirm import"}
          </button>
        </div>
        {historyPreview ? (
          <div className="mt-4 space-y-3 rounded-md border border-border/70 bg-surface/40 p-3 text-[12px]">
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-steel">
                  Report customer
                </dt>
                <dd className="mt-0.5 font-semibold num">
                  {historyPreview.accountMatch?.reportCustomer ??
                    historyPreview.reportCustomer ??
                    historyPreview.accountMatch?.slrbAccount ??
                    historyPreview.slrbAccount ??
                    "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-steel">
                  Autopart account
                </dt>
                <dd className="mt-0.5 font-semibold num">
                  {historyPreview.accountMatch?.verifiedAccount ??
                    historyPreview.verifiedAccount ??
                    "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-steel">
                  Status
                </dt>
                <dd className="mt-0.5 font-semibold">
                  {historyPreview.accountMatch?.status === "MATCHED_REPORT_CUSTOMER" ||
                  historyPreview.accountMatch?.status === "MATCHED"
                    ? "Matched"
                    : historyPreview.accountMatch?.status === "MATCHED_TRUNCATED"
                      ? "Matched — shortened report account"
                      : historyPreview.accountMatch?.status === "MATCHED_ALIAS"
                        ? "Matched via verified alias"
                        : historyPreview.accountMatch?.status === "ALIAS_REQUIRED"
                          ? "Account alias required"
                          : historyPreview.accountMatch?.status === "MULTIPLE_ACCOUNTS"
                            ? "Multiple accounts detected"
                            : historyPreview.accountMatch?.status === "AMBIGUOUS_TRUNCATED"
                              ? "Ambiguous truncated account"
                              : historyPreview.accountMatch?.ok
                                ? "Matched"
                                : "Mismatch"}
                </dd>
              </div>
            </dl>
            {historyPreview.accountMatch?.ok &&
            historyPreview.accountMatch.rowAccount &&
            historyPreview.accountMatch.verifiedAccount &&
            historyPreview.accountMatch.rowAccount !==
              historyPreview.accountMatch.verifiedAccount ? (
              <p className="text-[11px] text-steel">
                561L account code {historyPreview.accountMatch.rowAccount} — 561L uses a
                shortened {historyPreview.accountMatch.accountFieldWidth ?? 7}-character
                account field.
              </p>
            ) : null}
            {historyPreview.accountMatch?.status === "MULTIPLE_ACCOUNTS" &&
            historyPreview.accountMatch.multipleAccounts?.length ? (
              <p className="text-[11px] text-bad">
                Multiple accounts detected:{" "}
                {historyPreview.accountMatch.multipleAccounts.join(", ")}
              </p>
            ) : null}
            {historyPreview.accountMatch?.status === "ALIAS_REQUIRED" &&
            historyPreview.accountMatch.suggestedAlias ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAlias(historyPreview.accountMatch!.suggestedAlias!);
                  setAliasNote("Report account from 561L/SLRB");
                  void (async () => {
                    setBusy(true);
                    const r = await verifyAutopartAccountAliasFn({
                      data: {
                        companyId,
                        alias: historyPreview.accountMatch!.suggestedAlias!,
                        note: "Report account from 561L/SLRB",
                      },
                    });
                    setBusy(false);
                    if (!r.ok) {
                      toast.error(r.error);
                      return;
                    }
                    toast.success(
                      `Verified ${historyPreview.accountMatch!.suggestedAlias} as account alias`,
                    );
                    setWorkspace(r.data);
                    setAlias("");
                    setAliasNote("");
                    // Re-run preview with same files if still selected
                    if (file561 && fileSlrb) void onPreviewHistory();
                  })();
                }}
                className="h-9 rounded-md border border-border px-3 text-[11px] font-bold uppercase"
              >
                Verify {historyPreview.accountMatch.suggestedAlias} as account alias
              </button>
            ) : null}
            <p>
              561L: {historyPreview.report561l.validLines} lines (
              {historyPreview.report561l.invoiceLines} inv / {historyPreview.report561l.creditLines}{" "}
              credit) · SLRB: {historyPreview.reportSlrb.invoiceDocuments} invoices
            </p>
            <p>
              Matched docs: {historyPreview.matching.matchedDocuments} · Unmatched 561L:{" "}
              {historyPreview.matching.unmatched561Documents} · SKUs matched:{" "}
              {historyPreview.products.matchedAbSkus}/{historyPreview.products.uniqueSkus}
            </p>
            <ul className="space-y-1">
              {historyPreview.issues.map((i) => (
                <li
                  key={`${i.code}-${i.message}`}
                  className={
                    i.severity === "BLOCKING"
                      ? "text-bad"
                      : i.severity === "WARNING"
                        ? "text-warn"
                        : "text-steel"
                  }
                >
                  [{i.severity}] {i.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-border p-5">
        <h2 className="font-display text-base font-semibold uppercase">Update credit position</h2>
        <p className="mt-2 text-[12px] text-steel">
          407P100 is authoritative for current Autopart credit exposure. Used credit = Total
          (includes picking/dropship/etc when present).
        </p>
        <label className="mt-4 block text-[12px]">
          407P100 file
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="mt-1 block w-full text-[12px]"
            onChange={(e) => setFile407(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPreviewCredit()}
            className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase"
          >
            Preview
          </button>
          <button
            type="button"
            disabled={busy || !creditPreview?.canCommit}
            onClick={() => void onConfirmCredit()}
            className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-40"
          >
            Confirm update
          </button>
        </div>
        {creditPreview?.position ? (
          <dl className="mt-4 grid gap-2 text-[13px] sm:grid-cols-3">
            <div>
              <dt className="text-steel">Credit limit</dt>
              <dd className="font-semibold">{gbp(creditPreview.position.creditLimit)}</dd>
            </div>
            <div>
              <dt className="text-steel">Used credit</dt>
              <dd className="font-semibold">{gbp(creditPreview.position.usedCredit)}</dd>
            </div>
            <div>
              <dt className="text-steel">Available credit</dt>
              <dd className="font-semibold">
                {gbp(creditPreview.position.availableCreditDisplay)}
                {creditPreview.position.overLimitBy
                  ? ` (over by ${gbp(creditPreview.position.overLimitBy)})`
                  : ""}
              </dd>
            </div>
          </dl>
        ) : null}
        {creditPreview?.issues?.length ? (
          <ul className="mt-3 space-y-1 text-[12px]">
            {creditPreview.issues.map((i) => (
              <li
                key={`${i.code}-${i.message}`}
                className={i.severity === "BLOCKING" ? "text-bad" : "text-steel"}
              >
                [{i.severity}] {i.message}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {workspace.topProducts.length ? (
        <section className="rounded-lg border border-border p-5">
          <h2 className="font-display text-base font-semibold uppercase">Top purchased products</h2>
          <table className="mt-3 w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase text-steel">
                <th className="py-2">SKU</th>
                <th className="py-2 text-right">Net units</th>
                <th className="py-2 text-right">Net spend</th>
              </tr>
            </thead>
            <tbody>
              {workspace.topProducts.map((p) => (
                <tr key={p.sku} className="border-b border-border/50">
                  <td className="py-2 font-mono">{p.sku}</td>
                  <td className="py-2 text-right">{p.netUnits}</td>
                  <td className="py-2 text-right">{gbp(p.netSpend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
