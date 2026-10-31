import { createFileRoute } from "@tanstack/react-router";

import { assertAppRelativeLocation, sanitizeMicrosoftMessage } from "@/domain/microsoft-365-crm";
import { auth } from "@/infra/auth";
import { microsoft365CallbackUser, microsoft365CompleteCallback } from "@/server/microsoft-365/service";

/**
 * OAuth redirect target. The browser may send `code` and `state` only.
 * The response location is a fixed application path.
 */
export const Route = createFileRoute("/api/microsoft-365/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        let location = "/crm/microsoft?microsoft=token";
        try {
          const session = await auth.api.getSession({ headers: request.headers });
          const userId = await microsoft365CallbackUser(session?.user?.id ?? null);
          location = await microsoft365CompleteCallback({
            userId,
            code: url.searchParams.get("code"),
            state: url.searchParams.get("state"),
            error: url.searchParams.get("error"),
          });
        } catch (error) {
          console.error(
            "[ab:microsoft-365]",
            sanitizeMicrosoftMessage(error instanceof Error ? error.message : "callback failed"),
          );
        }
        const safe = assertAppRelativeLocation(location);
        const appUrl = process.env["APP_URL"]?.trim() || "http://localhost:43127";
        const target = new URL(safe, appUrl);
        const app = new URL(appUrl);
        if (target.origin !== app.origin) {
          return Response.redirect(new URL("/crm/microsoft?microsoft=token", app.origin), 302);
        }
        return Response.redirect(target, 302);
      },
    },
  },
});
