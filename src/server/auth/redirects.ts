/** Post-login landing based on actor class / roles — not merely "logged in". */
export function resolvePostLoginPath(session: {
  user: {
    actorType: "INTERNAL" | "TRADE";
    systemRoles: string[];
  };
}): string {
  const { user } = session;
  if (user.actorType === "TRADE") return "/portal";
  if (user.systemRoles.includes("SUPER_ADMIN")) return "/admin";
  if (user.systemRoles.includes("MANAGEMENT")) return "/crm/manager";
  if (
    user.systemRoles.includes("SALES_MANAGER") ||
    user.systemRoles.includes("SALES_REPRESENTATIVE")
  ) {
    return "/sales";
  }
  if (user.systemRoles.includes("MARKETING")) return "/admin/content";
  if (user.systemRoles.includes("ACCOUNTS")) return "/admin";
  if (user.systemRoles.includes("CUSTOMER_SERVICE")) return "/sales";
  return "/";
}

/** Validate return URLs — relative paths only, prevent open redirects */
export function safeReturnPath(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string") return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) return fallback;
  if (raw.length > 512) return fallback;
  return raw;
}
