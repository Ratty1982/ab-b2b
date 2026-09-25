import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Minus } from "lucide-react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import { STAFF_ROLE_OPTIONS, type StaffUserStatus } from "@/domain/users";
import type { SystemRoleKey } from "@/domain/permissions";
import {
  createStaffUserFn,
  deactivateStaffUserFn,
  deleteStaffUserFn,
  listStaffUsersFn,
  reactivateStaffUserFn,
  resendStaffInvitationFn,
  resetStaffUserPasswordFn,
  sendUserPasswordResetEmailFn,
  updateStaffUserFn,
} from "@/server/phase2/fns";
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

type StaffUserRow = {
  id: string;
  name: string;
  email: string;
  role: SystemRoleKey | null;
  roleLabel: string;
  status: string;
  invitationLabel?: string;
  canHardDelete?: boolean;
  canResendInvitation?: boolean;
  canSendPasswordReset?: boolean;
  lastLoginAt?: string | null;
};

function statusTone(status: string) {
  if (status === "ACTIVE") return "good" as const;
  if (status === "DISABLED") return "bad" as const;
  return "warn" as const;
}

function statusLabel(status: string) {
  if (status === "ACTIVE") return "Active";
  if (status === "DISABLED") return "Disabled";
  if (status === "INVITED") return "Invited";
  return status;
}

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
  const [tab, setTab] = useState<"Internal roles" | "Trade roles" | "Users">("Users");
  const [users, setUsers] = useState<StaffUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canGrantSuperAdmin, setCanGrantSuperAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [manageUser, setManageUser] = useState<StaffUserRow | null>(null);
  const [issuedPassword, setIssuedPassword] = useState<{ email: string; password: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listStaffUsersFn();
    if (!result.ok) {
      setError(result.error);
      setUsers([]);
    } else {
      setUsers(result.data.items);
      setCanGrantSuperAdmin(result.data.canGrantSuperAdmin);
      setCurrentUserId(result.data.currentUserId);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const roleOptions = useMemo(
    () => STAFF_ROLE_OPTIONS.filter((option) => option.key !== "SUPER_ADMIN" || canGrantSuperAdmin),
    [canGrantSuperAdmin],
  );

  return (
    <div>
      <PanelHeader
        title="Users, roles & permissions"
        sub="Not every internal user can see or change everything"
        actions={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110"
          >
            Add user
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
          <UsersPanel
            users={users}
            loading={loading}
            error={error}
            onRetry={() => void load()}
            onAdd={() => setAddOpen(true)}
            onManage={setManageUser}
          />
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

      <AddUserDrawer
        open={addOpen}
        roleOptions={roleOptions}
        onClose={() => setAddOpen(false)}
        onCreated={async () => {
          setAddOpen(false);
          await load();
        }}
      />

      <ManageUserDrawer
        user={manageUser}
        currentUserId={currentUserId}
        roleOptions={roleOptions}
        onClose={() => setManageUser(null)}
        onSaved={async () => {
          setManageUser(null);
          await load();
        }}
        onPasswordReset={async (issued) => {
          setManageUser(null);
          setIssuedPassword(issued);
          await load();
        }}
        onDeleted={async () => {
          setManageUser(null);
          await load();
        }}
      />

      <IssuedPasswordDrawer
        issued={issuedPassword}
        onClose={() => setIssuedPassword(null)}
      />
    </div>
  );
}

function UsersPanel({
  users,
  loading,
  error,
  onRetry,
  onAdd,
  onManage,
}: {
  users: StaffUserRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onAdd: () => void;
  onManage: (user: StaffUserRow) => void;
}) {
  if (loading) {
    return <p className="text-[13px] text-steel">Loading users…</p>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-border bg-surface/40 p-6">
        <p className="text-[14px] font-medium">Could not load users</p>
        <p className="mt-1 text-[13px] text-steel">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
        >
          Try again
        </button>
      </div>
    );
  }
  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface/30 px-6 py-12 text-center">
        <p className="text-[15px] font-semibold">No internal users yet</p>
        <p className="mx-auto mt-2 max-w-md text-[13px] text-steel">
          Dummy staff have been removed. Add the people who should sign in to admin, sales and CRM.
        </p>
        <button
          type="button"
          onClick={onAdd}
          className="mt-5 h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase tracking-wide text-primary-foreground"
        >
          Add user
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
            <th className="px-3 py-2 font-semibold">Name</th>
            <th className="px-3 py-2 font-semibold">Email</th>
            <th className="px-3 py-2 font-semibold">Role</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Invitation</th>
            <th className="px-3 py-2 text-right font-semibold">Action</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={u.id} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
              <td className="px-3 py-2 font-medium">{u.name}</td>
              <td className="px-3 py-2 text-steel">{u.email}</td>
              <td className="px-3 py-2">{u.roleLabel}</td>
              <td className="px-3 py-2">
                <StatusBadge tone={statusTone(u.status)}>{statusLabel(u.status)}</StatusBadge>
              </td>
              <td className="px-3 py-2 text-[12px] text-steel">{u.invitationLabel ?? "—"}</td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onManage(u)}
                  className="text-[12px] font-semibold text-primary hover:underline"
                >
                  Manage
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddUserDrawer({
  open,
  roleOptions,
  onClose,
  onCreated,
}: {
  open: boolean;
  roleOptions: typeof STAFF_ROLE_OPTIONS;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<SystemRoleKey>("SALES_REPRESENTATIVE");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setFirstName("");
      setLastName("");
      setEmail("");
      setRole(
        roleOptions.some((option) => option.key === "SALES_REPRESENTATIVE")
          ? "SALES_REPRESENTATIVE"
          : roleOptions[0]!.key,
      );
      setSaving(false);
    }
  }, [open, roleOptions]);

  if (!open) return null;

  return (
    <Drawer
      open
      title="Create user"
      sub="Creates the account and emails a secure invitation to set a password. Passwords are never emailed."
      onClose={onClose}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            setSaving(true);
            const result = await createStaffUserFn({
              data: {
                firstName,
                lastName,
                email,
                role,
              },
            });
            setSaving(false);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            if (result.data.invitationSent) {
              toast.success(`${result.data.user.name} created — invitation sent`);
            } else {
              toast.warning(
                `${result.data.user.name} created — invitation email failed. Use Resend Invitation.`,
              );
            }
            await onCreated();
          })();
        }}
      >
        <Field label="First name" htmlFor="staff-first-name">
          <input
            id="staff-first-name"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
            autoComplete="given-name"
          />
        </Field>
        <Field label="Last name" htmlFor="staff-last-name">
          <input
            id="staff-last-name"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClass}
            autoComplete="family-name"
          />
        </Field>
        <Field label="Email" htmlFor="staff-email">
          <input
            id="staff-email"
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            autoComplete="email"
          />
        </Field>
        <Field label="Role" htmlFor="staff-role">
          <select
            id="staff-role"
            value={role}
            onChange={(e) => setRole(e.target.value as SystemRoleKey)}
            className={inputClass}
          >
            {roleOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-[12px] text-steel">
          They will receive a Set your password email and choose their own credentials. Staff never need
          to know the user&apos;s password.
        </p>
        <button
          type="submit"
          disabled={saving || !firstName.trim() || !lastName.trim() || !email.trim()}
          className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create & send invite"}
        </button>
      </form>
    </Drawer>
  );
}

