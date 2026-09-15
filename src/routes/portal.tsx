import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell, type NavItem } from "@/components/ab/AppShell";

const nav: NavItem[] = [
  { label: "Dashboard", to: "/portal", exact: true },
  { label: "Shop", to: "/products" },
  { label: "Quick Order", to: "/portal/quick-order" },
  { label: "Orders", to: "/portal/orders" },
  { label: "Quotes", to: "/portal/orders" },
  { label: "Invoices", to: "/portal/orders" },
  { label: "Favourites / Order Lists", to: "/portal" },
  { label: "Downloads", to: "/resources" },
  { label: "Company & Users", to: "/portal/users" },
  { label: "Support", to: "/contact" },
];

export const Route = createFileRoute("/portal")({
  component: PortalLayout,
});

function PortalLayout() {
  return (
    <AppShell
      nav={nav}
      area="Trade Portal"
      user={{ name: "Dan Reeves", role: "Buyer · ABC Motor Factors" }}
    >
      <Outlet />
    </AppShell>
  );
}
