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
  /** True only after an operator has proved the directory survives container replacement. The path setting is not that proof. */
  persistent: boolean;
  persistenceProven: false;
  checklist: readonly string[];
  requirement: string;
};

const STORAGE_CHECKLIST = [
  "Confirm the Coolify persistent volume is mounted at the AUTOPART_IMPORT_DIR path. Setting the variable only names a directory.",
  "Write a marker file in that directory, replace the container, and confirm the marker and the original ALL files are still present.",
  "Back up the import directory independently of PostgreSQL. A database backup stores the SHA-256 and the path. The original file bytes are not in the database, so restoring PostgreSQL does not restore the files.",
] as const;

export function describeHistoricStorage(env: NodeJS.ProcessEnv, cwd: string): HistoricStorageReport {
  const configured = Boolean(env["AUTOPART_IMPORT_DIR"]?.trim());
  const directory = configured ? env["AUTOPART_IMPORT_DIR"]!.trim() : `${cwd}/data/autopart-imports`;
  return {
    directory,
    configured,
    persistent: false,
    persistenceProven: false,
    checklist: STORAGE_CHECKLIST,
    requirement: configured
      ? `AUTOPART_IMPORT_DIR is set to ${directory}. That records a path only. It does not prove the directory is a Coolify persistent volume or that files survive container replacement. Confirm the volume is mounted, confirm a marker file is still there after the container is replaced, and back up that directory independently of PostgreSQL. The database stores the SHA-256 and the path. The original bytes are not in the database.`
      : `AUTOPART_IMPORT_DIR is unset. Original ALL files are written under ${directory}, which a container replacement discards. Set the variable only after a Coolify persistent volume is mounted at that path. Confirm a marker file survives container replacement. Back up that directory independently of PostgreSQL, because the database stores the SHA-256 and the path, not the original bytes.`,
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
