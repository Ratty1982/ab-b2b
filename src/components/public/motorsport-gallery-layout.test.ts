import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MotorsportGalleryDialog, MotorsportMediaGallery } from "@/components/public/MotorsportMediaGallery";
import {
  desktopRows,
  galleryFrames,
  galleryIndexAfterKey,
  galleryKeyAction,
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
  expect(frames[0]).toMatchObject({ role: "feature", desktopSpan: 6, tabletSpan: 2 });
  const desktop = desktopRows(frames);
  const tablet = tabletRows(frames);
  for (const row of desktop) {
    expect(row.reduce((sum, span) => sum + span, 0)).toBe(6);
  }
  for (const row of tablet) {
    expect(row.reduce((sum, span) => sum + span, 0)).toBe(2);
  }
  const mosaic = frames.slice(1);
  const singletonDesktop = desktop.filter((row) => row.length === 1 && row[0] !== 6);
  expect(singletonDesktop).toEqual([]);
  if (mosaic.length !== 1) {
    expect(mosaic.filter((frame) => frame.desktopSpan === 6)).toEqual([]);
  }
}

describe("motorsport gallery placement", () => {
  it.each([1, 3, 5, 8, 9, 12])("balances %i photographs on desktop and tablet", (count) => {
    assertBalanced(count);
  });

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
    expect(markup).toContain("xl:grid-cols-6");
    expect(markup).not.toContain("row-span");
    expect(markup).toContain('src="/api/cms-media/media-1"');
    expect(markup).toContain("Pit lane");
    expect(markup).toContain("object-position:30% 70%");
    expect(markup).toContain("object-contain");
    expect(markup).toContain("loading=\"lazy\"");
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
  });
});
