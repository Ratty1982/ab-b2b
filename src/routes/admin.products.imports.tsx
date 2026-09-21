import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { decodeCsvBytes, ingestCsvText } from "@/domain/catalogue-csv";
import { listProductImportsFn, uploadProductImportFn, downloadProductImportTemplateFn } from "@/server/phase2/fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/products/imports")({
  head: () => ({ meta: [{ title: "Product imports — Automotive Brands Admin" }] }),
  component: ProductImports,
});

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
function ProductImports() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Array<{
    id: string;
    filename: string;
    status: string;
    rowCount: number;
    createdCount: number;
    updatedCount: number;
    errorCount: number;
    createdAt: string;
    uploadedBy: string;
  }>>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listProductImportsFn();
    if (!r.ok) setError(r.error);
    else {
      setError(null);
      setRows(r.data);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PanelHeader
        title="Imports"
        sub="Upload → validate → map → preview → confirm. The Excel template lists current categories as dropdowns. Empty cells do not wipe existing values."
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase"
              onClick={() => {
                void (async () => {
                  const r = await downloadProductImportTemplateFn();
                  if (!r.ok) {
                    toast.error(r.error);
                    return;
                  }
                  const binary = atob(r.data.base64);
                  const bytes = new Uint8Array(binary.length);
                  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
                  const blob = new Blob([bytes], { type: r.data.mime });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = r.data.filename;
                  a.click();
                  URL.revokeObjectURL(url);
                })();
              }}
            >
              Template
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void (async () => {
                  const buf = new Uint8Array(await file.arrayBuffer());
                  const xlsx = file.name.toLowerCase().endsWith(".xlsx");
                  const r = await uploadProductImportFn({
                    data: xlsx
                      ? {
                          filename: file.name,
                          workbookBase64: bytesToBase64(buf),
                          mime: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        }
                      : {
                          filename: file.name,
                          csv: ingestCsvText(decodeCsvBytes(buf)),
                          mime: file.type || "text/csv",
                        },
                  });
                  if (!r.ok) {
                    toast.error(r.error);
                    return;
                  }
                  toast.success("File uploaded — review mapping next");
                  await navigate({ to: "/admin/products/imports/$id", params: { id: r.data.id } });
                })();
              }}
            />
            <button type="button" className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase text-primary-foreground" onClick={() => fileRef.current?.click()}>
              Upload file
            </button>
          </div>
        }
      />
      <div className="p-4 sm:p-6">
        {error ? <p className="mb-4 text-sm">{error}</p> : null}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Uploaded</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Rows</th>
                <th className="px-3 py-2 text-right">Created</th>
                <th className="px-3 py-2 text-right">Updated</th>
                <th className="px-3 py-2 text-right">Errors</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-sm text-steel">No import jobs yet.</td></tr>
              ) : rows.map((row, i) => (
                <tr key={row.id} className={cn("border-b border-border/60", i % 2 && "bg-surface/30")}>
                  <td className="px-3 py-2">
                    <Link to="/admin/products/imports/$id" params={{ id: row.id }} className="font-medium text-primary hover:underline">{row.filename}</Link>
                  </td>
                  <td className="num px-3 py-2 text-steel">{new Date(row.createdAt).toLocaleString("en-GB")}</td>
                  <td className="px-3 py-2 text-steel">{row.uploadedBy}</td>
                  <td className="px-3 py-2"><StatusBadge tone={row.status === "APPLIED" ? "good" : row.status === "FAILED" ? "bad" : "warn"}>{row.status}</StatusBadge></td>
                  <td className="num px-3 py-2 text-right">{row.rowCount}</td>
                  <td className="num px-3 py-2 text-right">{row.createdCount}</td>
                  <td className="num px-3 py-2 text-right">{row.updatedCount}</td>
                  <td className="num px-3 py-2 text-right">{row.errorCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
