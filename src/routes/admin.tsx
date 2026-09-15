import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell, type NavItem } from "@/components/ab/AppShell";

const nav: NavItem[] = [
  { label: "Overview", to: "/admin", exact: true },
  { label: "Products", to: "/admin/products" },
  { label: "Brands & Categories", to: "/admin/products" },
  { label: "Companies", to: "/sales/customers" },
  { label: "Trade Applications", to: "/crm/applications" },
  { label: "Orders", to: "/portal/orders" },
  { label: "Quotes", to: "/sales/quotes" },
  { label: "Price Lists & Pricing", to: "/admin/pricing" },
  { label: "Promotions", to: "/admin/pricing" },
  { label: "Sales Team", to: "/crm/manager" },
  { label: "Users & Permissions", to: "/admin/roles" },
  { label: "Website Content", to: "/admin/content" },
  { label: "Downloads", to: "/admin/content" },
  { label: "Settings", to: "/admin/settings" },
];

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <AppShell
      nav={nav}
      area="Internal Admin"
      user={{ name: "Rachel Tibbs", role: "Super Admin" }}
    >
      <Outlet />
    </AppShell>
  );
}
