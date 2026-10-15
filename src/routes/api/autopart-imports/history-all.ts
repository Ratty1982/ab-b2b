import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/infra/auth";
import { AuthError } from "@/server/rbac/guards";
import {
  previewStoredHistoricImport,
  saveHistoricUpload,
  startStoredHistoricImport,
} from "@/server/companies/autopart-history-all";

export const Route = createFileRoute("/api/autopart-imports/history-all")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const session = await auth.api.getSession({ headers: request.headers });
          if (!session?.user?.id) {
            return Response.json({ ok: false, error: "Authentication required" }, { status: 401 });
          }
          const action = request.headers.get("x-autopart-action") ?? "upload";
          const importId = request.headers.get("x-autopart-import-id");
          if (action === "preview") {
            if (!importId) return Response.json({ ok: false, error: "Upload both files first." }, { status: 400 });
            const data = await previewStoredHistoricImport(session.user.id, importId);
            return Response.json({ ok: true, data });
          }
          if (action === "commit") {
            if (!importId) return Response.json({ ok: false, error: "Upload both files first." }, { status: 400 });
            const data = await startStoredHistoricImport(session.user.id, importId);
            return Response.json({ ok: true, data });
          }
          const slot = request.headers.get("x-autopart-history-file");
          if (slot !== "561l" && slot !== "slrb") {
            return Response.json({ ok: false, error: "Choose a 561L-ALL or SLRB-ALL file." }, { status: 400 });
          }
          const saved = await saveHistoricUpload({
            actorUserId: session.user.id,
            slot,
            filename: request.headers.get("x-autopart-filename") ?? `${slot}.csv`,
            body: request.body,
            importId,
          });
          return Response.json({ ok: true, data: saved });
        } catch (error) {
          if (error instanceof AuthError) {
            return Response.json({ ok: false, error: error.message }, { status: error.status });
          }
          console.error("[ab:history-all] upload failed", error);
          return Response.json({ ok: false, error: "Historical import failed" }, { status: 500 });
        }
      },
    },
  },
});
