import { createFileRoute } from "@tanstack/react-router";
import { getProductDocumentBytes } from "@/server/catalogue/product-documents";
import { resolveOptionalRequestUserId } from "@/server/auth/request-session";

function asciiFilename(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "_").slice(0, 120);
  return cleaned || "document.pdf";
}

export const Route = createFileRoute("/api/product-documents/$id")({
  server: {
    handlers: {
      GET: async ({
        params,
        request,
      }: {
        params: { id: string };
        request: Request;
      }) => {
        try {
          const actorUserId = await resolveOptionalRequestUserId();
          const url = new URL(request.url);
          const asDownload = url.searchParams.get("download") === "1";
          const media = await getProductDocumentBytes(params.id, {
            actorUserId,
            allowArchived: true,
          });
          if (!media) {
            return new Response("Not found", { status: 404 });
          }
          const disposition = asDownload ? "attachment" : "inline";
          return new Response(new Uint8Array(media.bytes), {
            headers: {
              "Content-Type": media.contentType,
              "Cache-Control": actorUserId
                ? "private, max-age=60"
                : "public, max-age=3600",
              "Content-Disposition": `${disposition}; filename="${asciiFilename(media.filename)}"`,
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          console.error("[ab:product-documents]", error);
          return new Response("Not found", { status: 404 });
        }
      },
    },
  },
});
