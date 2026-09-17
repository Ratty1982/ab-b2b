import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { AuthError } from "@/server/rbac/guards";
import { fitBoundingBox, processImageUpload } from "@/server/media/process-image";

async function rgbaPng(width: number, height: number): Promise<Buffer> {
  const mark = Math.max(1, Math.floor(Math.min(width, height) / 5));
  const stamp = await sharp({
    create: { width: mark, height: mark, channels: 4, background: { r: 180, g: 20, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: stamp, left: Math.floor(width / 3), top: Math.floor(height / 8) }])
    .png()
    .toBuffer();
}

async function jpegRgb(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 50, b: 60 } },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function hasTransparentPixel(buf: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] === 0) return true;
  }
  return false;
}

describe("fitBoundingBox", () => {
  it("maps the documented product catalogue examples", () => {
    expect(fitBoundingBox(877, 2048)).toEqual({ width: 428, height: 1000, scaled: true });
    expect(fitBoundingBox(2185, 2835)).toEqual({ width: 771, height: 1000, scaled: true });
    expect(fitBoundingBox(2000, 1000)).toEqual({ width: 1000, height: 500, scaled: true });
    expect(fitBoundingBox(1500, 1500)).toEqual({ width: 1000, height: 1000, scaled: true });
    expect(fitBoundingBox(800, 800)).toEqual({ width: 800, height: 800, scaled: false });
    expect(fitBoundingBox(600, 1400)).toEqual({ width: 429, height: 1000, scaled: true });
  });
});

describe("processImageUpload PRODUCT_IMAGE", () => {
  it("resizes a tall transparent PNG to ~428×1000 and keeps alpha", async () => {
    const input = await rgbaPng(877, 2048);
    const out = await processImageUpload({ buffer: input, mimeType: "image/png", usage: "PRODUCT_IMAGE" });
    expect(out.mimeType).toBe("image/png");
    expect(out.width).toBe(428);
    expect(out.height).toBe(1000);
    expect(await hasTransparentPixel(out.buffer)).toBe(true);
  });

  it("resizes a large portrait to ~771×1000", async () => {
    const input = await rgbaPng(2185, 2835);
    const out = await processImageUpload({ buffer: input, mimeType: "image/png", usage: "PRODUCT_IMAGE" });
    expect(out.width).toBe(771);
    expect(out.height).toBe(1000);
  });

  it("resizes landscape 2000×1000 to 1000×500", async () => {
    const input = await jpegRgb(2000, 1000);
    const out = await processImageUpload({ buffer: input, mimeType: "image/jpeg", usage: "PRODUCT_IMAGE" });
    expect(out.mimeType).toBe("image/jpeg");
    expect(out.width).toBe(1000);
    expect(out.height).toBe(500);
  });

  it("resizes a square 1500×1500 to 1000×1000", async () => {
    const input = await jpegRgb(1500, 1500);
    const out = await processImageUpload({ buffer: input, mimeType: "image/jpeg", usage: "PRODUCT_IMAGE" });
    expect(out.width).toBe(1000);
    expect(out.height).toBe(1000);
  });

  it("does not upscale an 800×800 image", async () => {
    const input = await jpegRgb(800, 800);
    const out = await processImageUpload({ buffer: input, mimeType: "image/jpeg", usage: "PRODUCT_IMAGE" });
    expect(out.width).toBe(800);
    expect(out.height).toBe(800);
  });

  it("resizes a tall 600×1400 image to ~429×1000", async () => {
    const input = await rgbaPng(600, 1400);
    const out = await processImageUpload({ buffer: input, mimeType: "image/png", usage: "PRODUCT_IMAGE" });
    expect(out.width).toBe(429);
    expect(out.height).toBe(1000);
  });

  it("rejects invalid image payloads", async () => {
    await expect(
      processImageUpload({
        buffer: Buffer.from("not-an-image"),
        mimeType: "image/png",
        usage: "PRODUCT_IMAGE",
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe("processImageUpload CMS_GENERAL", () => {
  it("does not apply the product 1000px cap", async () => {
    const input = await jpegRgb(2000, 1000);
    const out = await processImageUpload({ buffer: input, mimeType: "image/jpeg", usage: "CMS_GENERAL" });
    expect(out.width).toBe(2000);
    expect(out.height).toBe(1000);
    expect(out.buffer.equals(input)).toBe(true);
  });
});
