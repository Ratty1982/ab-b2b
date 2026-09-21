import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import { CommercialAuditList } from "@/components/pricing/CommercialAuditList";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";
import {
  addPriceListItemsFn,
  applyPriceListCsvFn,
  assignCompanyPriceListFn,
  bulkUpdatePriceListItemsFn,
  deletePriceListItemFn,
  exportPriceListCsvFn,
  getPriceListFn,
  listPriceListCompaniesFn,
  listPriceListItemsFn,
  previewPriceListCsvFn,
  searchPricingCompaniesFn,
  searchPricingVariantsFn,
  upsertPriceListFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/pricing/$id")({
  head: () => ({ meta: [{ title: "Price list — Automotive Brands Admin" }] }),
  component: PriceListWorkspace,
});

type Item = {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  brand: string;
  baseTradePriceDisplay: string | null;
  unitPrice: number | null;
  unitPriceDisplay: string | null;
  differenceLabel: string | null;
  status: string;
};

function PriceListWorkspace() {
  const { id } = Route.useParams();
  const session = useSession();
  const canEdit = session.signedIn && session.user.navPermissions.includes("pricing.edit");
  const [list, setList] = useState<{
    id: string;
    name: string;
    code: string;
    status: string;
    isDefault: boolean;
    itemCount: number;
    companyCount: number;
  } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [brand, setBrand] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Array<{
    id: string;
    name: string;
    accountNumber: string | null;
    priceListName: string | null;
  }>>([]);

  const load = useCallback(async () => {
    const [listRes, itemsRes, companiesRes] = await Promise.all([
      getPriceListFn({ data: { id } }),
      listPriceListItemsFn({ data: { priceListId: id, q, brand, page: 1, pageSize: 200 } }),
      listPriceListCompaniesFn({ data: { priceListId: id } }),
    ]);
    if (!listRes.ok) {
      toast.error(listRes.error);
      return;
    }
    setList(listRes.data);
    if (itemsRes.ok) {
      setItems(itemsRes.data.items);
      setDrafts({});
    }
    if (companiesRes.ok) setCompanies(companiesRes.data);
  }, [id, q, brand]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () =>
      Object.entries(drafts).filter(([variantId, value]) => {
        const item = items.find((row) => row.variantId === variantId);
        if (!item || !value.trim()) return false;
        return Number(value) !== item.unitPrice;
      }),
    [drafts, items],
  );

  function downloadCsv(csv: string, filename: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!list) return <p className="p-6 text-[13px] text-steel">Loading price list…</p>;

  return (
    <div>
      <PanelHeader
        title={list.name}
        sub={`${list.code} · ${list.itemCount} products · ${list.companyCount} assigned customers`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to={ROUTES.adminPricing} className="inline-flex h-10 items-center rounded-md border border-border px-3 text-[12px] font-semibold">
              All lists
            </Link>
            {canEdit ? (
              <>
                <button type="button" className="h-10 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => setEditOpen(true)}>
                  Edit details
                </button>
                <button type="button" className="h-10 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => setAssignOpen(true)}>
                  Assign customers
                </button>
                <button type="button" className="h-10 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground" onClick={() => setAddOpen(true)}>
                  Add products
                </button>
              </>
            ) : null}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-6">
        {list.isDefault ? <StatusBadge tone="brand">Default</StatusBadge> : <StatusBadge tone="good">Live</StatusBadge>}
        <span className="text-[12px] text-steel">Activate/deactivate is not supported on the current price-list model.</span>
      </div>

      <div className="space-y-8 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            <Field label="Search SKU / product">
              <input value={q} onChange={(e) => setQ(e.target.value)} className={cn(inputClass, "w-56")} />
            </Field>
            <Field label="Brand">
              <input value={brand} onChange={(e) => setBrand(e.target.value)} className={cn(inputClass, "w-40")} placeholder="Power Maxed" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="h-10 rounded-md border border-border px-3 text-[12px] font-semibold"
              onClick={() => {
                void exportPriceListCsvFn({ data: { priceListId: id } }).then((r) => {
                  if (!r.ok) toast.error(r.error);
                  else downloadCsv(r.data.csv, r.data.filename);
                });
              }}
            >
              Export CSV
            </button>
            {canEdit ? (
              <button type="button" className="h-10 rounded-md border border-border px-3 text-[12px] font-semibold" onClick={() => setImportOpen(true)}>
                Import CSV
              </button>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                disabled={!dirty.length}
                className="h-10 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground disabled:opacity-40"
                onClick={() => {
                  void bulkUpdatePriceListItemsFn({
                    data: {
                      priceListId: id,
                      items: dirty.map(([variantId, unitPrice]) => ({ variantId, unitPrice: Number(unitPrice) })),
                    },
                  }).then((r) => {
                    if (!r.ok) toast.error(r.error);
                    else {
                      toast.success("List prices saved");
                      void load();
                    }
                  });
                }}
              >
                Save changes{dirty.length ? ` (${dirty.length})` : ""}
              </button>
            ) : null}
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-[13px] text-steel">
            No products in this price list.
            {canEdit ? (
              <div>
                <button type="button" className="mt-3 font-semibold text-primary" onClick={() => setAddOpen(true)}>
                  Add products
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Brand</th>
                  <th className="px-3 py-2 text-right">Base trade</th>
                  <th className="px-3 py-2 text-right">List price</th>
                  <th className="px-3 py-2 text-right">Difference</th>
                  <th className="px-3 py-2">Status</th>
                  {canEdit ? <th className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const draft = drafts[item.variantId];
                  const dirtyRow = draft != null && Number(draft) !== item.unitPrice;
                  return (
                    <tr key={item.id} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30", dirtyRow && "bg-primary/5")}>
                      <td className="num px-3 py-2 text-primary">{item.sku}</td>
                      <td className="px-3 py-2">{item.productName}</td>
                      <td className="px-3 py-2 text-steel">{item.brand}</td>
                      <td className="num px-3 py-2 text-right">{item.baseTradePriceDisplay ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {canEdit ? (
                          <input
                            className={cn(inputClass, "ml-auto w-24 text-right", dirtyRow && "border-primary")}
                            value={draft ?? (item.unitPrice != null ? String(item.unitPrice) : "")}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [item.variantId]: e.target.value }))}
                          />
                        ) : (
                          <span className="num">{item.unitPriceDisplay ?? "—"}</span>
                        )}
                      </td>
                      <td className="num px-3 py-2 text-right">{item.differenceLabel ?? "—"}</td>
                      <td className="px-3 py-2"><StatusBadge tone={item.status === "ACTIVE" || item.status === "Active" ? "good" : "neutral"}>{item.status}</StatusBadge></td>
                      {canEdit ? (
                        <td className="px-3 py-2 text-right">
                          <button type="button" className="text-[12px] font-semibold text-primary" onClick={() => setRemoveId(item.id)}>
                            Remove
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <section>
          <h3 className="font-display text-lg font-semibold uppercase">Assigned customers</h3>
          {companies.length === 0 ? (
            <p className="mt-2 text-[13px] text-steel">No companies assigned to this list.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Current price list</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <tr key={company.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        <Link to="/admin/customers/$id" params={{ id: company.id }} className="font-semibold text-primary">
                          {company.name}
                        </Link>
                      </td>
                      <td className="num px-3 py-2">{company.accountNumber ?? "—"}</td>
                      <td className="px-3 py-2">{company.priceListName ?? list.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <CommercialAuditList priceListId={id} />
      </div>

      <ConfirmAction
        open={Boolean(removeId)}
        title="Remove product from price list?"
        description="The company will fall back to customer override or base trade price. This does not delete the product."
        confirmLabel="Remove"
        onOpenChange={(open) => {
          if (!open) setRemoveId(null);
        }}
        onConfirm={() => {
          if (!removeId) return;
          void deletePriceListItemFn({ data: { id: removeId } }).then((r) => {
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Product removed");
              void load();
            }
          });
        }}
      />

      {addOpen ? <AddProductsDrawer priceListId={id} existing={new Set(items.map((item) => item.variantId))} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); void load(); }} /> : null}
      {assignOpen ? <AssignCustomersDrawer priceListId={id} onClose={() => setAssignOpen(false)} onSaved={() => { setAssignOpen(false); void load(); }} /> : null}
      {editOpen ? (
        <Drawer open title="Edit details" onClose={() => setEditOpen(false)}>
          <EditListForm list={list} onSaved={() => { setEditOpen(false); void load(); }} />
        </Drawer>
      ) : null}
      {importOpen ? <ImportCsvDrawer priceListId={id} onClose={() => setImportOpen(false)} onSaved={() => { setImportOpen(false); void load(); }} /> : null}
    </div>
  );
}

function EditListForm({
  list,
  onSaved,
}: {
  list: { id: string; name: string; code: string; isDefault: boolean };
  onSaved: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [code, setCode] = useState(list.code);
  const [isDefault, setIsDefault] = useState(list.isDefault);
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void upsertPriceListFn({ data: { id: list.id, name, code, isDefault } }).then((r) => {
          if (!r.ok) toast.error(r.error);
          else {
            toast.success("Details saved");
            onSaved();
          }
        });
      }}
    >
      <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></Field>
      <Field label="Code"><input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} /></Field>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
        Mark as default (label only)
      </label>
      <button type="submit" className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">Save</button>
    </form>
  );
}

function AddProductsDrawer({
  priceListId,
  existing,
  onClose,
  onSaved,
}: {
  priceListId: string;
  existing: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; sku: string; name: string; brand: string; baseTradePriceDisplay: string | null }>>([]);
  const [selected, setSelected] = useState<Record<string, { sku: string; name: string; price: string }>>({});

  return (
    <Drawer open title="Add products" onClose={onClose}>
      <Field label="Search SKU / name / brand">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            void searchPricingVariantsFn({ data: { q: e.target.value } }).then((r) => r.ok && setHits(r.data));
          }}
          className={inputClass}
        />
      </Field>
      <ul className="mt-3 max-h-48 overflow-auto divide-y divide-border rounded-md border border-border text-[13px]">
        {hits.map((hit) => {
          const already = existing.has(hit.id) || Boolean(selected[hit.id]);
          return (
            <li key={hit.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span>
                <span className="num text-primary">{hit.sku}</span> {hit.name}
                <span className="block text-[11px] text-steel">{hit.brand} · base {hit.baseTradePriceDisplay ?? "—"}</span>
              </span>
              <button
                type="button"
                disabled={already}
                className="text-[12px] font-semibold text-primary disabled:text-steel"
                onClick={() =>
                  setSelected((prev) => ({
                    ...prev,
                    [hit.id]: { sku: hit.sku, name: hit.name, price: "" },
                  }))
                }
              >
                {existing.has(hit.id) ? "Already on list" : already ? "Selected" : "Select"}
              </button>
            </li>
          );
        })}
      </ul>
      {Object.keys(selected).length === 0 ? (
        <p className="mt-3 text-[13px] text-steel">Select one or more products, then set list prices.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {Object.entries(selected).map(([variantId, row]) => (
            <div key={variantId} className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
              <div className="text-[13px]">{row.sku} {row.name}</div>
              <input
                className={inputClass}
                placeholder="List price"
                value={row.price}
                onChange={(e) => setSelected((prev) => ({ ...prev, [variantId]: { ...row, price: e.target.value } }))}
              />
            </div>
          ))}
          <button
            type="button"
            className="h-11 w-full rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground"
            onClick={() => {
              const items = Object.entries(selected)
                .filter(([, row]) => Number(row.price) > 0)
                .map(([variantId, row]) => ({ variantId, unitPrice: Number(row.price) }));
              if (!items.length) return;
              void addPriceListItemsFn({ data: { priceListId, items } }).then((r) => {
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success(`Added ${r.data.created}${r.data.skippedDuplicates.length ? `, skipped ${r.data.skippedDuplicates.length} duplicates` : ""}`);
                  onSaved();
                }
              });
            }}
          >
            Add to price list
          </button>
        </div>
      )}
    </Drawer>
  );
}

