import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { inputClass } from "@/components/ab/Drawer";
import { WhatsNewModal, type WhatsNewViewModel } from "@/components/system/WhatsNewModal";
import {
  parseQuickPasteUpdate,
  quickUpdateVersionFromDate,
} from "@/domain/version-updates";
import { todayLondonDateOnly } from "@/domain/sales-history-period";
import { ROUTES } from "@/lib/app-nav";
import { createVersionUpdateFromPasteFn } from "@/server/phase2/fns";

export function QuickAddUpdate({ onCreated }: { onCreated: () => Promise<void> | void }) {
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const parsed = useMemo(() => parseQuickPasteUpdate(paste), [paste]);
  const previewVersion = quickUpdateVersionFromDate(todayLondonDateOnly());

  const previewModel: WhatsNewViewModel | null =
    parsed.ok && previewOpen
      ? {
          id: "quick-paste-preview",
          version: previewVersion,
          title: parsed.title,
          summary: null,
          content: parsed.content,
          publishedAt: new Date().toISOString(),
          isPreview: true,
        }
      : null;

  function showPreview() {
    if (!parsed.ok) {
      setError(parsed.error);
      toast.error(parsed.error);
      return;
    }
    setError(null);
    setPreviewOpen(true);
  }

  async function submit(publish: boolean) {
    if (!parsed.ok) {
      setError(parsed.error);
      toast.error(parsed.error);
      return;
    }
    setBusy(publish ? "publish" : "draft");
    const res = await createVersionUpdateFromPasteFn({
      data: { paste, publish },
    });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      toast.error(res.error);
      return;
    }
    setPaste("");
    setPreviewOpen(false);
    setError(null);
    toast.success(publish ? "Published" : "Draft saved");
    await onCreated();
  }

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold uppercase tracking-tight">Quick add update</h2>
          <p className="mt-1 max-w-2xl text-[13px] text-steel">
            Paste a short update. The first line becomes the title; everything after is the body. Then preview and
            publish.
          </p>
        </div>
        <Link
          to={ROUTES.adminVersionUpdateNew}
          className="text-[11px] font-semibold uppercase tracking-wide text-primary"
        >
          Advanced options
        </Link>
      </div>

      <label className="mt-4 grid gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">Paste update</span>
        <textarea
          className={`${inputClass} min-h-44 py-3 leading-relaxed`}
          value={paste}
          onChange={(e) => {
            setPaste(e.target.value);
            if (error) setError(null);
          }}
          placeholder={`Purchasing Intelligence\n\nWe've added a new Purchasing Intelligence area to help plan future stock requirements.\n\n• See current stock and incoming purchase orders\n• Forecast demand using sales history`}
        />
      </label>

      {parsed.ok && parsed.titleOnly ? (
        <p className="mt-2 text-[12px] text-steel">Title only — add body text if you want more than a heading.</p>
      ) : null}
      {error ? <p className="mt-2 text-[13px] text-bad">{error}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="h-10 rounded-md border border-border bg-surface px-4 text-[12px] font-semibold uppercase disabled:opacity-50"
          disabled={busy !== null}
          onClick={showPreview}
        >
          Preview
        </button>
        <button
          type="button"
          className="h-10 rounded-md border border-border bg-surface px-4 text-[12px] font-semibold uppercase disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void submit(false)}
        >
          {busy === "draft" ? "Saving…" : "Create draft"}
        </button>
        <button
          type="button"
          className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void submit(true)}
        >
          {busy === "publish" ? "Publishing…" : "Publish now"}
        </button>
      </div>

      <WhatsNewModal
        open={Boolean(previewModel)}
        update={previewModel}
        busy={busy !== null}
        onAcknowledge={() => setPreviewOpen(false)}
        onOpenChange={(open) => {
          if (!open) setPreviewOpen(false);
        }}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase"
              onClick={() => setPreviewOpen(false)}
            >
              Edit
            </button>
            <button
              type="button"
              className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold uppercase disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void submit(false)}
            >
              Create draft
            </button>
            <button
              type="button"
              className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void submit(true)}
            >
              Publish
            </button>
          </div>
        }
      />
    </section>
  );
}
