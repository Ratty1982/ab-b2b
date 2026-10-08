import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/infra/auth";
import { AuthError } from "@/server/rbac/guards";
import { writeAutopartReconciliationCsv } from "@/server/companies/autopart-master-import";

export const Route = createFileRoute("/api/autopart-imports/reconciliation/csv")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          const session = await auth.api.getSession({ headers: request.headers });
          if (!session?.user?.id)
            return Response.json({ ok: false, error: "Authentication required" }, { status: 401 });
          const account = new URL(request.url).searchParams.get("account")?.trim() || undefined;
          const encoder = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              try {
                await writeAutopartReconciliationCsv(session.user.id, account, (chunk) => {
                  controller.enqueue(encoder.encode(chunk));
                });
                controller.close();
              } catch (error) {
                controller.error(error);
              }
            },
          });
          return new Response(stream, {
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "content-disposition": 'attachment; filename="autopart-reconciliation.csv"',
              "cache-control": "no-store",
            },
          });
        } catch (error) {
          if (error instanceof AuthError) {
            return Response.json({ ok: false, error: error.message }, { status: error.status });
          }
          console.error("[ab:autopart-import] reconciliation export failed");
          return Response.json({ ok: false, error: "Export failed" }, { status: 500 });
        }
      },
    },
  },
});
