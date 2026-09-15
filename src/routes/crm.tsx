import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell, type NavItem } from "@/components/ab/AppShell";

const nav: NavItem[] = [
  { label: "Dashboard", to: "/sales", exact: true },
  { label: "Companies", to: "/sales/customers" },
  { label: "Contacts", to: "/crm", exact: true },
  { label: "Leads", to: "/crm", exact: true },
  { label: "Opportunities", to: "/crm", exact: true },
  { label: "Activities", to: "/crm", exact: true },
  { label: "Tasks", to: "/crm", exact: true },
  { label: "Quotes", to: "/sales/quotes" },
  { label: "Trade Applications", to: "/crm/applications" },
  { label: "Sales Team", to: "/crm/manager" },
  { label: "Reports", to: "/crm/manager" },
  { label: "Admin", to: "/admin" },
];

export const Route = createFileRoute("/crm")({
  component: CrmLayout,
});

function CrmLayout() {
  return (
    <AppShell nav={nav} area="CRM" user={{ name: "James Whitfield", role: "Sales Representative" }}>
      <Outlet />
    </AppShell>
  );
}
