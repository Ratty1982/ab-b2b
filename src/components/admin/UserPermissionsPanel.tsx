import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import type { PermissionKey } from "@/domain/permissions";
import {
  PERMISSION_CATEGORIES,
  accessSummary,
  applyUserPermissionOverrides,
  columnCheckState,
  sensitivePermissionChanges,
  storedFromOverrideMap,
  withPermissionEffects,
  type ColumnCheck,
  type OverrideEffect,
  type OverrideMap,
} from "@/domain/user-permissions";
import { previewBackOfficeNavigation } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { getStaffUserPermissionsFn, saveStaffUserPermissionsFn } from "@/server/phase2/fns";

type Editor = Extract<Awaited<ReturnType<typeof getStaffUserPermissionsFn>>, { ok: true }>["data"];

function effectLabel(effect: OverrideEffect): string {
  if (effect === "ALLOW") return "Allow";
  if (effect === "DENY") return "Deny";
  return "Inherit";
}

function CheckBox({
  label,
  state,
  onToggle,
}: {
  label: string;
  state: ColumnCheck;
  onToggle: (grant: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "mixed";
  }, [state]);
  if (state === "empty") {
    return <span className="text-[12px] text-steel">—</span>;
  }
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={state === "on"}
      onChange={() => onToggle(state !== "on")}
      className="size-4 accent-primary"
    />
  );
}

