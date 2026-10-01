import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import {
  createCustomerGroupFn,
  listCustomerGroupsFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/customers/groups/")({
  head: () => ({
    meta: [{ title: "Customer Groups — Automotive Brands Admin" }],
  }),
  component: CustomerGroupsPage,
});

type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  companyCount: number;
};

function CustomerGroupsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<GroupRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await listCustomerGroupsFn({ data: { includeInactive } });
    if (!res.ok) {
      setError(res.error);
      setItems([]);
      return;
    }
    setError(null);
    setItems(res.data.items);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  return (
    <div>
      <PanelHeader
        title="Customer Groups"
        sub="Automotive Brands reporting groups — not Autopart account hierarchy"
        crumbs={[
          { label: "Sales" },
          { label: "Customers", to: ROUTES.adminCustomers },
          { label: "Customer Groups" },
        ]}
        actions={
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-[13px] font-bold uppercase text-primary-foreground"
          >
            <Plus className="size-4" aria-hidden />
            Create group
          </button>
        }
      />

      <div className="space-y-4 px-4 py-4 sm:px-6">
        {error ? <p className="text-[13px] text-bad">{error}</p> : null}
        <label className="flex items-center gap-2 text-[12px] text-steel">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Include inactive groups
        </label>

        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full text-left text-[13px]">
            <thead className="border-b border-border bg-surface/60 text-[11px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-4 py-3">Group</th>
                <th className="px-4 py-3">Companies</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? (
                items.map((g) => (
                  <tr key={g.id} className="border-b border-border/60">
                    <td className="px-4 py-3">
                      <Link
                        to="/admin/customers/groups/$groupId"
                        params={{ groupId: g.id }}
                        className="font-semibold hover:text-primary"
                      >
                        {g.name}
                      </Link>
                      {g.description ? (
                        <div className="text-[12px] text-steel">{g.description}</div>
                      ) : null}
                    </td>
                    <td className="num px-4 py-3">{g.companyCount}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={g.active ? "good" : "neutral"}>
                        {g.active ? "Active" : "Inactive"}
                      </StatusBadge>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-steel">
                    No Customer Groups yet. Create Vertu, Retail Accounts, or other commercial
                    groupings as needed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-steel">
          Customer Group → Company → MAM account(s) → documents → product lines. Grouping does not
          change Autopart hierarchy, financial ownership, or trade login access.
        </p>
      </div>

      {createOpen ? (
        <Drawer open title="Create Customer Group" onClose={() => setCreateOpen(false)}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                setSaving(true);
                const res = await createCustomerGroupFn({
                  data: { name, description: description || null },
                });
                setSaving(false);
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("Customer Group created");
                setCreateOpen(false);
                setName("");
                setDescription("");
                void navigate({
                  to: "/admin/customers/groups/$groupId",
                  params: { groupId: res.data.id },
                });
              })();
            }}
          >
            <Field label="Name">
              <input
                required
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Vertu"
              />
            </Field>
            <Field label="Description">
              <textarea
                className={inputClass}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional commercial context"
              />
            </Field>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create group"}
            </button>
          </form>
        </Drawer>
      ) : null}
    </div>
  );
}
