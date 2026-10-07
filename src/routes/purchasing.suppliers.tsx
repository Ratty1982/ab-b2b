import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/purchasing/suppliers")({
  component: () => <Outlet />,
});
