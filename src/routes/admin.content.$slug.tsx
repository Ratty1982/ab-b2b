import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  GripVertical,
  Monitor,
  Plus,
  Settings2,
  Smartphone,
  Tablet,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { CmsPageView } from "@/components/cms/CmsSectionRenderer";
import { SectionSettings } from "@/components/cms/SectionSettings";
import { MediaPicker } from "@/components/cms/MediaPicker";
import type { CmsSectionTypeKey } from "@/domain/cms";
import {
  EDITOR_VIEWPORTS,
  SECTION_LIBRARY,
  addEditorSection,
  deleteEditorSection,
  duplicateEditorSection,
  moveEditorSection,
  reorderEditorSections,
  toggleEditorSection,
  type EditorSection,
  type EditorViewport,
} from "@/domain/cms-editor";
import { Field, inputClass } from "@/components/ab/Drawer";
import { cmsPublicPath } from "@/lib/cms-pages";
import { cn } from "@/lib/utils";
import {
  getCmsPageDraftFn,
  publishCmsPageFn,
  restoreCmsVersionFn,
  saveCmsDraftFn,
  updateCmsPageMetaFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/admin/content/$slug")({
  head: ({ params }) => ({
    meta: [{ title: `Edit ${params.slug} — CMS` }],
  }),
  component: CmsEditor,
});

type PageMeta = {
  title: string;
  seoTitle: string;
  metaDescription: string;
  ogImageMediaId: string | null;
  ogImageSrc: string | null;
  status: string;
  publishedAt: string | null;
  publishedByName: string | null;
  draftSavedAt: string | null;
  draftSavedByName: string | null;
  hasUnpublishedChanges: boolean;
};

type VersionRow = {
  id: string;
  version: number;
  label: string | null;
  createdAt: string;
  createdByName: string | null;
  isDraft: boolean;
  isPublished: boolean;
};

type RightMode = "section" | "page" | "history";

function snapshotKey(sections: EditorSection[], meta: PageMeta) {
  return JSON.stringify({
    sections: sections.map((s) => ({ type: s.type, enabled: s.enabled, config: s.config })),
    title: meta.title,
    seoTitle: meta.seoTitle,
    metaDescription: meta.metaDescription,
    ogImageMediaId: meta.ogImageMediaId,
  });
}

function SortableRow({
  section,
  index,
  selected,
  onSelect,
}: {
  section: EditorSection;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: section.id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md",
          selected ? "bg-secondary" : "hover:bg-surface",
          !section.enabled && "opacity-50",
        )}
      >
        <button
          type="button"
          className="grid size-8 shrink-0 place-items-center text-steel"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 px-1 py-2 text-left text-[12px]">
          {index + 1}. {section.type.replaceAll("_", " ")}
        </button>
      </div>
    </li>
  );
}

