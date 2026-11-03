import { createServerFn } from "@tanstack/react-start";
import { canonicalOrigin } from "@/domain/public-origin";

/** APP_URL origin for canonical links. Host-only; not a cookie domain. */
export const getPublicOrigin = createServerFn({ method: "GET" }).handler(async () => {
  const { getServerEnv } = await import("@/server/env");
  return canonicalOrigin(getServerEnv().APP_URL);
});
