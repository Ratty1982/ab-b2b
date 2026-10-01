import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/version-updates")({
  component: () => <Outlet />,
});
