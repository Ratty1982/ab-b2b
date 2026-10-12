import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { inputClass } from "@/components/ab/Drawer";
import { StatusBadge } from "@/components/ab/Badges";
import { ValidityBadge } from "@/components/pricing/ValidityBadge";
import { cn } from "@/lib/utils";
import { formatDate, formatOrDash } from "@/lib/datetime";
import {
  approveCustomerPriceImportFn,
  customerPriceImportTemplateFn,
  exportCustomerPricesCsvFn,
  getCustomerPriceImportFn,
  getCustomerPriceImportWorkspaceFn,
  previewCustomerPriceImportFn,
  rejectCustomerPriceImportFn,
  submitCustomerPriceImportFn,
} from "@/server/phase2/fns";

type Workspace = Extract<Awaited<ReturnType<typeof getCustomerPriceImportWorkspaceFn>>, { ok: true }>["data"];
type Preview = Extract<Awaited<ReturnType<typeof previewCustomerPriceImportFn>>, { ok: true }>["data"];
type ImportDetail = Extract<Awaited<ReturnType<typeof getCustomerPriceImportFn>>, { ok: true }>["data"];

const STATUS_LABEL = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved / applied",
  REJECTED: "Rejected",
} as const;

function statusTone(status: string) {
  if (status === "APPROVED") return "good" as const;
  if (status === "PENDING_APPROVAL") return "warn" as const;
  if (status === "REJECTED") return "bad" as const;
  return "neutral" as const;
}

function statusLabel(status: string) {
  return STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status;
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(safe)) return `"${safe.replaceAll('"', '""')}"`;
  return safe;
}

