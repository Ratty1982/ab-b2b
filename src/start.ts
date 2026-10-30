import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { migrationRequestDecision } from "@/domain/legacy-redirects";
import { STRICT_TRANSPORT_SECURITY } from "@/domain/transport-security";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/**
 * Baseline production security headers.
 * Auth/session cookies and RBAC land in Phase 1 — this only hardens responses.
 */
const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const response = result.response;
  if (!response) return result;

  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  // frame-ancestors in CSP is authoritative; keep XFO for older clients.
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (process.env["NODE_ENV"] === "production") {
    // This host only. Do not widen the policy to other names in the zone.
    headers.set("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY);
  }
  // Modest CSP compatible with TanStack/Vite + Google Fonts currently in use.
  // Do not add remote script hosts without an explicit review.
  if (!headers.has("Content-Security-Policy")) {
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join("; "),
    );
  }

  return {
    ...result,
    response: new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
  };
});

/**
 * Explicit WordPress paths, plus www → the APP_URL origin.
 * Does not redirect the b2b hostname. API callers on b2b stay on that host.
 */
const migrationRedirectMiddleware = createMiddleware().server(async ({ request, next }) => {
  const decision = migrationRequestDecision({
    method: request.method,
    requestUrl: request.url,
    appUrl: process.env["APP_URL"],
  });
  if (!decision) return next();
  if (decision.status === 410) {
    return new Response("Gone", {
      status: 410,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return Response.redirect(decision.location, decision.status);
});

// Start installs CSRF automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [
    errorMiddleware,
    securityHeadersMiddleware,
    migrationRedirectMiddleware,
    csrfMiddleware,
  ],
}));
