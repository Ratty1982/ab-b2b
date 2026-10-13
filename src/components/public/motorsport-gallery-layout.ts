/**
 * Placement for the motorsport gallery.
 *
 * The first CMS image is the featured photograph. Staff reorder it by moving
 * that image to the front. Every other image is a mosaic tile.
 *
 * Desktop uses six columns so a row can be three standard tiles (span 2),
 * two wider tiles (span 3), or one full-width tile (span 6). A remainder of
 * one is borrowed into the previous row so the last photograph is never left
 * alone. Two photographs share one row: the feature is twice as wide as its
 * companion, so the second image is not another panorama and the row is full.
 *
 * Tablet uses two columns. An odd final tile spans both columns at a shorter
 * ratio so the row stays full without becoming a second hero.
 * Mobile is one column; every tile is full width.
 */

export type GallerySpan = 2 | 3 | 4 | 6;

export type GalleryFrame = {
  role: "feature" | "mosaic";
  desktopSpan: GallerySpan;
  tabletSpan: 1 | 2;
  /** Companion beside the feature when the gallery has exactly two photographs. */
  pair?: boolean;
};

export type GalleryKeyAction = "close" | "previous" | "next" | "none";

export function desktopMosaicSpans(count: number): GallerySpan[] {
  if (count <= 0) return [];
  if (count === 1) return [6];
  const remainder = count % 3;
  const spans = Array.from({ length: count }, () => 2 as GallerySpan);
  if (remainder === 2) {
    spans[count - 2] = 3;
    spans[count - 1] = 3;
    return spans;
  }
  if (remainder === 1) {
    spans[count - 4] = 3;
    spans[count - 3] = 3;
    spans[count - 2] = 3;
    spans[count - 1] = 3;
  }
  return spans;
}

export function tabletMosaicSpans(count: number): Array<1 | 2> {
  if (count <= 0) return [];
  if (count === 1 || count % 2 === 1) {
    const spans = Array.from({ length: count }, () => 1 as 1 | 2);
    spans[count - 1] = 2;
    return spans;
  }
  return Array.from({ length: count }, () => 1 as const);
}

export function galleryFrames(count: number): GalleryFrame[] {
  if (count <= 0) return [];
  if (count === 2) {
    return [
      { role: "feature", desktopSpan: 4, tabletSpan: 2 },
      { role: "mosaic", desktopSpan: 2, tabletSpan: 2, pair: true },
    ];
  }
  const mosaicCount = count - 1;
  const desktop = desktopMosaicSpans(mosaicCount);
  const tablet = tabletMosaicSpans(mosaicCount);
  return [
    { role: "feature", desktopSpan: 6, tabletSpan: 2 },
    ...desktop.map((desktopSpan, index) => ({
      role: "mosaic" as const,
      desktopSpan,
      tabletSpan: tablet[index] ?? 1,
    })),
  ];
}

/** Rows of desktop spans. Each row must sum to 6. */
export function desktopRows(frames: GalleryFrame[]): GallerySpan[][] {
  const rows: GallerySpan[][] = [];
  let row: GallerySpan[] = [];
  let used = 0;
  for (const frame of frames) {
    if (used + frame.desktopSpan > 6) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(frame.desktopSpan);
    used += frame.desktopSpan;
    if (used === 6) {
      rows.push(row);
      row = [];
      used = 0;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

export function tabletRows(frames: GalleryFrame[]): Array<Array<1 | 2>> {
  const rows: Array<Array<1 | 2>> = [];
  let row: Array<1 | 2> = [];
  let used = 0;
  for (const frame of frames) {
    if (used + frame.tabletSpan > 2) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(frame.tabletSpan);
    used += frame.tabletSpan;
    if (used === 2) {
      rows.push(row);
      row = [];
      used = 0;
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

export function galleryKeyAction(key: string): GalleryKeyAction {
  if (key === "Escape") return "close";
  if (key === "ArrowLeft") return "previous";
  if (key === "ArrowRight") return "next";
  return "none";
}

/** Returns the next open index, or null when the lightbox should close. */
export function galleryIndexAfterKey(
  index: number,
  count: number,
  action: GalleryKeyAction,
): number | null {
  if (action === "close") return null;
  if (action === "previous" || action === "next") {
    if (count <= 1) return index;
    const delta = action === "next" ? 1 : -1;
    return (index + delta + count) % count;
  }
  return index;
}

export function mosaicFrameClass(frame: GalleryFrame): string {
  const tablet = frame.tabletSpan === 2 ? "sm:col-span-2" : "sm:col-span-1";
  const desktop =
    frame.desktopSpan === 6
      ? "xl:col-span-6"
      : frame.desktopSpan === 4
        ? "xl:col-span-4"
        : frame.desktopSpan === 3
          ? "xl:col-span-3"
          : "xl:col-span-2";
  let aspect = "aspect-[3/2]";
  if (frame.role === "feature") {
    aspect = "aspect-[4/3] sm:aspect-[16/9] xl:aspect-[2/1]";
  } else if (frame.pair) {
    aspect = "aspect-[3/2] sm:aspect-[3/2] xl:aspect-square";
  } else if (frame.desktopSpan === 6) {
    aspect = "aspect-[4/3] sm:aspect-[3/1] xl:aspect-[21/9]";
  } else if (frame.desktopSpan === 3 && frame.tabletSpan === 2) {
    aspect = "aspect-[3/2] sm:aspect-[3/1] xl:aspect-[9/4]";
  } else if (frame.desktopSpan === 3) {
    aspect = "aspect-[3/2] xl:aspect-[9/4]";
  } else if (frame.tabletSpan === 2) {
    aspect = "aspect-[3/2] sm:aspect-[3/1] xl:aspect-[3/2]";
  }
  return `relative col-span-1 overflow-hidden rounded-lg bg-[#0c1220] ${tablet} ${desktop} ${aspect}`;
}
