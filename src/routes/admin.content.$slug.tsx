import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, Plus, Trash2 } from "lucide-react";
import { CmsPageView } from "@/components/cms/CmsSectionRenderer";
import { CMS_SECTION_TYPES, type CmsSectionTypeKey } from "@/domain/cms";
import { getCmsPageDraftFn, publishCmsPageFn, saveCmsDraftFn } from "@/server/phase2/fns";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/content/$slug")({
  head: ({ params }) => ({
    meta: [{ title: `Edit ${params.slug} — CMS` }],
  }),
  component: CmsEditor,
});

type DraftSection = {
  id: string;
  type: CmsSectionTypeKey;
  config: Record<string, unknown>;
  enabled: boolean;
  sortOrder: number;
};

type Viewport = "desktop" | "tablet" | "mobile";

function defaultConfig(type: CmsSectionTypeKey): Record<string, unknown> {
  switch (type) {
    case "HERO":
      return {
        headline: "New headline",
        supporting: "Supporting copy",
        ctaLabel: "Open a Trade Account",
        ctaHref: "/register",
        alignment: "left",
        variant: "split",
        spacing: "standard",
      };
    case "FEATURED_BRANDS":
      return {
        heading: "Our brands",
        supporting: "Our brands",
        brandSlugs: ["power-maxed", "steel-seal", "street-rhino", "bramley-power", "kidzmotion"],
        displayCount: 5,
        variant: "standard",
        spacing: "standard",
      };
    case "TRADE_CTA":
      return {
        headline: "Ready to trade?",
        supporting: "",
        ctaLabel: "Apply",
        ctaHref: "/register",
        variant: "dark",
        spacing: "standard",
      };
    case "SPACER":
      return { size: "md" };
    case "RICH_TEXT":
      return { content: "Plain text content", spacing: "standard" };
    case "BANNER":
      return { text: "Announcement", tone: "brand", spacing: "compact" };
    case "BENEFITS_GRID":
      return { heading: "Benefits", items: [], spacing: "standard" };
    case "CATEGORY_GRID":
      return { heading: "Categories", categories: [], spacing: "standard" };
    default:
      return { heading: type, spacing: "standard" };
  }
}

