import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_HEADER_LOGO_SRC,
  SITE_HEADER_LOGO_MAX_BYTES,
  SITE_HEADER_LOGO_MAX_EDGE,
  SITE_HEADER_LOGO_MIN_EDGE,
  buildHeaderLogoSrc,
  guessSiteHeaderLogoContentType,
  isSiteHeaderLogoContentType,
  looksLikeSvgUpload,
  validateSiteHeaderLogoDimensions,
} from "@/domain/site-branding";

describe("site branding domain", () => {
  it("accepts only jpeg/png/webp content types", () => {
    expect(isSiteHeaderLogoContentType("image/png")).toBe(true);
    expect(isSiteHeaderLogoContentType("image/jpeg")).toBe(true);
    expect(isSiteHeaderLogoContentType("image/webp")).toBe(true);
    expect(isSiteHeaderLogoContentType("image/gif")).toBe(false);
    expect(isSiteHeaderLogoContentType("image/svg+xml")).toBe(false);
  });

  it("guesses content type from filename extensions", () => {
    expect(guessSiteHeaderLogoContentType("mark.PNG")).toBe("image/png");
    expect(guessSiteHeaderLogoContentType("mark.jpeg")).toBe("image/jpeg");
    expect(guessSiteHeaderLogoContentType("mark.webp")).toBe("image/webp");
    expect(guessSiteHeaderLogoContentType("mark.svg")).toBeNull();
  });

  it("rejects SVG by filename, type, or payload sniff", () => {
    expect(looksLikeSvgUpload({ filename: "logo.svg" })).toBe(true);
    expect(looksLikeSvgUpload({ contentType: "image/svg+xml" })).toBe(true);
    expect(
      looksLikeSvgUpload({
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      }),
    ).toBe(true);
    expect(
      looksLikeSvgUpload({
        filename: "logo.png",
        contentType: "image/png",
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      }),
    ).toBe(false);
  });

  it("validates logo dimensions against min/max edges", () => {
    expect(validateSiteHeaderLogoDimensions(SITE_HEADER_LOGO_MIN_EDGE, SITE_HEADER_LOGO_MIN_EDGE)).toBeNull();
    expect(validateSiteHeaderLogoDimensions(16, 16)).toMatch(/at least/);
    expect(
      validateSiteHeaderLogoDimensions(SITE_HEADER_LOGO_MAX_EDGE + 1, 100),
    ).toMatch(/at most/);
    expect(validateSiteHeaderLogoDimensions(0, 100)).toMatch(/invalid/i);
  });

  it("builds cache-busted cms media URLs and keeps the static default constant", () => {
    expect(DEFAULT_SITE_HEADER_LOGO_SRC).toBe("/brand/ab-logo.jpg");
    expect(SITE_HEADER_LOGO_MAX_BYTES).toBe(2 * 1024 * 1024);
    const at = new Date("2026-11-05T12:00:00.000Z");
    expect(buildHeaderLogoSrc("clxxxxxxxx", at)).toBe(
      `/api/cms-media/clxxxxxxxx?v=${at.getTime()}`,
    );
  });
});
