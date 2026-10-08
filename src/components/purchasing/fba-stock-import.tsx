import { useEffect, useState, type ReactNode } from "react";
import { btnClass, primaryBtnClass, qty } from "@/components/purchasing/workspace";
import {
  FBA_NEW_PRODUCT_NOTE,
  FBA_PARTIAL_CSV_WARNING,
  FBA_PARTIAL_SNAPSHOT_WARNING,
  fbaImportSafetyLines,
  fbaIssuesCsv,
  fbaMatchingEquation,
  fbaRowsReadEquation,
  presentFbaDiagnosticText,
  type FbaDuplicateRow,
  type FbaInvalidRow,
  type FbaPreviewProduct,
} from "@/domain/fba-stock";
import { formatOperationalDateTime } from "@/lib/datetime";
import { importFbaStockFn, listFbaStockImportsFn, previewFbaStockImportFn } from "@/server/phase2/fns";

type Preview = Extract<Awaited<ReturnType<typeof previewFbaStockImportFn>>, { ok: true }>["data"];
type Imported = Extract<Awaited<ReturnType<typeof importFbaStockFn>>, { ok: true }>["data"];
type History = Extract<Awaited<ReturnType<typeof listFbaStockImportsFn>>, { ok: true }>["data"];

function when(iso: string | null | undefined): string {
  return formatOperationalDateTime(iso) ?? "—";
}

function warningText(warnings: unknown): string {
  if (!Array.isArray(warnings) || warnings.length === 0) return "None";
  return warnings.map((item) => String(item)).join(" ");
}

/**
 * Manual Amazon FBA stock import on Stock Forecast.
 * purchasing.view can read history. purchasing.manage can upload.
 */
