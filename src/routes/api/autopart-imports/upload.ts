import { createFileRoute } from "@tanstack/react-router";
import type { AutopartMasterImportKind } from "@prisma/client";
import { auth } from "@/infra/auth";
import { AuthError } from "@/server/rbac/guards";
import { saveAutopartUpload } from "@/server/companies/autopart-master-import";

const KINDS = new Set<AutopartMasterImportKind>(["CUSTOMER_MASTER", "INVOICE_LINES", "LEDGER"]);

export const Route = createFileRoute("/api/autopart-imports/upload")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const session = await auth.api.getSession({ headers: request.headers });
          if (!session?.user?.id)
            return Response.json({ ok: false, error: "Authentication required" }, { status: 401 });
          const kind = request.headers.get("x-autopart-kind") ?? "";
          const filename = request.headers.get("x-autopart-filename") ?? "";
          if (!KINDS.has(kind as AutopartMasterImportKind)) {
            return Response.json(
              { ok: false, error: "Unsupported Autopart file type" },
              { status: 400 },
            );
          }
          const saved = await saveAutopartUpload({
            actorUserId: session.user.id,
            filename,
            kind: kind as AutopartMasterImportKind,
            body: request.body,
          });
          return Response.json({ ok: true, data: saved });
        } catch (error) {
          if (error instanceof AuthError) {
            return Response.json({ ok: false, error: error.message }, { status: error.status });
          }
          console.error("[ab:autopart-import] upload failed");
          return Response.json({ ok: false, error: "Upload failed" }, { status: 500 });
        }
      },
    },
  },
});