function CmsEditor() {
  const { slug } = Route.useParams();
  const [sections, setSections] = useState<DraftSection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");

  const load = useCallback(async () => {
    const r = await getCmsPageDraftFn({ data: { slug } });
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setTitle(r.data.title);
    const secs = (r.data.version?.sections ?? []).map((s) => ({
      id: s.id,
      type: s.type as CmsSectionTypeKey,
      config: s.config as Record<string, unknown>,
      enabled: s.enabled,
      sortOrder: s.sortOrder,
    }));
    setSections(secs);
    setSelectedId(secs[0]?.id ?? null);
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = sections.find((s) => s.id === selectedId) ?? null;

  function updateSelectedConfig(key: string, value: unknown) {
    if (!selected) return;
    setSections((prev) =>
      prev.map((s) =>
        s.id === selected.id ? { ...s, config: { ...s.config, [key]: value } } : s,
      ),
    );
  }

  async function saveDraft() {
    setSaving(true);
    const r = await saveCmsDraftFn({
      data: {
        slug,
        sections: sections.map((s) => ({
          type: s.type,
          config: s.config,
          enabled: s.enabled,
        })),
      },
    });
    setSaving(false);
    if (!r.ok) toast.error(r.error);
    else {
      toast.success("Draft saved");
      await load();
    }
  }

  async function publish() {
    const save = await saveCmsDraftFn({
      data: {
        slug,
        sections: sections.map((s) => ({
          type: s.type,
          config: s.config,
          enabled: s.enabled,
        })),
      },
    });
    if (!save.ok) {
      toast.error(save.error);
      return;
    }
    const r = await publishCmsPageFn({ data: { slug } });
    if (!r.ok) toast.error(r.error);
    else toast.success("Published to live site");
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg uppercase">{title || slug}</div>
          <div className="text-[11px] text-steel">Draft editor · live site unchanged until publish</div>
        </div>
        <div className="flex gap-1 rounded-md border border-border p-0.5">
          {(["desktop", "tablet", "mobile"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setViewport(v)}
              className={cn(
                "h-8 rounded px-3 text-[11px] font-semibold uppercase",
                viewport === v ? "bg-secondary text-foreground" : "text-steel",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void saveDraft()}
          disabled={saving}
          className="h-9 rounded-md border border-border px-4 text-[12px] font-semibold"
        >
          Save draft
        </button>
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-[12px] font-semibold"
        >
          <Eye className="size-3.5" aria-hidden />
          Preview live
        </a>
        <button
          type="button"
          onClick={() => void publish()}
          className="h-9 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
        >
          Publish
        </button>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
        <aside className="hidden overflow-y-auto border-r border-border p-3 lg:block">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-steel">Structure</div>
          <ul className="mt-2 grid gap-1">
            {sections.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-[12px]",
                    selectedId === s.id ? "bg-secondary" : "hover:bg-surface",
                    !s.enabled && "opacity-50",
                  )}
                >
                  <span>
                    {i + 1}. {s.type.replaceAll("_", " ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-steel">
            Add section
          </div>
          <div className="mt-2 grid gap-1">
            {CMS_SECTION_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-left text-[11px] text-steel hover:bg-surface hover:text-foreground"
                onClick={() => {
                  const id = `tmp-${crypto.randomUUID()}`;
                  setSections((prev) => [
                    ...prev,
                    {
                      id,
                      type,
                      config: defaultConfig(type),
                      enabled: true,
                      sortOrder: prev.length,
                    },
                  ]);
                  setSelectedId(id);
                }}
              >
                <Plus className="size-3" aria-hidden />
                {type.replaceAll("_", " ")}
              </button>
            ))}
          </div>
        </aside>

        <div className="overflow-y-auto bg-ink/80 p-4">
          <div
            className={cn(
              "mx-auto overflow-hidden rounded-md border border-border bg-ink shadow-xl transition-all",
              viewport === "desktop" && "w-full",
              viewport === "tablet" && "max-w-[768px]",
              viewport === "mobile" && "max-w-[390px]",
            )}
          >
            <CmsPageView
              sections={sections
                .filter((s) => s.enabled)
                .map((s) => ({ id: s.id, type: s.type, config: s.config }))}
            />
          </div>
        </div>

        <aside className="overflow-y-auto border-l border-border p-4">
          {!selected ? (
            <p className="text-sm text-steel">Select a section</p>
          ) : (
            <div className="grid gap-3">
              <div className="font-display text-base uppercase">
                {selected.type.replaceAll("_", " ")}
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded border border-border"
                  aria-label="Move up"
                  onClick={() => {
                    setSections((prev) => {
                      const i = prev.findIndex((s) => s.id === selected.id);
                      if (i <= 0) return prev;
                      const next = [...prev];
                      [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                      return next;
                    });
                  }}
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded border border-border"
                  aria-label="Move down"
                  onClick={() => {
                    setSections((prev) => {
                      const i = prev.findIndex((s) => s.id === selected.id);
                      if (i < 0 || i >= prev.length - 1) return prev;
                      const next = [...prev];
                      [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
                      return next;
                    });
                  }}
                >
                  <ArrowDown className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded border border-border"
                  aria-label="Duplicate"
                  onClick={() => {
                    const id = `tmp-${crypto.randomUUID()}`;
                    setSections((prev) => {
                      const i = prev.findIndex((s) => s.id === selected.id);
                      const copy = {
                        ...selected,
                        id,
                        config: { ...selected.config },
                      };
                      const next = [...prev];
                      next.splice(i + 1, 0, copy);
                      return next;
                    });
                  }}
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded border border-border text-bad"
                  aria-label="Remove"
                  onClick={() => {
                    setSections((prev) => prev.filter((s) => s.id !== selected.id));
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
                  onChange={(e) => {
                    setSections((prev) =>
                      prev.map((s) =>
                        s.id === selected.id ? { ...s, enabled: e.target.checked } : s,
                      ),
                    );
                  }}
                />
                Enabled
              </label>
              {Object.entries(selected.config).map(([key, value]) => {
                if (typeof value === "object") return null;
                return (
                  <label key={key} className="grid gap-1 text-[11px] font-semibold uppercase tracking-wide text-steel">
                    {key}
                    <input
                      value={String(value ?? "")}
                      onChange={(e) => updateSelectedConfig(key, e.target.value)}
                      className="h-9 rounded-md border border-border bg-surface px-3 text-[13px] font-normal normal-case tracking-normal text-foreground"
                    />
                  </label>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