export function FbaStockImportPanel({
  canManage,
  onImported,
}: {
  canManage: boolean;
  onImported: () => void;
}) {
  const [history, setHistory] = useState<History>([]);
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Imported | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshHistory() {
    const listed = await listFbaStockImportsFn();
    if (listed.ok) setHistory(listed.data);
  }

  useEffect(() => {
    void refreshHistory();
  }, []);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      const body = await file.text();
      setFileName(file.name);
      setText(body);
      const next = await previewFbaStockImportFn({ data: { fileName: file.name, text: body } });
      if (!next.ok) {
        setError(next.error);
        return;
      }
      setPreview(next.data);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview || preview.duplicate) return;
    setBusy(true);
    setError(null);
    try {
      const next = await importFbaStockFn({ data: { fileName, text } });
      if (!next.ok) {
        setError(next.error);
        return;
      }
      setResult(next.data);
      setPreview(null);
      await refreshHistory();
      if (next.data.status === "IMPORTED") onImported();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-b border-border/70 px-4 py-4 sm:px-6" data-fba-import>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold uppercase">FBA Stock Import</h2>
          <p className="mt-1 max-w-3xl text-[13px] text-steel">
            Import Amazon FBA stock from the exported 231PO3NEW file. FBA Stock stays separate from Warehouse Stock and is not B2B sellable.
          </p>
        </div>
        {canManage ? (
          <div>
            <input
              id="fba-stock-file"
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
                event.currentTarget.value = "";
              }}
            />
            <label htmlFor="fba-stock-file" className={`${btnClass} ${busy ? "pointer-events-none opacity-50" : ""}`}>
              Import FBA Stock
            </label>
          </div>
        ) : (
          <p className="text-[12px] text-steel">Import FBA Stock requires purchasing.manage.</p>
        )}
      </div>

      {error ? (
        <p className="mt-3 border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive" data-fba-error>
          {error}
        </p>
      ) : null}

      {preview ? <FbaPreview preview={preview} busy={busy} onImport={() => void commit()} /> : null}

      {result ? (
        <div className="mt-3 border border-border px-3 py-3 text-[13px]" data-fba-result>
          <p className="font-semibold">{result.status === "DUPLICATE" ? result.message : "FBA Stock updated"}</p>
          <dl className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Products processed" value={qty(result.productsProcessed)} />
            <Stat label="Products with stock" value={qty(result.productsWithStock)} />
            <Stat label="Total FBA units" value={qty(result.totalUnits)} />
            <Stat label="Changed quantities" value={qty(result.changedQuantities)} />
            <Stat label="New FBA products" value={qty(result.newProducts)} />
            <Stat label="Zero stock" value={qty(result.zeroStock)} />
            <Stat label="Warnings" value={Array.isArray(result.warnings) ? String(result.warnings.length) : "0"} />
          </dl>
          <p className="mt-2 text-steel">{warningText(result.warnings)}</p>
          <p className="mt-2 text-steel">
            Imported at {when(result.importedAt)}
            {"importedBy" in result && result.importedBy ? ` · Imported by ${result.importedBy}` : ""}
            {` · ${result.fileName}`}
          </p>
        </div>
      ) : null}

      {history.length > 0 ? (
        <div className="mt-4 overflow-x-auto" data-fba-history>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">Import history</h3>
          <table className="mt-2 w-full min-w-[760px] text-left text-[12px]">
            <thead className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">User</th>
                <th className="py-1 pr-3">File</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Processed</th>
                <th className="py-1 pr-3">With stock</th>
                <th className="py-1 pr-3">FBA units</th>
                <th className="py-1 pr-3">Changed</th>
                <th className="py-1">Warnings</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id} className="border-t border-border/70">
                  <td className="py-1 pr-3">{when(row.importedAt)}</td>
                  <td className="py-1 pr-3">{row.importedBy}</td>
                  <td className="py-1 pr-3">{row.fileName}</td>
                  <td className="py-1 pr-3">{row.status}</td>
                  <td className="py-1 pr-3">{qty(row.productsProcessed)}</td>
                  <td className="py-1 pr-3">{qty(row.productsWithStock)}</td>
                  <td className="py-1 pr-3">{qty(row.totalUnits)}</td>
                  <td className="py-1 pr-3">{qty(row.changedQuantities)}</td>
                  <td className="py-1">{Array.isArray(row.warnings) ? row.warnings.length : 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function DiagnosticText({ value }: { value: string | null | undefined }) {
  const full = value?.trim() ? value : null;
  if (!full) return <>—</>;
  const flat = full.replace(/\s+/g, " ").trim();
  const shown = presentFbaDiagnosticText(full) ?? flat;
  if (shown === flat) return <>{shown}</>;
  return (
    <span>
      {shown}
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-steel">
          View full text
        </summary>
        <p className="mt-1 max-w-xl whitespace-pre-wrap break-words">{full}</p>
      </details>
    </span>
  );
}

function signedQty(value: number): string {
  const formatted = qty(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

function downloadIssues(fileName: string, rows: Array<FbaInvalidRow | FbaDuplicateRow>) {
  const csv = fbaIssuesCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${fileName.replace(/\.[^.]+$/, "") || "fba-stock"}-issues.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function FbaPreview({
  preview,
  busy,
  onImport,
}: {
  preview: Preview;
  busy: boolean;
  onImport: () => void;
}) {
  const warnings = Array.isArray(preview.warnings) ? preview.warnings.map((item) => String(item)) : [];
  const partial = warnings.find((item) => item === FBA_PARTIAL_CSV_WARNING || item === FBA_PARTIAL_SNAPSHOT_WARNING);
  const otherWarnings = warnings.filter((item) => item !== partial);
  const issues = [...preview.invalidRowDetails, ...preview.duplicateRowDetails];
  const malformedQuotes = preview.invalidRowDetails.filter((row) => row.reason === "malformed_quote").length;
  const safety = fbaImportSafetyLines(preview);

  return (
    <div className="mt-3 border border-border px-3 py-3 text-[13px]" data-fba-preview>
      <p className="font-semibold">FBA Stock Import</p>
      <p className="mt-1">File: {preview.fileName}</p>
      <p className="mt-1">Source recognised as Amazon FBA</p>
      <p className="text-[11px] text-steel">Autopart source branch: {preview.sourceBranch}</p>

      {partial ? (
        <div className="mt-3 border border-border/80 bg-surface/40 px-3 py-2" data-fba-partial>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em]">Partial snapshot</p>
          <p className="mt-1 text-steel">{partial}</p>
        </div>
      ) : null}

      <PreviewGroup title="File summary">
        <Stat label="Rows read" value={qty(preview.rowsRead)} />
        <Stat label="Valid product rows" value={qty(preview.productsProcessed)} />
        <Stat label="Invalid rows" value={qty(preview.invalidRows)} />
        {preview.duplicateSkus > 0 ? <Stat label="Duplicate rows" value={qty(preview.duplicateSkus)} /> : null}
      </PreviewGroup>
      <p className="mt-2 text-[12px] text-steel" data-fba-file-equation>
        {fbaRowsReadEquation(preview)}
      </p>

      <PreviewGroup title="Matching">
        <Stat label="Matched existing products" value={qty(preview.matchedExisting)} />
        <Stat label="New to AB" value={qty(preview.newProducts)} />
      </PreviewGroup>
      <p className="mt-2 text-[12px] text-steel" data-fba-matching-equation>
        {fbaMatchingEquation(preview)}
      </p>
      {preview.newProducts > 0 ? <p className="mt-2 max-w-3xl text-[12px] text-steel">{FBA_NEW_PRODUCT_NOTE}</p> : null}

      <PreviewGroup title="FBA stock">
        <Stat label="Products with FBA stock > 0" value={qty(preview.productsWithStock)} />
        <Stat label="Total FBA units" value={qty(preview.totalUnits)} />
        <Stat label="New FBA stock records" value={qty(preview.newFbaRecords)} />
        <Stat label="FBA quantities changed" value={qty(preview.fbaQuantityChanges)} />
        <Stat label="Unchanged quantities" value={qty(preview.unchangedQuantities)} />
      </PreviewGroup>
      <p className="mt-2 max-w-3xl text-[12px] text-steel">
        A new FBA stock record includes a first quantity of zero. Unchanged means the imported FBA quantity already matches the current FBA quantity.
      </p>

      {preview.stockedProducts.length > 0 ? (
        <Review title={`View ${qty(preview.stockedProducts.length)} stocked products`} testId="fba-stocked">
          <p className="mb-2 text-[12px] text-steel">
            Total after import is Warehouse Stock plus imported FBA Stock. It is not B2B sellable stock.
          </p>
          <table className="w-full min-w-[760px] text-left text-[12px]">
            <thead className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
              <tr>
                <th className="py-1 pr-3">SKU</th>
                <th className="py-1 pr-3">Product</th>
                <th className="py-1 pr-3">Warehouse</th>
                <th className="py-1 pr-3">Current FBA</th>
                <th className="py-1 pr-3">Imported FBA</th>
                <th className="py-1 pr-3">Change</th>
                <th className="py-1">Total after import</th>
              </tr>
            </thead>
            <tbody>
              {preview.stockedProducts.map((row) => (
                <tr key={row.sku} className="border-t border-border/70">
                  <td className="py-1 pr-3">{row.sku}</td>
                  <td className="py-1 pr-3">{row.description || "—"}</td>
                  <td className="py-1 pr-3">{qty(row.warehouseQty)}</td>
                  <td className="py-1 pr-3">{qty(row.currentFbaQty)}</td>
                  <td className="py-1 pr-3">{qty(row.importedFbaQty)}</td>
                  <td className="py-1 pr-3">{signedQty(row.change)}</td>
                  <td className="py-1">{qty(row.totalAfterImport)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Review>
      ) : null}

      {preview.newProductRows.length > 0 ? (
        <Review title={`View ${qty(preview.newProductRows.length)} new products`} testId="fba-new-products">
          <p className="mb-2 text-[12px] text-steel">
            Group and condition are shown from the file for review. Import creates an internal Autopart product and does not save them, and it does not create a public catalogue product.
          </p>
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <thead className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
              <tr>
                <th className="py-1 pr-3">SKU</th>
                <th className="py-1 pr-3">Description</th>
                <th className="py-1 pr-3">FBA stock</th>
                <th className="py-1 pr-3">Group</th>
                <th className="py-1 pr-3">Condition</th>
                <th className="py-1">Result</th>
              </tr>
            </thead>
            <tbody>
              {preview.newProductRows.map((row) => (
                <NewProductRow key={row.sku} row={row} />
              ))}
            </tbody>
          </table>
        </Review>
      ) : null}

      {preview.quoteDiagnostics.some((row) => row.recovered) ? (
        <Review
          title={`View ${qty(preview.quoteDiagnostics.filter((row) => row.recovered).length)} recovered quotations`}
          testId="fba-quote-recovery"
        >
          <p className="mb-2 text-[12px] text-steel">
            These descriptions contained an unescaped inch mark. Each row was read on its own and its Avail quantity was kept.
          </p>
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
              <tr>
                <th className="py-1 pr-3">Row</th>
                <th className="py-1 pr-3">SKU</th>
                <th className="py-1 pr-3">Description</th>
                <th className="py-1 pr-3">Recovery</th>
                <th className="py-1">Detail</th>
              </tr>
            </thead>
            <tbody>
              {preview.quoteDiagnostics
                .filter((row) => row.recovered)
                .map((row) => (
                  <tr key={`quote-${row.line}-${row.sku}`} className="border-t border-border/70">
                    <td className="py-1 pr-3">{row.line}</td>
                    <td className="py-1 pr-3">{row.sku || "—"}</td>
                    <td className="py-1 pr-3">
                      <DiagnosticText value={row.description} />
                    </td>
                    <td className="py-1 pr-3">Recovered</td>
                    <td className="py-1">{row.detail}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Review>
      ) : null}

      {preview.invalidRowDetails.length > 0 ? (
        <Review title={`View ${qty(preview.invalidRowDetails.length)} invalid rows`} testId="fba-invalid-rows">
          <p className="mb-2 text-[12px] text-steel">These rows will be skipped. Valid rows can still be imported.</p>
          {malformedQuotes > 0 ? (
            <p className="mb-2 text-[12px] text-steel">
              {qty(malformedQuotes)} {malformedQuotes === 1 ? "row has" : "rows have"} a malformed CSV quotation and
              {malformedQuotes === 1 ? " was" : " were"} not recovered. No quantity from
              {malformedQuotes === 1 ? " that row" : " those rows"} will be imported.
            </p>
          ) : null}
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
              <tr>
                <th className="py-1 pr-3">Row</th>
                <th className="py-1 pr-3">SKU</th>
                <th className="py-1 pr-3">Description</th>
                <th className="py-1 pr-3">Reason</th>
                <th className="py-1">Value</th>
              </tr>
            </thead>
            <tbody>
              {preview.invalidRowDetails.map((row) => (
                <tr key={`${row.line}-${row.reason}`} className="border-t border-border/70">
                  <td className="py-1 pr-3">{row.line}</td>
                  <td className="py-1 pr-3">{row.sku || "—"}</td>
                  <td className="py-1 pr-3">
                    <DiagnosticText value={row.description} />
                  </td>
                  <td className="py-1 pr-3">{row.reasonLabel}</td>
                  <td className="py-1">{row.reason === "malformed_quote" ? "Not recovered" : row.value || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Review>
      ) : null}

      {preview.duplicateRowDetails.length > 0 ? (
        <Review title={`View ${qty(preview.duplicateRowDetails.length)} duplicate rows`} testId="fba-duplicate-rows">
          <p className="mb-2 text-[12px] text-steel">A SKU that appears more than once is skipped. It is not imported.</p>
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">
              <tr>
                <th className="py-1 pr-3">Row</th>
                <th className="py-1 pr-3">SKU</th>
                <th className="py-1 pr-3">Description</th>
                <th className="py-1 pr-3">Reason</th>
                <th className="py-1">Value</th>
              </tr>
            </thead>
            <tbody>
              {preview.duplicateRowDetails.map((row) => (
                <tr key={`${row.line}-${row.sku}`} className="border-t border-border/70">
                  <td className="py-1 pr-3">{row.line}</td>
                  <td className="py-1 pr-3">{row.sku}</td>
                  <td className="py-1 pr-3">
                    <DiagnosticText value={row.description} />
                  </td>
                  <td className="py-1 pr-3">{row.reasonLabel}</td>
                  <td className="py-1">{row.value || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Review>
      ) : null}

      {issues.length > 0 ? (
        <button
          type="button"
          className={`${btnClass} mt-3`}
          onClick={() => downloadIssues(preview.fileName, issues)}
          data-fba-download-issues
        >
          Download issues CSV
        </button>
      ) : null}

      {otherWarnings.length > 0 ? <p className="mt-2 text-steel">{otherWarnings.join(" ")}</p> : null}

      {preview.duplicate ? (
        <p className="mt-2 font-medium" data-fba-duplicate>
          Already imported. This file content was imported before.
        </p>
      ) : (
        <div className="mt-4 border border-border/80 px-3 py-3" data-fba-safety>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em]">Ready to import</p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-[13px]">
            {safety.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <button type="button" className={`${primaryBtnClass} mt-3`} disabled={busy} onClick={onImport}>
            {busy ? "Importing…" : "Import"}
          </button>
        </div>
      )}
    </div>
  );
}

function NewProductRow({ row }: { row: FbaPreviewProduct }) {
  return (
    <tr className="border-t border-border/70">
      <td className="py-1 pr-3">{row.sku}</td>
      <td className="py-1 pr-3">{row.description || "—"}</td>
      <td className="py-1 pr-3">{qty(row.importedFbaQty)}</td>
      <td className="py-1 pr-3">{row.groupCode || "—"}</td>
      <td className="py-1 pr-3">{row.conditionCode || "—"}</td>
      <td className="py-1">{row.result}</td>
    </tr>
  );
}

function PreviewGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">{title}</h3>
      <dl className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>
    </div>
  );
}

function Review({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <details className="mt-3 border border-border/80 px-3 py-2" data-fba-review={testId}>
      <summary className="cursor-pointer text-[12px] font-semibold uppercase tracking-[0.08em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        {title}
      </summary>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </details>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
