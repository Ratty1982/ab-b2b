import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import { WhatsNewModal, type WhatsNewViewModel } from "@/components/system/WhatsNewModal";
import {
  emptyVersionUpdateContent,
  roleAudienceOptions,
  type VersionUpdateAudience,
  type VersionUpdateContent,
} from "@/domain/version-updates";
import { ROUTES } from "@/lib/app-nav";
import {
  getVersionUpdateAdminFn,
  previewVersionUpdateFn,
  publishVersionUpdateFn,
  upsertVersionUpdateFn,
} from "@/server/phase2/fns";

export function VersionUpdateEditor({ id }: { id?: string }) {
  const navigate = useNavigate();
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("What's New in Automotive Brands B2B");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState<VersionUpdateContent>(emptyVersionUpdateContent());
  const [audienceMode, setAudienceMode] = useState<"ALL_INTERNAL" | "ROLES">("ALL_INTERNAL");
  const [roleKeys, setRoleKeys] = useState<string[]>([]);
  const [status, setStatus] = useState("DRAFT");
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<WhatsNewViewModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | undefined>(id);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const res = await getVersionUpdateAdminFn({ data: { id } });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLoadedId(res.data.id);
      setVersion(res.data.version);
      setTitle(res.data.title);
      setSummary(res.data.summary ?? "");
      setContent(res.data.content);
      setStatus(res.data.status);
      if (res.data.audience.mode === "ROLES") {
        setAudienceMode("ROLES");
        setRoleKeys(res.data.audience.roleKeys);
      } else {
        setAudienceMode("ALL_INTERNAL");
        setRoleKeys([]);
      }
    })();
  }, [id]);

  function buildAudience(): VersionUpdateAudience {
    if (audienceMode === "ROLES") {
      return {
        mode: "ROLES",
        roleKeys: roleKeys.filter(Boolean) as import("@/domain/permissions").SystemRoleKey[],
      };
    }
    return { mode: "ALL_INTERNAL" };
  }

  async function save(andPublish: boolean) {
    setBusy(andPublish ? "publish" : "save");
    const res = await upsertVersionUpdateFn({
      data: {
        id: loadedId,
        version,
        title,
        summary: summary || null,
        content,
        audience: buildAudience(),
      },
    });
    if (!res.ok) {
      setBusy(null);
      toast.error(res.error);
      return;
    }
    setLoadedId(res.data.id);
    setStatus(res.data.status);
    if (andPublish) {
      const pub = await publishVersionUpdateFn({ data: { id: res.data.id } });
      setBusy(null);
      if (!pub.ok) {
        toast.error(pub.error);
        return;
      }
      toast.success("Published");
      setStatus(pub.data.status);
      await navigate({ to: ROUTES.adminVersionUpdates });
      return;
    }
    setBusy(null);
    toast.success("Draft saved");
    if (!id) {
      await navigate({ to: "/admin/version-updates/$id", params: { id: res.data.id } });
    }
  }

  async function previewDraft() {
    if (!loadedId) {
      // Save first so preview has an id
      setBusy("preview");
      const res = await upsertVersionUpdateFn({
        data: {
          version,
          title,
          summary: summary || null,
          content,
          audience: buildAudience(),
        },
      });
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLoadedId(res.data.id);
      const p = await previewVersionUpdateFn({ data: { id: res.data.id } });
      if (p.ok) setPreview(p.data);
      return;
    }
    const p = await previewVersionUpdateFn({ data: { id: loadedId } });
    if (!p.ok) {
      toast.error(p.error);
      return;
    }
    setPreview(p.data);
  }

  function updateSection(index: number, patch: Partial<{ heading: string; body: string }>) {
    setContent((prev) => ({
      ...prev,
      sections: prev.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }

  return (
    <div>
      <PanelHeader
        title={id ? "Edit Version Update" : "Create Version Update"}
        sub={status === "PUBLISHED" ? "Editing a published update does not reset acknowledgements." : "Detailed editor. For a single paste, use Quick add on the Version Updates list."}
        actions={
          <Link
            to={ROUTES.adminVersionUpdates}
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-[12px] font-semibold uppercase"
          >
            Back
          </Link>
        }
      />

      <div className="space-y-5 p-4 sm:p-6 max-w-3xl">
        {error ? <p className="text-[13px] text-bad">{error}</p> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Version">
            <input
              className={inputClass}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.4"
            />
          </Field>
          <Field label="Status">
            <input className={inputClass} value={status} readOnly disabled />
          </Field>
        </div>

        <Field label="Title">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <Field label="Summary (optional)">
          <input
            className={inputClass}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Short list label"
          />
        </Field>

        <Field label="Intro">
          <textarea
            className={`${inputClass} min-h-24 py-2`}
            value={content.intro}
            onChange={(e) => setContent((c) => ({ ...c, intro: e.target.value }))}
          />
        </Field>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[12px] font-bold uppercase tracking-wide text-steel">Sections</h3>
            <button
              type="button"
              className="text-[11px] font-semibold uppercase text-primary"
              onClick={() =>
                setContent((c) => ({
                  ...c,
                  sections: [...c.sections, { heading: "", body: "" }],
                }))
              }
            >
              + Add section
            </button>
          </div>
          {content.sections.map((section, index) => (
            <div key={index} className="space-y-2 rounded-md border border-border p-3">
              <input
                className={inputClass}
                placeholder="Heading"
                value={section.heading}
                onChange={(e) => updateSection(index, { heading: e.target.value })}
              />
              <textarea
                className={`${inputClass} min-h-24 py-2`}
                placeholder="Body"
                value={section.body}
                onChange={(e) => updateSection(index, { body: e.target.value })}
              />
              <button
                type="button"
                className="text-[11px] font-semibold uppercase text-steel"
                onClick={() =>
                  setContent((c) => ({
                    ...c,
                    sections: c.sections.filter((_, i) => i !== index),
                  }))
                }
              >
                Remove section
              </button>
            </div>
          ))}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-[12px] font-bold uppercase tracking-wide text-steel">
            Audience
          </legend>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="radio"
              checked={audienceMode === "ALL_INTERNAL"}
              onChange={() => setAudienceMode("ALL_INTERNAL")}
            />
            All internal staff
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="radio"
              checked={audienceMode === "ROLES"}
              onChange={() => setAudienceMode("ROLES")}
            />
            Selected roles
          </label>
          {audienceMode === "ROLES" ? (
            <div className="grid gap-1 sm:grid-cols-2">
              {roleAudienceOptions().map((opt) => (
                <label key={opt.key} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={roleKeys.includes(opt.key)}
                    onChange={(e) => {
                      setRoleKeys((prev) =>
                        e.target.checked
                          ? [...prev, opt.key]
                          : prev.filter((k) => k !== opt.key),
                      );
                    }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          ) : null}
        </fieldset>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void save(false)}
          >
            Save draft
          </button>
          <button
            type="button"
            className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void previewDraft()}
          >
            Preview
          </button>
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            disabled={busy !== null || status === "ARCHIVED"}
            onClick={() => void save(true)}
          >
            Publish
          </button>
        </div>
      </div>

      <WhatsNewModal
        open={Boolean(preview)}
        update={preview}
        onAcknowledge={() => setPreview(null)}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
    </div>
  );
}
