import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { guestSession } from "@/lib/session";
import { DEFAULT_SITE_HEADER_LOGO_SRC } from "@/domain/site-branding";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: {
      queryClient,
      session: guestSession,
      publicOrigin: "",
      siteBranding: {
        headerLogoSrc: DEFAULT_SITE_HEADER_LOGO_SRC,
        isCustom: false,
        cacheKey: null,
      },
    },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
