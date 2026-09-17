import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { BrandLogoPicker } from "@/components/cms/SectionSettings";
import { slugifyCatalogue } from "@/domain/catalogue";
import { listCatalogueCategoriesFn, saveCatalogueCategoryFn } from "@/server/phase2/fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/categories")({
  head: () => ({ meta: [{ title: "Categories — Automotive Brands Admin" }] }),
  component: AdminCategories,
});

type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentId: string | null;
  parentName: string | null;
  sortOrder: number;
  isActive: boolean;
  childCount: number;
  productCount: number;
  depth: number;
  imageMediaId: string | null;
  imageAlt: string | null;
  imageSrc: string | null;
};

function AdminCategories() {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [edit, setEdit] = useState<Partial<CategoryRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await listCatalogueCategoriesFn();
    if (!r.ok) setError(r.error);
    else {
      setError(null);
      setRows(r.data);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <PanelHeader
        title="Categories"
        sub="Hierarchical catalogue structure. A category cannot be nested under its own descendant."
        actions={
          <button type="button" className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase text-primary-foreground" onClick={() => setEdit({ name: "", slug: "", parentId: null, isActive: true, sortOrder: 0 })}>
            Add category
          </button>
        }
      />
      <div className="p-4 sm:p-6">
        {error ? <p className="mb-4 text-sm text-bad">{error}</p> : null}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Parent</th>
                <th className="px-3 py-2 text-right">Products</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.id} className={cn("border-b border-border/60", i % 2 && "bg-surface/30")}>
                  <td className="px-3 py-2 font-medium" style={{ paddingLeft: 12 + c.depth * 16 }}>{c.name}</td>
                  <td className="px-3 py-2 text-steel">{c.parentName ?? "—"}</td>
                  <td className="num px-3 py-2 text-right">{c.productCount}</td>
                  <td className="px-3 py-2"><StatusBadge tone={c.isActive ? "good" : "warn"}>{c.isActive ? "Active" : "Hidden"}</StatusBadge></td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setEdit(c)}>Manage</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {edit ? (
        <Drawer open title={edit.id ? "Manage category" : "Add category"} onClose={() => setEdit(null)}>
          <form className="grid gap-4" onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              const r = await saveCatalogueCategoryFn({
                data: {
                  id: edit.id,
                  name: edit.name,
                  slug: edit.slug || slugifyCatalogue(edit.name ?? ""),
                  description: edit.description ?? "",
                  parentId: edit.parentId || null,
                  isActive: edit.isActive ?? true,
                  sortOrder: edit.sortOrder ?? 0,
                  imageMediaId: edit.imageMediaId ?? "",
                  imageAlt: edit.imageAlt ?? "",
                },
              });
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success("Category saved");
              setEdit(null);
              await load();
            })();
          }}>
            <Field label="Name"><input required value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={inputClass} /></Field>
            <Field label="Slug"><input value={edit.slug ?? ""} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} className={inputClass} /></Field>
            <Field label="Parent">
              <select value={edit.parentId ?? ""} onChange={(e) => setEdit({ ...edit, parentId: e.target.value || null })} className={inputClass}>
                <option value="">Top level</option>
                {rows.filter((c) => c.id !== edit.id).map((c) => (
                  <option key={c.id} value={c.id}>{"— ".repeat(c.depth)}{c.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Description"><textarea value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className={`${inputClass} min-h-20`} /></Field>
            <Field label="Display order"><input type="number" value={edit.sortOrder ?? 0} onChange={(e) => setEdit({ ...edit, sortOrder: Number(e.target.value) })} className={inputClass} /></Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={edit.isActive ?? true} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
              Active
            </label>
            <BrandLogoPicker
              label="Category image"
              logo={edit.imageMediaId ? { mediaId: edit.imageMediaId, src: edit.imageSrc ?? undefined, alt: edit.imageAlt ?? undefined } : undefined}
              onChange={(next) => setEdit({ ...edit, imageMediaId: next?.mediaId ?? null, imageSrc: next?.src ?? null, imageAlt: next?.alt ?? null })}
            />
            <button type="submit" className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">Save category</button>
          </form>
        </Drawer>
      ) : null}
    </div>
  );
}
