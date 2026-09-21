import { readFile } from "node:fs/promises";
import { AuthError } from "@/server/rbac/guards";
import { loadAutopartStockConfig, type AutopartStockConfig } from "@/server/stock/config";

export type FetchedFeed = {
  text: string;
  bytes: number;
  sourceLabel: string;
};

export async function fetchAutopartFeed(config: AutopartStockConfig = loadAutopartStockConfig()): Promise<FetchedFeed> {
  if (config.source === "file") {
    if (!config.filePath) throw new AuthError("AUTOPART_STOCK_FILE_PATH is not set", "CONFIG", 400);
    const buf = await readFile(config.filePath);
    if (buf.byteLength > config.maxBytes) throw new AuthError("Stock feed exceeds maximum size", "VALIDATION", 400);
    return { text: buf.toString("utf8"), bytes: buf.byteLength, sourceLabel: `file:${config.filePath}` };
  }
  if (config.source === "http") {
    if (!config.httpUrl) throw new AuthError("AUTOPART_STOCK_HTTP_URL is not set", "CONFIG", 400);
    const headers: Record<string, string> = {};
      const token = process.env["AUTOPART_STOCK_HTTP_TOKEN"]?.trim();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(config.httpUrl, { headers });
    if (!res.ok) throw new AuthError(`Stock HTTP source returned ${res.status}`, "UPSTREAM", 502);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > config.maxBytes) throw new AuthError("Stock feed exceeds maximum size", "VALIDATION", 400);
    return { text: buf.toString("utf8"), bytes: buf.byteLength, sourceLabel: "http" };
  }
  if (config.source === "ftp") {
    return fetchFtp(config);
  }
  throw new AuthError("Autopart stock source is not configured", "CONFIG", 400);
}

async function fetchFtp(config: AutopartStockConfig): Promise<FetchedFeed> {
  const password = process.env["AUTOPART_STOCK_FTP_PASSWORD"] ?? "";
  if (!config.ftpHost || !config.ftpUser) {
    throw new AuthError("FTP stock source is incomplete", "CONFIG", 400);
  }
  const { Client } = await import("basic-ftp");
  const Writable = await import("node:stream").then((m) => m.Writable);
  const client = new Client(15000);
  const chunks: Buffer[] = [];
  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      const size = chunks.reduce((n, c) => n + c.byteLength, 0);
      if (size > config.maxBytes) {
        cb(new Error("Stock feed exceeds maximum size"));
        return;
      }
      cb();
    },
  });
  try {
    await client.access({
      host: config.ftpHost,
      port: config.ftpPort,
      user: config.ftpUser,
      password,
      secure: false,
    });
    await client.downloadTo(writable, config.ftpPath);
  } finally {
    client.close();
  }
  const buf = Buffer.concat(chunks);
  return { text: buf.toString("utf8"), bytes: buf.byteLength, sourceLabel: `ftp:${config.ftpPath}` };
}
