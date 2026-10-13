import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MotorsportGalleryDialog, MotorsportMediaGallery } from "@/components/public/MotorsportMediaGallery";
import { SectionSettings } from "@/components/cms/SectionSettings";
import {
  desktopRows,
  galleryFrames,
  galleryIndexAfterKey,
  galleryKeyAction,
  mosaicFrameClass,
  tabletRows,
} from "@/components/public/motorsport-gallery-layout";

function html(node: ReactNode) {
  return renderToStaticMarkup(node as ReactElement);
}

function photo(index: number, extras: Record<string, unknown> = {}) {
  return {
    mediaId: `media-${index}`,
    alt: `Race photograph ${index}`,
    caption: index === 2 ? "Pit lane" : "",
    fit: index === 3 ? "contain" : "fill",
    focalX: 30,
    focalY: 70,
    ...extras,
  };
}

function assertBalanced(count: number) {
  const frames = galleryFrames(count);
  expect(frames).toHaveLength(count);
  expect(frames[0]).toMatchObject({ role: "feature" });
  const desktop = desktopRows(frames);
  const tablet = tabletRows(frames);
  for (const row of desktop) {
    expect(row.reduce((sum, span) => sum + span, 0)).toBe(6);
  }
  for (const row of tablet) {
    expect(row.reduce((sum, span) => sum + span, 0)).toBe(2);
    expect(row.every((span) => span === 1 || span === 2)).toBe(true);
  }
  const singletonDesktop = desktop.filter((row) => row.length === 1 && row[0] !== 6);
  expect(singletonDesktop).toEqual([]);
  expect(frames.slice(1).filter((frame) => frame.desktopSpan === 6)).toEqual([]);
  for (const frame of frames) {
    const frameClass = mosaicFrameClass(frame);
    expect(frameClass).toContain("col-span-1");
    expect(frameClass).not.toContain("min-w-");
    expect(frameClass).toContain("overflow-hidden");
  }
  if (count === 2) {
    expect(frames.map((frame) => frame.desktopSpan)).toEqual([4, 2]);
    expect(desktop).toEqual([[4, 2]]);
    expect(mosaicFrameClass(frames[1]!)).toContain("xl:aspect-square");
    expect(mosaicFrameClass(frames[1]!)).not.toContain("xl:aspect-[21/9]");
    return;
  }
  expect(frames[0]).toMatchObject({ desktopSpan: 6, tabletSpan: 2 });
  expect(desktop[0]).toEqual([6]);
  for (const row of desktop.slice(1)) {
    const threeEqual = row.length === 3 && row.every((span) => span === 2);
    const widerPair = row.length === 2 && row.every((span) => span === 3);
    expect(threeEqual || widerPair).toBe(true);
  }
}

describe("motorsport gallery placement", () => {
  it("renders nothing for an empty gallery", () => {
    expect(galleryFrames(0)).toEqual([]);
    expect(desktopRows([])).toEqual([]);
    expect(tabletRows([])).toEqual([]);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])(
    "balances %i photographs without an empty desktop cell",
    (count) => {
      if (count === 0) {
        expect(galleryFrames(0)).toEqual([]);
        return;
      }
      assertBalanced(count);
    },
  );

  it("pairs a remainder of one instead of leaving a single tile", () => {
    const frames = galleryFrames(8);
    expect(frames.map((frame) => frame.desktopSpan)).toEqual([6, 2, 2, 2, 3, 3, 3, 3]);
    expect(frames.map((frame) => frame.tabletSpan)).toEqual([2, 1, 1, 1, 1, 1, 1, 2]);
  });

  it("widens the last pair when two tiles would otherwise finish the row", () => {
    const frames = galleryFrames(9);
    expect(frames.map((frame) => frame.desktopSpan)).toEqual([6, 2, 2, 2, 2, 2, 2, 3, 3]);
    expect(frames.every((frame) => frame.tabletSpan === 2 || frame.tabletSpan === 1)).toBe(true);
    expect(frames.filter((frame) => frame.tabletSpan === 2)).toEqual([
      expect.objectContaining({ role: "feature" }),
    ]);
  });

  it("maps keyboard controls", () => {
    expect(galleryKeyAction("Escape")).toBe("close");
    expect(galleryKeyAction("ArrowLeft")).toBe("previous");
    expect(galleryKeyAction("ArrowRight")).toBe("next");
    expect(galleryKeyAction("a")).toBe("none");
    expect(galleryIndexAfterKey(0, 9, "previous")).toBe(8);
    expect(galleryIndexAfterKey(8, 9, "next")).toBe(0);
    expect(galleryIndexAfterKey(2, 9, "close")).toBeNull();
    expect(galleryIndexAfterKey(0, 1, "next")).toBe(0);
  });
});

