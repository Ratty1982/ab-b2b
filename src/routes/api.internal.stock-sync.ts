import { createFileRoute } from "@tanstack/react-router";
import { publicAutopartStatus, runCronStockSync } from "@/server/stock/service";
import { AuthError } from "@/server/rbac/guards";

function cronSecret(request: Request): string | null {
  const header = request.headers.get("x-autopart-cron-secret")?.trim();
  if (header) return header;
  const auth = request.headers.get("authorization")?.trim();
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const url = new URL(request.url);
  return url.searchParams.get("secret");
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Stock sync failed";
  return Response.json({ ok: false, error: message }, { status: 500 });
}

export const Route = createFileRoute("/api/internal/stock-sync")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({ ok: true, ...publicAutopartStatus() });
      },
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dryRun") === "true";
          const result = await runCronStockSync(cronSecret(request), dryRun);
          return Response.json({ ok: true, ...result });
        } catch (error) {
          return errorResponse(error);
        }
      },
    },
  },
});
