import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { BrandLogoPicker } from "@/components/cms/SectionSettings";
import { slugifyCatalogue } from "@/domain/catalogue";
import { listCatalogueBrandsFn, saveCatalogueBrandFn } from "@/server/phase2/fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/brands")({
  head: () => ({ meta: [{ title: "Brands — Automotive Brands Admin" }] }),
  component: AdminBrands,
});

type BrandRow = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  activeProductCount: number;
  logoMediaId: string | null;
  logoAlt: string | null;
  logoSrc: string | null;
};

function AdminBrands() {
  const [rows, setRows] = useState<BrandRow[]>([]);
  const [edit, setEdit] = useState<Partial<BrandRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await listCatalogueBrandsFn();
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
        title="Brands"
        sub="Portfolio brands for the product master. Brands with products cannot be deleted."
        actions={
          <button type="button" className="h-10 rounded-md bg-primary px-5 text-[13px] font-bold uppercase text-primary-foreground" onClick={() => setEdit({ name: "", slug: "", isActive: true, sortOrder: rows.length + 1, logoMediaId: null, logoAlt: null, logoSrc: null })}>
            Add brand
          </button>
        }
      />
      <div className="p-4 sm:p-6">
        {error ? <p className="mb-4 text-sm text-bad">{error}</p> : null}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                <th className="px-3 py-2">Logo</th>
                <th className="px-3 py-2">Brand</th>
                <th className="px-3 py-2 text-right">Products</th>
                <th className="px-3 py-2 text-right">Active</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b, i) => (
                <tr key={b.id} className={cn("border-b border-border/60", i % 2 && "bg-surface/30")}>
                  <td className="px-3 py-2">
                    <div className="grid size-10 place-items-center overflow-hidden rounded border border-border bg-white">
                      {b.logoSrc ? <img src={b.logoSrc} alt="" className="max-h-9 max-w-9 object-contain object-center" /> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-medium">{b.name}</td>
                  <td className="num px-3 py-2 text-right">{b.productCount}</td>
                  <td className="num px-3 py-2 text-right">{b.activeProductCount}</td>
                  <td className="px-3 py-2"><StatusBadge tone={b.isActive ? "good" : "warn"}>{b.isActive ? "Active" : "Hidden"}</StatusBadge></td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setEdit(b)}>Manage</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {edit ? (
        <Drawer open title={edit.id ? "Manage brand" : "Add brand"} onClose={() => setEdit(null)}>
          <form className="grid gap-4" onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              const r = await saveCatalogueBrandFn({
                data: {
                  id: edit.id,
                  name: edit.name,
                  slug: edit.slug || slugifyCatalogue(edit.name ?? ""),
                  tagline: edit.tagline ?? "",
                  description: edit.description ?? "",
                  isActive: edit.isActive ?? true,
                  sortOrder: edit.sortOrder ?? 0,
                  logoMediaId: edit.logoMediaId ?? "",
                  logoAlt: edit.logoAlt ?? "",
                },
              });
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success("Brand saved");
              setEdit(null);
              await load();
            })();
          }}>
            <Field label="Name"><input required value={edit.name ?? ""} onChange={(e) => setEdit((prev) => (prev ? { ...prev, name: e.target.value } : prev))} className={inputClass} /></Field>
            <Field label="Slug"><input value={edit.slug ?? ""} onChange={(e) => setEdit((prev) => (prev ? { ...prev, slug: e.target.value } : prev))} className={inputClass} /></Field>
            <Field label="Tagline"><input value={edit.tagline ?? ""} onChange={(e) => setEdit((prev) => (prev ? { ...prev, tagline: e.target.value } : prev))} className={inputClass} /></Field>
            <Field label="Description"><textarea value={edit.description ?? ""} onChange={(e) => setEdit((prev) => (prev ? { ...prev, description: e.target.value } : prev))} className={`${inputClass} min-h-24`} /></Field>
            <Field label="Display order"><input type="number" value={edit.sortOrder ?? 0} onChange={(e) => setEdit((prev) => (prev ? { ...prev, sortOrder: Number(e.target.value) } : prev))} className={inputClass} /></Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={edit.isActive ?? true} onChange={(e) => setEdit((prev) => (prev ? { ...prev, isActive: e.target.checked } : prev))} />
              Active
            </label>
            <BrandLogoPicker
              label={edit.name || "Brand"}
              logo={edit.logoMediaId ? { mediaId: edit.logoMediaId, src: edit.logoSrc ?? undefined, alt: edit.logoAlt ?? undefined } : undefined}
              onChange={(next) => setEdit((prev) => (prev ? { ...prev, logoMediaId: next?.mediaId ?? null, logoSrc: next?.src ?? null, logoAlt: next?.alt ?? null } : prev))}
            />
            {edit.id && (edit.productCount ?? 0) > 0 ? (
              <p className="text-[12px] text-steel">This brand has {edit.productCount} products, so it cannot be deleted. Deactivate it instead.</p>
            ) : null}
            <button type="submit" className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">Save brand</button>
          </form>
        </Drawer>
      ) : null}
    </div>
  );
}