function errorReportCsv(lines: Preview["lines"]) {
  const rows = ["Row,SKU,Issues"];
  for (const line of lines) {
    if (!line.messages.length) continue;
    rows.push([String(line.rowNumber), csvCell(line.sku), csvCell(line.messages.join("; "))].join(","));
  }
  return `${rows.join("\n")}\n`;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? (value.split(",")[1] ?? "") : "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

export function CustomerPriceImportPanel({
  companyId,
  showPrices = true,
}: {
  companyId: string;
  showPrices?: boolean;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function reload() {
    const result = await getCustomerPriceImportWorkspaceFn({ data: { companyId } });
    if (!result.ok) {
      setError(result.error);
      setWorkspace(null);
      return;
    }
    setError(null);
    setWorkspace(result.data);
  }

  useEffect(() => {
    setPreview(null);
    setDetail(null);
    void reload();
  }, [companyId]);

  const prices = useMemo(() => {
    const rows = workspace?.prices ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.sku, row.productName, row.brand].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [workspace, query]);

  const pending = (workspace?.imports ?? []).filter((row) => row.status === "PENDING_APPROVAL");

  return (
    <section className="grid gap-6">
      <div>
        <h3 className="font-display text-lg font-semibold uppercase">Trade prices</h3>
        {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
        {workspace ? (
          <p className="mt-1 max-w-3xl text-[13px] text-steel">
            {workspace.company.name}
            {workspace.company.accountCode ? ` · ${workspace.company.accountCode}` : ""}
            {" · "}
            Assigned price list:{" "}
            {workspace.assignedPriceList
              ? `${workspace.assignedPriceList.code} — ${workspace.assignedPriceList.name}`
              : "Default trade price"}
            . {workspace.negotiatedCount} negotiated product price
            {workspace.negotiatedCount === 1 ? "" : "s"}. Uploads add or update prices for this customer
            only, and live prices change after approval. Prices missing from a file stay as they are.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="h-10 rounded-md border border-border px-3 text-[12px] font-semibold"
          onClick={() => {
            void customerPriceImportTemplateFn().then((result) => {
              if (!result.ok) toast.error(result.error);
              else downloadText(result.data.filename, result.data.csv);
            });
          }}
        >
          Download example template
        </button>
        <button
          type="button"
          className="h-10 rounded-md border border-border px-3 text-[12px] font-semibold"
          onClick={() => {
            void exportCustomerPricesCsvFn({ data: { companyId } }).then((result) => {
              if (!result.ok) toast.error(result.error);
              else downloadText(result.data.filename, result.data.csv);
            });
          }}
        >
          Export current prices
        </button>
        <label className="inline-flex h-10 cursor-pointer items-center rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground">
          Upload trade prices
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setBusy(true);
              void readFile(file)
                .then((fileBase64) =>
                  previewCustomerPriceImportFn({ data: { companyId, filename: file.name, fileBase64 } }),
                )
                .then((result) => {
                  if (!result.ok) toast.error(result.error);
                  else {
                    setPreview(result.data);
                    setDetail(null);
                    void reload();
                  }
                })
                .finally(() => setBusy(false));
            }}
          />
        </label>
      </div>

      {preview ? (
        <div className="grid gap-3 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="font-semibold">Upload preview</h4>
              <p className="text-[13px] text-steel">
                {preview.companyName}
                {preview.accountCode ? ` · ${preview.accountCode}` : ""} · {preview.filename}
              </p>
            </div>
            {preview.canSubmit && preview.importId ? (
              <button
                type="button"
                disabled={busy}
                className="h-10 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-60"
                onClick={() => {
                  if (!preview.importId) return;
                  setBusy(true);
                  void submitCustomerPriceImportFn({ data: { companyId, importId: preview.importId } })
                    .then((result) => {
                      if (!result.ok) toast.error(result.error);
                      else {
                        toast.success("Submitted for approval. Live prices are unchanged.");
                        setPreview(null);
                        void reload();
                      }
                    })
                    .finally(() => setBusy(false));
                }}
              >
                Submit for approval
              </button>
            ) : null}
          </div>
          <dl className="grid gap-2 text-[13px] sm:grid-cols-5">
            <div><dt className="text-steel">Products found</dt><dd className="num">{preview.productsFound}</dd></div>
            <div><dt className="text-steel">New</dt><dd className="num">{preview.newCount}</dd></div>
            <div><dt className="text-steel">Updates</dt><dd className="num">{preview.updateCount}</dd></div>
            <div><dt className="text-steel">Unchanged</dt><dd className="num">{preview.unchangedCount}</dd></div>
            <div><dt className="text-steel">Invalid</dt><dd className="num">{preview.invalidCount}</dd></div>
          </dl>
          {preview.fileIssues.length ? (
            <ul className="grid gap-1 text-[13px] text-destructive">
              {preview.fileIssues.map((issue, index) => (
                <li key={`${issue.message}-${index}`}>
                  {issue.rowNumber ? `Row ${issue.rowNumber}: ` : ""}
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
          {preview.lines.some((line) => line.messages.length) ? (
            <button
              type="button"
              className="h-9 w-fit rounded-md border border-border px-3 text-[12px] font-semibold"
              onClick={() => downloadText("customer-price-errors.csv", errorReportCsv(preview.lines))}
            >
              Download error report
            </button>
          ) : null}
          {preview.lines.length ? <PreviewTable lines={preview.lines} /> : null}
        </div>
      ) : null}

      {showPrices ? <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h4 className="font-semibold">Negotiated prices</h4>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search SKU or product"
            className={cn(inputClass, "max-w-xs")}
          />
        </div>
        {prices.length === 0 ? (
          <p className="mt-3 text-[13px] text-steel">No negotiated prices match this customer.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2 text-right">Normal price</th>
                  <th className="px-3 py-2 text-right">Customer price</th>
                  <th className="px-3 py-2">Valid from</th>
                  <th className="px-3 py-2">Valid until</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    <td className="num px-3 py-2 text-primary">{row.sku}</td>
                    <td className="px-3 py-2">{row.productName}</td>
                    <td className="num px-3 py-2 text-right">{row.normalPriceDisplay ?? "—"}</td>
                    <td className="num px-3 py-2 text-right">{row.unitPriceDisplay ?? "—"}</td>
                    <td className="num px-3 py-2">{formatOrDash(formatDate(row.startsAt))}</td>
                    <td className="num px-3 py-2">{formatOrDash(formatDate(row.endsAt))}</td>
                    <td className="px-3 py-2"><ValidityBadge status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div> : null}

      <div className="grid gap-3">
        <h4 className="font-semibold">Pending approvals</h4>
        {pending.length === 0 ? (
          <p className="text-[13px] text-steel">No uploads are waiting for approval.</p>
        ) : (
          <ul className="grid gap-2">
            {pending.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border border-border px-3 py-2">
                <div>
                  <div className="font-semibold">{row.filename}</div>
                  <div className="text-[12px] text-steel">
                    {row.submittedBy?.name ?? "Unknown"} · {row.newCount} new · {row.updateCount} updates
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => openDetail(row.id)}>
                    Inspect
                  </button>
                  {workspace?.canApprove ? (
                    <>
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-primary"
                        onClick={() => {
                          setBusy(true);
                          void approveCustomerPriceImportFn({ data: { companyId, importId: row.id } })
                            .then((result) => {
                              if (!result.ok) toast.error(result.error);
                              else {
                                toast.success("Prices approved and applied for this customer.");
                                void reload();
                              }
                            })
                            .finally(() => setBusy(false));
                        }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-primary"
                        onClick={() => {
                          const reason = rejectReason.trim();
                          if (!reason) {
                            toast.error("Enter a rejection reason first");
                            return;
                          }
                          setBusy(true);
                          void rejectCustomerPriceImportFn({ data: { companyId, importId: row.id, reason } })
                            .then((result) => {
                              if (!result.ok) toast.error(result.error);
                              else {
                                toast.success("Upload rejected. Live prices are unchanged.");
                                setRejectReason("");
                                void reload();
                              }
                            })
                            .finally(() => setBusy(false));
                        }}
                      >
                        Reject
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {workspace?.canApprove && pending.length ? (
          <textarea
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            className={cn(inputClass, "max-w-xl min-h-20 py-2")}
            placeholder="Rejection reason, then choose Reject on the upload"
          />
        ) : null}
      </div>

      <div>
        <h4 className="font-semibold">Latest pricing uploads</h4>
        {(workspace?.imports.length ?? 0) === 0 ? (
          <p className="mt-2 text-[13px] text-steel">No pricing uploads for this customer yet.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {workspace?.imports.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 border border-border/70 px-3 py-2 text-[13px]">
                <div>
                  <span className="font-semibold">{row.filename}</span>
                  <span className="text-steel"> · {row.submittedBy?.name ?? "Unknown"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge>
                  <button type="button" className="font-semibold text-primary" onClick={() => openDetail(row.id)}>
                    Inspect
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detail ? (
        <div className="grid gap-2 rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold">{detail.filename}</h4>
            <StatusBadge tone={statusTone(detail.status)}>{statusLabel(detail.status)}</StatusBadge>
          </div>
          <p className="text-[13px] text-steel">
            {detail.company.name}
            {detail.company.accountCode ? ` · ${detail.company.accountCode}` : ""} · {detail.newCount} new ·{" "}
            {detail.updateCount} updates
            {detail.rejectionReason ? ` · ${detail.rejectionReason}` : ""}
          </p>
          <PreviewTable lines={detail.lines} />
        </div>
      ) : null}
    </section>
  );

  function openDetail(importId: string) {
    void getCustomerPriceImportFn({ data: { companyId, importId } }).then((result) => {
      if (!result.ok) toast.error(result.error);
      else setDetail(result.data);
    });
  }
}

function PreviewTable({ lines }: { lines: Preview["lines"] }) {
  return (
    <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
      <table className="w-full min-w-[980px] text-[13px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.12em] text-steel">
            <th className="px-3 py-2">Row</th>
            <th className="px-3 py-2">SKU</th>
            <th className="px-3 py-2">Product</th>
            <th className="px-3 py-2 text-right">Normal trade</th>
            <th className="px-3 py-2 text-right">Existing</th>
            <th className="px-3 py-2 text-right">Proposed</th>
            <th className="px-3 py-2 text-right">Change</th>
            <th className="px-3 py-2">Effective</th>
            <th className="px-3 py-2">Warnings</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={`${line.rowNumber}-${line.sku}`} className="border-b border-border/60 last:border-0">
              <td className="num px-3 py-2">{line.rowNumber}</td>
              <td className="num px-3 py-2">{line.sku || "—"}</td>
              <td className="px-3 py-2">{line.productName ?? "—"}</td>
              <td className="num px-3 py-2 text-right">{line.normalPrice ?? "—"}</td>
              <td className="num px-3 py-2 text-right">{line.existingPrice ?? "—"}</td>
              <td className="num px-3 py-2 text-right">{line.proposedPrice ?? "—"}</td>
              <td className="num px-3 py-2 text-right">{line.percentChange ?? "—"}</td>
              <td className="num px-3 py-2">
                {line.startsAt ? line.startsAt.slice(0, 10) : "—"}
                {" → "}
                {line.endsAt ? line.endsAt.slice(0, 10) : "—"}
              </td>
              <td className="px-3 py-2 text-destructive">{line.messages.join("; ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
