import { describe, expect, it } from "vitest";
import { CMS_IMAGE_FIT_LABELS, validateSectionConfig } from "@/domain/cms";
import {
  SECTION_LIBRARY,
  addEditorSection,
  collectMediaIds,
  deleteEditorSection,
  duplicateEditorSection,
  moveEditorSection,
  reorderEditorSections,
  toggleEditorSection,
  EDITOR_VIEWPORTS,
} from "@/domain/cms-editor";
import { HERO_IMAGE_STANDARD, heroRecommendedCopy } from "@/lib/hero-image";
import { getMediaStorageStatus } from "@/server/cms/storage";
import { readImageSize } from "@/server/cms/media";

describe("CMS editor draft operations", () => {
  it("adds, duplicates, reorders, toggles and deletes controlled sections", () => {
    let sections = addEditorSection([], "HERO", "a");
    sections = addEditorSection(sections, "TRADE_CTA", "b");
    expect(sections.map((s) => s.type)).toEqual(["HERO", "TRADE_CTA"]);
    sections = duplicateEditorSection(sections, "a", "a2");
    expect(sections.map((s) => s.id)).toEqual(["a", "a2", "b"]);
    sections = moveEditorSection(sections, "b", -1);
    expect(sections.map((s) => s.id)).toEqual(["a", "b", "a2"]);
    sections = reorderEditorSections(sections, "a2", "a");
    expect(sections.map((s) => s.id)).toEqual(["a2", "a", "b"]);
    sections = toggleEditorSection(sections, "b", false);
    expect(sections.find((s) => s.id === "b")?.enabled).toBe(false);
    sections = deleteEditorSection(sections, "a");
    expect(sections.map((s) => s.id)).toEqual(["a2", "b"]);
  });

  it("lists every controlled section type in the library", () => {
    expect(SECTION_LIBRARY.map((s) => s.type)).toEqual([
      "HERO",
      "BRAND_LOGO_STRIP",
      "FEATURED_BRANDS",
      "CATEGORY_GRID",
      "FEATURED_PRODUCTS",
      "TEXT_IMAGE",
      "IMAGE_TEXT",
      "BENEFITS_GRID",
      "TRADE_CTA",
      "BANNER",
      "RICH_TEXT",
      "SPACER",
    ]);
  });

  it("uses realistic preview widths", () => {
    expect(EDITOR_VIEWPORTS.desktop).toBe(1280);
    expect(EDITOR_VIEWPORTS.tablet).toBe(768);
    expect(EDITOR_VIEWPORTS.mobile).toBe(390);
  });
});

describe("hero image standard and schema", () => {
  it("documents the hero-parts canvas size", () => {
    expect(HERO_IMAGE_STANDARD).toEqual({
      width: 1200,
      height: 1008,
      aspectRatio: "25:21",
      aspectDecimal: 1200 / 1008,
    });
    expect(heroRecommendedCopy()).toMatch(/1200/);
    expect(heroRecommendedCopy()).toMatch(/25:21/);
  });

  it("accepts hero eyebrow, overlay, focal point and fill-area fit", () => {
    const cfg = validateSectionConfig("HERO", {
      eyebrow: "UK supply",
      headline: "Hello",
      overlayStrength: "20",
      media: { mediaId: "clxxxxxxxxxxxxxxxxxxxxxxxxx", alt: "Parts", fit: "fill", focalX: "30", focalY: 70 },
    }) as {
      eyebrow: string;
      overlayStrength: number;
      media?: { fit?: string; focalX?: number; focalY?: number };
    };
    expect(cfg.eyebrow).toBe("UK supply");
    expect(cfg.overlayStrength).toBe(20);
    expect(cfg.media?.fit).toBe("fill");
    expect(cfg.media?.focalX).toBe(30);
    expect(cfg.media?.focalY).toBe(70);
    expect(CMS_IMAGE_FIT_LABELS.fill).toBe("Fill Area");
    expect(CMS_IMAGE_FIT_LABELS.contain).toBe("Show Whole Image");
  });

  it("collects media ids from nested configs", () => {
    const ids = collectMediaIds({
      media: { mediaId: "clxxxxxxxxxxxxxxxxxxxxxxxxx" },
      logos: { "steel-seal": { mediaId: "clyyyyyyyyyyyyyyyyyyyyyyy" } },
    });
    expect(ids.size).toBe(2);
  });
});

describe("media storage and upload validation helpers", () => {
  it("reports database fallback when S3 env is absent", () => {
    const status = getMediaStorageStatus();
    expect(status.provider).toBe("database");
    expect(status.uploadsEnabled).toBe(true);
    expect(status.message).toMatch(/S3_/);
  });

  it("reads PNG dimensions", () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    expect(readImageSize(png)).toEqual({ width: 1, height: 1 });
  });
});
