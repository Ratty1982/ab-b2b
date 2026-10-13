import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cmsFocalStyle, cmsImageFitClass, cmsMediaDisplaySrc } from "@/lib/cms-media";
import { cn } from "@/lib/utils";
import {
  galleryFrames,
  galleryIndexAfterKey,
  galleryKeyAction,
  mosaicFrameClass,
  type GalleryFrame,
} from "@/components/public/motorsport-gallery-layout";

function str(c: Record<string, unknown>, key: string, fallback = ""): string {
  const v = c[key];
  return typeof v === "string" ? v : fallback;
}

type GalleryPhoto = {
  src: string;
  alt: string;
  caption: string;
  fit: "contain" | "fill";
  focal: { objectPosition: string };
};

function photosFromConfig(config: Record<string, unknown>): GalleryPhoto[] {
  const itemsRaw = config["items"];
  const items = Array.isArray(itemsRaw)
    ? itemsRaw.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    : [];
  return items
    .map((item) => ({
      src: cmsMediaDisplaySrc(item) ?? "",
      alt: typeof item["alt"] === "string" && item["alt"].trim() ? item["alt"] : "Power Maxed Racing photography",
      caption: typeof item["caption"] === "string" ? item["caption"].trim() : "",
      fit: item["fit"] === "contain" ? ("contain" as const) : ("fill" as const),
      focal: cmsFocalStyle(item),
    }))
    .filter((photo) => Boolean(photo.src));
}

function tileSizes(frame: GalleryFrame): string {
  if (frame.role === "feature" && frame.desktopSpan === 4) {
    return "(max-width: 640px) 100vw, (max-width: 1279px) 100vw, 880px";
  }
  if (frame.pair) {
    return "(max-width: 640px) 100vw, (max-width: 1279px) 100vw, 440px";
  }
  if (frame.role === "feature" || frame.desktopSpan === 6) {
    return "(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 1320px";
  }
  if (frame.tabletSpan === 2) {
    return "(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 660px";
  }
  if (frame.desktopSpan === 3) {
    return "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 660px";
  }
  return "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 440px";
}

/**
 * Responsive motorsport gallery from CMS MEDIA_GALLERY items.
 * Empty state explains media upload — never invents race photography.
 */
