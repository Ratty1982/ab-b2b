import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/infra/auth";
import { AuthError } from "@/server/rbac/guards";
import { writeProspectConversionExceptions } from "@/server/companies/autopart-prospect-conversion";

export const Route = createFileRoute("/api/autopart-imports/prospect-exceptions/csv")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          const session = await auth.api.getSession({ headers: request.headers });
          if (!session?.user?.id)
            return Response.json({ ok: false, error: "Authentication required" }, { status: 401 });
          const runId = new URL(request.url).searchParams.get("runId")?.trim();
          if (!runId)
            return Response.json({ ok: false, error: "runId is required" }, { status: 400 });
          const encoder = new TextEncoder();
          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              try {
                await writeProspectConversionExceptions(session.user.id, runId, (chunk) => {
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
              "content-disposition": 'attachment; filename="autopart-prospect-exceptions.csv"',
              "cache-control": "no-store",
            },
          });
        } catch (error) {
          if (error instanceof AuthError) {
            return Response.json({ ok: false, error: error.message }, { status: error.status });
          }
          console.error("[ab:autopart-import] prospect exception export failed");
          return Response.json({ ok: false, error: "Export failed" }, { status: 500 });
        }
      },
    },
  },
});
