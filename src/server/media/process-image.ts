import sharp, { type Metadata, type Sharp } from "sharp";
import { CMS_MEDIA_CONTENT_TYPES } from "@/domain/cms";
import {
  mediaUsageAppliesProductCap,
  PRODUCT_IMAGE_MAX_EDGE,
  type MediaUploadUsage,
} from "@/domain/media-usage";
import { AuthError } from "@/server/rbac/guards";

export type ProcessedImageUpload = {
  buffer: Buffer;
  mimeType: (typeof CMS_MEDIA_CONTENT_TYPES)[number];
  width: number;
  height: number;
  fileSize: number;
};

export function fitBoundingBox(
  width: number,
  height: number,
  maxEdge = PRODUCT_IMAGE_MAX_EDGE,
): { width: number; height: number; scaled: boolean } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new AuthError("Image has invalid dimensions", "VALIDATION", 400);
  }
  if (width <= maxEdge && height <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height), scaled: false };
  }
  const scale = Math.min(maxEdge / width, maxEdge / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}

export function sniffImageType(buf: Buffer): (typeof CMS_MEDIA_CONTENT_TYPES)[number] | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 6) {
    const header = buf.toString("ascii", 0, 6);
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  return null;
}

function mimeFromSharpFormat(
  format: string | undefined,
): (typeof CMS_MEDIA_CONTENT_TYPES)[number] | null {
  if (format === "png") return "image/png";
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  if (format === "gif") return "image/gif";
  return null;
}

async function encodeProcessed(
  pipeline: Sharp,
  mimeType: (typeof CMS_MEDIA_CONTENT_TYPES)[number],
): Promise<Buffer> {
  if (mimeType === "image/png") {
    return pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, effort: 7 }).toBuffer();
  }
  if (mimeType === "image/jpeg") {
    return pipeline
      .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" })
      .toBuffer();
  }
  if (mimeType === "image/webp") {
    return pipeline.webp({ quality: 88, alphaQuality: 100, effort: 4 }).toBuffer();
  }
  return pipeline.gif().toBuffer();
}

/**
 * Central image policy. PRODUCT_IMAGE is capped to a 1000×1000 bounding box
 * (aspect ratio preserved, never cropped/upscaled). CMS_GENERAL is stored as uploaded.
 */
export async function processImageUpload(opts: {
  buffer: Buffer;
  mimeType: string;
  usage: MediaUploadUsage;
}): Promise<ProcessedImageUpload> {
  const sniffed = sniffImageType(opts.buffer);
  if (!sniffed) {
    throw new AuthError("Unsupported image format", "VALIDATION", 400);
  }
  if (sniffed !== opts.mimeType) {
    throw new AuthError("File contents do not match the declared type", "VALIDATION", 400);
  }

  let meta: Metadata;
  try {
    meta =
      opts.usage === "CMS_GENERAL"
        ? await sharp(opts.buffer, { failOn: "error" }).metadata()
        : await sharp(opts.buffer, { failOn: "error" }).rotate().metadata();
  } catch {
    throw new AuthError("This file could not be read as an image", "VALIDATION", 400);
  }

  const width = meta.width;
  const height = meta.height;
  if (!width || !height) {
    throw new AuthError("Image has invalid dimensions", "VALIDATION", 400);
  }

  if (opts.usage === "CMS_GENERAL") {
    return {
      buffer: opts.buffer,
      mimeType: sniffed,
      width,
      height,
      fileSize: opts.buffer.length,
    };
  }

  const applyCap = mediaUsageAppliesProductCap(opts.usage);
  let outputMime = sniffed;
  if (applyCap && sniffed === "image/gif") {
    outputMime = "image/png";
  }

  try {
    let pipeline = sharp(opts.buffer, { failOn: "error", animated: false }).rotate();
    if (applyCap) {
      pipeline = pipeline.resize({
        width: PRODUCT_IMAGE_MAX_EDGE,
        height: PRODUCT_IMAGE_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    const buffer = await encodeProcessed(pipeline, outputMime);
    const outMeta = await sharp(buffer).metadata();
    const outW = outMeta.width ?? 0;
    const outH = outMeta.height ?? 0;
    if (!outW || !outH) {
      throw new AuthError("Image processing produced invalid dimensions", "VALIDATION", 400);
    }
    if (applyCap && (outW > PRODUCT_IMAGE_MAX_EDGE || outH > PRODUCT_IMAGE_MAX_EDGE)) {
      throw new AuthError("Processed image exceeded the product size limit", "VALIDATION", 400);
    }

    const encodedMime = mimeFromSharpFormat(outMeta.format) ?? outputMime;
    return {
      buffer,
      mimeType: encodedMime,
      width: outW,
      height: outH,
      fileSize: buffer.length,
    };
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError("This file could not be processed as an image", "VALIDATION", 400);
  }
}
