/**
 * Labels the database this process is connected to.
 * Coolify production is recognised only from Coolify's own environment variables.
 * A database whose name ends with _test stays an isolated test database.
 */

export type HistoricEnvironmentKind = "isolated-test" | "coolify" | "local-application";

export type HistoricEnvironmentReport = {
  kind: HistoricEnvironmentKind;
  database: string | null;
  host: string | null;
  coolify: boolean;
  productionResetAllowed: false;
  summary: string;
};

export function describeHistoricEnvironment(
  env: NodeJS.ProcessEnv,
  database: { database: string | null; host: string | null },
): HistoricEnvironmentReport {
  const coolify = Object.keys(env).some((key) => key.startsWith("COOLIFY_"));
  const name = database.database;
  const isolated = Boolean(name?.endsWith("_test"));
  const kind: HistoricEnvironmentKind = isolated ? "isolated-test" : coolify ? "coolify" : "local-application";
  const where =
    kind === "isolated-test"
      ? `Isolated test database ${name}.`
      : kind === "coolify"
        ? `Coolify application database ${name ?? "unknown"} on ${database.host ?? "unknown"}.`
        : `Local application database ${name ?? "unknown"} on ${database.host ?? "unknown"}. Coolify environment variables are not set, so this is not the Coolify production service.`;
  return {
    kind,
    database: name,
    host: database.host,
    coolify: kind === "coolify",
    productionResetAllowed: false,
    summary: `${where} This report does not reset historical sales. A Coolify backup still needs its own verified restore before any live reset.`,
  };
}

export type HistoricStorageReport = {
  directory: string;
  configured: boolean;
  persistent: boolean;
  requirement: string;
};

export function describeHistoricStorage(env: NodeJS.ProcessEnv, cwd: string): HistoricStorageReport {
  const configured = Boolean(env["AUTOPART_IMPORT_DIR"]?.trim());
  const directory = configured ? env["AUTOPART_IMPORT_DIR"]!.trim() : `${cwd}/data/autopart-imports`;
  return {
    directory,
    configured,
    persistent: configured,
    requirement: configured
      ? "AUTOPART_IMPORT_DIR is set. Mount that exact path as a Coolify persistent volume. The database stores the SHA-256 only; the original bytes live on that volume and must survive redeploy and container replacement."
      : "AUTOPART_IMPORT_DIR is unset. Original ALL files are written under the application working directory, which Coolify replaces on deploy. Set AUTOPART_IMPORT_DIR to a mounted persistent volume before importing production history.",
  };
}

export const HISTORIC_IMPORT_STALE_MS = 3 * 60 * 1000;

export function importLockIsAbandoned(
  owner: string | null,
  heartbeatAt: Date | null,
  now: number,
  probe: { hostname: string; pidAlive: (pid: number) => boolean },
): boolean {
  if (!owner) return true;
  const match = /^([^:]+):(\d+):[0-9a-f-]+$/i.exec(owner);
  if (!match) return true;
  const host = match[1] ?? "";
  const pid = Number(match[2]);
  if (host === probe.hostname && !probe.pidAlive(pid)) return true;
  if (!heartbeatAt) return true;
  return now - heartbeatAt.getTime() > HISTORIC_IMPORT_STALE_MS;
}