function AssignCustomersDrawer({
  priceListId,
  onClose,
  onSaved,
}: {
  priceListId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; name: string; accountNumber: string | null; currentPriceList: string }>>([]);
  return (
    <Drawer open title="Assign customers" onClose={onClose}>
      <p className="mb-3 text-[13px] text-steel">Uses the company&apos;s assigned price list. A company can only have one list.</p>
      <Field label="Search company">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            void searchPricingCompaniesFn({ data: { q: e.target.value } }).then((r) => r.ok && setHits(r.data));
          }}
          className={inputClass}
        />
      </Field>
      <ul className="mt-3 divide-y divide-border rounded-md border border-border text-[13px]">
        {hits.map((hit) => (
          <li key={hit.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span>
              {hit.name}
              <span className="block text-[11px] text-steel">{hit.accountNumber ?? "No account number"} · currently {hit.currentPriceList}</span>
            </span>
            <button
              type="button"
              className="text-[12px] font-semibold text-primary"
              onClick={() => {
                void assignCompanyPriceListFn({ data: { companyId: hit.id, priceListId } }).then((r) => {
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success("Price list assigned");
                    onSaved();
                  }
                });
              }}
            >
              Assign
            </button>
          </li>
        ))}
      </ul>
    </Drawer>
  );
}

