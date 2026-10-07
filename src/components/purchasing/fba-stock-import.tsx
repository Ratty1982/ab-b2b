import { useEffect, useState } from "react";
import { btnClass, primaryBtnClass, qty } from "@/components/purchasing/workspace";
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

      {preview ? (
        <div className="mt-3 border border-border px-3 py-3 text-[13px]" data-fba-preview>
          <p className="font-semibold">FBA Stock Import</p>
          <p className="mt-1">File: {preview.fileName}</p>
          <p className="mt-1">Source recognised as Amazon FBA</p>
          <p className="text-[11px] text-steel">Autopart source branch: {preview.sourceBranch}</p>
          <dl className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Products in file" value={qty(preview.productsProcessed)} />
            <Stat label="Matched existing products" value={qty(preview.matchedExisting)} />
            <Stat label="New internal Autopart products" value={qty(preview.newProducts)} />
            <Stat label="Products with FBA stock > 0" value={qty(preview.productsWithStock)} />
            <Stat label="Total FBA units" value={qty(preview.totalUnits)} />
            <Stat label="Unknown/unmatched rows" value={qty(preview.newProducts)} />
            <Stat label="Invalid rows" value={qty(preview.invalidRows)} />
            <Stat label="Changed quantities" value={qty(preview.changedQuantities)} />
          </dl>
          <p className="mt-2 text-steel">{warningText(preview.warnings)}</p>
          {preview.duplicate ? (
            <p className="mt-2 font-medium" data-fba-duplicate>
              Already imported. This file content was imported before.
            </p>
          ) : (
            <button type="button" className={`${primaryBtnClass} mt-3`} disabled={busy} onClick={() => void commit()}>
              {busy ? "Importing…" : "Import"}
            </button>
          )}
        </div>
      ) : null}

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-steel">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
