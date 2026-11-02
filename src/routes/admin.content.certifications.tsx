import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { MediaPicker, type CmsMediaListItem } from "@/components/cms/MediaPicker";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import { CERTIFICATION_DEFAULT_ALT } from "@/domain/certifications";
import { guardStaffPage } from "@/lib/guard-staff-page";
import { cn } from "@/lib/utils";
import {
  archiveCertificationFn,
  attachCertificationBadgeFn,
  deleteCertificationFn,
  listCertificationsFn,
  removeCertificationBadgeFn,
  removeCertificationPdfFn,
  uploadCertificationPdfFn,
  upsertCertificationFn,
} from "@/server/phase2/fns";

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  });
}

export const Route = createFileRoute("/admin/content/certifications")({
  beforeLoad: ({ location }) =>
    guardStaffPage("cms.certifications.view", location.href, "/admin"),
  head: () => ({ meta: [{ title: "Certifications — Automotive Brands Admin" }] }),
  component: AdminCertifications,
});

type CertificationRow = {
  id: string;
  title: string;
  issuingOrganisation: string;
  certificateNumber: string | null;
  standards: string[];
  scope: string | null;
  description: string | null;
  imageMediaId: string | null;
  imageAltText: string | null;
  image: { mediaId: string; src: string; alt: string; width: number | null; height: number | null } | null;
  hasCertificatePdf: boolean;
  certificatePdfFilename: string | null;
  certificatePdfUrl: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  published: boolean;
  archived: boolean;
  showOnHomepage: boolean;
  showInFooter: boolean;
  showOnAboutPage: boolean;
  displayOrder: number;
  publiclyVisible: boolean;
};

type Draft = {
  id?: string;
  title: string;
  issuingOrganisation: string;
  certificateNumber: string;
  standardsText: string;
  scope: string;
  description: string;
  imageMediaId: string | null;
  imageAltText: string;
  imageSrc: string | null;
  issueDate: string;
  expiryDate: string;
  published: boolean;
  archived: boolean;
  showOnHomepage: boolean;
  showInFooter: boolean;
  showOnAboutPage: boolean;
  displayOrder: number;
  hasCertificatePdf: boolean;
  certificatePdfFilename: string | null;
  certificatePdfUrl: string | null;
};

function emptyDraft(): Draft {
  return {
    title: "",
    issuingOrganisation: "",
    certificateNumber: "",
    standardsText: "",
    scope: "",
    description: "",
    imageMediaId: null,
    imageAltText: CERTIFICATION_DEFAULT_ALT,
    imageSrc: null,
    issueDate: "",
    expiryDate: "",
    published: false,
    archived: false,
    showOnHomepage: true,
    showInFooter: true,
    showOnAboutPage: true,
    displayOrder: 0,
    hasCertificatePdf: false,
    certificatePdfFilename: null,
    certificatePdfUrl: null,
  };
}

function toDraft(row: CertificationRow): Draft {
  return {
    id: row.id,
    title: row.title,
    issuingOrganisation: row.issuingOrganisation,
    certificateNumber: row.certificateNumber ?? "",
    standardsText: row.standards.join("\n"),
    scope: row.scope ?? "",
    description: row.description ?? "",
    imageMediaId: row.imageMediaId,
    imageAltText: row.imageAltText || CERTIFICATION_DEFAULT_ALT,
    imageSrc: row.image?.src ?? null,
    issueDate: row.issueDate ?? "",
    expiryDate: row.expiryDate ?? "",
    published: row.published,
    archived: row.archived,
    showOnHomepage: row.showOnHomepage,
    showInFooter: row.showInFooter,
    showOnAboutPage: row.showOnAboutPage,
    displayOrder: row.displayOrder,
    hasCertificatePdf: row.hasCertificatePdf,
    certificatePdfFilename: row.certificatePdfFilename,
    certificatePdfUrl: row.certificatePdfUrl,
  };
}

