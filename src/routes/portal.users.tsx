import { createFileRoute } from "@tanstack/react-router";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";

export const Route = createFileRoute("/portal/users")({
  head: () => ({
    meta: [
      { title: "Company & Users — Automotive Brands Trade Portal" },
      {
        name: "description",
        content:
          "Manage the people on your trade account: company admins, buyers, accounts users and read-only access.",
      },
      { property: "og:title", content: "Company & Users — Automotive Brands" },
      { property: "og:description", content: "Manage users and permissions on your trade account." },
    ],
  }),
  component: Users,
});

const users = [
  {
    name: "Karen Doyle",
    email: "karen@abcmotorfactors.co.uk",
    role: "Company Admin",
    perms: ["Place orders", "View pricing", "View invoices", "Manage users", "Request quotes"],
  },
  {
    name: "Dan Reeves",
    email: "buyer@abcmotorfactors.co.uk",
    role: "Buyer",
    perms: ["Place orders", "View pricing", "Request quotes"],
  },
  {
    name: "Sue Marchant",
    email: "accounts@abcmotorfactors.co.uk",
    role: "Accounts",
    perms: ["View invoices", "View pricing"],
  },
  {
    name: "Tom Ashby",
    email: "counter@abcmotorfactors.co.uk",
    role: "Read Only",
    perms: ["View catalogue"],
  },
];

function Users() {
  return (
    <div>
      <PanelHeader
        title="ABC Motor Factors Ltd"
        sub="Account ABC001 · 4 users · Trade A pricing"
        actions={
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold text-primary-foreground transition hover:brightness-110"
          >
            Invite user
          </button>
        }
      />
      <div className="p-4 sm:p-6">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2 font-semibold">User</th>
                <th className="px-3 py-2 font-semibold">Role</th>
                <th className="px-3 py-2 font-semibold">Permissions</th>
                <th className="px-3 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.email} className={`border-b border-border/60 ${i % 2 ? "bg-surface/30" : ""}`}>
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-[11px] text-steel">{u.email}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge tone={u.role === "Company Admin" ? "brand" : "neutral"}>
                      {u.role}
                    </StatusBadge>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {u.perms.map((p) => (
                        <span
                          key={p}
                          className="rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-steel"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[12px] font-semibold">
                    <button type="button" className="text-primary hover:underline">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
