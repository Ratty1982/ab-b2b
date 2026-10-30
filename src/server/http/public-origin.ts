import { createServerFn } from "@tanstack/react-start";
import { canonicalOrigin } from "@/domain/public-origin";
import { getServerEnv } from "@/server/env";

/** APP_URL origin for canonical links. Host-only; not a cookie domain. */
export const getPublicOrigin = createServerFn({ method: "GET" }).handler(async () => {
  return canonicalOrigin(getServerEnv().APP_URL);
});