function ImportCsvDrawer({
  priceListId,
  onClose,
  onSaved,
}: {
  priceListId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{
    ready: Array<{ sku: string; productName: string; price: number }>;
    issues: Array<{ line: number; sku: string; message: string }>;
    canApply: boolean;
  } | null>(null);

  return (
    <Drawer open title="Import list prices" onClose={onClose}>
      <p className="mb-3 text-[13px] text-steel">CSV columns: sku, price. Unknown SKUs are flagged and never created. Nothing writes until you confirm.</p>
      <textarea className={cn(inputClass, "min-h-40 font-mono text-[12px]")} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"sku,price\nGC5000,7.95"} />
      <button
        type="button"
        className="mt-3 h-10 w-full rounded-md border border-border text-[12px] font-semibold"
        onClick={() => {
          void previewPriceListCsvFn({ data: { priceListId, csv } }).then((r) => {
            if (!r.ok) toast.error(r.error);
            else setPreview(r.data);
          });
        }}
      >
        Validate & preview
      </button>
      {preview ? (
        <div className="mt-4 space-y-3 text-[13px]">
          {preview.issues.length ? (
            <ul className="rounded-md border border-border bg-surface/40 p-3 text-[12px] text-steel">
              {preview.issues.map((issue) => (
                <li key={`${issue.line}-${issue.sku}`}>{`Line ${issue.line}: ${issue.sku || "—"} — ${issue.message}`}</li>
              ))}
            </ul>
          ) : null}
          <p>{preview.ready.length} row(s) ready to apply.</p>
          <button
            type="button"
            disabled={!preview.canApply}
            className="h-11 w-full rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-40"
            onClick={() => {
              void applyPriceListCsvFn({
                data: {
                  priceListId,
                  items: preview.ready.map((row) => ({ sku: row.sku, price: row.price })),
                },
              }).then((r) => {
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success(`Applied ${r.data.applied} price(s)`);
                  onSaved();
                }
              });
            }}
          >
            Confirm import
          </button>
        </div>
      ) : null}
    </Drawer>
  );
}