export function MotorsportMediaGallery({ config }: { config: Record<string, unknown> }) {
  const photos = photosFromConfig(config);
  const frames = galleryFrames(photos.length);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <section className="border-b border-border/50 bg-ink" data-motorsport-section="gallery">
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10 lg:py-12">
        {str(config, "eyebrow") ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan">
            {str(config, "eyebrow")}
          </p>
        ) : null}
        <h2 className="mt-2 font-display text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
          {str(config, "heading", "Gallery")}
        </h2>
        {str(config, "supporting") ? (
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-steel">
            {str(config, "supporting")}
          </p>
        ) : null}

        {photos.length === 0 ? (
          <div
            className="mt-6 rounded-lg border border-dashed border-border/70 bg-surface/30 px-5 py-10 text-center"
            role="status"
            data-gallery-empty="true"
          >
            <p className="text-[14px] text-steel">
              Gallery images are managed in Website Builder. Upload licensed Power Maxed Racing
              photography under Admin → Content → Media, then attach them to this gallery section.
            </p>
            <p className="mt-2 text-[12px] text-steel/80">
              Do not crop, blur, or overlay watermarks on preview photography.
            </p>
          </div>
        ) : (
          <ul
            className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6"
            data-gallery-count={photos.length}
          >
            {photos.map((photo, index) => {
              const frame = frames[index]!;
              return (
                <li
                  key={`${photo.src}-${index}`}
                  className={mosaicFrameClass(frame)}
                  data-gallery-tile={frame.role}
                  data-desktop-span={frame.desktopSpan}
                  data-tablet-span={frame.tabletSpan}
                >
                  <button
                    type="button"
                    className="absolute inset-0 block h-full w-full cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
                    aria-label={`View photograph ${index + 1} of ${photos.length}: ${photo.alt}`}
                    onClick={(event) => {
                      triggerRef.current = event.currentTarget;
                      setOpenIndex(index);
                    }}
                  >
                    <img
                      src={photo.src}
                      alt={photo.alt}
                      className={cn("size-full", cmsImageFitClass(photo.fit))}
                      style={photo.focal}
                      loading={frame.role === "feature" ? "eager" : "lazy"}
                      fetchPriority={frame.role === "feature" ? "high" : "auto"}
                      decoding="async"
                      sizes={tileSizes(frame)}
                    />
                  </button>
                  {photo.caption ? (
                    <p className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2.5 pt-8 text-left text-[12px] leading-snug text-white/90">
                      {photo.caption}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {openIndex !== null && photos[openIndex] && typeof document !== "undefined"
        ? createPortal(
            <MotorsportGalleryDialog
              photos={photos}
              index={openIndex}
              onIndexChange={setOpenIndex}
              onClose={() => setOpenIndex(null)}
              returnFocusRef={triggerRef}
            />,
            document.body,
          )
        : null}
    </section>
  );
}

export function MotorsportGalleryDialog({
  photos,
  index,
  onIndexChange,
  onClose,
  returnFocusRef,
}: {
  photos: GalleryPhoto[];
  index: number;
  onIndexChange: (index: number | null) => void;
  onClose: () => void;
  returnFocusRef?: { current: HTMLButtonElement | null };
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(index);
  const onCloseRef = useRef(onClose);
  const onIndexChangeRef = useRef(onIndexChange);
  const photo = photos[index];
  const count = photos.length;
  indexRef.current = index;
  onCloseRef.current = onClose;
  onIndexChangeRef.current = onIndexChange;

  useEffect(() => {
    const returnTo = returnFocusRef?.current ?? null;
    closeRef.current?.focus();
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    function onKey(event: KeyboardEvent) {
      const action = galleryKeyAction(event.key);
      if (action === "close") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (action === "previous" || action === "next") {
        event.preventDefault();
        const next = galleryIndexAfterKey(indexRef.current, count, action);
        if (next !== null) onIndexChangeRef.current(next);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      returnTo?.focus();
    };
  }, [count, returnFocusRef]);

  if (!photo) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-gallery-lightbox="true"
      className="fixed inset-0 z-[80] bg-black"
      onClick={(event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest("button, img")) return;
        onClose();
      }}
    >
      <button
        ref={closeRef}
        type="button"
        className="fixed right-3 top-3 z-[81] inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-ink/80 text-white hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
        aria-label="Close photograph"
        onClick={onClose}
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
      <div className="flex h-full items-center justify-center px-3 pb-28 pt-16 sm:px-20">
        <img
          src={photo.src}
          alt={photo.alt}
          className="max-h-[calc(100dvh-11rem)] w-auto max-w-[calc(100vw-2rem)] object-contain sm:max-w-[calc(100vw-8rem)]"
          decoding="async"
        />
      </div>
      <div className="fixed inset-x-0 bottom-0 z-[81] border-t border-white/10 bg-ink/90 px-3 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          {count > 1 ? (
            <button
              type="button"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/25 text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
              aria-label="Previous photograph"
              onClick={() => {
                const next = galleryIndexAfterKey(index, count, "previous");
                if (next !== null) onIndexChange(next);
              }}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          <div className="min-w-0 flex-1 text-center" aria-live="polite" aria-atomic="true">
            <p id={titleId} className="truncate text-[13px] text-white/90">
              {photo.caption || photo.alt}
            </p>
            <p className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-white/55">
              {index + 1} of {count}
            </p>
          </div>
          {count > 1 ? (
            <button
              type="button"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/25 text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan"
              aria-label="Next photograph"
              onClick={() => {
                const next = galleryIndexAfterKey(index, count, "next");
                if (next !== null) onIndexChange(next);
              }}
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
