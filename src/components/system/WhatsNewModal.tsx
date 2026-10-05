import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InstantText } from "@/components/ab/InstantText";
import type { ReactNode } from "react";
import type { VersionUpdateContent } from "@/domain/version-updates";

export type WhatsNewViewModel = {
  id: string;
  version: string;
  title: string;
  summary: string | null;
  content: VersionUpdateContent;
  publishedAt: string | null;
  earlierUnreadCount?: number;
  isPreview?: boolean;
};

export function WhatsNewArticle({
  title,
  content,
}: {
  title: string;
  content: VersionUpdateContent;
}) {
  return (
    <>
      <h3 className="font-display text-lg font-semibold uppercase tracking-tight">{title}</h3>
      {content.intro ? (
        <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/90">{content.intro}</p>
      ) : null}
      {content.sections.map((section) => (
        <section key={`${section.heading}-${section.body.slice(0, 24)}`} className="mt-5">
          {section.heading ? (
            <h4 className="text-[12px] font-bold uppercase tracking-wide text-steel">{section.heading}</h4>
          ) : null}
          {section.body ? (
            <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed">{section.body}</p>
          ) : null}
        </section>
      ))}
    </>
  );
}

export function WhatsNewModal({
  open,
  update,
  busy,
  onAcknowledge,
  onOpenChange,
  footer,
}: {
  open: boolean;
  update: WhatsNewViewModel | null;
  busy?: boolean;
  onAcknowledge: () => void;
  onOpenChange: (open: boolean) => void;
  footer?: ReactNode;
}) {
  if (!update) return null;
  const { content } = update;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(90vh,40rem)] w-[calc(100%-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:rounded-lg"
        aria-describedby="whats-new-desc"
        onEscapeKeyDown={(e) => {
          // Preview can dismiss freely; live modal prefers Got it (still allow ESC)
          if (update.isPreview) return;
          e.preventDefault();
          if (!busy) onAcknowledge();
        }}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-5 py-4 text-left">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan">
            What&apos;s New
          </p>
          <DialogTitle className="font-display text-xl font-semibold uppercase tracking-tight">
            Automotive Brands B2B
          </DialogTitle>
          <DialogDescription id="whats-new-desc" className="text-[13px] text-steel">
            Version {update.version}
            {update.publishedAt ? (
              <>
                {" · "}
                <InstantText value={update.publishedAt} variant="date" />
              </>
            ) : null}
            {update.isPreview ? " · Preview" : null}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <WhatsNewArticle title={update.title} content={content} />
          {!update.isPreview && (update.earlierUnreadCount ?? 0) > 0 ? (
            <p className="mt-5 text-[12px] text-steel">
              {update.earlierUnreadCount} earlier update
              {update.earlierUnreadCount === 1 ? "" : "s"} also available in What&apos;s New.
            </p>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-5 py-3 sm:justify-end">
          {footer ?? (
            <button
              type="button"
              className="h-10 rounded-md bg-primary px-5 text-[12px] font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-50"
              disabled={busy}
              onClick={onAcknowledge}
            >
              {update.isPreview ? "Close preview" : "Got it"}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