export function UserPermissionsPanel({ userId }: { userId: string }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saved, setSaved] = useState<OverrideMap>({});
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [roleGranted, setRoleGranted] = useState<Set<PermissionKey>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [openAdvanced, setOpenAdvanced] = useState<string | null>(null);

  function applyEditor(data: Editor) {
    const granted = new Set<PermissionKey>();
    const map: OverrideMap = {};
    for (const category of data.categories) {
      for (const permission of category.permissions) {
        if (permission.roleGranted) granted.add(permission.key);
        if (permission.effect !== "INHERIT") map[permission.key] = permission.effect;
      }
    }
    setEditor(data);
    setRoleGranted(granted);
    setOverrides(map);
    setSaved(map);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const result = await getStaffUserPermissionsFn({ data: { userId } });
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setEditor(null);
      } else {
        applyEditor(result.data);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const applied = useMemo(
    () => applyUserPermissionOverrides(roleGranted, storedFromOverrideMap(overrides)),
    [overrides, roleGranted],
  );
  const summary = useMemo(() => accessSummary(applied.effective), [applied]);
  const navigation = useMemo(
    () =>
      previewBackOfficeNavigation({
        permissions: applied.effective,
        denied: applied.denied,
      }),
    [applied],
  );
  const customised = storedFromOverrideMap(overrides).length;
  const targetIsSuperAdmin = editor?.roles.some((role) => role.key === "SUPER_ADMIN") ?? false;
  const sensitive = sensitivePermissionChanges(saved, overrides);

  async function persist(confirmSensitive: boolean) {
    setSaving(true);
    const result = await saveStaffUserPermissionsFn({
      data: {
        userId,
        confirmSensitive,
        overrides: storedFromOverrideMap(overrides),
      },
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    applyEditor(result.data);
    toast.success("Permissions saved");
  }

  function requestSave() {
    if (sensitive.length > 0 || targetIsSuperAdmin) {
      setConfirmOpen(true);
      return;
    }
    void persist(false);
  }

  if (loading) return <p className="text-[13px] text-steel">Loading permissions…</p>;
  if (!editor) return <p className="text-[13px] text-bad">{error ?? "Permissions could not be loaded."}</p>;

  const roleText = editor.roles.map((role) => role.label).join(", ") || "No role";

  return (
    <div className="grid gap-4">
      <div className="rounded-md border border-border bg-surface/40 px-3 py-3 text-[12px] text-steel">
        <p>
          Base role: <span className="font-semibold text-foreground">{roleText}</span>
        </p>
        <p className="mt-1">
          Customised permissions: <span className="font-semibold text-foreground">{customised}</span>
        </p>
        <p className="mt-2 text-foreground">
          {summary.length ? summary.join(" · ") : "No internal areas are granted."}
        </p>
        <p className="mt-2">
          Inherit follows the role. Allow adds a permission. Deny removes it even when the role grants it.
          Other people with this role are unchanged. Trade customer access is separate.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="h-9 rounded-md border border-border px-3 text-[12px] font-bold uppercase"
          onClick={() => setOverrides({})}
        >
          Reset all to role defaults
        </button>
        <button
          type="button"
          disabled={saving}
          className="h-9 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-50"
          onClick={requestSave}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      {PERMISSION_CATEGORIES.map((category) => {
        const columns = {
          view: [...(category.columns.view ?? [])],
          edit: [...(category.columns.edit ?? [])],
          manage: [...(category.columns.manage ?? [])],
        };
        const states = {
          view: columnCheckState(columns.view, roleGranted, overrides),
          edit: columnCheckState(columns.edit, roleGranted, overrides),
          manage: columnCheckState(columns.manage, roleGranted, overrides),
        };
        const customInCategory = category.permissions.some((key) => overrides[key] && overrides[key] !== "INHERIT");
        return (
          <section key={category.id} className="rounded-md border border-border">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <h3 className="text-[13px] font-semibold">
                {category.label}
                {customInCategory ? (
                  <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-warn">Custom</span>
                ) : null}
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="text-[11px] font-semibold uppercase text-steel hover:text-foreground"
                  onClick={() =>
                    setOverrides((current) =>
                      withPermissionEffects(current, category.permissions, roleGranted, "grant"),
                    )
                  }
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-[11px] font-semibold uppercase text-steel hover:text-foreground"
                  onClick={() =>
                    setOverrides((current) =>
                      withPermissionEffects(current, category.permissions, roleGranted, "clear"),
                    )
                  }
                >
                  Clear category
                </button>
                <button
                  type="button"
                  className="text-[11px] font-semibold uppercase text-steel hover:text-foreground"
                  onClick={() =>
                    setOverrides((current) =>
                      withPermissionEffects(current, category.permissions, roleGranted, "reset"),
                    )
                  }
                >
                  Reset category
                </button>
              </div>
            </header>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-steel">
                  <th className="px-3 py-2 font-semibold">Access</th>
                  <th className="px-3 py-2 text-center font-semibold">View</th>
                  <th className="px-3 py-2 text-center font-semibold">Edit</th>
                  <th className="px-3 py-2 text-center font-semibold">Manage</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-3 py-2 text-steel">Effective</td>
                  {(["view", "edit", "manage"] as const).map((column) => (
                    <td key={column} className="px-3 py-2 text-center">
                      <CheckBox
                        label={`${category.label} ${column}`}
                        state={states[column]}
                        onToggle={(grant) =>
                          setOverrides((current) =>
                            withPermissionEffects(
                              current,
                              columns[column],
                              roleGranted,
                              grant ? "grant" : "clear",
                            ),
                          )
                        }
                      />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <button
              type="button"
              className="w-full border-t border-border px-3 py-2 text-left text-[12px] font-semibold text-steel hover:text-foreground"
              aria-expanded={openAdvanced === category.id}
              onClick={() => setOpenAdvanced((current) => (current === category.id ? null : category.id))}
            >
              {openAdvanced === category.id ? "Hide individual permissions" : "Individual permissions"}
            </button>
            {openAdvanced === category.id ? (
              <ul className="grid gap-2 border-t border-border px-3 py-3">
                {category.permissions.map((key) => {
                  const effect = overrides[key] ?? "INHERIT";
                  const effective = applied.effective.has(key);
                  const permission = editor.categories
                    .flatMap((row) => row.permissions)
                    .find((row) => row.key === key);
                  return (
                    <li key={key} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div>
                        <p className="text-[13px] text-foreground">
                          {permission?.label ?? key}
                          {effect !== "INHERIT" ? (
                            <span className="ml-2 text-[11px] font-semibold uppercase text-warn">Custom</span>
                          ) : null}
                        </p>
                        <p className="text-[11px] text-steel">
                          Role {permission?.roleGranted ? "grants" : "does not grant"} this ·{" "}
                          {effective ? "Effective: allowed" : "Effective: not allowed"}
                        </p>
                      </div>
                      <select
                        aria-label={permission?.label ?? key}
                        value={effect}
                        className={cn(
                          "h-9 rounded-md border border-border bg-transparent px-2 text-[12px]",
                        )}
                        onChange={(event) => {
                          const next = event.target.value as OverrideEffect;
                          setOverrides((current) => {
                            const copy: OverrideMap = { ...current };
                            if (next === "INHERIT") delete copy[key];
                            else copy[key] = next;
                            return copy;
                          });
                        }}
                      >
                        {(["INHERIT", "ALLOW", "DENY"] as const).map((option) => (
                          <option key={option} value={option}>
                            {effectLabel(option)}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        );
      })}

      <section className="rounded-md border border-border px-3 py-3">
        <h3 className="text-[13px] font-semibold">Navigation preview</h3>
        <p className="mt-1 text-[12px] text-steel">
          Areas this user would see. This does not sign in as them.
        </p>
        {navigation.length === 0 ? (
          <p className="mt-2 text-[12px] text-steel">No staff navigation items.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {navigation.map((section) => (
              <li key={section.section}>
                <p className="text-[12px] font-semibold">{section.section}</p>
                <p className="text-[12px] text-steel">{section.items.join(" · ")}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmAction
        open={confirmOpen}
        title="Confirm permission changes"
        description={
          targetIsSuperAdmin
            ? "This user is a Super Admin. Saving changes their effective access, including any sensitive permissions. The Super Admin role itself is not assigned from this screen."
            : `Sensitive permissions will change: ${sensitive
                .map((key) => editor.categories.flatMap((category) => category.permissions).find((row) => row.key === key)?.label ?? key)
                .join(", ")}.`
        }
        confirmLabel="Save permissions"
        onOpenChange={setConfirmOpen}
        onConfirm={() => {
          void persist(true);
        }}
      />
    </div>
  );
}
