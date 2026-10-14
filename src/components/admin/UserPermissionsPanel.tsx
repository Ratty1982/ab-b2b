import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import type { PermissionKey } from "@/domain/permissions";
import { implySectionPermissions, selectionState } from "@/domain/permission-sections";
import {
  accessSummary,
  applyUserPermissionOverrides,
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
type PermissionRow = Editor["categories"][number]["permissions"][number];

function accessLabel(state: ColumnCheck): string {
  if (state === "on") return "Full access";
  if (state === "mixed") return "Partial access";
  if (state === "off") return "No access";
  return "Always available";
}

function TriCheck({
  label,
  state,
  onToggle,
}: {
  label: string;
  state: ColumnCheck;
  onToggle: (selected: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "mixed";
  }, [state]);
  if (state === "empty") return <span className="text-[12px] text-steel">—</span>;
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
  const [directRole, setDirectRole] = useState<Set<PermissionKey>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selected, setSelected] = useState<Set<PermissionKey>>(new Set());
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  function applyEditor(data: Editor) {
    const direct = new Set<PermissionKey>();
    const map: OverrideMap = {};
    for (const category of data.categories) {
      for (const permission of category.permissions) {
        if (permission.directRole) direct.add(permission.key);
        if (permission.effect !== "INHERIT") map[permission.key] = permission.effect;
      }
    }
    setEditor(data);
    setDirectRole(direct);
    setRoleGranted(implySectionPermissions(direct, new Set()));
    setOverrides(map);
    setSaved(map);
    setOpenCategories(new Set(data.categories.map((category) => category.id)));
    setOpenSections(
      new Set(data.categories.flatMap((category) => category.sections.map((section) => section.id))),
    );
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
    () => applyUserPermissionOverrides(directRole, storedFromOverrideMap(overrides)),
    [overrides, directRole],
  );
  const summary = useMemo(() => accessSummary(applied.effective), [applied]);
  const navigation = useMemo(
    () => previewBackOfficeNavigation({ permissions: applied.effective, denied: applied.denied }),
    [applied],
  );
  const customised = storedFromOverrideMap(overrides);
  const targetIsSuperAdmin = editor?.roles.some((role) => role.key === "SUPER_ADMIN") ?? false;
  const sensitive = sensitivePermissionChanges(saved, overrides);
  const query = filter.trim().toLowerCase();

  function accessOf(keys: readonly PermissionKey[]): ColumnCheck {
    if (keys.length === 0) return "empty";
    const granted = keys.map((key) => applied.effective.has(key));
    if (granted.every(Boolean)) return "on";
    if (granted.some(Boolean)) return "mixed";
    return "off";
  }

  function keysOf(rows: readonly PermissionRow[]): PermissionKey[] {
    return rows.map((row) => row.key);
  }

  function visibleRows(rows: readonly PermissionRow[]): PermissionRow[] {
    if (!query) return [...rows];
    return rows.filter(
      (row) => row.label.toLowerCase().includes(query) || row.key.toLowerCase().includes(query),
    );
  }

  function toggleSelected(keys: readonly PermissionKey[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function setAccess(keys: readonly PermissionKey[], mode: "grant" | "clear" | "reset") {
    setOverrides((current) => withPermissionEffects(current, keys, roleGranted, mode));
  }

  async function persist(confirmSensitive: boolean) {
    setSaving(true);
    const result = await saveStaffUserPermissionsFn({
      data: { userId, confirmSensitive, overrides: storedFromOverrideMap(overrides) },
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    applyEditor(result.data);
    setSelected(new Set());
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
  const inherited = customised.length
    ? [...applied.effective].filter((key) => !overrides[key])
    : [...applied.effective];
  const allowed = customised.filter((row) => row.effect === "ALLOW").map((row) => row.permissionKey);
  const denied = customised.filter((row) => row.effect === "DENY").map((row) => row.permissionKey);

  return (
    <div className="grid gap-4">
      <div className="rounded-md border border-border bg-surface/40 px-3 py-3 text-[12px] text-steel">
        <p>
          Base role: <span className="font-semibold text-foreground">{roleText}</span>
        </p>
        <p className="mt-1">
          Customised permissions: <span className="font-semibold text-foreground">{customised.length}</span>
        </p>
        <p className="mt-1">Inherit keeps the role. Allow adds a permission. Deny removes one the role grants.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter permissions"
          aria-label="Filter permissions"
          className="h-9 min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 text-[13px]"
        />
        <button type="button" className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => {
          setOpenCategories(new Set(editor.categories.map((category) => category.id)));
          setOpenSections(new Set(editor.categories.flatMap((category) => category.sections.map((section) => section.id))));
        }}>
          Expand all
        </button>
        <button type="button" className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => {
          setOpenCategories(new Set());
          setOpenSections(new Set());
        }}>
          Collapse all
        </button>
      </div>

      {selected.size > 0 ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-background px-3 py-2" role="toolbar" aria-label="Bulk permission actions">
          <span className="text-[12px] font-semibold">{selected.size} selected</span>
          <button type="button" className="h-8 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground" onClick={() => setAccess([...selected], "grant")}>Allow</button>
          <button type="button" className="h-8 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => setAccess([...selected], "clear")}>Deny</button>
          <button type="button" className="h-8 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => setAccess([...selected], "reset")}>Reset to role</button>
          <button type="button" className="h-8 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      ) : null}

      <div className="grid gap-3">
        {editor.categories.map((category) => {
          const sections = category.sections
            .map((section) => ({ ...section, permissions: visibleRows(section.permissions) }))
            .filter((section) => !query || section.permissions.length > 0 || section.label.toLowerCase().includes(query));
          if (query && sections.length === 0 && !category.label.toLowerCase().includes(query)) return null;
          const categoryKeys = keysOf(category.permissions);
          const access = accessOf(categoryKeys);
          const picked = selectionState(selected, categoryKeys);
          const open = openCategories.has(category.id) || Boolean(query);
          return (
            <section key={category.id} className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center gap-3 bg-surface/50 px-3 py-2">
                <TriCheck
                  label={`Select ${category.label}`}
                  state={picked}
                  onToggle={(on) => toggleSelected(categoryKeys, on)}
                />
                <button
                  type="button"
                  className="text-[13px] font-semibold"
                  aria-expanded={open}
                  onClick={() => setOpenCategories((current) => {
                    const next = new Set(current);
                    if (next.has(category.id)) next.delete(category.id);
                    else next.add(category.id);
                    return next;
                  })}
                >
                  {open ? "▾" : "▸"} {category.label}
                </button>
                <span className="text-[12px] text-steel">{accessLabel(access)}</span>
                <div className="ml-auto flex flex-wrap gap-2">
                  <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setAccess(categoryKeys, "grant")}>Allow all</button>
                  <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setAccess(categoryKeys, "clear")}>Clear</button>
                  <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setAccess(categoryKeys, "reset")}>Reset to role</button>
                </div>
              </div>
              {open ? (
                <div className="grid gap-2 p-3">
                  {sections.map((section) => {
                    const sectionKeys = keysOf(section.permissions.length ? section.permissions : category.sections.find((item) => item.id === section.id)?.permissions ?? []);
                    const sectionAccess = accessOf(sectionKeys);
                    const sectionPicked = selectionState(selected, sectionKeys);
                    const sectionOpen = openSections.has(section.id) || Boolean(query);
                    return (
                      <div key={section.id} className="rounded-md border border-border/70">
                        <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                          <TriCheck
                            label={`Select ${section.label}`}
                            state={sectionPicked}
                            onToggle={(on) => toggleSelected(sectionKeys, on)}
                          />
                          <button
                            type="button"
                            className="text-[13px] font-medium"
                            aria-expanded={sectionOpen}
                            onClick={() => setOpenSections((current) => {
                              const next = new Set(current);
                              if (next.has(section.id)) next.delete(section.id);
                              else next.add(section.id);
                              return next;
                            })}
                          >
                            {sectionOpen ? "▾" : "▸"} {section.label}
                          </button>
                          <span className="text-[12px] text-steel">{section.fixedNote ? "Fixed" : accessLabel(sectionAccess)}</span>
                          {sectionKeys.length > 0 ? (
                            <div className="ml-auto flex flex-wrap gap-2">
                              <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setAccess(sectionKeys, "grant")}>Allow all</button>
                              <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setAccess(sectionKeys, "clear")}>Clear</button>
                              <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setAccess(sectionKeys, "reset")}>Reset to role</button>
                            </div>
                          ) : null}
                        </div>
                        {sectionOpen ? (
                          <div className="border-t border-border/70 px-3 py-2">
                            {section.fixedNote ? <p className="text-[12px] text-steel">{section.fixedNote}</p> : null}
                            <ul className="grid gap-2">
                              {section.permissions.map((permission) => {
                                const effect = overrides[permission.key] ?? "INHERIT";
                                const effective = applied.effective.has(permission.key);
                                return (
                                  <li key={permission.key} className="flex flex-wrap items-center gap-3 text-[13px]">
                                    <TriCheck
                                      label={`Select ${permission.label}`}
                                      state={selected.has(permission.key) ? "on" : "off"}
                                      onToggle={(on) => toggleSelected([permission.key], on)}
                                    />
                                    <span className={cn("min-w-[180px] flex-1", permission.sensitive && "font-semibold")}>
                                      {permission.label}
                                      {permission.sensitive ? <span className="ml-2 text-[11px] uppercase text-warn">Sensitive</span> : null}
                                    </span>
                                    <span className="text-[11px] text-steel">{effective ? "Effective" : "Not effective"}</span>
                                    <select
                                      aria-label={`${permission.label} effect`}
                                      value={effect}
                                      onChange={(event) => {
                                        const next = event.target.value as OverrideEffect;
                                        setOverrides((current) => {
                                          const copy = { ...current };
                                          if (next === "INHERIT") delete copy[permission.key];
                                          else copy[permission.key] = next;
                                          return copy;
                                        });
                                      }}
                                      className="h-8 rounded-md border border-border bg-background px-2 text-[12px]"
                                    >
                                      <option value="INHERIT">Inherit ({permission.roleGranted ? "allowed" : "not granted"})</option>
                                      <option value="ALLOW">Allow</option>
                                      <option value="DENY">Deny</option>
                                    </select>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <div className="rounded-md border border-border px-3 py-3 text-[12px]">
        <p className="font-semibold">Effective access before save</p>
        <p className="mt-1 text-steel">Areas: {summary.join(", ") || "None"}</p>
        <p className="mt-2">Inherited from the role: {inherited.length}</p>
        <p>Custom allow: {allowed.map((key) => editor.categories.flatMap((category) => category.permissions).find((row) => row.key === key)?.label ?? key).join(", ") || "None"}</p>
        <p>Custom deny: {denied.map((key) => editor.categories.flatMap((category) => category.permissions).find((row) => row.key === key)?.label ?? key).join(", ") || "None"}</p>
        <p className="mt-2 font-semibold">Navigation</p>
        {navigation.length === 0 ? <p className="text-steel">No back-office sections.</p> : navigation.map((section) => (
          <p key={section.section} className="text-steel">{section.section}: {section.items.join(", ")}</p>
        ))}
      </div>

      <div className="flex justify-end">
        <button type="button" disabled={saving} onClick={requestSave} className="h-10 rounded-md bg-primary px-4 text-[13px] font-bold text-primary-foreground disabled:opacity-60">
          {saving ? "Saving…" : "Save permissions"}
        </button>
      </div>

      <ConfirmAction
        open={confirmOpen}
        title="Confirm permission changes"
        description={
          targetIsSuperAdmin
            ? `This updates a Super Admin. ${sensitive.length ? `Sensitive keys: ${sensitive.join(", ")}.` : "Review the effective access summary before continuing."}`
            : `Sensitive keys change: ${sensitive.join(", ")}. The role and other permissions stay as shown.`
        }
        confirmLabel="Save permissions"
        onOpenChange={setConfirmOpen}
        onConfirm={() => void persist(true)}
      />
    </div>
  );
}
