import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import {
  archiveProductDocumentFn,
  listProductDocumentsFn,
  setProductSdsRequirementFn,
  uploadProductDocumentFn,
} from "@/server/phase2/fns";
import {
  SDS_COVERAGE_STATUS_LABEL,
  SDS_NOT_REQUIRED_REASON_HINTS,
} from "@/domain/sds-coverage";

type DocsData = Extract<Awaited<ReturnType<typeof listProductDocumentsFn>>, { ok: true }>["data"];
type DocRow = NonNullable<DocsData["currentSds"]>;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function buttonClass(primary = false) {
  return cn(
    "h-9 rounded-md px-3 text-[11px] font-semibold uppercase tracking-wide disabled:opacity-50",
    primary
      ? "bg-primary text-primary-foreground"
      : "border border-border bg-surface/40 text-foreground hover:bg-surface",
  );
}

function DocCard({
  doc,
  onArchive,
  busy,
}: {
  doc: DocRow;
  onArchive: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-4">
      <p className="font-medium text-[14px]">{doc.title}</p>
      <p className="mt-1 text-[12px] text-steel">
        PDF
        {doc.revision ? ` · Revision: ${doc.revision}` : ""}
        {doc.documentDate ? ` · ${formatDate(doc.documentDate)}` : ""}
        {doc.updatedAt ? ` · Updated: ${formatDate(doc.updatedAt)}` : ""}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={doc.viewUrl} target="_blank" rel="noreferrer" className={buttonClass()}>
          View
        </a>
        <a href={doc.downloadUrl} className={buttonClass()}>
          Download
        </a>
        <button type="button" className={buttonClass()} disabled={busy} onClick={onArchive}>
          Archive
        </button>
      </div>
    </div>
  );
}

