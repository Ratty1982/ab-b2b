import { createFileRoute } from "@tanstack/react-router";
import type { CustomerSalesUploadRole } from "@prisma/client";
import { auth } from "@/infra/auth";
import { AuthError } from "@/server/rbac/guards";
import { saveCustomerSalesUpload } from "@/server/companies/customer-sales-upload";

const ROLES = new Set<CustomerSalesUploadRole>(["HISTORY_561L", "HISTORY_SLRB", "ONGOING"]);

export const Route = createFileRoute("/api/customer-sales-uploads")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const session = await auth.api.getSession({ headers: request.headers });
          if (!session?.user?.id) {
            return Response.json({ ok: false, error: "Authentication required" }, { status: 401 });
          }
          const role = request.headers.get("x-upload-role") ?? "";
          const filename = request.headers.get("x-filename") ?? "";
          const companyId = request.headers.get("x-company-id") ?? "";
          if (!ROLES.has(role as CustomerSalesUploadRole)) {
            return Response.json({ ok: false, error: "Unsupported sales report type" }, { status: 400 });
          }
          if (!companyId) {
            return Response.json({ ok: false, error: "Customer is required" }, { status: 400 });
          }
          const saved = await saveCustomerSalesUpload({
            actorUserId: session.user.id,
            companyId,
            filename,
            role: role as CustomerSalesUploadRole,
            body: request.body,
          });
          return Response.json({ ok: true, data: saved });
        } catch (error) {
          if (error instanceof AuthError) {
            return Response.json({ ok: false, error: error.message }, { status: error.status });
          }
          console.error("[ab:customer-sales-upload] upload failed");
          return Response.json({ ok: false, error: "Upload failed" }, { status: 500 });
        }
      },
    },
  },
});
