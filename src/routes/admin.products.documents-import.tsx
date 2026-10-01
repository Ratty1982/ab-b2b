import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import {
  confirmBulkSdsImportFn,
  previewBulkSdsImportFn,
  searchProductsForDocumentAttachFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/products/documents-import")({
  head: () => ({ meta: [{ title: "Import SDS — Automotive Brands Admin" }] }),
  component: BulkSdsImportPage,
});

type PreviewItem = Extract<
  Awaited<ReturnType<typeof previewBulkSdsImportFn>>,
  { ok: true }
>["data"]["items"][number];

type RowStatus =
  | PreviewItem["status"]
  | "IMPORTED"
  | "REPLACED"
  | "FAILED"
  | "SKIPPED";

type RowState = Omit<PreviewItem, "status"> & {
  status: RowStatus;
  action: "IMPORT" | "REPLACE" | "SKIP";
  selectedProductId: string | null;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function statusTone(status: string): Tone {
  if (status === "MATCHED" || status === "IMPORTED" || status === "REPLACED") return "good";
  if (status === "REVIEW" || status === "EXISTING_SDS") return "warn";
  if (status === "INVALID" || status === "FAILED") return "bad";
  return "neutral";
}

function BulkSdsImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState<Record<string, string>>({});
  const [searchHits, setSearchHits] = useState<
    Record<string, Array<{ productId: string; name: string; sku: string }>>
  >({});

  const summary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [rows]);

  async function onFiles(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = [...fileList].slice(0, 40);
    setBusy("preview");
    setError(null);
    const payload = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const buf = new Uint8Array(await f.arrayBuffer());
      payload.push({
        clientKey: `f-${i}-${f.name}`,
        filename: f.name,
        contentType: f.type || "application/pdf",
        base64: bytesToBase64(buf),
      });
    }
    const res = await previewBulkSdsImportFn({ data: { files: payload } });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      return;
    }
    setRows(
      res.data.items.map((item) => ({
        ...item,
        selectedProductId: item.productId,
        action:
          item.status === "EXISTING_SDS"
            ? "SKIP"
            : item.status === "MATCHED"
              ? "IMPORT"
              : item.status === "ALREADY_ATTACHED" || item.status === "INVALID"
                ? "SKIP"
                : "SKIP",
      })),
    );
    toast.success(`Previewed ${res.data.items.length} file(s)`);
  }

  async function searchProduct(clientKey: string, q: string) {
    setSearchQ((prev) => ({ ...prev, [clientKey]: q }));
    if (q.trim().length < 2) return;
    const res = await searchProductsForDocumentAttachFn({ data: { q, limit: 12 } });
    if (res.ok) {
      setSearchHits((prev) => ({ ...prev, [clientKey]: res.data }));
    }
  }

  async function confirm() {
    const toSend = rows
      .filter((r) => r.action !== "SKIP" && r.selectedProductId && r.base64)
      .filter((r) => r.status !== "INVALID" && r.status !== "ALREADY_ATTACHED");
    if (!toSend.length) {
      toast.message("Nothing selected to import");
      return;
    }
    setBusy("confirm");
    const res = await confirmBulkSdsImportFn({
      data: {
        items: toSend.map((r) => ({
          clientKey: r.clientKey,
          filename: r.filename,
          base64: r.base64!,
          contentType: r.contentType,
          productId: r.selectedProductId!,
          action: r.action === "REPLACE" ? "REPLACE" : "IMPORT",
        })),
      },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      `Imported ${res.data.imported}, replaced ${res.data.replaced}, failed ${res.data.failed}`,
    );
    // Mark rows from results
    setRows((prev) =>
      prev.map((row) => {
        const hit = res.data.results.find((r) => r.clientKey === row.clientKey);
        if (!hit) return row;
        return {
          ...row,
          status: hit.status as RowState["status"],
          message: hit.message,
          action: "SKIP",
        };
      }),
    );
  }

  return (
    <div>
      <PanelHeader
        title="Import SDS / Product Documents"
        sub="Upload PDFs from your SDS folder, review matches, then confirm. Files are stored in Automotive Brands object storage — not OneDrive links."
        actions={
          <Link
            to={ROUTES.adminProductImports}
            className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase inline-flex items-center"
          >
            Product CSV imports
          </Link>
        }
      />

      <div className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-4 text-[12px] font-semibold uppercase text-primary-foreground disabled:opacity-50"
            disabled={busy === "preview"}
            onClick={() => fileRef.current?.click()}
          >
            Select PDF files
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              void onFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <p className="text-[12px] text-steel">Up to 40 PDFs per preview batch.</p>
        </div>

        {error ? <p className="text-[13px] text-bad">{error}</p> : null}

        {rows.length ? (
          <>
            <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-steel">
              {Object.entries(summary).map(([k, n]) => (
                <span key={k} className="rounded border border-border px-2 py-1">
                  {k}: {n}
                </span>
              ))}
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-steel">
                    <th className="px-3 py-2">File</th>
                    <th className="px-3 py-2">Product match</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.clientKey} className="border-b border-border/60 align-top">
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.filename}</div>
                        <div className="text-[11px] text-steel">{row.message}</div>
                      </td>
                      <td className="px-3 py-2">
                        {row.productName ?? "—"}
                        {(row.status === "NO_MATCH" ||
                          row.status === "REVIEW" ||
                          !row.selectedProductId) &&
                        row.status !== "INVALID" &&
                        row.status !== "ALREADY_ATTACHED" ? (
                          <div className="mt-2 space-y-1">
                            <input
                              className="h-8 w-full max-w-xs rounded border border-border bg-background px-2 text-[12px]"
                              placeholder="Search product / SKU…"
                              value={searchQ[row.clientKey] ?? ""}
                              onChange={(e) => void searchProduct(row.clientKey, e.target.value)}
                            />
                            {(searchHits[row.clientKey] ?? row.candidates).slice(0, 6).map((c) => (
                              <button
                                key={c.productId}
                                type="button"
                                className="block w-full max-w-xs truncate rounded px-2 py-1 text-left text-[12px] hover:bg-secondary/60"
                                onClick={() => {
                                  setRows((prev) =>
                                    prev.map((r) =>
                                      r.clientKey === row.clientKey
                                        ? {
                                            ...r,
                                            selectedProductId: c.productId,
                                            productName: c.name,
                                            sku: c.sku,
                                            status: r.status === "EXISTING_SDS" ? r.status : "MATCHED",
                                            action: r.status === "EXISTING_SDS" ? "REPLACE" : "IMPORT",
                                          }
                                        : r,
                                    ),
                                  );
                                }}
                              >
                                {c.sku} — {c.name}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{row.sku ?? "—"}</td>
                      <td className="px-3 py-2">
                        <StatusBadge tone={statusTone(row.status)}>{row.status}</StatusBadge>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="h-8 rounded border border-border bg-background px-2 text-[12px]"
                          value={row.action}
                          disabled={
                            row.status === "INVALID" ||
                            row.status === "ALREADY_ATTACHED" ||
                            row.status === "IMPORTED" ||
                            row.status === "REPLACED"
                          }
                          onChange={(e) => {
                            const action = e.target.value as RowState["action"];
                            setRows((prev) =>
                              prev.map((r) =>
                                r.clientKey === row.clientKey ? { ...r, action } : r,
                              ),
                            );
                          }}
                        >
                          <option value="IMPORT">Import</option>
                          <option value="REPLACE">Replace existing</option>
                          <option value="SKIP">Skip</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              className={cn(
                "h-10 rounded-md bg-primary px-4 text-[12px] font-semibold uppercase text-primary-foreground disabled:opacity-50",
              )}
              disabled={busy === "confirm"}
              onClick={() => void confirm()}
            >
              Confirm import
            </button>
          </>
        ) : (
          <p className="text-[13px] text-steel">
            No files loaded yet. Choose SDS PDFs to preview matching before anything is published.
          </p>
        )}
      </div>
    </div>
  );
}