export function ProductDocumentsPanel({
  productId,
  autoOpenUpload = false,
}: {
  productId: string;
  autoOpenUpload?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<DocsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [replaceMode, setReplaceMode] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [revision, setRevision] = useState("");
  const [documentDate, setDocumentDate] = useState("");
  const [notes, setNotes] = useState("");
  const [docType, setDocType] = useState("SAFETY_DATA_SHEET");
  const [pendingFile, setPendingFile] = useState<{
    filename: string;
    contentType: string;
    base64: string;
  } | null>(null);
  const [notRequiredOpen, setNotRequiredOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonHint, setReasonHint] = useState("");
  const autoOpened = useRef(false);

  const load = useCallback(async () => {
    const res = await listProductDocumentsFn({ data: { productId } });
    if (!res.ok) {
      setError(res.error);
      setData(null);
      return;
    }
    setError(null);
    setData(res.data);
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!autoOpenUpload || autoOpened.current || !data) return;
    if (data.currentSds) return;
    autoOpened.current = true;
    setReplaceMode(false);
    setDocType("SAFETY_DATA_SHEET");
    fileRef.current?.click();
  }, [autoOpenUpload, data]);

  async function onPickFile(file: File | null, asReplace: boolean) {
    if (!file) return;
    setReplaceMode(asReplace);
    setFormOpen(true);
    if (asReplace) setDocType("SAFETY_DATA_SHEET");
    const buf = new Uint8Array(await file.arrayBuffer());
    setPendingFile({
      filename: file.name,
      contentType: file.type || "application/pdf",
      base64: bytesToBase64(buf),
    });
    if (!title && data?.productName) {
      setTitle(`${data.productName} Safety Data Sheet`);
    }
  }

  async function submitUpload() {
    if (!pendingFile) return;
    setBusy("upload");
    const res = await uploadProductDocumentFn({
      data: {
        productId,
        type: docType,
        title: title.trim() || null,
        filename: pendingFile.filename,
        contentType: pendingFile.contentType,
        base64: pendingFile.base64,
        revision: revision.trim() || null,
        documentDate: documentDate || null,
        notes: notes.trim() || null,
        replaceExisting: replaceMode,
      },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(replaceMode ? "Safety Data Sheet replaced" : "Document uploaded");
    setFormOpen(false);
    setPendingFile(null);
    setReplaceMode(false);
    setRevision("");
    setDocumentDate("");
    setNotes("");
    await load();
  }

  async function archive(documentId: string) {
    setBusy(documentId);
    const res = await archiveProductDocumentFn({ data: { documentId } });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Document archived");
    await load();
  }

  async function markNotRequired() {
    setBusy("not-required");
    const res = await setProductSdsRequirementFn({
      data: {
        productIds: [productId],
        requirement: "NOT_REQUIRED",
        reason: reason.trim() || reasonHint || null,
        confirm: true,
      },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("SDS marked not required");
    setNotRequiredOpen(false);
    await load();
  }

  async function restoreRequirement() {
    setBusy("require");
    const res = await setProductSdsRequirementFn({
      data: { productIds: [productId], requirement: "REQUIRED", confirm: true },
    });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("SDS requirement restored");
    await load();
  }

  if (!data && !error) {
    return <p className="text-[13px] text-steel">Loading documents…</p>;
  }
  if (error) {
    return <p className="text-[13px] text-bad">{error}</p>;
  }
  if (!data) return null;

  return (
    <div className="space-y-8">
      <section aria-labelledby="sds-heading">
        <h3 id="sds-heading" className="font-display text-base font-semibold uppercase">
          Documents &amp; Safety
        </h3>
        <p className="mt-1 text-[12px] text-steel">
          Safety Data Sheets are stored in Automotive Brands object storage and shown on the public
          product page when current.
        </p>

        <div className="mt-4 space-y-3">
          <h4 className="text-[12px] font-bold uppercase tracking-wide text-steel">
            Safety Data Sheet
          </h4>
          {data.sdsCoverage ? (
            <div className="rounded-md border border-border bg-surface/30 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">SDS status</p>
              <p className="mt-1 text-[14px] font-medium">
                {SDS_COVERAGE_STATUS_LABEL[
                  data.sdsCoverage.status as keyof typeof SDS_COVERAGE_STATUS_LABEL
                ] ?? data.sdsCoverage.status}
              </p>
              {data.sdsCoverage.status === "ARCHIVED_ONLY" ? (
                <p className="mt-1 text-[12px] text-warn">
                  Archived SDS available — current SDS required. Do not restore an archived sheet
                  automatically; it may be obsolete.
                </p>
              ) : null}
              {data.sdsCoverage.status === "NOT_REQUIRED" ? (
                <div className="mt-1 text-[12px] text-steel">
                  <p>Internal classification only — not shown on the public product page.</p>
                  {data.sdsCoverage.notRequiredReason ? (
                    <p className="mt-1">Reason: {data.sdsCoverage.notRequiredReason}</p>
                  ) : null}
                  {data.sdsCoverage.requirementUpdatedAt ? (
                    <p className="mt-1">
                      Changed {formatDate(data.sdsCoverage.requirementUpdatedAt)}
                      {data.sdsCoverage.requirementUpdatedBy?.name
                        ? ` by ${data.sdsCoverage.requirementUpdatedBy.name}`
                        : data.sdsCoverage.requirementUpdatedBy?.email
                          ? ` by ${data.sdsCoverage.requirementUpdatedBy.email}`
                          : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {data.sdsCoverage?.status === "NOT_REQUIRED" ? (
            <div className="rounded-md border border-dashed border-border px-4 py-5">
              <p className="text-[13px] text-steel">SDS is marked not required for this product.</p>
              <button
                type="button"
                className={cn(buttonClass(true), "mt-3")}
                disabled={busy === "require"}
                onClick={() => void restoreRequirement()}
              >
                Require SDS
              </button>
            </div>
          ) : data.currentSds ? (
            <>
              <DocCard
                doc={data.currentSds}
                busy={busy === data.currentSds.id}
                onArchive={() => void archive(data.currentSds!.id)}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass(true)}
                  onClick={() => {
                    setReplaceMode(true);
                    fileRef.current?.click();
                  }}
                >
                  Replace SDS
                </button>
              </div>
            </>
          ) : (
            <div className="rounded-md border border-dashed border-border px-4 py-5">
              <p className="text-[13px] text-steel">
                {data.sdsCoverage?.status === "ARCHIVED_ONLY"
                  ? "No current Safety Data Sheet. Archived SDS is available for review."
                  : "No Safety Data Sheet attached."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass(true)}
                  onClick={() => {
                    setReplaceMode(false);
                    setDocType("SAFETY_DATA_SHEET");
                    fileRef.current?.click();
                  }}
                >
                  Upload SDS
                </button>
                <button
                  type="button"
                  className={buttonClass()}
                  onClick={() => {
                    setReason("");
                    setReasonHint("");
                    setNotRequiredOpen(true);
                  }}
                >
                  Mark SDS not required
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="other-docs-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4
            id="other-docs-heading"
            className="text-[12px] font-bold uppercase tracking-wide text-steel"
          >
            Other Documents
          </h4>
          <button
            type="button"
            className={buttonClass()}
            onClick={() => {
              setReplaceMode(false);
              setDocType("TECHNICAL_DATA_SHEET");
              setFormOpen(true);
              fileRef.current?.click();
            }}
          >
            + Add Document
          </button>
        </div>
        {data.otherDocuments.length ? (
          <div className="mt-3 space-y-3">
            {data.otherDocuments.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                busy={busy === doc.id}
                onArchive={() => void archive(doc.id)}
              />
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-steel">No other current documents.</p>
        )}
      </section>

      {data.archived.length ? (
        <section>
          <h4 className="text-[12px] font-bold uppercase tracking-wide text-steel">Archived</h4>
          <ul className="mt-2 space-y-1 text-[12px] text-steel">
            {data.archived.map((d) => (
              <li key={d.id}>
                {d.typeLabel}: {d.title}{" "}
                <a className="underline" href={d.viewUrl} target="_blank" rel="noreferrer">
                  View
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          e.target.value = "";
          void onPickFile(file, replaceMode);
        }}
      />

      {formOpen && pendingFile ? (
        <div className="rounded-md border border-border bg-surface/40 p-4 space-y-3">
          <h4 className="font-display text-sm font-semibold uppercase">
            {replaceMode ? "Replace Safety Data Sheet" : "Upload document"}
          </h4>
          <p className="text-[12px] text-steel">File: {pendingFile.filename}</p>
          {!replaceMode ? (
            <label className="block text-[12px]">
              <span className="text-steel">Document type</span>
              <select
                className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              >
                {data.typeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-[12px]">
            <span className="text-steel">Title</span>
            <input
              className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[12px]">
              <span className="text-steel">Revision / Version (optional)</span>
              <input
                className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3"
                value={revision}
                onChange={(e) => setRevision(e.target.value)}
              />
            </label>
            <label className="block text-[12px]">
              <span className="text-steel">Document date (optional)</span>
              <input
                type="date"
                className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3"
                value={documentDate}
                onChange={(e) => setDocumentDate(e.target.value)}
              />
            </label>
          </div>
          <label className="block text-[12px]">
            <span className="text-steel">Notes (internal, optional)</span>
            <textarea
              className="mt-1 min-h-20 w-full rounded-md border border-border bg-background px-3 py-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass(true)}
              disabled={busy === "upload"}
              onClick={() => void submitUpload()}
            >
              {replaceMode ? "Confirm replacement" : "Upload"}
            </button>
            <button
              type="button"
              className={buttonClass()}
              onClick={() => {
                setFormOpen(false);
                setPendingFile(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {notRequiredOpen ? (
        <div className="rounded-md border border-border bg-surface/40 p-4 space-y-3">
          <h4 className="font-display text-sm font-semibold uppercase">Mark SDS not required</h4>
          <p className="text-[12px] text-steel">
            Internal classification only. You remain responsible for deciding whether an SDS is required.
          </p>
          <label className="block text-[12px]">
            <span className="text-steel">Reason hint (optional)</span>
            <select
              className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3"
              value={reasonHint}
              onChange={(e) => setReasonHint(e.target.value)}
            >
              <option value="">Choose a note…</option>
              {SDS_NOT_REQUIRED_REASON_HINTS.map((hint) => (
                <option key={hint} value={hint}>
                  {hint}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[12px]">
            <span className="text-steel">Internal reason (optional)</span>
            <textarea
              className="mt-1 min-h-20 w-full rounded-md border border-border bg-background px-3 py-2"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={240}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass(true)}
              disabled={busy === "not-required"}
              onClick={() => void markNotRequired()}
            >
              Confirm
            </button>
            <button type="button" className={buttonClass()} onClick={() => setNotRequiredOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
