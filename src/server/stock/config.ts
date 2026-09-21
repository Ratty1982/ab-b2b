export type AutopartStockConfig = {
  source: "none" | "ftp" | "http" | "file";
  ftpHost: string | null;
  ftpPort: number;
  ftpUser: string | null;
  ftpPasswordSet: boolean;
  ftpPath: string;
  httpUrl: string | null;
  httpTokenSet: boolean;
  filePath: string | null;
  staleHours: number;
  scheduleMinutes: number;
  cronSecretSet: boolean;
  schedulerEnabled: boolean;
  maxBytes: number;
};

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadAutopartStockConfig(): AutopartStockConfig {
  const sourceRaw = (env("AUTOPART_STOCK_SOURCE") ?? "none").toLowerCase();
  const source: AutopartStockConfig["source"] =
    sourceRaw === "ftp" || sourceRaw === "http" || sourceRaw === "file" ? sourceRaw : "none";
  return {
    source,
    ftpHost: env("AUTOPART_STOCK_FTP_HOST"),
    ftpPort: envInt("AUTOPART_STOCK_FTP_PORT", 21),
    ftpUser: env("AUTOPART_STOCK_FTP_USER"),
    ftpPasswordSet: Boolean(env("AUTOPART_STOCK_FTP_PASSWORD")),
    ftpPath: env("AUTOPART_STOCK_FTP_PATH") ?? "231PO3NEW",
    httpUrl: env("AUTOPART_STOCK_HTTP_URL"),
    httpTokenSet: Boolean(env("AUTOPART_STOCK_HTTP_TOKEN")),
    filePath: env("AUTOPART_STOCK_FILE_PATH"),
    staleHours: envInt("AUTOPART_STOCK_STALE_HOURS", 36),
    scheduleMinutes: envInt("AUTOPART_STOCK_SCHEDULE_MINUTES", 15),
    cronSecretSet: Boolean(env("AUTOPART_STOCK_CRON_SECRET")),
    schedulerEnabled: env("AUTOPART_STOCK_ENABLE_SCHEDULER") === "true",
    maxBytes: envInt("AUTOPART_STOCK_MAX_BYTES", 15_000_000),
  };
}

export function autopartConfigured(config = loadAutopartStockConfig()): boolean {
  if (config.source === "http") return Boolean(config.httpUrl);
  if (config.source === "file") return Boolean(config.filePath);
  if (config.source === "ftp") return Boolean(config.ftpHost && config.ftpUser && config.ftpPasswordSet);
  return false;
}

export function publicAutopartStatus() {
  const config = loadAutopartStockConfig();
  return {
    configured: autopartConfigured(config),
    sourceType: config.source,
    scheduleMinutes: config.scheduleMinutes,
    scheduleTimezone: "UTC",
    staleHours: config.staleHours,
    schedulerEnabled: config.schedulerEnabled,
    cronEndpointConfigured: config.cronSecretSet,
  };
}