function ManageUserDrawer({
  user,
  currentUserId,
  roleOptions,
  onClose,
  onSaved,
  onPasswordReset,
  onDeleted,
}: {
  user: StaffUserRow | null;
  currentUserId: string | null;
  roleOptions: typeof STAFF_ROLE_OPTIONS;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onPasswordReset: (issued: { email: string; password: string }) => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<SystemRoleKey>("SALES_REPRESENTATIVE");
  const [status, setStatus] = useState<StaffUserStatus>("ACTIVE");
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [resending, setResending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name);
      setRole(user.role ?? "SALES_REPRESENTATIVE");
      setStatus((user.status as StaffUserStatus) || "ACTIVE");
      setSaving(false);
      setNewPassword("");
      setConfirmReset(false);
      setResetting(false);
      setSendingReset(false);
      setResending(false);
      setDeleting(false);
      setDeleteOpen(false);
      setBusy(false);
    }
  }, [user]);

  if (!user) return null;

  const isSelf = user.id === currentUserId;
  const isInvited = user.status === "INVITED";
  const isActive = user.status === "ACTIVE";
  const isDisabled = user.status === "DISABLED";

  return (
    <Drawer open title="Manage user" sub={user.email} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void (async () => {
            setSaving(true);
            const result = await updateStaffUserFn({
              data: { id: user.id, name, role, status },
            });
            setSaving(false);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("User updated");
            await onSaved();
          })();
        }}
      >
        <div className="rounded-md border border-border bg-surface/40 px-3 py-3 text-[12px] text-steel">
          <p>
            Status: <span className="font-semibold text-foreground">{statusLabel(user.status)}</span>
          </p>
          <p className="mt-1">Invitation: {user.invitationLabel ?? "—"}</p>
          {user.lastLoginAt ? (
            <p className="mt-1">Last login: {new Date(user.lastLoginAt).toLocaleString("en-GB")}</p>
          ) : (
            <p className="mt-1">Last login: Never</p>
          )}
        </div>
        <Field label="Name" htmlFor="manage-name">
          <input
            id="manage-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Role" htmlFor="manage-role">
          <select
            id="manage-role"
            value={role}
            onChange={(e) => setRole(e.target.value as SystemRoleKey)}
            className={inputClass}
          >
            {roleOptions.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
            {user.role && !roleOptions.some((option) => option.key === user.role) ? (
              <option value={user.role}>{user.roleLabel}</option>
            ) : null}
          </select>
        </Field>
        <Field label="Status" htmlFor="manage-status">
          <select
            id="manage-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StaffUserStatus)}
            className={inputClass}
            disabled={isSelf}
          >
            <option value="ACTIVE">Active</option>
            <option value="INVITED">Invited</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </Field>
        {isSelf ? (
          <p className="text-[12px] text-steel">You cannot disable or delete your own account.</p>
        ) : null}
        <button
          type="submit"
          disabled={saving || resetting || busy || !name.trim()}
          className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>

      {isInvited ? (
        <div className="mt-6 grid gap-3 border-t border-border pt-5">
          <p className="text-[13px] font-semibold">Resend invitation</p>
          <p className="text-[12px] text-steel">
            Issues a fresh set-password link and emails it to {user.email}. Does not create a duplicate
            user.
          </p>
          <button
            type="button"
            disabled={saving || busy || resending}
            className="h-11 rounded-md border border-border text-[13px] font-bold uppercase disabled:opacity-50"
            onClick={() => {
              void (async () => {
                setResending(true);
                const result = await resendStaffInvitationFn({ data: { id: user.id } });
                setResending(false);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                if (result.data.invitationSent) {
                  toast.success("Invitation resent");
                } else {
                  toast.warning("Invitation reissued — email delivery failed");
                }
                await onSaved();
              })();
            }}
          >
            {resending ? "Sending…" : "Resend invitation"}
          </button>
        </div>
      ) : null}

      {isActive ? (
        <div className="mt-6 grid gap-3 border-t border-border pt-5">
          <p className="text-[13px] font-semibold">Send password reset</p>
          <p className="text-[12px] text-steel">
            Sends a secure reset link to {user.email}. Does not reveal or set a password — they choose a
            new one themselves.
          </p>
          <button
            type="button"
            disabled={saving || resetting || sendingReset || busy}
            className="h-11 rounded-md border border-border text-[13px] font-bold uppercase disabled:opacity-50"
            onClick={() => {
              void (async () => {
                setSendingReset(true);
                const result = await sendUserPasswordResetEmailFn({ data: { userId: user.id } });
                setSendingReset(false);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success(`Password reset email sent to ${result.data.email}`);
              })();
            }}
          >
            {sendingReset ? "Sending…" : "Send password reset email"}
          </button>
        </div>
      ) : null}

      {!isSelf && isActive ? (
        <div className="mt-6 grid gap-3 border-t border-border pt-5">
          <p className="text-[13px] font-semibold">Deactivate user</p>
          <p className="text-[12px] text-steel">
            Prevents login and revokes sessions. Preserves orders, audit and company history.
          </p>
          <button
            type="button"
            disabled={busy}
            className="h-11 rounded-md border border-border text-[13px] font-bold uppercase disabled:opacity-50"
            onClick={() => {
              void (async () => {
                setBusy(true);
                const result = await deactivateStaffUserFn({ data: { id: user.id } });
                setBusy(false);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("User deactivated");
                await onSaved();
              })();
            }}
          >
            Deactivate user
          </button>
        </div>
      ) : null}

      {!isSelf && isDisabled ? (
        <div className="mt-6 grid gap-3 border-t border-border pt-5">
          <p className="text-[13px] font-semibold">Reactivate user</p>
          <button
            type="button"
            disabled={busy}
            className="h-11 rounded-md border border-border text-[13px] font-bold uppercase disabled:opacity-50"
            onClick={() => {
              void (async () => {
                setBusy(true);
                const result = await reactivateStaffUserFn({ data: { id: user.id } });
                setBusy(false);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("User reactivated");
                await onSaved();
              })();
            }}
          >
            Reactivate user
          </button>
        </div>
      ) : null}

      {!isSelf && user.canHardDelete ? (
        <div className="mt-6 grid gap-3 border-t border-border pt-5">
          <p className="text-[13px] font-semibold text-bad">Delete user permanently</p>
          <p className="text-[12px] text-steel">
            Only available because this user has no retained business history (typically an unused
            invitation).
          </p>
          <button
            type="button"
            disabled={busy || deleting}
            className="h-11 rounded-md border border-bad/40 text-[13px] font-bold uppercase text-bad disabled:opacity-50"
            onClick={() => setDeleteOpen(true)}
          >
            Delete user
          </button>
        </div>
      ) : null}

      {!isSelf && !user.canHardDelete && !isInvited ? (
        <p className="mt-6 border-t border-border pt-5 text-[12px] text-steel">
          Permanent delete is unavailable — this user has business history. Deactivate instead.
        </p>
      ) : null}

      {isActive ? (
        <div className="mt-6 grid gap-3 border-t border-border pt-5">
          <p className="text-[13px] font-semibold">Force set password (emergency)</p>
          <p className="text-[12px] text-steel">
            Immediately sets a password and signs them out. Prefer Send password reset email. You will
            see the new password once and must share it yourself — it is never emailed.
          </p>
          <Field label="New password (optional)" htmlFor="manage-reset-password">
            <input
              id="manage-reset-password"
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setConfirmReset(false);
              }}
              className={inputClass}
              autoComplete="new-password"
              placeholder="Leave blank to generate"
            />
          </Field>
          {confirmReset ? (
            <p className="text-[12px] text-warn">
              Confirm to set a new password and end all of their signed-in sessions.
            </p>
          ) : null}
          <button
            type="button"
            disabled={saving || resetting || sendingReset || busy}
            className="h-11 rounded-md border border-border text-[13px] font-bold uppercase disabled:opacity-50"
            onClick={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              void (async () => {
                setResetting(true);
                const result = await resetStaffUserPasswordFn({
                  data: {
                    id: user.id,
                    password: newPassword.trim() || undefined,
                  },
                });
                setResetting(false);
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Password reset");
                await onPasswordReset({
                  email: result.data.email,
                  password: result.data.temporaryPassword,
                });
              })();
            }}
          >
            {resetting ? "Resetting…" : confirmReset ? "Confirm force set password" : "Force set password"}
          </button>
        </div>
      ) : null}

      <ConfirmAction
        open={deleteOpen}
        title="Delete user?"
        description="This permanently removes the user account. This action is only available because this user has no retained business history."
        confirmLabel="Delete user"
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          void (async () => {
            setDeleting(true);
            const result = await deleteStaffUserFn({ data: { id: user.id } });
            setDeleting(false);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("User deleted");
            await onDeleted();
          })();
        }}
      />
    </Drawer>
  );
}

function IssuedPasswordDrawer({
  issued,
  onClose,
}: {
  issued: { email: string; password: string } | null;
  onClose: () => void;
}) {
  if (!issued) return null;

  return (
    <Drawer
      open
      title="Share this password now"
      sub="Emergency force-set only. It is shown once and is never emailed."
      onClose={onClose}
    >
      <div className="grid gap-4">
        <Field label="Email">
          <p className="text-[14px]">{issued.email}</p>
        </Field>
        <Field label="Temporary password">
          <p className="break-all rounded-md border border-border bg-ink px-3 py-2 font-mono text-[14px]">
            {issued.password}
          </p>
        </Field>
        <button
          type="button"
          className="h-11 rounded-md border border-border text-[13px] font-bold uppercase"
          onClick={() => {
            void navigator.clipboard.writeText(issued.password).then(
              () => toast.success("Password copied"),
              () => toast.error("Could not copy — copy it from the box above"),
            );
          }}
        >
          Copy password
        </button>
        <button
          type="button"
          className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </Drawer>
  );
}
