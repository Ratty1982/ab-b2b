import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import type { PermissionKey } from "@/domain/permissions";
import { STAFF_PERMISSION_TREE, selectionState } from "@/domain/permission-sections";
import { PERMISSION_LABELS, SENSITIVE_PERMISSIONS, type ColumnCheck, type OverrideEffect } from "@/domain/user-permissions";
import { applyBulkStaffPermissionsFn, previewBulkStaffPermissionsFn } from "@/server/phase2/fns";

type Staff = { id: string; name: string; email: string; roleLabel: string };
type Preview = Extract<Awaited<ReturnType<typeof previewBulkStaffPermissionsFn>>, { ok: true }>["data"];

const SENSITIVE = new Set<string>(SENSITIVE_PERMISSIONS);

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
  if (state === "empty") return null;
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

export function BulkUserPermissions({
  users,
  onClose,
  onApplied,
}: {
  users: Staff[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [selected, setSelected] = useState<Set<PermissionKey>>(new Set());
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set(STAFF_PERMISSION_TREE.map((category) => category.id)));
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(STAFF_PERMISSION_TREE.flatMap((category) => category.sections.map((section) => section.id))),
  );
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pendingEffect, setPendingEffect] = useState<OverrideEffect | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const query = filter.trim().toLowerCase();

  const selectedKeys = useMemo(() => [...selected], [selected]);

  function toggle(keys: readonly PermissionKey[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
    setPreview(null);
  }

  async function review(effect: OverrideEffect) {
    if (selectedKeys.length === 0) {
      toast.error("Select at least one permission");
      return;
    }
    setBusy(true);
    setPendingEffect(effect);
    const result = await previewBulkStaffPermissionsFn({
      data: {
        userIds: users.map((user) => user.id),
        changes: selectedKeys.map((permissionKey) => ({ permissionKey, effect })),
      },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      setPreview(null);
      return;
    }
    setPreview(result.data);
  }

  async function apply() {
    if (!preview || !pendingEffect) return;
    setBusy(true);
    const result = await applyBulkStaffPermissionsFn({
      data: {
        userIds: users.map((user) => user.id),
        confirmSensitive: true,
        changes: selectedKeys.map((permissionKey) => ({ permissionKey, effect: pendingEffect })),
      },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Updated permissions for ${users.length} staff`);
    onApplied();
    onClose();
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold">Bulk permissions</h3>
          <p className="mt-1 text-[12px] text-steel">
            {users.length} staff. Unselected permissions and their roles stay unchanged.
          </p>
        </div>
        <button type="button" onClick={onClose} className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold">
          Close
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {users.map((user) => (
          <li key={user.id} className="rounded-md border border-border px-2 py-1 text-[12px]">
            <span className="font-semibold">{user.name}</span>
            <span className="text-steel"> · {user.roleLabel}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter permissions"
          aria-label="Filter permissions"
          className="h-9 min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 text-[13px]"
        />
        <button type="button" className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => {
          setOpenCategories(new Set(STAFF_PERMISSION_TREE.map((category) => category.id)));
          setOpenSections(new Set(STAFF_PERMISSION_TREE.flatMap((category) => category.sections.map((section) => section.id))));
        }}>Expand all</button>
        <button type="button" className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => {
          setOpenCategories(new Set());
          setOpenSections(new Set());
        }}>Collapse all</button>
      </div>
      {selected.size > 0 ? (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-background px-3 py-2" role="toolbar" aria-label="Bulk permission actions">
          <span className="text-[12px] font-semibold">{selected.size} selected</span>
          <button type="button" disabled={busy} className="h-8 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground" onClick={() => void review("ALLOW")}>Allow</button>
          <button type="button" disabled={busy} className="h-8 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => void review("DENY")}>Deny</button>
          <button type="button" disabled={busy} className="h-8 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => void review("INHERIT")}>Reset to role</button>
          <button type="button" className="h-8 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => { setSelected(new Set()); setPreview(null); }}>Clear selection</button>
        </div>
      ) : null}
      <div className="grid max-h-[420px] gap-2 overflow-auto">
        {STAFF_PERMISSION_TREE.map((category) => {
          const categoryKeys = category.sections.flatMap((section) => section.actions);
          const sections = category.sections.filter((section) => {
            if (!query) return true;
            if (section.label.toLowerCase().includes(query)) return true;
            return section.actions.some((key) => PERMISSION_LABELS[key].toLowerCase().includes(query) || key.includes(query));
          });
          if (query && sections.length === 0) return null;
          const open = openCategories.has(category.id) || Boolean(query);
          return (
            <section key={category.id} className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center gap-3 bg-surface/50 px-3 py-2">
                <TriCheck label={`Select ${category.label}`} state={selectionState(selected, categoryKeys)} onToggle={(on) => toggle(categoryKeys, on)} />
                <button type="button" className="text-[13px] font-semibold" aria-expanded={open} onClick={() => setOpenCategories((current) => {
                  const next = new Set(current);
                  if (next.has(category.id)) next.delete(category.id);
                  else next.add(category.id);
                  return next;
                })}>
                  {open ? "▾" : "▸"} {category.label}
                </button>
                <div className="ml-auto flex gap-2">
                  <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => toggle(categoryKeys, true)}>Select all</button>
                  <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => toggle(categoryKeys, false)}>Clear</button>
                </div>
              </div>
              {open ? (
                <div className="grid gap-2 p-3">
                  {sections.map((section) => {
                    const actions = section.actions.filter((key) => !query || PERMISSION_LABELS[key].toLowerCase().includes(query) || key.includes(query) || section.label.toLowerCase().includes(query));
                    const sectionOpen = openSections.has(section.id) || Boolean(query);
                    return (
                      <div key={section.id} className="rounded-md border border-border/70">
                        <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                          <TriCheck label={`Select ${section.label}`} state={selectionState(selected, section.actions)} onToggle={(on) => toggle(section.actions, on)} />
                          <button type="button" className="text-[13px] font-medium" aria-expanded={sectionOpen} onClick={() => setOpenSections((current) => {
                            const next = new Set(current);
                            if (next.has(section.id)) next.delete(section.id);
                            else next.add(section.id);
                            return next;
                          })}>
                            {sectionOpen ? "▾" : "▸"} {section.label}
                          </button>
                          {section.actions.length > 0 ? (
                            <div className="ml-auto flex gap-2">
                              <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => toggle(section.actions, true)}>Select all</button>
                              <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => toggle(section.actions, false)}>Clear</button>
                            </div>
                          ) : null}
                        </div>
                        {sectionOpen ? (
                          <div className="border-t border-border/70 px-3 py-2">
                            {section.fixedNote ? <p className="text-[12px] text-steel">{section.fixedNote}</p> : null}
                            <ul className="grid gap-2">
                              {actions.map((key) => (
                                <li key={key} className="flex items-center gap-3 text-[13px]">
                                  <TriCheck label={`Select ${PERMISSION_LABELS[key]}`} state={selected.has(key) ? "on" : "off"} onToggle={(on) => toggle([key], on)} />
                                  <span>
                                    {PERMISSION_LABELS[key]}
                                    {SENSITIVE.has(key) ? <span className="ml-2 text-[11px] uppercase text-warn">Sensitive</span> : null}
                                  </span>
                                </li>
                              ))}
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
      {preview ? (
        <div className="rounded-md border border-border px-3 py-3 text-[12px]">
          <p className="font-semibold">Review before applying {pendingEffect === "ALLOW" ? "Allow" : pendingEffect === "DENY" ? "Deny" : "Reset to role"}</p>
          <p className="mt-1 text-steel">Staff: {preview.users.map((user) => user.name).join(", ")}</p>
          <div className="mt-2 grid gap-2">
            {preview.changes.map((change) => (
              <div key={change.key} className={change.sensitive ? "rounded-md border border-warn/50 px-2 py-2" : ""}>
                <p className="font-semibold">
                  {change.label}
                  {change.sensitive ? <span className="ml-2 text-warn">Sensitive</span> : null}
                </p>
                {change.rows.map((row) => (
                  <p key={row.userId} className="text-steel">
                    {row.name}: {row.beforeEffective ? "has access" : "no access"} ({row.beforeEffect}) → {row.afterEffective ? "has access" : "no access"} ({row.afterEffect})
                  </p>
                ))}
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmOpen(true)}
            className="mt-3 h-10 rounded-md bg-primary px-4 text-[13px] font-bold text-primary-foreground"
          >
            Confirm and apply
          </button>
        </div>
      ) : null}
      <ConfirmAction
        open={confirmOpen}
        title="Apply bulk permissions"
        description={`Update ${users.length} staff and ${selectedKeys.length} permission${selectedKeys.length === 1 ? "" : "s"}. ${preview?.sensitive ? "This includes a sensitive access change." : "Other overrides and roles stay as they are."}`}
        confirmLabel="Apply"
        onOpenChange={setConfirmOpen}
        onConfirm={() => void apply()}
      />
    </div>
  );
}
