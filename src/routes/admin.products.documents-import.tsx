import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { SharePointSdsSettingsPanel } from "@/components/catalogue/SharePointSdsSettingsPanel";
import { InstantText } from "@/components/ab/InstantText";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import {
  confirmBulkSdsImportFn,
  confirmSharePointSdsImportFn,
  getSharePointSdsSettingsFn,
  listSharePointSdsScanFn,
  previewBulkSdsImportFn,
  scanSharePointSdsFolderFn,
  searchProductsForDocumentAttachFn,
  updateSharePointSdsScanItemFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/products/documents-import")({
  head: () => ({ meta: [{ title: "Import SDS — Automotive Brands Admin" }] }),
  component: BulkSdsImportPage,
});

type SourceMode = "choose" | "sharepoint" | "upload";

type LocalPreviewItem = Extract<
  Awaited<ReturnType<typeof previewBulkSdsImportFn>>,
  { ok: true }
>["data"]["items"][number];

type RowStatus =
  | LocalPreviewItem["status"]
  | "IMPORTED"
  | "REPLACED"
  | "FAILED"
  | "SKIPPED";

type LocalRow = Omit<LocalPreviewItem, "status"> & {
  status: RowStatus;
  action: "IMPORT" | "REPLACE" | "SKIP";
  selectedProductId: string | null;
};

type SpSettings = Extract<
  Awaited<ReturnType<typeof getSharePointSdsSettingsFn>>,
  { ok: true }
>["data"];

type SpPage = Extract<
  Awaited<ReturnType<typeof listSharePointSdsScanFn>>,
  { ok: true }
>["data"];

type SpRowAction = "IMPORT" | "REPLACE" | "SKIP";

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
  if (
    status === "REVIEW" ||
    status === "EXISTING_SDS" ||
    status === "UPDATED_SOURCE" ||
    status === "SOURCE_MISSING"
  ) {
    return "warn";
  }
  if (status === "INVALID" || status === "FAILED" || status === "DOWNLOAD_FAILED") return "bad";
  return "neutral";
}

function defaultAction(status: string): SpRowAction {
  if (status === "MATCHED") return "IMPORT";
  if (status === "EXISTING_SDS" || status === "UPDATED_SOURCE") return "SKIP";
  return "SKIP";
}

function BulkSdsImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<SourceMode>("choose");
  const [spSettings, setSpSettings] = useState<SpSettings | null>(null);
  const [showSpConfig, setShowSpConfig] = useState(false);

  // Local upload state
  const [localRows, setLocalRows] = useState<LocalRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState<Record<string, string>>({});
  const [searchHits, setSearchHits] = useState<
    Record<string, Array<{ productId: string; name: string; sku: string }>>
  >({});

  // SharePoint scan state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [spPage, setSpPage] = useState<SpPage | null>(null);
  const [spActions, setSpActions] = useState<Record<string, SpRowAction>>({});
  const [spPageNum, setSpPageNum] = useState(1);

  const loadSpSettings = useCallback(async () => {
    const res = await getSharePointSdsSettingsFn();
    if (res.ok) setSpSettings(res.data);
  }, []);

  const onSharePointSettingsChanged = useCallback((s: SpSettings) => {
    setSpSettings(s);
  }, []);

  useEffect(() => {
    void loadSpSettings();
  }, [loadSpSettings]);

  const localSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of localRows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return counts;
  }, [localRows]);

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
    setLocalRows(
      res.data.items.map((item) => ({
        ...item,
        selectedProductId: item.productId,
        action:
          item.status === "EXISTING_SDS" || item.status === "UPDATED_SOURCE"
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

  async function confirmLocal() {
    const toSend = localRows
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
    setLocalRows((prev) =>
      prev.map((row) => {
        const hit = res.data.results.find((r) => r.clientKey === row.clientKey);
        if (!hit) return row;
        return {
          ...row,
          status: hit.status as RowStatus,
          message: hit.message,
          action: "SKIP",
        };
      }),
    );
  }

  async function loadSpPage(sid: string, page: number) {
    const res = await listSharePointSdsScanFn({
      data: { sessionId: sid, page, pageSize: 50 },
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSpPage(res.data);
    setSpPageNum(page);
    setSpActions((prev) => {
      const next = { ...prev };
      for (const item of res.data.items) {
        if (!next[item.clientKey]) next[item.clientKey] = defaultAction(item.status);
      }
      return next;
    });
  }

  async function scanSharePoint() {
    setBusy("scan");
    setError(null);
    const res = await scanSharePointSdsFolderFn();
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      await loadSpSettings();
      return;
    }
    setSessionId(res.data.sessionId);
    setSpPage(res.data.page);
    setSpSettings(res.data.settings);
    setSpPageNum(1);
    const actions: Record<string, SpRowAction> = {};
    for (const item of res.data.page.items) {
      actions[item.clientKey] = defaultAction(item.status);
    }
    setSpActions(actions);
    toast.success(`Scanned ${res.data.summary["FILES_FOUND"] ?? 0} PDF(s)`);
  }

  async function selectSpProduct(clientKey: string, productId: string) {
    if (!sessionId) return;
    const res = await updateSharePointSdsScanItemFn({
      data: { sessionId, clientKey, productId },
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSpPage((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((i) =>
              i.clientKey === clientKey
                ? {
                    ...i,
                    productId: res.data.productId,
                    productName: res.data.productName,
                    sku: res.data.sku,
                    status: res.data.status as SpPage["items"][number]["status"],
                    message: res.data.message,
                  }
                : i,
            ),
          }
        : prev,
    );
    setSpActions((prev) => ({
      ...prev,
      [clientKey]:
        res.data.status === "EXISTING_SDS" || res.data.status === "UPDATED_SOURCE"
          ? "SKIP"
          : res.data.status === "MATCHED"
            ? "IMPORT"
            : prev[clientKey] ?? "SKIP",
    }));
  }

  function bulkImportMatched() {
    if (!spPage) return;
    setSpActions((prev) => {
      const next = { ...prev };
      for (const item of spPage.items) {
        if (item.status === "MATCHED" && item.productId) next[item.clientKey] = "IMPORT";
      }
      return next;
    });
    // Also set across pages via confirm filter — apply to loaded page; for full session
    // confirm will read actions we set when paging. Store matched intent for all loaded keys.
    toast.message("Set MATCHED rows on this page to Import — confirm to apply");
  }

  async function bulkSkipDuplicates() {
    if (!sessionId) return;
    // Walk all pages and set ALREADY_ATTACHED to SKIP (already default)
    setSpActions((prev) => {
      const next = { ...prev };
      if (spPage) {
        for (const item of spPage.items) {
          if (item.status === "ALREADY_ATTACHED") next[item.clientKey] = "SKIP";
        }
      }
      return next;
    });
    toast.message("Duplicates remain skipped");
  }

  async function confirmSharePoint() {
    if (!sessionId || !spPage) return;
    // Collect actions for ALL session items by paging
    setBusy("confirm");
    const toSend: Array<{
      clientKey: string;
      productId: string;
      action: "IMPORT" | "REPLACE" | "SKIP";
    }> = [];

    let page = 1;
    let pageCount = 1;
    const actionMap = { ...spActions };
    do {
      const res = await listSharePointSdsScanFn({
        data: { sessionId, page, pageSize: 100 },
      });
      if (!res.ok) {
        setBusy(null);
        toast.error(res.error);
        return;
      }
      pageCount = res.data.pageCount;
      for (const item of res.data.items) {
        const action = actionMap[item.clientKey] ?? defaultAction(item.status);
        if (action === "SKIP") continue;
        if (!item.productId) continue;
        if (
          item.status === "ALREADY_ATTACHED" ||
          item.status === "INVALID" ||
          item.status === "DOWNLOAD_FAILED" ||
          item.status === "SOURCE_MISSING"
        ) {
          continue;
        }
        if (item.status === "EXISTING_SDS" && action !== "REPLACE") continue;
        const resolvedAction: "IMPORT" | "REPLACE" =
          item.status === "UPDATED_SOURCE" || action === "REPLACE" ? "REPLACE" : "IMPORT";
        toSend.push({
          clientKey: item.clientKey,
          productId: item.productId,
          action: resolvedAction,
        });
      }
      page += 1;
    } while (page <= pageCount);

    if (!toSend.length) {
      setBusy(null);
      toast.message("Nothing selected to import");
      return;
    }

    const res = await confirmSharePointSdsImportFn({
      data: { sessionId, items: toSend },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      `Imported ${res.data.imported}, replaced ${res.data.replaced}, failed ${res.data.failed}`,
    );
    await loadSpPage(sessionId, spPageNum);
    await loadSpSettings();
  }

  return (
    <div>
      <PanelHeader
        title="Import SDS / Product Documents"
        sub="Import Safety Data Sheets from SharePoint or upload PDFs. Files are stored in Automotive Brands object storage — not SharePoint links."
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
        {source === "choose" ? (
          <section className="space-y-4">
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-steel">
              Choose source
            </h3>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="h-11 rounded-md bg-primary px-5 text-[12px] font-semibold uppercase text-primary-foreground"
                onClick={() => setSource("sharepoint")}
              >
                Import from SharePoint
              </button>
              <button
                type="button"
                className="h-11 rounded-md border border-border px-5 text-[12px] font-semibold uppercase"
                onClick={() => setSource("upload")}
              >
                Upload PDF files
              </button>
            </div>
          </section>
        ) : (
          <button
            type="button"
            className="text-[12px] font-semibold uppercase text-steel hover:text-foreground"
            onClick={() => {
              setSource("choose");
              setLocalRows([]);
              setSessionId(null);
              setSpPage(null);
              setError(null);
            }}
          >
            ← Change source
          </button>
        )}

        {error ? <p className="text-[13px] text-bad">{error}</p> : null}

        {source === "sharepoint" ? (
          <div className="space-y-4">
            <section className="rounded-lg border border-border bg-surface/30 p-4">
              <h3 className="font-display text-base font-semibold uppercase">
                {spSettings?.sourceLabel ?? "Power Maxed SDS"}
              </h3>
              <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-3">
                <div>
                  <dt className="text-[11px] uppercase text-steel">SharePoint folder</dt>
                  <dd className="font-medium">
                    {spSettings?.folderDisplayName ?? "Power Maxed SDS 2025"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase text-steel">Connection</dt>
                  <dd className="font-medium">
                    {spSettings?.connected ? "Connected" : "Not connected"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase text-steel">Last scanned</dt>
                  <dd className="font-medium">
                    {spSettings?.lastScanAt ? (
                      <InstantText value={spSettings.lastScanAt} variant="audit" />
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="h-10 rounded-md bg-primary px-4 text-[12px] font-semibold uppercase text-primary-foreground disabled:opacity-50"
                  disabled={busy === "scan" || !spSettings?.folderResolved}
                  onClick={() => void scanSharePoint()}
                >
                  {busy === "scan" ? "Scanning…" : "Scan SharePoint folder"}
                </button>
                <button
                  type="button"
                  className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase"
                  onClick={() => setShowSpConfig((v) => !v)}
                >
                  {showSpConfig ? "Hide connection settings" : "Connection settings"}
                </button>
              </div>
              {spSettings?.lastScanError ? (
                <p className="mt-2 text-[12px] text-bad">{spSettings.lastScanError}</p>
              ) : null}
            </section>

            {showSpConfig || !spSettings?.folderResolved ? (
              <SharePointSdsSettingsPanel
                compact
                onChanged={onSharePointSettingsChanged}
              />
            ) : null}

            {spPage ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                  {Object.entries(spPage.summary).map(([k, n]) => (
                    <div
                      key={k}
                      className="rounded-md border border-border px-3 py-2 text-center"
                    >
                      <div className="text-[10px] font-semibold uppercase text-steel">{k.replace(/_/g, " ")}</div>
                      <div className="num text-lg font-semibold">{n}</div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase"
                    onClick={() => bulkImportMatched()}
                  >
                    Import all MATCHED (this page)
                  </button>
                  <button
                    type="button"
                    className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase"
                    onClick={() => void bulkSkipDuplicates()}
                  >
                    Skip all duplicates
                  </button>
                </div>

                <SharePointPreviewTable
                  page={spPage}
                  actions={spActions}
                  searchQ={searchQ}
                  searchHits={searchHits}
                  busy={busy}
                  onAction={(clientKey, action) =>
                    setSpActions((prev) => ({ ...prev, [clientKey]: action }))
                  }
                  onSearch={(clientKey, q) => void searchProduct(clientKey, q)}
                  onSelectProduct={(clientKey, productId) =>
                    void selectSpProduct(clientKey, productId)
                  }
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="h-9 rounded-md border border-border px-3 text-[12px] disabled:opacity-40"
                      disabled={spPageNum <= 1 || busy !== null}
                      onClick={() => sessionId && void loadSpPage(sessionId, spPageNum - 1)}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="h-9 rounded-md border border-border px-3 text-[12px] disabled:opacity-40"
                      disabled={spPageNum >= spPage.pageCount || busy !== null}
                      onClick={() => sessionId && void loadSpPage(sessionId, spPageNum + 1)}
                    >
                      Next
                    </button>
                    <span className="self-center text-[12px] text-steel">
                      Page {spPage.page} / {spPage.pageCount} · {spPage.total} rows
                    </span>
                  </div>
                  <button
                    type="button"
                    className="h-10 rounded-md bg-primary px-4 text-[12px] font-semibold uppercase text-primary-foreground disabled:opacity-50"
                    disabled={busy === "confirm"}
                    onClick={() => void confirmSharePoint()}
                  >
                    Confirm SharePoint import
                  </button>
                </div>
              </>
            ) : (
              <p className="text-[13px] text-steel">
                Scan the SharePoint folder to preview matches. Nothing is published until you
                confirm.
              </p>
            )}
          </div>
        ) : null}

        {source === "upload" ? (
          <div className="space-y-4">
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
              <p className="text-[12px] text-steel">Up to 40 PDFs per local preview batch.</p>
            </div>

            {localRows.length ? (
              <>
                <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-wide text-steel">
                  {Object.entries(localSummary).map(([k, n]) => (
                    <span key={k} className="rounded border border-border px-2 py-1">
                      {k}: {n}
                    </span>
                  ))}
                </div>
                <LocalPreviewTable
                  rows={localRows}
                  searchQ={searchQ}
                  searchHits={searchHits}
                  onSearch={(clientKey, q) => void searchProduct(clientKey, q)}
                  onSelectProduct={(clientKey, c) => {
                    setLocalRows((prev) =>
                      prev.map((r) =>
                        r.clientKey === clientKey
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
                  onAction={(clientKey, action) => {
                    setLocalRows((prev) =>
                      prev.map((r) => (r.clientKey === clientKey ? { ...r, action } : r)),
                    );
                  }}
                />
                <button
                  type="button"
                  className={cn(
                    "h-10 rounded-md bg-primary px-4 text-[12px] font-semibold uppercase text-primary-foreground disabled:opacity-50",
                  )}
                  disabled={busy === "confirm"}
                  onClick={() => void confirmLocal()}
                >
                  Confirm import
                </button>
              </>
            ) : (
              <p className="text-[13px] text-steel">
                No files loaded yet. Choose SDS PDFs to preview matching before anything is
                published.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LocalPreviewTable({
  rows,
  searchQ,
  searchHits,
  onSearch,
  onSelectProduct,
  onAction,
}: {
  rows: LocalRow[];
  searchQ: Record<string, string>;
  searchHits: Record<string, Array<{ productId: string; name: string; sku: string }>>;
  onSearch: (clientKey: string, q: string) => void;
  onSelectProduct: (
    clientKey: string,
    c: { productId: string; name: string; sku: string },
  ) => void;
  onAction: (clientKey: string, action: "IMPORT" | "REPLACE" | "SKIP") => void;
}) {
  return (
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
                      onChange={(e) => onSearch(row.clientKey, e.target.value)}
                    />
                    {(searchHits[row.clientKey] ?? row.candidates).slice(0, 6).map((c) => (
                      <button
                        key={c.productId}
                        type="button"
                        className="block w-full max-w-xs truncate rounded px-2 py-1 text-left text-[12px] hover:bg-secondary/60"
                        onClick={() => onSelectProduct(row.clientKey, c)}
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
                  onChange={(e) =>
                    onAction(row.clientKey, e.target.value as "IMPORT" | "REPLACE" | "SKIP")
                  }
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
  );
}

function SharePointPreviewTable({
  page,
  actions,
  searchQ,
  searchHits,
  busy,
  onAction,
  onSearch,
  onSelectProduct,
}: {
  page: SpPage;
  actions: Record<string, SpRowAction>;
  searchQ: Record<string, string>;
  searchHits: Record<string, Array<{ productId: string; name: string; sku: string }>>;
  busy: string | null;
  onAction: (clientKey: string, action: SpRowAction) => void;
  onSearch: (clientKey: string, q: string) => void;
  onSelectProduct: (clientKey: string, productId: string) => void;
}) {
  return (
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
          {page.items.map((row) => (
            <tr key={row.clientKey} className="border-b border-border/60 align-top">
              <td className="px-3 py-2">
                <div className="font-medium">{row.filename}</div>
                <div className="text-[11px] text-steel">{row.message}</div>
              </td>
              <td className="px-3 py-2">
                {row.productName ?? "—"}
                {(row.status === "NO_MATCH" || row.status === "REVIEW" || !row.productId) &&
                row.status !== "INVALID" &&
                row.status !== "ALREADY_ATTACHED" &&
                row.status !== "SOURCE_MISSING" &&
                row.status !== "DOWNLOAD_FAILED" ? (
                  <div className="mt-2 space-y-1">
                    <input
                      className="h-8 w-full max-w-xs rounded border border-border bg-background px-2 text-[12px]"
                      placeholder="Search product / SKU…"
                      value={searchQ[row.clientKey] ?? ""}
                      onChange={(e) => onSearch(row.clientKey, e.target.value)}
                      disabled={busy !== null}
                    />
                    {(searchHits[row.clientKey] ?? row.candidates).slice(0, 6).map((c) => (
                      <button
                        key={c.productId}
                        type="button"
                        className="block w-full max-w-xs truncate rounded px-2 py-1 text-left text-[12px] hover:bg-secondary/60"
                        onClick={() => onSelectProduct(row.clientKey, c.productId)}
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
                  value={actions[row.clientKey] ?? "SKIP"}
                  disabled={
                    row.status === "INVALID" ||
                    row.status === "ALREADY_ATTACHED" ||
                    row.status === "SOURCE_MISSING" ||
                    row.status === "DOWNLOAD_FAILED" ||
                    String(row.status) === "IMPORTED" ||
                    String(row.status) === "REPLACED"
                  }
                  onChange={(e) => onAction(row.clientKey, e.target.value as SpRowAction)}
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
  );
}
