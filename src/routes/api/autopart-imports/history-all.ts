import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/infra/auth";
import { AuthError } from "@/server/rbac/guards";
import { confirmAllHistoricImport, previewAllHistoricImport } from "@/server/companies/autopart-history-all";

export const Route = createFileRoute("/api/autopart-imports/history-all")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const session = await auth.api.getSession({ headers: request.headers });
          if (!session?.user?.id) {
            return Response.json({ ok: false, error: "Authentication required" }, { status: 401 });
          }
          const form = await request.formData();
          const mode = String(form.get("mode") ?? "preview");
          const file561 = form.get("file561l");
          const fileSlrb = form.get("fileSlrb");
          if (!(file561 instanceof File) || !(fileSlrb instanceof File)) {
            return Response.json({ ok: false, error: "Choose both the 561L-ALL and SLRB-ALL files." }, { status: 400 });
          }
          const payload = {
            file561l: await file561.text(),
            fileSlrb: await fileSlrb.text(),
            filename561l: file561.name,
            filenameSlrb: fileSlrb.name,
          };
          const data =
            mode === "commit"
              ? await confirmAllHistoricImport(session.user.id, payload)
              : await previewAllHistoricImport(session.user.id, payload);
          return Response.json({ ok: true, data });
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