function AdminCertifications() {
  const [items, setItems] = useState<CertificationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [visibility, setVisibility] = useState<"all" | "published" | "draft" | "archived">("all");

  const reload = useCallback(() => {
    void listCertificationsFn({ data: { visibility } }).then((result) => {
      if (!result.ok) {
        setError(result.error);
        setItems([]);
        return;
      }
      setError(null);
      setItems(result.data.items as CertificationRow[]);
    });
  }, [visibility]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    const result = await upsertCertificationFn({
      data: {
        id: draft.id ?? null,
        title: draft.title,
        issuingOrganisation: draft.issuingOrganisation,
        certificateNumber: draft.certificateNumber || null,
        standards: draft.standardsText,
        scope: draft.scope || null,
        description: draft.description || null,
        imageMediaId: draft.imageMediaId,
        imageAltText: draft.imageAltText || CERTIFICATION_DEFAULT_ALT,
        issueDate: draft.issueDate || null,
        expiryDate: draft.expiryDate || null,
        published: draft.published,
        archived: draft.archived,
        showOnHomepage: draft.showOnHomepage,
        showInFooter: draft.showInFooter,
        showOnAboutPage: draft.showOnAboutPage,
        displayOrder: draft.displayOrder,
      },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(draft.id ? "Certification saved" : "Certification created");
    setDraft(toDraft(result.data as CertificationRow));
    reload();
  }

  async function onPickMedia(media: CmsMediaListItem) {
    if (!draft?.id) {
      setDraft({
        ...draft!,
        imageMediaId: media.id,
        imageSrc: media.src,
        imageAltText: draft?.imageAltText || media.altText || CERTIFICATION_DEFAULT_ALT,
      });
      return;
    }
    setBusy(true);
    const result = await attachCertificationBadgeFn({
      data: {
        certificationId: draft.id,
        mediaId: media.id,
        altText: draft.imageAltText || media.altText || CERTIFICATION_DEFAULT_ALT,
      },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Badge attached");
    setDraft(toDraft(result.data as CertificationRow));
    reload();
  }

  async function onUploadPdf(file: File | null) {
    if (!file || !draft?.id) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Choose a PDF certificate");
      return;
    }
    setBusy(true);
    try {
      const bodyBase64 = await fileToBase64(file);
      const result = await uploadCertificationPdfFn({
        data: {
          certificationId: draft.id,
          filename: file.name,
          contentType: file.type || "application/pdf",
          bodyBase64,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Certificate PDF uploaded");
      setDraft(toDraft(result.data as CertificationRow));
      reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PDF upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PanelHeader
        title="Certifications & Accreditations"
        sub="Manage official badges for the homepage, footer and About pages. Leave unpublished until the badge is reviewed."
      />
      <div className="space-y-4 px-4 py-4 sm:px-6">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <select
            className={cn(inputClass, "h-9 w-auto")}
            value={visibility}
            onChange={(event) =>
              setVisibility(event.target.value as "all" | "published" | "draft" | "archived")
            }
            aria-label="Visibility filter"
          >
            <option value="all">All</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
            <option value="archived">Archived</option>
          </select>
          <button
            type="button"
            className="h-9 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground"
            onClick={() => setDraft(emptyDraft())}
          >
            Add Certification
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] font-bold uppercase tracking-wide text-steel">
                <th className="py-2 pr-3">Certification</th>
                <th className="py-2 pr-3">Organisation</th>
                <th className="py-2 pr-3">Badge</th>
                <th className="py-2 pr-3">Placement</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Order</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="py-2 pr-3">
                    <button
                      type="button"
                      className="text-left font-medium text-primary hover:underline"
                      onClick={() => setDraft(toDraft(row))}
                    >
                      {row.title}
                    </button>
                    {row.certificateNumber ? (
                      <div className="text-[11px] text-steel">{row.certificateNumber}</div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">{row.issuingOrganisation}</td>
                  <td className="py-2 pr-3">
                    {row.image ? (
                      <img
                        src={row.image.src}
                        alt=""
                        className="h-10 w-auto rounded bg-white object-contain p-1"
                      />
                    ) : (
                      <span className="text-steel">No badge</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-[12px] text-steel">
                    {[
                      row.showOnHomepage ? "Homepage" : null,
                      row.showInFooter ? "Footer" : null,
                      row.showOnAboutPage ? "About" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge
                      tone={row.archived ? "neutral" : row.publiclyVisible ? "good" : "warn"}
                    >
                      {row.archived ? "Archived" : row.publiclyVisible ? "Live" : "Draft"}
                    </StatusBadge>
                  </td>
                  <td className="py-2">{row.displayOrder}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Edit certification" : "Add certification"}
        width="lg"
      >
        {draft ? (
          <form className="space-y-4 p-4" onSubmit={(event) => void save(event)}>
            <p className="text-[12px] text-steel">
              Do not invent issue dates, expiry dates or scope. Leave unknown fields blank. Publish only after the
              official badge has been uploaded and reviewed.
            </p>
            <Field label="Title">
              <input
                className={inputClass}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                required
              />
            </Field>
            <Field label="Issuing organisation">
              <input
                className={inputClass}
                value={draft.issuingOrganisation}
                onChange={(event) => setDraft({ ...draft, issuingOrganisation: event.target.value })}
                required
              />
            </Field>
            <Field label="Certificate number">
              <input
                className={inputClass}
                value={draft.certificateNumber}
                onChange={(event) => setDraft({ ...draft, certificateNumber: event.target.value })}
              />
            </Field>
            <Field label="Standards (one per line)">
              <textarea
                className={cn(inputClass, "min-h-20 py-2")}
                value={draft.standardsText}
                onChange={(event) => setDraft({ ...draft, standardsText: event.target.value })}
              />
            </Field>
            <Field label="Description">
              <textarea
                className={cn(inputClass, "min-h-28 py-2")}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </Field>
            <Field label="Scope (optional, verified only)">
              <textarea
                className={cn(inputClass, "min-h-20 py-2")}
                value={draft.scope}
                onChange={(event) => setDraft({ ...draft, scope: event.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Issue date">
                <input
                  type="date"
                  className={inputClass}
                  value={draft.issueDate}
                  onChange={(event) => setDraft({ ...draft, issueDate: event.target.value })}
                />
              </Field>
              <Field label="Expiry date">
                <input
                  type="date"
                  className={inputClass}
                  value={draft.expiryDate}
                  onChange={(event) => setDraft({ ...draft, expiryDate: event.target.value })}
                />
              </Field>
            </div>
            <Field label="Display order">
              <input
                type="number"
                min={0}
                className={inputClass}
                value={draft.displayOrder}
                onChange={(event) =>
                  setDraft({ ...draft, displayOrder: Number(event.target.value) || 0 })
                }
              />
            </Field>
            <Field label="Badge image alt text">
              <input
                className={inputClass}
                value={draft.imageAltText}
                onChange={(event) => setDraft({ ...draft, imageAltText: event.target.value })}
              />
            </Field>
            <div className="rounded-md border border-border p-3">
              <div className="text-[12px] font-bold uppercase tracking-wide text-steel">Badge</div>
              {draft.imageSrc ? (
                <img
                  src={draft.imageSrc}
                  alt={draft.imageAltText}
                  className="mt-3 h-24 w-auto rounded bg-white object-contain p-2"
                />
              ) : (
                <p className="mt-2 text-sm text-steel">No badge uploaded yet.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="h-9 rounded-md border border-border px-3 text-[12px] font-bold uppercase"
                  onClick={() => setPickerOpen(true)}
                  disabled={busy}
                >
                  {draft.imageSrc ? "Replace badge" : "Upload / select badge"}
                </button>
                {draft.id && draft.imageMediaId ? (
                  <button
                    type="button"
                    className="h-9 rounded-md border border-border px-3 text-[12px] font-bold uppercase"
                    disabled={busy}
                    onClick={() => {
                      void removeCertificationBadgeFn({ data: { id: draft.id } }).then((result) => {
                        if (!result.ok) {
                          toast.error(result.error);
                          return;
                        }
                        toast.success("Badge removed");
                        setDraft(toDraft(result.data as CertificationRow));
                        reload();
                      });
                    }}
                  >
                    Remove badge
                  </button>
                ) : null}
              </div>
              {!draft.id ? (
                <p className="mt-2 text-[12px] text-steel">
                  You can select a badge now; it is saved when you click Save. Upload the official Citation badge —
                  do not recreate or redraw it.
                </p>
              ) : null}
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-[12px] font-bold uppercase tracking-wide text-steel">
                Certificate PDF (optional)
              </div>
              {draft.hasCertificatePdf ? (
                <p className="mt-2 text-sm">
                  {draft.certificatePdfFilename ?? "certificate.pdf"}{" "}
                  {draft.certificatePdfUrl ? (
                    <a
                      href={draft.certificatePdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-bold text-primary hover:underline"
                    >
                      View
                    </a>
                  ) : null}
                </p>
              ) : (
                <p className="mt-2 text-sm text-steel">No PDF uploaded.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-3 text-[12px] font-bold uppercase">
                  {draft.hasCertificatePdf ? "Replace PDF" : "Upload PDF"}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    disabled={busy || !draft.id}
                    onChange={(event) => void onUploadPdf(event.target.files?.[0] ?? null)}
                  />
                </label>
                {draft.id && draft.hasCertificatePdf ? (
                  <button
                    type="button"
                    className="h-9 rounded-md border border-border px-3 text-[12px] font-bold uppercase"
                    disabled={busy}
                    onClick={() => {
                      void removeCertificationPdfFn({ data: { id: draft.id } }).then((result) => {
                        if (!result.ok) {
                          toast.error(result.error);
                          return;
                        }
                        toast.success("PDF removed");
                        setDraft(toDraft(result.data as CertificationRow));
                        reload();
                      });
                    }}
                  >
                    Remove PDF
                  </button>
                ) : null}
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-[12px] font-bold uppercase tracking-wide text-steel">
                Visibility
              </legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.showOnHomepage}
                  onChange={(event) => setDraft({ ...draft, showOnHomepage: event.target.checked })}
                />
                Homepage
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.showInFooter}
                  onChange={(event) => setDraft({ ...draft, showInFooter: event.target.checked })}
                />
                Footer
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.showOnAboutPage}
                  onChange={(event) => setDraft({ ...draft, showOnAboutPage: event.target.checked })}
                />
                About / Why Us
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.published}
                  onChange={(event) => setDraft({ ...draft, published: event.target.checked })}
                />
                Published (requires badge)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.archived}
                  onChange={(event) => setDraft({ ...draft, archived: event.target.checked })}
                />
                Archived
              </label>
            </fieldset>
            {draft.imageSrc ? (
              <div className="rounded-md border border-dashed border-border bg-surface/40 p-4">
                <div className="text-[11px] font-bold uppercase tracking-wide text-steel">Preview</div>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <img
                    src={draft.imageSrc}
                    alt={draft.imageAltText}
                    className="h-20 w-auto rounded bg-white object-contain p-2"
                  />
                  <div>
                    <div className="font-display text-lg font-semibold uppercase">{draft.title || "Title"}</div>
                    <div className="text-[13px] text-steel">
                      {draft.issuingOrganisation || "Issuing organisation"}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="submit"
                disabled={busy}
                className="h-10 rounded-md bg-primary px-4 text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
              >
                Save
              </button>
              {draft.id ? (
                <>
                  <button
                    type="button"
                    className="h-10 rounded-md border border-border px-4 text-[13px] font-bold uppercase"
                    disabled={busy}
                    onClick={() => {
                      void archiveCertificationFn({ data: { id: draft.id } }).then((result) => {
                        if (!result.ok) {
                          toast.error(result.error);
                          return;
                        }
                        toast.success("Certification archived");
                        setDraft(null);
                        reload();
                      });
                    }}
                  >
                    Archive
                  </button>
                  <button
                    type="button"
                    className="h-10 rounded-md border border-destructive/40 px-4 text-[13px] font-bold uppercase text-destructive disabled:opacity-50"
                    disabled={busy || (draft.published && !draft.archived)}
                    onClick={() => setDeleteConfirmOpen(true)}
                    title={
                      draft.published && !draft.archived
                        ? "Archive or unpublish before deleting"
                        : undefined
                    }
                  >
                    Delete
                  </button>
                </>
              ) : null}
            </div>
          </form>
        ) : null}
      </Drawer>

      <ConfirmAction
        open={deleteConfirmOpen}
        title="Delete certification?"
        description="This permanently removes the certification record. Prefer archive or unpublish when the badge has already appeared publicly."
        confirmLabel="Delete permanently"
        onOpenChange={setDeleteConfirmOpen}
        onConfirm={() => {
          if (!draft?.id) return;
          void deleteCertificationFn({ data: { id: draft.id, confirm: true } }).then((result) => {
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Certification deleted");
            setDeleteConfirmOpen(false);
            setDraft(null);
            reload();
          });
        }}
      />

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(media) => void onPickMedia(media)}
      />
    </div>
  );
}
