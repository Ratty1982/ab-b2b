import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/purchasing/forecast")({
  component: () => <Outlet />,
});
