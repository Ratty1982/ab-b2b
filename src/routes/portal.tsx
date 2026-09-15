import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell, type NavItem } from "@/components/ab/AppShell";

const nav: NavItem[] = [
  { label: "Dashboard", to: "/portal", exact: true },
  { label: "Shop", to: "/products" },
  { label: "Quick Order", to: "/portal/quick-order" },
  { label: "Orders", to: "/portal/orders" },
  { label: "Quotes", to: "/portal/quotes" },
  { label: "Invoices & Statements", to: "/portal/invoices" },
  { label: "Favourites / Order Lists", to: "/portal/favourites" },
  { label: "Downloads", to: "/resources" },
  { label: "Company & Users", to: "/portal/users" },
  { label: "Support", to: "/portal/support" },
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
