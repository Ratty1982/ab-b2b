import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import { MediaPicker, type CmsMediaListItem } from "@/components/cms/MediaPicker";
import {
  deleteTeamDepartmentFn,
  deleteTeamMemberFn,
  listSalesRepsFn,
  listTeamDepartmentsFn,
  listTeamMembersFn,
  upsertTeamDepartmentFn,
  upsertTeamMemberFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/content/team")({
  head: () => ({ meta: [{ title: "Team — Automotive Brands Admin" }] }),
  component: AdminTeam,
});

type DeptRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isPublic: boolean;
  memberCount: number;
};

type MemberRow = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  initials: string;
  jobTitle: string | null;
  bio: string | null;
  email: string | null;
  phone: string | null;
  linkedInUrl: string | null;
  sortOrder: number;
  isPublic: boolean;
  isFeatured: boolean;
  isContactable: boolean;
  departmentId: string | null;
  department: { id: string; name: string; slug: string } | null;
  photoMediaId: string | null;
  photoAlt: string | null;
  photoFocalX: number;
  photoFocalY: number;
  photo: { src: string; alt: string; objectPosition: string } | null;
  salesRepId: string | null;
  salesRep: { id: string; label: string; code: string | null } | null;
};

type MemberDraft = Partial<MemberRow> & {
  firstName: string;
  lastName: string;
};

function emptyMember(): MemberDraft {
  return {
    firstName: "",
    lastName: "",
    jobTitle: "",
    bio: "",
    email: "",
    phone: "",
    linkedInUrl: "",
    sortOrder: 0,
    isPublic: false,
    isFeatured: false,
    isContactable: false,
    departmentId: null,
    photoMediaId: null,
    photoAlt: "",
    photoFocalX: 50,
    photoFocalY: 50,
    salesRepId: null,
    photo: null,
  };
}

