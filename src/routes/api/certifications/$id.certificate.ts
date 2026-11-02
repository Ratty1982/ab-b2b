import { createFileRoute } from "@tanstack/react-router";
import { certificationPdfCacheControl } from "@/domain/certifications";
import { resolveOptionalRequestUserId } from "@/server/auth/request-session";
import {
  getAdminCertificationPdfBytes,
  getPublicCertificationPdfBytes,
} from "@/server/certifications/service";

function asciiFilename(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "_").slice(0, 120);
  return cleaned || "certificate.pdf";
}

function notFoundResponse() {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": certificationPdfCacheControl("missing"),
    },
  });
}

export const Route = createFileRoute("/api/certifications/$id/certificate")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        try {
          const actorUserId = await resolveOptionalRequestUserId();
          let servedAsAdmin = false;
          let pdf = null as Awaited<ReturnType<typeof getPublicCertificationPdfBytes>>;
          if (actorUserId) {
            pdf = await getAdminCertificationPdfBytes(actorUserId, params.id).catch(() => null);
            if (pdf) servedAsAdmin = true;
          }
          if (!pdf) {
            pdf = await getPublicCertificationPdfBytes(params.id);
          }
          if (!pdf) return notFoundResponse();
          return new Response(new Uint8Array(pdf.bytes), {
            headers: {
              "Content-Type": pdf.contentType,
              "Cache-Control": certificationPdfCacheControl(servedAsAdmin ? "admin" : "public"),
              "Content-Disposition": `inline; filename="${asciiFilename(pdf.filename)}"`,
            },
          });
        } catch (error) {
          console.error("[ab:certifications-pdf]", error);
          return notFoundResponse();
        }
      },
    },
  },
});
