import { createFileRoute } from "@tanstack/react-router";
import { resolveOptionalRequestUserId } from "@/server/auth/request-session";
import {
  getAdminCertificationPdfBytes,
  getPublicCertificationPdfBytes,
} from "@/server/certifications/service";

function asciiFilename(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "_").slice(0, 120);
  return cleaned || "certificate.pdf";
}

export const Route = createFileRoute("/api/certifications/$id/certificate")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        try {
          const actorUserId = await resolveOptionalRequestUserId();
          const pdf = actorUserId
            ? (await getAdminCertificationPdfBytes(actorUserId, params.id).catch(() => null)) ??
              (await getPublicCertificationPdfBytes(params.id))
            : await getPublicCertificationPdfBytes(params.id);
          if (!pdf) return new Response("Not found", { status: 404 });
          return new Response(new Uint8Array(pdf.bytes), {
            headers: {
              "Content-Type": pdf.contentType,
              "Cache-Control": actorUserId ? "private, max-age=60" : "public, max-age=3600",
              "Content-Disposition": `inline; filename="${asciiFilename(pdf.filename)}"`,
            },
          });
        } catch (error) {
          console.error("[ab:certifications-pdf]", error);
          return new Response("Not found", { status: 404 });
        }
      },
    },
  },
});