function AdminTeam() {
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [reps, setReps] = useState<Array<{ id: string; label: string }>>([]);
  const [q, setQ] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [visibility, setVisibility] = useState<"all" | "public" | "hidden">("all");
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<MemberDraft | null>(null);
  const [deptEdit, setDeptEdit] = useState<Partial<DeptRow> | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteDeptId, setDeleteDeptId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [deptR, memberR, repR] = await Promise.all([
      listTeamDepartmentsFn(),
      listTeamMembersFn({
        data: {
          q: q || undefined,
          departmentId: departmentId || undefined,
          visibility,
        },
      }),
      listSalesRepsFn(),
    ]);
    if (!deptR.ok) {
      setError(deptR.error);
      return;
    }
    if (!memberR.ok) {
      setError(memberR.error);
      return;
    }
    setError(null);
    setDepartments(deptR.data);
    setMembers(memberR.data);
    if (repR.ok) setReps(repR.data);
  }, [q, departmentId, visibility]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PanelHeader
        title="Team"
        sub="Public Meet the Team profiles. Hidden by default until you publish. Photos use the media library."
        crumbs={[
          { label: "Website" },
          { label: "Team" },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-10 rounded-md border border-border px-4 text-[12px] font-semibold"
              onClick={() =>
                setDeptEdit({
                  name: "",
                  slug: "",
                  description: "",
                  sortOrder: (departments.at(-1)?.sortOrder ?? 0) + 10,
                  isPublic: true,
                })
              }
            >
              Add department
            </button>
            <button
              type="button"
              className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase text-primary-foreground"
              onClick={() => setEdit(emptyMember())}
            >
              Add member
            </button>
          </div>
        }
      />
      <div className="p-4 sm:p-6">
        {error ? <p className="mb-4 text-sm text-bad">{error}</p> : null}

        <div className="mb-4 flex flex-wrap gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or title"
            className={cn(inputClass, "max-w-xs")}
            aria-label="Search team members"
          />
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className={cn(inputClass, "max-w-[220px]")}
            aria-label="Filter department"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as typeof visibility)}
            className={cn(inputClass, "max-w-[160px]")}
            aria-label="Filter visibility"
          >
            <option value="all">All visibility</option>
            <option value="public">Public</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>

        <div className="mb-8 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                <th className="px-3 py-2">Photo</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Job title</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Featured</th>
                <th className="px-3 py-2">Public</th>
                <th className="px-3 py-2">Sales rep</th>
                <th className="px-3 py-2 text-right">Order</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-steel">
                    No team members yet. Add verified people before publishing.
                  </td>
                </tr>
              ) : (
                members.map((m, i) => (
                  <tr key={m.id} className={cn("border-b border-border/60", i % 2 && "bg-surface/30")}>
                    <td className="px-3 py-2">
                      <div className="grid size-10 place-items-center overflow-hidden rounded border border-border bg-[#0b1220] text-[10px] font-semibold text-white">
                        {m.photo ? (
                          <img
                            src={m.photo.src}
                            alt=""
                            className="h-full w-full object-cover"
                            style={{ objectPosition: m.photo.objectPosition }}
                          />
                        ) : (
                          m.initials
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-medium">{m.displayName}</td>
                    <td className="px-3 py-2 text-steel">{m.jobTitle || "—"}</td>
                    <td className="px-3 py-2">{m.department?.name || "—"}</td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={m.isFeatured ? "brand" : "neutral"}>
                        {m.isFeatured ? "Featured" : "—"}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={m.isPublic ? "good" : "warn"}>
                        {m.isPublic ? "Public" : "Hidden"}
                      </StatusBadge>
                    </td>
                    <td className="px-3 py-2 text-steel">{m.salesRep?.label || "—"}</td>
                    <td className="num px-3 py-2 text-right">{m.sortOrder}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-primary"
                        onClick={() => setEdit({ ...m })}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <h2 className="mb-3 font-display text-lg uppercase">Departments</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Slug</th>
                <th className="px-3 py-2">Members</th>
                <th className="px-3 py-2">Public</th>
                <th className="px-3 py-2 text-right">Order</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d, i) => (
                <tr key={d.id} className={cn("border-b border-border/60", i % 2 && "bg-surface/30")}>
                  <td className="px-3 py-2 font-medium">{d.name}</td>
                  <td className="px-3 py-2 text-steel">{d.slug}</td>
                  <td className="num px-3 py-2">{d.memberCount}</td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={d.isPublic ? "good" : "warn"}>
                      {d.isPublic ? "Public" : "Hidden"}
                    </StatusBadge>
                  </td>
                  <td className="num px-3 py-2 text-right">{d.sortOrder}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-primary"
                        onClick={() => setDeptEdit(d)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-[12px] font-semibold text-bad"
                        onClick={() => setDeleteDeptId(d.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit ? (
        <Drawer open title={edit.id ? "Edit team member" : "Add team member"} onClose={() => setEdit(null)}>
          <form
            className="grid gap-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void (async () => {
                const r = await upsertTeamMemberFn({
                  data: {
                    id: edit.id,
                    firstName: edit.firstName,
                    lastName: edit.lastName,
                    jobTitle: edit.jobTitle || null,
                    bio: edit.bio || null,
                    email: edit.email || null,
                    phone: edit.phone || null,
                    linkedInUrl: edit.linkedInUrl || null,
                    sortOrder: Number(edit.sortOrder) || 0,
                    isPublic: Boolean(edit.isPublic),
                    isFeatured: Boolean(edit.isFeatured),
                    isContactable: Boolean(edit.isContactable),
                    departmentId: edit.departmentId || null,
                    photoMediaId: edit.photoMediaId || null,
                    photoAlt: edit.photoAlt || null,
                    photoFocalX: Number(edit.photoFocalX) || 50,
                    photoFocalY: Number(edit.photoFocalY) || 50,
                    salesRepId: edit.salesRepId || null,
                  },
                });
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success(edit.id ? "Member saved" : "Member created");
                  setEdit(null);
                  await load();
                }
              })();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="First name">
                <input
                  required
                  className={inputClass}
                  value={edit.firstName}
                  onChange={(e) => setEdit({ ...edit, firstName: e.target.value })}
                />
              </Field>
              <Field label="Last name">
                <input
                  required
                  className={inputClass}
                  value={edit.lastName}
                  onChange={(e) => setEdit({ ...edit, lastName: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Job title">
              <input
                className={inputClass}
                value={edit.jobTitle ?? ""}
                onChange={(e) => setEdit({ ...edit, jobTitle: e.target.value })}
              />
            </Field>
            <Field label="Department">
              <select
                className={inputClass}
                value={edit.departmentId ?? ""}
                onChange={(e) => setEdit({ ...edit, departmentId: e.target.value || null })}
              >
                <option value="">No department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Short bio (optional)">
              <textarea
                className={cn(inputClass, "min-h-[96px]")}
                value={edit.bio ?? ""}
                onChange={(e) => setEdit({ ...edit, bio: e.target.value })}
                maxLength={1200}
              />
            </Field>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-steel">Photo</p>
              <div className="flex items-center gap-3">
                <div className="grid size-16 place-items-center overflow-hidden rounded border border-border bg-[#0b1220] text-xs text-white">
                  {edit.photo?.src ? (
                    <img
                      src={edit.photo.src}
                      alt=""
                      className="h-full w-full object-cover"
                      style={{ objectPosition: edit.photo.objectPosition }}
                    />
                  ) : (
                    "AB"
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
                    onClick={() => setPickerOpen(true)}
                  >
                    Choose photo
                  </button>
                  {edit.photoMediaId ? (
                    <button
                      type="button"
                      className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold text-bad"
                      onClick={() =>
                        setEdit({
                          ...edit,
                          photoMediaId: null,
                          photo: null,
                          photoAlt: "",
                        })
                      }
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </div>
              <Field label="Photo alt text">
                <input
                  className={inputClass}
                  value={edit.photoAlt ?? ""}
                  onChange={(e) => setEdit({ ...edit, photoAlt: e.target.value })}
                />
              </Field>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Field label="Focal X %">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={inputClass}
                    value={edit.photoFocalX ?? 50}
                    onChange={(e) => setEdit({ ...edit, photoFocalX: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Focal Y %">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className={inputClass}
                    value={edit.photoFocalY ?? 50}
                    onChange={(e) => setEdit({ ...edit, photoFocalY: Number(e.target.value) })}
                  />
                </Field>
              </div>
            </div>
            <div className="rounded-md border border-border/70 bg-surface/40 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">
                Public contact (never auto-copied from user accounts)
              </p>
              <div className="mt-3 grid gap-3">
                <label className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={Boolean(edit.isContactable)}
                    onChange={(e) => setEdit({ ...edit, isContactable: e.target.checked })}
                  />
                  Show contact actions publicly
                </label>
                <Field label="Public email">
                  <input
                    type="email"
                    className={inputClass}
                    value={edit.email ?? ""}
                    onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                  />
                </Field>
                <Field label="Public telephone">
                  <input
                    className={inputClass}
                    value={edit.phone ?? ""}
                    onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                  />
                </Field>
                <Field label="LinkedIn URL">
                  <input
                    className={inputClass}
                    value={edit.linkedInUrl ?? ""}
                    onChange={(e) => setEdit({ ...edit, linkedInUrl: e.target.value })}
                  />
                </Field>
              </div>
            </div>
            <Field label="Optional SalesRep link">
              <select
                className={inputClass}
                value={edit.salesRepId ?? ""}
                onChange={(e) => setEdit({ ...edit, salesRepId: e.target.value || null })}
              >
                <option value="">None</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Display order">
              <input
                type="number"
                className={inputClass}
                value={edit.sortOrder ?? 0}
                onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })}
              />
            </Field>
            <div className="grid gap-2 text-[13px]">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(edit.isPublic)}
                  onChange={(e) => setEdit({ ...edit, isPublic: e.target.checked })}
                />
                Public on /meet-the-team
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={Boolean(edit.isFeatured)}
                  onChange={(e) => setEdit({ ...edit, isFeatured: e.target.checked })}
                />
                Featured on Why Us teaser
              </label>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="submit"
                className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase text-primary-foreground"
              >
                Save
              </button>
              {edit.id ? (
                <button
                  type="button"
                  className="h-10 rounded-md border border-bad px-4 text-[12px] font-semibold text-bad"
                  onClick={() => setDeleteId(edit.id!)}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </form>
        </Drawer>
      ) : null}

      {deptEdit ? (
        <Drawer
          open
          title={deptEdit.id ? "Edit department" : "Add department"}
          onClose={() => setDeptEdit(null)}
        >
          <form
            className="grid gap-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void (async () => {
                const r = await upsertTeamDepartmentFn({
                  data: {
                    id: deptEdit.id,
                    name: deptEdit.name,
                    slug: deptEdit.slug,
                    description: deptEdit.description || null,
                    sortOrder: Number(deptEdit.sortOrder) || 0,
                    isPublic: Boolean(deptEdit.isPublic),
                  },
                });
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success("Department saved");
                  setDeptEdit(null);
                  await load();
                }
              })();
            }}
          >
            <Field label="Name">
              <input
                required
                className={inputClass}
                value={deptEdit.name ?? ""}
                onChange={(e) => {
                  const name = e.target.value;
                  const nextSlug = deptEdit.id
                    ? (deptEdit.slug ?? "")
                    : name
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "-")
                        .replace(/^-|-$/g, "");
                  setDeptEdit({ ...deptEdit, name, slug: nextSlug || deptEdit.slug || "" });
                }}
              />
            </Field>
            <Field label="Slug">
              <input
                required
                className={inputClass}
                value={deptEdit.slug ?? ""}
                onChange={(e) => setDeptEdit({ ...deptEdit, slug: e.target.value })}
              />
            </Field>
            <Field label="Description (optional)">
              <textarea
                className={cn(inputClass, "min-h-[72px]")}
                value={deptEdit.description ?? ""}
                onChange={(e) => setDeptEdit({ ...deptEdit, description: e.target.value })}
              />
            </Field>
            <Field label="Display order">
              <input
                type="number"
                className={inputClass}
                value={deptEdit.sortOrder ?? 0}
                onChange={(e) => setDeptEdit({ ...deptEdit, sortOrder: Number(e.target.value) })}
              />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={Boolean(deptEdit.isPublic)}
                onChange={(e) => setDeptEdit({ ...deptEdit, isPublic: e.target.checked })}
              />
              Public department
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase text-primary-foreground"
              >
                Save department
              </button>
              {deptEdit.id ? (
                <button
                  type="button"
                  className="h-10 rounded-md border border-bad px-4 text-[12px] font-semibold text-bad"
                  onClick={() => setDeleteDeptId(deptEdit.id!)}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </form>
        </Drawer>
      ) : null}

      <MediaPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(item: CmsMediaListItem) => {
          if (!edit) return;
          setEdit({
            ...edit,
            photoMediaId: item.id,
            photoAlt: edit.photoAlt || item.altText || "",
            photo: {
              src: item.src,
              alt: item.altText || "",
              objectPosition: `50% 50%`,
            },
          });
        }}
      />

      <ConfirmAction
        open={Boolean(deleteId)}
        title="Delete team member?"
        description="This removes the public profile permanently. CRM SalesRep records are not deleted."
        confirmLabel="Delete"
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
        onConfirm={() => {
          if (!deleteId) return;
          void (async () => {
            const r = await deleteTeamMemberFn({ data: { id: deleteId } });
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Member deleted");
              setDeleteId(null);
              setEdit(null);
              await load();
            }
          })();
        }}
      />

      <ConfirmAction
        open={Boolean(deleteDeptId)}
        title="Delete department?"
        description="This removes the department permanently. Team members keep their profiles and become unassigned."
        confirmLabel="Delete"
        onOpenChange={(open) => {
          if (!open) setDeleteDeptId(null);
        }}
        onConfirm={() => {
          if (!deleteDeptId) return;
          void (async () => {
            const r = await deleteTeamDepartmentFn({ data: { id: deleteDeptId } });
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Department deleted");
              if (departmentId === deleteDeptId) setDepartmentId("");
              setDeleteDeptId(null);
              setDeptEdit(null);
              await load();
            }
          })();
        }}
      />
    </div>
  );
}
