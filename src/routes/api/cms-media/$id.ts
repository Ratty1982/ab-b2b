import { createFileRoute } from "@tanstack/react-router";
import { getPublicCmsMediaBytes } from "@/server/cms/media";

function asciiFilename(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, "_").slice(0, 120);
  return cleaned || "image";
}

export const Route = createFileRoute("/api/cms-media/$id")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        try {
          const media = await getPublicCmsMediaBytes(params.id);
          if (!media) {
            return new Response("Not found", { status: 404 });
          }
          return new Response(new Uint8Array(media.bytes), {
            headers: {
              "Content-Type": media.contentType,
              "Cache-Control": "public, max-age=86400",
              "Content-Disposition": `inline; filename="${asciiFilename(media.filename)}"`,
            },
          });
        } catch (error) {
          console.error("[ab:cms-media]", error);
          return new Response("Not found", { status: 404 });
        }
      },
    },
  },
});
