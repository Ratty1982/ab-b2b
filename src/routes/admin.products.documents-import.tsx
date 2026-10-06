import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge, type Tone } from "@/components/ab/Badges";
import { SharePointSdsSettingsPanel } from "@/components/catalogue/SharePointSdsSettingsPanel";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/datetime";
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
  head: () => ({ meta: [{ title: "Bulk SDS Upload — Automotive Brands Admin" }] }),
  component: BulkSdsImportPage,
});

type LocalPreviewItem = Extract<
  Awaited<ReturnType<typeof previewBulkSdsImportFn>>,
  { ok: true }
>["data"]["items"][number];

type RowStatus =
  | LocalPreviewItem["status"]
  | "READY"
  | "ALREADY_ATTACHED"
  | "IMPORTED"
  | "REPLACED"
  | "FAILED"
  | "SKIPPED";

type LocalRow = Omit<LocalPreviewItem, "status"> & {
  status: RowStatus;
  action: "IMPORT" | "REPLACE" | "SKIP";
  selectedProductId: string | null;
  brandName: string | null;
};

type SearchHit = {
  productId: string;
  name: string;
  sku: string;
  brandName?: string | null;
  existingSds?: {
    id: string;
    filename: string;
    title: string;
    uploadedAt: string;
  } | null;
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
type FilterKey = "all" | "ready" | "review" | "nomatch" | "replacement" | "duplicate" | "error";

const DEFAULT_MAX_FILES = 100;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function formatMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function statusTone(status: string): Tone {
  if (status === "MATCHED" || status === "READY" || status === "IMPORTED" || status === "REPLACED") {
    return "good";
  }
  if (status === "REVIEW" || status === "EXISTING_SDS" || status === "UPDATED_SOURCE" || status === "SOURCE_MISSING") {
    return "warn";
  }
  if (status === "INVALID" || status === "FAILED" || status === "DOWNLOAD_FAILED") return "bad";
  return "neutral";
}

function statusLabel(status: string): string {
  switch (status) {
    case "MATCHED":
    case "READY":
      return "✓ Matched";
    case "REVIEW":
      return "⚠ Needs review";
    case "NO_MATCH":
      return "— No match";
    case "EXISTING_SDS":
    case "UPDATED_SOURCE":
      return "↻ Replaces current SDS";
    case "ALREADY_ATTACHED":
      return "= Already uploaded";
    case "INVALID":
    case "DOWNLOAD_FAILED":
    case "FAILED":
      return "✕ Error";
    case "IMPORTED":
      return "Imported";
    case "REPLACED":
      return "Replaced";
    case "SKIPPED":
      return "Skipped";
    default:
      return status.replace(/_/g, " ");
  }
}

function matchMethodLabel(method: LocalRow["matchMethod"]): string {
  if (method === "EXACT_SKU") return "Exact SKU";
  if (method === "NORMALISED_SKU") return "Normalised SKU";
  if (method === "PRODUCT_NAME") return "Product name";
  if (method === "MANUAL") return "Manual";
  return "—";
}

function defaultLocalAction(item: LocalPreviewItem): LocalRow["action"] {
  if (item.status === "MATCHED") return "IMPORT";
  if (item.status === "EXISTING_SDS" || item.status === "UPDATED_SOURCE") return "REPLACE";
  return "SKIP";
}

function isReadyRow(row: LocalRow): boolean {
  if (row.action === "SKIP") return false;
  if (!row.selectedProductId) return false;
  if (row.status === "INVALID" || row.status === "ALREADY_ATTACHED") return false;
  if (row.status === "IMPORTED" || row.status === "REPLACED" || row.status === "SKIPPED") return false;
  return row.action === "IMPORT" || row.action === "REPLACE";
}

function BulkSdsImportPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const fileBodies = useRef<Map<string, { filename: string; contentType: string; base64: string }>>(new Map());
  const [dragOver, setDragOver] = useState(false);
  const [spSettings, setSpSettings] = useState<SpSettings | null>(null);
  const [showSharePoint, setShowSharePoint] = useState(false);
  const [showSpConfig, setShowSpConfig] = useState(false);

  const [localRows, setLocalRows] = useState<LocalRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState<Record<string, string>>({});
  const [searchHits, setSearchHits] = useState<Record<string, SearchHit[]>>({});
  const [maxFiles, setMaxFiles] = useState(DEFAULT_MAX_FILES);
  const [maxBytes, setMaxBytes] = useState(DEFAULT_MAX_BYTES);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [spPage, setSpPage] = useState<SpPage | null>(null);
  const [spActions, setSpActions] = useState<Record<string, SpRowAction>>({});
  const [spPageNum, setSpPageNum] = useState(1);

  const sharePointEnabled = Boolean(spSettings?.workflowEnabled);

  const loadSpSettings = useCallback(async () => {
    const res = await getSharePointSdsSettingsFn();
    if (res.ok) setSpSettings(res.data);
  }, []);

  useEffect(() => {
    void loadSpSettings();
  }, [loadSpSettings]);

  const counts = useMemo(() => {
    const c = {
      files: localRows.length,
      matched: 0,
      review: 0,
      nomatch: 0,
      replacements: 0,
      duplicates: 0,
      errors: 0,
      ready: 0,
    };
    for (const r of localRows) {
      if (isReadyRow(r)) c.ready += 1;
      if (r.status === "MATCHED" || r.status === "READY") c.matched += 1;
      if (r.status === "REVIEW") c.review += 1;
      if (r.status === "NO_MATCH") c.nomatch += 1;
      if (r.status === "EXISTING_SDS" || r.status === "UPDATED_SOURCE" || r.action === "REPLACE") {
        c.replacements += 1;
      }
      if (r.status === "ALREADY_ATTACHED") c.duplicates += 1;
      if (r.status === "INVALID" || r.status === "FAILED" || r.status === "DOWNLOAD_FAILED") c.errors += 1;
    }
    return c;
  }, [localRows]);

  const visibleRows = useMemo(() => {
    return localRows.filter((r) => {
      if (filter === "all") return true;
      if (filter === "ready") return isReadyRow(r);
      if (filter === "review") return r.status === "REVIEW";
      if (filter === "nomatch") return r.status === "NO_MATCH";
      if (filter === "replacement") return r.status === "EXISTING_SDS" || r.action === "REPLACE";
      if (filter === "duplicate") return r.status === "ALREADY_ATTACHED";
      if (filter === "error") return r.status === "INVALID" || r.status === "FAILED" || r.status === "DOWNLOAD_FAILED";
      return true;
    });
  }, [localRows, filter]);

  const importSummary = useMemo(() => {
    const selected = localRows.length;
    const news = localRows.filter((r) => isReadyRow(r) && r.action === "IMPORT").length;
    const replacements = localRows.filter((r) => isReadyRow(r) && r.action === "REPLACE").length;
    const dupes = localRows.filter((r) => r.status === "ALREADY_ATTACHED").length;
    const skipped = localRows.filter((r) => r.action === "SKIP" || !isReadyRow(r)).length;
    return { selected, news, replacements, dupes, skipped };
  }, [localRows]);

  async function onFiles(fileList: FileList | File[] | null) {
    if (!fileList || ("length" in fileList && !fileList.length)) return;
    const incoming = [...fileList];
    const pdfs = incoming.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length !== incoming.length) {
      toast.error("Only PDF files are accepted in Bulk SDS Upload");
    }
    const files = pdfs.slice(0, maxFiles);
    if (!files.length) return;
    setBusy("preview");
    setError(null);
    setConfirmOpen(false);
    const payload = [];
    const nextBodies = new Map<string, { filename: string; contentType: string; base64: string }>();
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const buf = new Uint8Array(await f.arrayBuffer());
      const clientKey = `f-${i}-${f.name}`;
      const base64 = bytesToBase64(buf);
      nextBodies.set(clientKey, {
        filename: f.name,
        contentType: f.type || "application/pdf",
        base64,
      });
      payload.push({
        clientKey,
        filename: f.name,
        contentType: f.type || "application/pdf",
        base64,
      });
    }
    const res = await previewBulkSdsImportFn({ data: { files: payload } });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      return;
    }
    fileBodies.current = nextBodies;
    setMaxFiles(res.data.maxFiles ?? DEFAULT_MAX_FILES);
    setMaxBytes(res.data.maxBytes ?? DEFAULT_MAX_BYTES);
    setLocalRows(
      res.data.items.map((item) => ({
        ...item,
        brandName: item.brandName ?? null,
        selectedProductId: item.productId,
        action: defaultLocalAction(item),
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

  function assignProduct(clientKey: string, hit: SearchHit) {
    setLocalRows((prev) =>
      prev.map((r) => {
        if (r.clientKey !== clientKey) return r;
        const existing = hit.existingSds ?? null;
        const replace = Boolean(existing);
        return {
          ...r,
          selectedProductId: hit.productId,
          productId: hit.productId,
          productName: hit.name,
          sku: hit.sku,
          brandName: hit.brandName ?? null,
          matchMethod: "MANUAL",
          existingSds: existing,
          existingDocumentId: existing?.id ?? null,
          status: replace ? "EXISTING_SDS" : "READY",
          action: replace ? "REPLACE" : "IMPORT",
          message: replace
            ? "Product selected — confirming will replace the current SDS"
            : "Product selected manually",
        };
      }),
    );
  }

  function skipRow(clientKey: string) {
    setLocalRows((prev) =>
      prev.map((r) => (r.clientKey === clientKey ? { ...r, action: "SKIP" as const } : r)),
    );
  }

  async function confirmLocal() {
    const toSend = localRows.map((r) => {
      const body = fileBodies.current.get(r.clientKey);
      if (!isReadyRow(r)) {
        return {
          clientKey: r.clientKey,
          filename: r.filename,
          action: "SKIP" as const,
          productId: r.selectedProductId,
          base64: undefined,
          contentType: r.contentType,
        };
      }
      return {
        clientKey: r.clientKey,
        filename: r.filename,
        action: r.action === "REPLACE" ? ("REPLACE" as const) : ("IMPORT" as const),
        productId: r.selectedProductId,
        base64: body?.base64,
        contentType: body?.contentType ?? r.contentType,
      };
    });
    if (!toSend.some((r) => r.action !== "SKIP")) {
      toast.message("Nothing ready to import — resolve matches or skip remaining files");
      return;
    }
    setBusy("confirm");
    const res = await confirmBulkSdsImportFn({ data: { items: toSend } });
    setBusy(null);
    setConfirmOpen(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(
      `${res.data.imported} imported · ${res.data.replaced} replaced · ${res.data.failed} failed`,
    );
    setLocalRows((prev) =>
      prev.map((row) => {
        const hit = res.data.results.find((r) => r.clientKey === row.clientKey);
        if (!hit) return row;
        return {
          ...row,
          status: hit.status as RowStatus,
          message: hit.message,
          action: hit.status === "FAILED" ? row.action : "SKIP",
        };
      }),
    );
  }

  async function retryFailed() {
    const failed = localRows.filter((r) => r.status === "FAILED" && r.selectedProductId);
    if (!failed.length) {
      toast.message("No failed rows ready to retry");
      return;
    }
    setBusy("confirm");
    const res = await confirmBulkSdsImportFn({
      data: {
        items: failed.map((r) => {
          const body = fileBodies.current.get(r.clientKey);
          return {
            clientKey: r.clientKey,
            filename: r.filename,
            action: r.action === "REPLACE" ? ("REPLACE" as const) : ("IMPORT" as const),
            productId: r.selectedProductId,
            base64: body?.base64,
            contentType: body?.contentType ?? r.contentType,
          };
        }),
      },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Retry: ${res.data.imported + res.data.replaced} succeeded, ${res.data.failed} failed`);
    setLocalRows((prev) =>
      prev.map((row) => {
        const hit = res.data.results.find((r) => r.clientKey === row.clientKey);
        if (!hit) return row;
        return { ...row, status: hit.status as RowStatus, message: hit.message };
      }),
    );
  }

  function defaultAction(status: string): SpRowAction {
    if (status === "MATCHED") return "IMPORT";
    if (status === "EXISTING_SDS" || status === "UPDATED_SOURCE") return "SKIP";
    return "SKIP";
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
  }

  async function confirmSharePoint() {
    if (!sessionId || !spPage) return;
    setBusy("confirm");
    const toSend: Array<{ clientKey: string; productId: string; action: "IMPORT" | "REPLACE" | "SKIP" }> = [];
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
        if (action === "SKIP" || !item.productId) continue;
        if (
          item.status === "ALREADY_ATTACHED" ||
          item.status === "INVALID" ||
          item.status === "DOWNLOAD_FAILED" ||
          item.status === "SOURCE_MISSING"
        ) {
          continue;
        }
        toSend.push({
          clientKey: item.clientKey,
          productId: item.productId,
          action: item.status === "UPDATED_SOURCE" || action === "REPLACE" ? "REPLACE" : "IMPORT",
        });
      }
      page += 1;
    } while (page <= pageCount);
    if (!toSend.length) {
      setBusy(null);
      toast.message("Nothing selected to import");
      return;
    }
    const res = await confirmSharePointSdsImportFn({ data: { sessionId, items: toSend } });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Imported ${res.data.imported}, replaced ${res.data.replaced}, failed ${res.data.failed}`);
    await loadSpPage(sessionId, spPageNum);
    await loadSpSettings();
  }

  return (
    <div>
      <PanelHeader
        title="Bulk SDS Upload"
        sub="Drop Safety Data Sheet PDFs, review automatic product matches, then confirm. New SDS becomes current; the previous current SDS is archived on replace."
        crumbs={[
          { label: "Products", to: ROUTES.adminProducts },
          { label: "Bulk SDS Upload" },
        ]}
        actions={
          <Link
            to={ROUTES.adminProducts}
            className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase inline-flex items-center"
          >
            Products
          </Link>
        }
      />

      <div className="space-y-5 p-4 sm:p-6">
        {error ? <p className="text-[13px] text-bad">{error}</p> : null}

        <section
          className={cn(
            "rounded-lg border-2 border-dashed px-4 py-10 text-center sm:px-8",
            dragOver ? "border-primary bg-primary/5" : "border-border bg-surface/30",
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void onFiles(e.dataTransfer.files);
          }}
        >
          <p className="font-display text-lg font-semibold uppercase">Drop SDS PDF files here</p>
          <p className="mt-2 text-[13px] text-steel">
            PDF only · up to {maxFiles} files · {formatMb(maxBytes)} each. Matching uses SKU in the
            filename, then product name. Ambiguous files stay in Needs review.
          </p>
          <button
            type="button"
            className="mt-4 h-10 rounded-md bg-primary px-5 text-[12px] font-semibold uppercase text-primary-foreground disabled:opacity-50"
            disabled={busy === "preview"}
            onClick={() => fileRef.current?.click()}
          >
            {busy === "preview" ? "Validating…" : "Choose files"}
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
        </section>

        {localRows.length ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
              {[
                ["Files selected", counts.files],
                ["Matched", counts.matched],
                ["Needs review", counts.review],
                ["No match", counts.nomatch],
                ["Replacements", counts.replacements],
                ["Duplicates", counts.duplicates],
                ["Errors", counts.errors],
                ["Ready to import", counts.ready],
              ].map(([label, n]) => (
                <div key={label} className="rounded-md border border-border px-3 py-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-steel">{label}</div>
                  <div className="num text-lg font-semibold">{n}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["all", "All"],
                  ["ready", "Ready"],
                  ["review", "Needs review"],
                  ["nomatch", "No match"],
                  ["replacement", "Replacement"],
                  ["duplicate", "Duplicate"],
                  ["error", "Error"],
                ] as Array<[FilterKey, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    "h-8 rounded-md border px-3 text-[11px] font-semibold uppercase",
                    filter === key ? "border-primary bg-primary/10" : "border-border",
                  )}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase disabled:opacity-50"
                disabled={counts.ready === 0}
                onClick={() => setConfirmOpen(true)}
              >
                Import all ready
              </button>
              {localRows.some((r) => r.status === "FAILED") ? (
                <button
                  type="button"
                  className="h-9 rounded-md border border-border px-3 text-[11px] font-semibold uppercase"
                  disabled={busy !== null}
                  onClick={() => void retryFailed()}
                >
                  Retry failed
                </button>
              ) : null}
            </div>

            <LocalPreviewTable
              rows={visibleRows}
              searchQ={searchQ}
              searchHits={searchHits}
              onSearch={(clientKey, q) => void searchProduct(clientKey, q)}
              onSelectProduct={assignProduct}
              onSkip={skipRow}
              onAction={(clientKey, action) => {
                setLocalRows((prev) =>
                  prev.map((r) => (r.clientKey === clientKey ? { ...r, action } : r)),
                );
              }}
            />

            <section className="rounded-lg border border-border bg-surface/30 p-4">
              <h3 className="font-display text-base font-semibold uppercase">Import summary</h3>
              <p className="mt-2 text-[13px]">
                {importSummary.selected} PDF{importSummary.selected === 1 ? "" : "s"} selected
              </p>
              <ul className="mt-2 space-y-1 text-[13px] text-steel">
                <li>{importSummary.news} new SDS documents</li>
                <li>{importSummary.replacements} SDS replacements</li>
                <li>{counts.duplicates} duplicates skipped</li>
                <li>
                  {localRows.filter((r) => r.action === "SKIP" && r.status !== "ALREADY_ATTACHED").length}{" "}
                  unmatched or skipped
                </li>
              </ul>
              {!confirmOpen ? (
                <button
                  type="button"
                  className="mt-4 h-10 rounded-md bg-primary px-4 text-[12px] font-semibold uppercase text-primary-foreground disabled:opacity-50"
                  disabled={busy !== null || counts.ready === 0}
                  onClick={() => setConfirmOpen(true)}
                >
                  Review import
                </button>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="h-10 rounded-md bg-primary px-4 text-[12px] font-semibold uppercase text-primary-foreground disabled:opacity-50"
                    disabled={busy === "confirm"}
                    onClick={() => void confirmLocal()}
                  >
                    {busy === "confirm" ? "Importing…" : "Confirm import"}
                  </button>
                  <button
                    type="button"
                    className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase"
                    disabled={busy !== null}
                    onClick={() => setConfirmOpen(false)}
                  >
                    Back
                  </button>
                </div>
              )}
              <p className="mt-2 text-[12px] text-steel">
                Nothing is stored until you confirm. Unresolved files are not imported.
              </p>
            </section>
          </>
        ) : null}

        {sharePointEnabled ? (
          <section className="rounded-lg border border-border p-4">
            <button
              type="button"
              className="text-[12px] font-semibold uppercase text-steel hover:text-foreground"
              onClick={() => setShowSharePoint((v) => !v)}
            >
              {showSharePoint ? "Hide SharePoint import" : "SharePoint import (advanced)"}
            </button>
            {showSharePoint ? (
              <div className="mt-4 space-y-4">
                <p className="text-[13px] text-steel">
                  Microsoft Graph is enabled for this environment. Manual bulk upload remains the
                  supported production workflow.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase disabled:opacity-50"
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
                {showSpConfig ? (
                  <SharePointSdsSettingsPanel compact onChanged={(s) => setSpSettings(s)} />
                ) : null}
                {spPage ? (
                  <>
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
                      onSelectProduct={(clientKey, productId) => void selectSpProduct(clientKey, productId)}
                    />
                    <button
                      type="button"
                      className="h-10 rounded-md bg-primary px-4 text-[12px] font-semibold uppercase text-primary-foreground disabled:opacity-50"
                      disabled={busy === "confirm"}
                      onClick={() => void confirmSharePoint()}
                    >
                      Confirm SharePoint import
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </section>
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
  onSkip,
  onAction,
}: {
  rows: LocalRow[];
  searchQ: Record<string, string>;
  searchHits: Record<string, SearchHit[]>;
  onSearch: (clientKey: string, q: string) => void;
  onSelectProduct: (clientKey: string, c: SearchHit) => void;
  onSkip: (clientKey: string) => void;
  onAction: (clientKey: string, action: "IMPORT" | "REPLACE" | "SKIP") => void;
}) {
  if (!rows.length) {
    return <p className="text-[13px] text-steel">No files in this filter.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[960px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase text-steel">
            <th className="px-3 py-2">File</th>
            <th className="px-3 py-2">Matched product</th>
            <th className="px-3 py-2">SKU</th>
            <th className="px-3 py-2">Match method</th>
            <th className="px-3 py-2">Existing SDS</th>
            <th className="px-3 py-2">Action</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const needsPick =
              (row.status === "NO_MATCH" || row.status === "REVIEW" || !row.selectedProductId) &&
              row.status !== "INVALID" &&
              row.status !== "ALREADY_ATTACHED" &&
              row.status !== "IMPORTED" &&
              row.status !== "REPLACED";
            return (
              <tr key={row.clientKey} className="border-b border-border/60 align-top">
                <td className="px-3 py-2">
                  <div className="font-medium">{row.filename}</div>
                  <div className="text-[11px] text-steel">{row.message}</div>
                </td>
                <td className="px-3 py-2">
                  {row.productName ? (
                    <div>
                      <div>{row.productName}</div>
                      {row.brandName ? <div className="text-[11px] text-steel">{row.brandName}</div> : null}
                    </div>
                  ) : (
                    "—"
                  )}
                  {needsPick ? (
                    <div className="mt-2 space-y-1">
                      <input
                        className="h-8 w-full max-w-xs rounded border border-border bg-background px-2 text-[12px]"
                        placeholder="Search SKU or product name…"
                        value={searchQ[row.clientKey] ?? ""}
                        onChange={(e) => onSearch(row.clientKey, e.target.value)}
                      />
                      {(searchHits[row.clientKey] ?? row.candidates).slice(0, 6).map((c) => (
                        <button
                          key={c.productId}
                          type="button"
                          className="block w-full max-w-xs truncate rounded px-2 py-1 text-left text-[12px] hover:bg-secondary/60"
                          onClick={() =>
                            onSelectProduct(row.clientKey, {
                              productId: c.productId,
                              name: c.name,
                              sku: c.sku,
                              brandName: "brandName" in c ? (c.brandName as string | null) : null,
                              existingSds:
                                "existingSds" in c
                                  ? ((c as SearchHit).existingSds ?? null)
                                  : null,
                            })
                          }
                        >
                          {c.sku} — {c.name}
                          {"brandName" in c && c.brandName ? ` · ${c.brandName}` : ""}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 tabular-nums">{row.sku ?? "—"}</td>
                <td className="px-3 py-2">{matchMethodLabel(row.matchMethod)}</td>
                <td className="px-3 py-2">
                  {row.existingSds ? (
                    <div>
                      <div>{row.existingSds.filename}</div>
                      <div className="text-[11px] text-steel">
                        Uploaded {formatDate(row.existingSds.uploadedAt) ?? "—"}
                      </div>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
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
                      <option value="IMPORT">Import new</option>
                      <option value="REPLACE">Replace current SDS</option>
                      <option value="SKIP">Skip file</option>
                    </select>
                    {row.status !== "IMPORTED" && row.status !== "REPLACED" ? (
                      <button
                        type="button"
                        className="text-left text-[11px] uppercase text-steel hover:text-foreground"
                        onClick={() => onSkip(row.clientKey)}
                      >
                        Skip file
                      </button>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge>
                </td>
              </tr>
            );
          })}
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
  searchHits: Record<string, SearchHit[]>;
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
                <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge>
              </td>
              <td className="px-3 py-2">
                <select
                  className="h-8 rounded border border-border bg-background px-2 text-[12px]"
                  value={actions[row.clientKey] ?? "SKIP"}
                  disabled={
                    row.status === "INVALID" ||
                    row.status === "ALREADY_ATTACHED" ||
                    row.status === "SOURCE_MISSING" ||
                    row.status === "DOWNLOAD_FAILED"
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
