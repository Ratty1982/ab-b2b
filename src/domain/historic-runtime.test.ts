import { describe, expect, it } from "vitest";
import {
  describeHistoricEnvironment,
  describeHistoricStorage,
  importLockIsAbandoned,
} from "@/domain/historic-runtime";

describe("historic runtime labels", () => {
  it("keeps a _test database isolated even when Coolify variables exist", () => {
    const report = describeHistoricEnvironment(
      { COOLIFY_FQDN: "app.example" },
      { database: "automotive_brands_test", host: "localhost" },
    );
    expect(report.kind).toBe("isolated-test");
    expect(report.coolify).toBe(false);
    expect(report.productionResetAllowed).toBe(false);
  });

  it("labels a Coolify service separately from a local application database", () => {
    expect(
      describeHistoricEnvironment({ COOLIFY_RESOURCE_UUID: "abc" }, { database: "automotive_brands", host: "db" }).kind,
    ).toBe("coolify");
    expect(
      describeHistoricEnvironment({}, { database: "automotive_brands", host: "localhost" }).kind,
    ).toBe("local-application");
  });

  it("requires a persistent volume when the import directory is unset", () => {
    const missing = describeHistoricStorage({}, "/app");
    expect(missing.persistent).toBe(false);
    expect(missing.directory).toBe("/app/data/autopart-imports");
    const set = describeHistoricStorage({ AUTOPART_IMPORT_DIR: "/data/autopart-imports" }, "/app");
    expect(set.persistent).toBe(true);
    expect(set.directory).toBe("/data/autopart-imports");
  });

  it("treats a dead local process or a stale heartbeat as an abandoned import", () => {
    const now = Date.parse("2026-10-15T12:00:00.000Z");
    expect(
      importLockIsAbandoned("host:99:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", new Date(now), now, {
        hostname: "host",
        pidAlive: () => false,
      }),
    ).toBe(true);
    expect(
      importLockIsAbandoned("other:99:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", new Date(now - 60_000), now, {
        hostname: "host",
        pidAlive: () => true,
      }),
    ).toBe(false);
    expect(
      importLockIsAbandoned("other:99:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", new Date(now - 4 * 60_000), now, {
        hostname: "host",
        pidAlive: () => true,
      }),
    ).toBe(true);
  });
});