describe("motorsport gallery markup", () => {
  it("keeps the empty state and does not invent photographs", () => {
    const markup = html(
      createElement(MotorsportMediaGallery, {
        config: { heading: "Power Maxed Racing", supporting: "Do not alter watermarks.", items: [] },
      }),
    );
    expect(markup).toContain('data-gallery-empty="true"');
    expect(markup).toContain("licensed");
    expect(markup).toContain("Do not alter watermarks");
    expect(markup).not.toContain("data-gallery-lightbox");
    expect(markup).not.toContain("<img");
  });

  it("renders CMS images with predictable spans, focal points, and captions", () => {
    const markup = html(
      createElement(MotorsportMediaGallery, {
        config: {
          eyebrow: "Gallery",
          heading: "Power Maxed Racing",
          items: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => photo(index)),
        },
      }),
    );
    expect(markup).toContain("Power Maxed Racing");
    expect(markup).toContain('data-gallery-count="9"');
    expect(markup).toContain('data-gallery-tile="feature"');
    expect(markup).toContain("grid-cols-1");
    expect(markup).toContain("sm:grid-cols-2");
    expect(markup).toContain("xl:grid-cols-6");
    expect(markup).toContain("gap-3");
    expect(markup).not.toContain("row-span");
    expect(markup).toContain('src="/api/cms-media/media-1"');
    expect(markup).toContain("Pit lane");
    expect(markup).toContain("object-position:30% 70%");
    expect(markup).toContain("object-contain");
    expect(markup).toContain("loading=\"lazy\"");
    expect(markup).toContain("loading=\"eager\"");
    expect(markup).toContain('fetchPriority="high"');
    expect(markup).toContain('<link rel="preload" as="image" href="/api/cms-media/media-1"');
    const feature = markup.slice(markup.indexOf('data-gallery-tile="feature"'), markup.indexOf('data-gallery-tile="mosaic"'));
    expect(feature).toContain('loading="eager"');
    expect(feature).not.toContain('loading="lazy"');
    expect(markup.match(/data-desktop-span="2"/g)?.length).toBe(6);
    expect(markup.match(/data-desktop-span="3"/g)?.length).toBe(2);
    expect(markup.match(/data-desktop-span="6"/g)?.length).toBe(1);
  });

  it("drops items that have no media source", () => {
    const markup = html(
      createElement(MotorsportMediaGallery, {
        config: { heading: "Gallery", items: [{ alt: "Missing" }, photo(1)] },
      }),
    );
    expect(markup).toContain('data-gallery-count="1"');
    expect(markup).not.toContain("Missing");
  });

  it("renders the lightbox with the original image, caption, and controls", () => {
    const markup = html(
      createElement(MotorsportGalleryDialog, {
        photos: [
          {
            src: "/api/cms-media/media-1",
            alt: "Race photograph 1",
            caption: "Formation lap",
            fit: "fill",
            focal: { objectPosition: "50% 50%" },
          },
          {
            src: "/api/cms-media/media-2",
            alt: "Race photograph 2",
            caption: "",
            fit: "fill",
            focal: { objectPosition: "50% 50%" },
          },
        ],
        index: 0,
        onIndexChange: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('src="/api/cms-media/media-1"');
    expect(markup).toContain("object-contain");
    expect(markup).not.toContain("object-cover");
    expect(markup).toContain("Formation lap");
    expect(markup).toContain("Close photograph");
    expect(markup).toContain("Previous photograph");
    expect(markup).toContain("Next photograph");
    expect(markup).toContain("1 of 2");
    expect(markup).toContain('aria-live="polite"');
  });

  it("lets staff reorder, caption, and frame gallery photographs", () => {
    const markup = html(
      createElement(SectionSettings, {
        type: "MEDIA_GALLERY",
        config: {
          heading: "Gallery",
          items: [photo(1), photo(2)],
        },
        onChange: () => undefined,
      }),
    );
    expect(markup).toContain("The first photograph is featured");
    expect(markup).toContain("Featured photograph");
    expect(markup).toContain("Move earlier");
    expect(markup).toContain("Move later");
    expect(markup).toContain("Alt text");
    expect(markup).toContain("Caption");
    expect(markup).toContain("How the image fits");
    expect(markup).toContain("Focal position (horizontal)");
    expect(markup).toContain("Focal position (vertical)");
    expect(markup).toContain("Add image from Media");
    expect(markup).toContain("Pit lane");
  });
});
