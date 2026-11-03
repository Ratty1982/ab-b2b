import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientBoundaryStubId } from "../../../vite.client-boundary";

const root = process.cwd();

describe("client server boundary", () => {
  it("sends secret-bearing server modules to browser stubs", () => {
    expect(clientBoundaryStubId("@/infra/auth")).toMatch(/auth-stub\.ts$/);
    expect(clientBoundaryStubId("@/infra/auth/auth")).toMatch(/auth-stub\.ts$/);
    expect(clientBoundaryStubId("/workspace/src/infra/auth/auth")).toMatch(/auth-stub\.ts$/);
    expect(clientBoundaryStubId("/workspace/src/infra/auth")).toMatch(/auth-stub\.ts$/);
    expect(clientBoundaryStubId("@/server/env")).toMatch(/env-stub\.ts$/);
    expect(clientBoundaryStubId("/workspace/src/server/env")).toMatch(/env-stub\.ts$/);
    expect(clientBoundaryStubId("@/infra/database/client")).toMatch(/database-stub\.ts$/);
    expect(clientBoundaryStubId("/workspace/src/infra/database/client")).toMatch(/database-stub\.ts$/);
    expect(clientBoundaryStubId("@prisma/client")).toMatch(/prisma-stub\.ts$/);
    expect(clientBoundaryStubId("@/infra/auth/client")).toBeNull();
    expect(clientBoundaryStubId("/workspace/src/server/auth/session")).toBeNull();
    expect(clientBoundaryStubId("@/domain/mfa-policy")).toBeNull();
  });

  it("keeps secrets and Better Auth construction out of the browser stubs", () => {
    const stubs = ["auth-stub.ts", "env-stub.ts", "database-stub.ts", "prisma-stub.ts"].map((name) =>
      readFileSync(join(root, "src/client-boundary", name), "utf8"),
    );
    for (const source of stubs) {
      expect(source).not.toContain("betterAuth");
      expect(source).not.toContain("AUTH_SECRET");
      expect(source).not.toContain("DATABASE_URL");
      expect(source).not.toContain("postgresql://");
      expect(source).not.toContain("MICROSOFT_365");
      expect(source).not.toContain("dev-only-change-me");
      expect(source).not.toContain("@prisma/client");
    }
  });

  it("installs the boundary only for the Vite client environment", () => {
    const config = readFileSync(join(root, "vite.config.ts"), "utf8");
    expect(config).toContain("clientBoundaryPlugin()");
    const plugin = readFileSync(join(root, "vite.client-boundary.ts"), "utf8");
    expect(plugin).toContain('!== "client"');
  });
});
