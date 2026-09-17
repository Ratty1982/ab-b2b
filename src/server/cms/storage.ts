/**
 * Media storage: Postgres (survives Coolify) or S3-compatible (Cloudflare R2).
 * Never write image bytes to the container filesystem.
 */
import { createHash, createHmac } from "node:crypto";

export type MediaStorageProvider = "database" | "s3";

export type MediaStorageStatus = {
  provider: MediaStorageProvider;
  uploadsEnabled: boolean;
  configured: boolean;
  message: string;
};

export type StoredObject = {
  provider: MediaStorageProvider;
  storageKey: string;
  bytes: Uint8Array | null;
  publicUrl: string | null;
};

type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string | null;
};

function env(name: string): string {
  return process.env[name]?.trim() || "";
}

export function readS3Config(): S3Config | null {
  const endpoint = env("S3_ENDPOINT") || env("OBJECT_STORAGE_ENDPOINT");
  const bucket = env("S3_BUCKET") || env("OBJECT_STORAGE_BUCKET");
  const accessKeyId = env("S3_ACCESS_KEY_ID") || env("OBJECT_STORAGE_ACCESS_KEY");
  const secretAccessKey = env("S3_SECRET_ACCESS_KEY") || env("OBJECT_STORAGE_SECRET_KEY");
  const region = env("S3_REGION") || env("OBJECT_STORAGE_REGION") || "auto";
  const publicBaseUrl = env("S3_PUBLIC_BASE_URL") || env("OBJECT_STORAGE_PUBLIC_BASE_URL") || "";
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint: endpoint.replace(/\/$/, ""),
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: publicBaseUrl ? publicBaseUrl.replace(/\/$/, "") : null,
  };
}

export function getMediaStorageStatus(): MediaStorageStatus {
  if (readS3Config()) {
    return {
      provider: "s3",
      uploadsEnabled: true,
      configured: true,
      message: "Uploads go to S3-compatible object storage (Cloudflare R2).",
    };
  }
  return {
    provider: "database",
    uploadsEnabled: true,
    configured: true,
    message:
      "Uploads are stored in Postgres so they survive Coolify deploys. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (and optionally S3_REGION, S3_PUBLIC_BASE_URL) to use Cloudflare R2.",
  };
}

export async function putMediaObject(opts: {
  storageKey: string;
  bytes: Buffer;
  contentType: string;
}): Promise<StoredObject> {
  const s3 = readS3Config();
  if (s3) {
    await s3Put(s3, opts.storageKey, opts.bytes, opts.contentType);
    const publicUrl = s3.publicBaseUrl ? `${s3.publicBaseUrl}/${opts.storageKey}` : null;
    return { provider: "s3", storageKey: opts.storageKey, bytes: null, publicUrl };
  }
  return {
    provider: "database",
    storageKey: opts.storageKey,
    bytes: Uint8Array.from(opts.bytes),
    publicUrl: null,
  };
}

export async function getMediaObjectBytes(row: {
  storageProvider: string;
  storageKey: string;
  bytes: Uint8Array | null;
}): Promise<Buffer | null> {
  if (row.bytes && row.bytes.length) return Buffer.from(row.bytes);
  if (row.storageProvider === "s3" && row.storageKey) {
    const s3 = readS3Config();
    if (!s3) return null;
    return s3Get(s3, row.storageKey);
  }
  return null;
}

export async function deleteMediaObject(row: {
  storageProvider: string;
  storageKey: string;
}): Promise<void> {
  if (row.storageProvider !== "s3") return;
  const s3 = readS3Config();
  if (!s3) return;
  await s3Delete(s3, row.storageKey);
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function hashHex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function amzDate(now: Date): { amz: string; date: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: iso, date: iso.slice(0, 8) };
}

function endpointHost(endpoint: string): string {
  return new URL(endpoint.includes("://") ? endpoint : `https://${endpoint}`).host;
}

function objectUrl(cfg: S3Config, key: string): URL {
  const base = cfg.endpoint.includes("://") ? cfg.endpoint : `https://${cfg.endpoint}`;
  return new URL(`/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`, `${base}/`);
}

async function signedRequest(
  cfg: S3Config,
  method: "PUT" | "GET" | "DELETE",
  key: string,
  body: Buffer | null,
  contentType?: string,
): Promise<Response> {
  const url = objectUrl(cfg, key);
  const now = new Date();
  const { amz, date } = amzDate(now);
  const payloadHash = hashHex(body ?? Buffer.alloc(0));
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-date": amz,
    "x-amz-content-sha256": payloadHash,
  };
  if (contentType) headers["content-type"] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonical = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/${cfg.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${hashHex(canonical)}`;
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, date);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url, {
    method,
    headers,
    ...(method === "PUT" && body ? { body: new Uint8Array(body) } : {}),
  });
}

async function s3Put(cfg: S3Config, key: string, bytes: Buffer, contentType: string) {
  const res = await signedRequest(cfg, "PUT", key, bytes, contentType);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`S3 upload failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

async function s3Get(cfg: S3Config, key: string): Promise<Buffer | null> {
  const res = await signedRequest(cfg, "GET", key, null);
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

async function s3Delete(cfg: S3Config, key: string) {
  const res = await signedRequest(cfg, "DELETE", key, null);
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`S3 delete failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

/** Exported for unit tests */
export const _s3Test = { endpointHost, objectUrl, amzDate };
