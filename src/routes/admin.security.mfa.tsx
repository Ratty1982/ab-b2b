import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/security/mfa")({
  beforeLoad: () => {
    throw redirect({ href: "/account/security" });
  },
  component: function AccountSecurityRedirect() {
    return null;
  },
});
