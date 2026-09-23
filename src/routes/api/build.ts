import { createFileRoute } from "@tanstack/react-router";

/**
 * Safe deploy identity for verifying Coolify/runtime matches GitHub.
 * Never includes secrets. SOURCE_COMMIT is commonly injected by Coolify.
 */
export const Route = createFileRoute("/api/build")({
  server: {
    handlers: {
      GET: async () => {
        const sha =
          process.env["SOURCE_COMMIT"] ||
          process.env["GIT_SHA"] ||
          process.env["COMMIT_SHA"] ||
          process.env["CF_PAGES_COMMIT_SHA"] ||
          "unknown";
        const body = {
          ok: true as const,
          sha,
          nodeEnv: process.env["NODE_ENV"] ?? "unknown",
        };
        return Response.json(body, {
          headers: {
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
