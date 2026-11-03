import path from "node:path";
import type { Plugin } from "vite";

const stubDir = path.resolve(process.cwd(), "src/client-boundary");

/**
 * Modules that read secrets or open the database.
 * The client environment receives a stub. Server and SSR keep the real module.
 */
const SPECIFIER_STUBS: Record<string, string> = {
  "@/infra/auth": path.join(stubDir, "auth-stub.ts"),
  "@/infra/auth/index": path.join(stubDir, "auth-stub.ts"),
  "@/infra/auth/auth": path.join(stubDir, "auth-stub.ts"),
  "@/server/env": path.join(stubDir, "env-stub.ts"),
  "@/infra/database/client": path.join(stubDir, "database-stub.ts"),
};

const FILE_STUBS: Array<[string, string]> = [
  ["/src/infra/auth/auth.ts", SPECIFIER_STUBS["@/infra/auth"]!],
  ["/src/infra/auth/auth", SPECIFIER_STUBS["@/infra/auth"]!],
  ["/src/infra/auth/index.ts", SPECIFIER_STUBS["@/infra/auth"]!],
  ["/src/infra/auth/index", SPECIFIER_STUBS["@/infra/auth"]!],
  ["/src/infra/auth", SPECIFIER_STUBS["@/infra/auth"]!],
  ["/src/server/env.ts", SPECIFIER_STUBS["@/server/env"]!],
  ["/src/server/env", SPECIFIER_STUBS["@/server/env"]!],
  ["/src/infra/database/client.ts", SPECIFIER_STUBS["@/infra/database/client"]!],
  ["/src/infra/database/client", SPECIFIER_STUBS["@/infra/database/client"]!],
];

export function clientBoundaryStubId(id: string): string | null {
  const bare = id.split("?")[0] ?? id;
  const mapped = SPECIFIER_STUBS[bare];
  if (mapped) return mapped;
  const normalised = bare.replaceAll("\\", "/");
  if (
    normalised === "@prisma/client" ||
    normalised.endsWith("/.prisma/client/index-browser") ||
    normalised.includes("@prisma/client/runtime/index-browser")
  ) {
    return path.join(stubDir, "prisma-stub.ts");
  }
  // Longer suffixes first so /auth/auth wins over /auth, and /auth/client is left alone.
  const ordered = [...FILE_STUBS].sort((a, b) => b[0].length - a[0].length);
  for (const [suffix, stub] of ordered) {
    if (normalised.endsWith(suffix)) return stub;
  }
  return null;
}

export function clientBoundaryPlugin(): Plugin {
  return {
    name: "ab-client-server-boundary",
    enforce: "pre",
    resolveId(id) {
      if ((this.environment?.name ?? "unknown") !== "client") return null;
      return clientBoundaryStubId(id);
    },
  };
}