function CmsEditor() {
  const { slug } = Route.useParams();
  const [sections, setSections] = useState<EditorSection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<EditorViewport>("desktop");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [rightMode, setRightMode] = useState<RightMode>("section");
  const [savedKey, setSavedKey] = useState("");
  const [status, setStatus] = useState<"idle" | "saved" | "saving" | "failed">("idle");
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [meta, setMeta] = useState<PageMeta>({
    title: "",
    seoTitle: "",
    metaDescription: "",
    ogImageMediaId: null,
    ogImageSrc: null,
    status: "DRAFT",
    publishedAt: null,
    publishedByName: null,
    draftSavedAt: null,
    draftSavedByName: null,
    hasUnpublishedChanges: false,
  });
  const [ogPicker, setOgPicker] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const load = useCallback(async () => {
    const r = await getCmsPageDraftFn({ data: { slug } });
    if (!r.ok) {
      setActionError(r.error);
      toast.error(r.error);
      return;
    }
    const secs = (r.data.version?.sections ?? []).map((s) => ({
      id: s.id,
      type: s.type as CmsSectionTypeKey,
      config: s.config as Record<string, unknown>,
      enabled: s.enabled,
      sortOrder: s.sortOrder,
    }));
    setSections(secs);
    setSelectedId((current) => current ?? secs[0]?.id ?? null);
    const nextMeta: PageMeta = {
      title: r.data.title,
      seoTitle: r.data.seoTitle ?? "",
      metaDescription: r.data.metaDescription ?? "",
      ogImageMediaId: r.data.ogImageMediaId ?? null,
      ogImageSrc: r.data.ogImageSrc ?? null,
      status: r.data.status,
      publishedAt: r.data.publishedAt,
      publishedByName: r.data.publishedByName ?? null,
      draftSavedAt: r.data.draftSavedAt ?? null,
      draftSavedByName: r.data.draftSavedByName ?? null,
      hasUnpublishedChanges: r.data.hasUnpublishedChanges,
    };
    setMeta(nextMeta);
    setVersions(r.data.versions ?? []);
    setSavedKey(snapshotKey(secs, nextMeta));
    setStatus("idle");
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => snapshotKey(sections, meta) !== savedKey, [sections, meta, savedKey]);

  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);

  const selected = sections.find((s) => s.id === selectedId) ?? null;

  function updateSelectedConfig(key: string, value: unknown) {
    if (!selected) return;
    setSections((prev) =>
      prev.map((s) => (s.id === selected.id ? { ...s, config: { ...s.config, [key]: value } } : s)),
    );
  }

  function failAction(message: string) {
    setActionError(message);
    setStatus("failed");
    toast.error(message);
  }

  async function saveDraft() {
    setSaving(true);
    setStatus("saving");
    setActionError(null);
    try {
      const metaResult = await updateCmsPageMetaFn({
        data: {
          slug,
          title: meta.title,
          seoTitle: meta.seoTitle || null,
          metaDescription: meta.metaDescription || null,
          ogImageMediaId: meta.ogImageMediaId,
        },
      });
      if (!metaResult.ok) {
        failAction(metaResult.error);
        return;
      }
      const r = await saveCmsDraftFn({
        data: {
          slug,
          sections: sections.map((s) => ({ type: s.type, config: s.config, enabled: s.enabled })),
        },
      });
      if (!r.ok) {
        failAction(r.error);
        return;
      }
      toast.success("Draft saved — live site unchanged");
      setStatus("saved");
      await load();
    } catch (error) {
      failAction(error instanceof Error ? error.message : "Could not save draft");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    setPublishing(true);
    setActionError(null);
    try {
      await saveDraft();
      const r = await publishCmsPageFn({ data: { slug } });
      if (!r.ok) {
        failAction(r.error);
        return;
      }
      toast.success("Published to the live website");
      setStatus("saved");
      await load();
    } catch (error) {
      failAction(error instanceof Error ? error.message : "Could not publish");
    } finally {
      setPublishing(false);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    if (!overId || event.active.id === overId) return;
    setSections((prev) => reorderEditorSections(prev, String(event.active.id), String(overId)));
  }

  const canvasWidth = EDITOR_VIEWPORTS[viewport];
  const publicPath = cmsPublicPath(slug);
  const statusLabel = saving
    ? "Saving…"
    : publishing
      ? "Publishing…"
      : status === "failed"
        ? "Publish failed"
        : dirty
          ? "Unsaved changes"
          : meta.hasUnpublishedChanges
            ? "Draft changes"
            : meta.status === "PUBLISHED"
              ? "Published"
              : "Draft";

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col bg-ink lg:h-svh">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
        <div className="min-w-0 flex-1">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-steel">
            <Link to="/admin/content" className="hover:text-foreground">
              Website
            </Link>
            <span aria-hidden>›</span>
            <span className="text-foreground">{slug === "home" ? "Homepage" : slug}</span>
          </nav>
          <div className="font-display text-lg uppercase leading-tight">{meta.title || slug}</div>
          <div className="text-[11px] text-steel">
            {statusLabel}
            {meta.publishedAt ? ` · Published ${new Date(meta.publishedAt).toLocaleString()}` : " · Never published"}
          </div>
        </div>
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          {(
            [
              { id: "desktop" as const, icon: Monitor, label: "Desktop" },
              { id: "tablet" as const, icon: Tablet, label: "Tablet" },
              { id: "mobile" as const, icon: Smartphone, label: "Mobile" },
            ] as const
          ).map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setViewport(v.id)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded px-3 text-[11px] font-semibold uppercase",
                viewport === v.id ? "bg-secondary text-foreground" : "text-steel",
              )}
            >
              <v.icon className="size-3.5" aria-hidden />
              <span className="hidden sm:inline">{v.label}</span>
            </button>
          ))}
        </div>
        <Link
          to="/admin/content/$slug/preview"
          params={{ slug }}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-border px-3 text-[12px] font-semibold"
        >
          <Eye className="size-3.5" aria-hidden />
          Preview
        </Link>
        <a href={publicPath} target="_blank" rel="noreferrer" className="hidden h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold sm:inline-flex">
          Live
        </a>
        <button
          type="button"
          onClick={() => void saveDraft()}
          disabled={saving || publishing}
          className="h-9 shrink-0 rounded-md border border-border px-4 text-[12px] font-semibold disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Draft"}
        </button>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={saving || publishing}
          className="relative z-10 h-9 shrink-0 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
        >
          {publishing ? "Publishing…" : "Publish"}
        </button>
      </header>
      {actionError ? (
        <div role="alert" className="border-b border-bad/40 bg-bad/10 px-4 py-2 text-[13px] text-bad">
          {actionError}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
        <aside className="overflow-y-auto border-r border-border p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-steel">Sections</div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <ul className="mt-2 grid gap-1">
                {sections.map((s, i) => (
                  <SortableRow
                    key={s.id}
                    section={s}
                    index={i}
                    selected={selectedId === s.id}
                    onSelect={() => {
                      setSelectedId(s.id);
                      setRightMode("section");
                    }}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <button
            type="button"
            className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1 rounded-md border border-border text-[12px] font-semibold"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="size-3.5" aria-hidden />
            Add Section
          </button>
          <div className="mt-3 grid gap-1">
            <button
              type="button"
              className={cn("rounded-md px-2 py-2 text-left text-[12px]", rightMode === "page" ? "bg-secondary" : "hover:bg-surface")}
              onClick={() => setRightMode("page")}
            >
              <Settings2 className="mr-1 inline size-3.5" /> Page settings
            </button>
            <button
              type="button"
              className={cn("rounded-md px-2 py-2 text-left text-[12px]", rightMode === "history" ? "bg-secondary" : "hover:bg-surface")}
              onClick={() => setRightMode("history")}
            >
              History
            </button>
          </div>
        </aside>

        <div className="min-h-0 overflow-auto bg-black/40 p-3 sm:p-5">
          <div className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wide text-steel">
            {viewport} · {canvasWidth}px canvas — click a section to edit
          </div>
          <div className="flex justify-center">
            <div
              className="max-h-[calc(100svh-11rem)] overflow-y-auto overflow-x-hidden rounded-md border border-border bg-ink shadow-xl transition-[width]"
              style={{ width: `min(100%, ${canvasWidth}px)` }}
            >
              {sections.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-steel">No sections yet. Add a section from the left panel.</div>
              ) : (
                sections.map((s) => (
                  <div key={s.id} className="relative">
                    <div
                      className={cn(
                        "pointer-events-none",
                        !s.enabled && "opacity-40",
                        selectedId === s.id && rightMode === "section" && "ring-2 ring-inset ring-primary",
                      )}
                    >
                      <CmsPageView sections={[{ id: s.id, type: s.type, config: s.config }]} />
                    </div>
                    <button
                      type="button"
                      className="absolute inset-0 z-10 cursor-pointer bg-transparent"
                      aria-label={`Select ${s.type.replaceAll("_", " ")} section`}
                      onClick={() => {
                        setSelectedId(s.id);
                        setRightMode("section");
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <aside className="overflow-y-auto border-l border-border p-4">
          {rightMode === "page" ? (
            <PageSettings
              slug={slug}
              meta={meta}
              onChange={setMeta}
              onPickOg={() => setOgPicker(true)}
            />
          ) : rightMode === "history" ? (
            <HistoryPanel
              meta={meta}
              versions={versions}
              onRestore={(versionId) => {
                void (async () => {
                  const r = await restoreCmsVersionFn({ data: { slug, versionId } });
                  if (!r.ok) {
                    toast.error(r.error);
                    return;
                  }
                  toast.success("Restored into a new draft");
                  await load();
                })();
              }}
            />
          ) : !selected ? (
            <p className="text-sm text-steel">Select a section on the canvas or in the structure list.</p>
          ) : (
            <div className="grid gap-3">
              <div className="font-display text-base uppercase">{selected.type.replaceAll("_", " ")}</div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded border border-border"
                  aria-label="Move up"
                  onClick={() => setSections((prev) => moveEditorSection(prev, selected.id, -1))}
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded border border-border"
                  aria-label="Move down"
                  onClick={() => setSections((prev) => moveEditorSection(prev, selected.id, 1))}
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded border border-border"
                  aria-label="Duplicate"
                  onClick={() => {
                    const id = `tmp-${crypto.randomUUID()}`;
                    setSections((prev) => duplicateEditorSection(prev, selected.id, id));
                    setSelectedId(id);
                  }}
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded border border-border text-bad"
                  aria-label="Remove"
                  onClick={() => {
                    if (!window.confirm("Remove this section from the draft?")) return;
                    setSections((prev) => deleteEditorSection(prev, selected.id));
                    setSelectedId(null);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  onChange={(e) => setSections((prev) => toggleEditorSection(prev, selected.id, e.target.checked))}
                />
                Enabled on page
              </label>
              <SectionSettings type={selected.type} config={selected.config} onChange={updateSelectedConfig} />
            </div>
          )}
        </aside>
      </div>

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4">
          <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg uppercase">Add section</h2>
              <button type="button" className="text-[12px] font-semibold" onClick={() => setAddOpen(false)}>
                Close
              </button>
            </div>
            <p className="mt-1 text-[12px] text-steel">Controlled blocks only. No custom HTML or scripts.</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {SECTION_LIBRARY.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  className="rounded-md border border-border bg-ink p-3 text-left hover:border-primary"
                  onClick={() => {
                    const id = `tmp-${crypto.randomUUID()}`;
                    setSections((prev) => addEditorSection(prev, item.type, id));
                    setSelectedId(id);
                    setRightMode("section");
                    setAddOpen(false);
                  }}
                >
                  <div className="text-[13px] font-semibold">{item.name}</div>
                  <div className="mt-1 text-[12px] text-steel">{item.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <MediaPicker
        open={ogPicker}
        onClose={() => setOgPicker(false)}
        onSelect={(item) => {
          setMeta((m) => ({ ...m, ogImageMediaId: item.id, ogImageSrc: item.src }));
          setOgPicker(false);
        }}
      />
    </div>
  );
}

function PageSettings({
  slug,
  meta,
  onChange,
  onPickOg,
}: {
  slug: string;
  meta: PageMeta;
  onChange: (meta: PageMeta) => void;
  onPickOg: () => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="font-display text-base uppercase">Page settings</div>
      <Field label="Page title">
        <input value={meta.title} onChange={(e) => onChange({ ...meta, title: e.target.value })} className={inputClass} />
      </Field>
      <Field label={`SEO title (${meta.seoTitle.length}/60)`}>
        <input
          value={meta.seoTitle}
          onChange={(e) => onChange({ ...meta, seoTitle: e.target.value })}
          className={inputClass}
          maxLength={200}
        />
      </Field>
      <p className="text-[11px] text-steel">Aim for about 50–60 characters.</p>
      <Field label={`Meta description (${meta.metaDescription.length}/160)`}>
        <textarea
          rows={4}
          value={meta.metaDescription}
          onChange={(e) => onChange({ ...meta, metaDescription: e.target.value })}
          className={inputClass}
          maxLength={400}
        />
      </Field>
      <p className="text-[11px] text-steel">Aim for about 140–160 characters.</p>
      <Field label="Share image">
        <div className="grid gap-2">
          {meta.ogImageSrc ? (
            <img src={meta.ogImageSrc} alt="" className="aspect-[1.91/1] w-full rounded-md object-cover" />
          ) : (
            <div className="grid aspect-[1.91/1] place-items-center rounded-md border border-dashed border-border text-[12px] text-steel">
              No share image
            </div>
          )}
          <button type="button" className="h-9 rounded-md border border-border text-[12px] font-semibold" onClick={onPickOg}>
            Choose share image
          </button>
        </div>
      </Field>
      <Field label="Slug">
        <input value={slug} disabled className={cn(inputClass, "opacity-60")} />
      </Field>
      <p className="text-[11px] text-steel">{slug === "home" ? "Homepage slug is locked to /" : "Slug is locked for this page."}</p>
    </div>
  );
}

function HistoryPanel({
  meta,
  versions,
  onRestore,
}: {
  meta: PageMeta;
  versions: VersionRow[];
  onRestore: (versionId: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="font-display text-base uppercase">History</div>
      <div className="rounded-md border border-border p-3 text-[12px]">
        <div className="font-semibold">Published</div>
        <p className="mt-1 text-steel">
          {meta.publishedAt ? `${new Date(meta.publishedAt).toLocaleString()}${meta.publishedByName ? ` · ${meta.publishedByName}` : ""}` : "Not published yet"}
        </p>
      </div>
      <div className="rounded-md border border-border p-3 text-[12px]">
        <div className="font-semibold">Draft</div>
        <p className="mt-1 text-steel">
          {meta.draftSavedAt
            ? `${new Date(meta.draftSavedAt).toLocaleString()}${meta.draftSavedByName ? ` · ${meta.draftSavedByName}` : ""}`
            : "Not saved yet"}
        </p>
      </div>
      <ul className="grid gap-2">
        {versions.map((v) => (
          <li key={v.id} className="rounded-md border border-border p-3 text-[12px]">
            <div className="font-semibold">
              v{v.version} {v.isPublished ? "· live" : ""} {v.isDraft ? "· current draft" : ""}
            </div>
            <p className="mt-1 text-steel">
              {v.label} · {new Date(v.createdAt).toLocaleString()}
              {v.createdByName ? ` · ${v.createdByName}` : ""}
            </p>
            {!v.isDraft ? (
              <button
                type="button"
                className="mt-2 h-8 rounded-md border border-border px-2 text-[11px] font-semibold"
                onClick={() => {
                  if (!window.confirm(`Restore v${v.version} into a new draft? The live site will not change until you publish.`)) return;
                  onRestore(v.id);
                }}
              >
                Restore version
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
