import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell, type NavItem } from "@/components/ab/AppShell";

const nav: NavItem[] = [
  { label: "Dashboard", to: "/sales", exact: true },
  { label: "My Customers", to: "/sales/customers" },
  { label: "Leads", to: "/crm" },
  { label: "Opportunities", to: "/crm" },
  { label: "Quotes", to: "/crm" },
  { label: "Orders", to: "/portal/orders" },
  { label: "Tasks", to: "/sales" },
  { label: "Calendar / Activities", to: "/sales" },
];

export const Route = createFileRoute("/sales")({
  component: SalesLayout,
});

function SalesLayout() {
  return (
    <AppShell
      nav={nav}
      area="Sales Portal"
      user={{ name: "James Whitfield", role: "Sales Representative" }}
    >
      <Outlet />
    </AppShell>
  );
}
