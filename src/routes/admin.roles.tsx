import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Minus } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { salesTeam } from "@/lib/crm-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/roles")({
  head: () => ({
    meta: [
      { title: "Users, Roles & Permissions — Automotive Brands Admin" },
      {
        name: "description",
        content:
          "Internal and trade roles with granular permissions: super admin, management, sales, customer service, accounts, marketing and trade account roles.",
      },
      { property: "og:title", content: "Users, Roles & Permissions — Automotive Brands Admin" },
      { property: "og:description", content: "Control who can see pricing, place orders and manage accounts." },
    ],
  }),
  component: AdminRoles,
});

const internalRoles = [
  "Super Admin",
  "Management",
  "Sales Manager",
  "Sales Representative",
  "Customer Service",
  "Accounts",
  "Marketing",
];

const tradeRoles = ["Trade Account Admin", "Trade Buyer", "Trade Accounts User", "Trade Read Only"];

const permissions: { name: string; grants: (boolean | "partial")[] }[] = [
  { name: "View catalogue", grants: [true, true, true, true, true, true, true] },
  { name: "View customer pricing", grants: [true, true, true, true, true, true, false] },
  { name: "Edit price lists", grants: [true, true, "partial", false, false, false, false] },
  { name: "Place orders for customers", grants: [true, true, true, true, true, false, false] },
  { name: "Approve trade applications", grants: [true, true, true, false, "partial", true, false] },
  { name: "Set credit limits", grants: [true, true, false, false, false, true, false] },
  { name: "View invoices & statements", grants: [true, true, true, "partial", true, true, false] },
  { name: "Manage internal users", grants: [true, "partial", false, false, false, false, false] },
  { name: "Edit website content", grants: [true, true, false, false, false, false, true] },
  { name: "Export reports", grants: [true, true, true, "partial", false, true, "partial"] },
];

const tradePermissions: { name: string; grants: (boolean | "partial")[] }[] = [
  { name: "Place orders", grants: [true, true, false, false] },
  { name: "View pricing", grants: [true, true, true, true] },
  { name: "View invoices & statements", grants: [true, false, true, false] },
  { name: "Request quotes", grants: [true, true, false, false] },
  { name: "Manage company users", grants: [true, false, false, false] },
  { name: "Manage delivery addresses", grants: [true, "partial", false, false] },
];

const users = [
  { name: "Rachel Tibbs", email: "rachel.tibbs@automotivebrands.co.uk", role: "Super Admin", status: "Active" },
  { name: "Marcus Hale", email: "marcus.hale@automotivebrands.co.uk", role: "Sales Manager", status: "Active" },
  ...salesTeam.map((s) => ({
    name: s.name,
    email: `${s.name.toLowerCase().replace(" ", ".")}@automotivebrands.co.uk`,
    role: "Sales Representative",
    status: "Active",
  })),
  { name: "Dawn Fletcher", email: "dawn.fletcher@automotivebrands.co.uk", role: "Accounts", status: "Active" },
  { name: "Joe Bannerman", email: "joe.bannerman@automotivebrands.co.uk", role: "Marketing", status: "Invited" },
];

function Cell({ value }: { value: boolean | "partial" }) {
  return (
    <td className="px-3 py-2 text-center">
      {value === true ? (
        <Check className="mx-auto size-4 text-good" aria-label="Allowed" />
      ) : value === "partial" ? (
        <span className="num text-[11px] text-warn">Own records</span>
      ) : (
        <Minus className="mx-auto size-4 text-steel/50" aria-label="Not allowed" />
      )}
    </td>
  );
}

function AdminRoles() {
  const [tab, setTab] = useState<"Internal roles" | "Trade roles" | "Users">("Internal roles");

  return (
    <div>
      <PanelHeader
        title="Users, roles & permissions"
        sub="Not every internal user can see or change everything"
        actions={
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Invite user
          </button>
        }
      />

      <div className="flex gap-1 border-b border-border/70 px-4 sm:px-6">
        {(["Internal roles", "Trade roles", "Users"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-3 text-[13px] font-semibold",
              tab === t ? "border-primary text-foreground" : "border-transparent text-steel hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6">
        {tab === "Users" ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Email</th>
                  <th className="px-3 py-2 font-semibold">Role</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u, i) => (
                  <tr key={u.email} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                    <td className="px-3 py-2 font-medium">{u.name}</td>
                    <td className="px-3 py-2 text-steel">{u.email}</td>
                    <td className="px-3 py-2">{u.role}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={u.status === "Active" ? "good" : "warn"}>{u.status}</StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="text-[12px] font-semibold text-primary hover:underline">
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2 font-semibold">Permission</th>
                  {(tab === "Internal roles" ? internalRoles : tradeRoles).map((r) => (
                    <th key={r} className="px-3 py-2 text-center font-semibold">
                      {r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(tab === "Internal roles" ? permissions : tradePermissions).map((p, i) => (
                  <tr key={p.name} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    {p.grants.map((g, gi) => (
                      <Cell key={gi} value={g} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
