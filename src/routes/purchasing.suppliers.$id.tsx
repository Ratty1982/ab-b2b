import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import { StatusBadge } from "@/components/ab/Badges";
import {
  ErrorState,
  LoadingState,
  PlannerRecommendationBadge,
  btnClass,
  gbp,
  primaryBtnClass,
  qty,
} from "@/components/purchasing/workspace";
import { ROUTES } from "@/lib/app-nav";
import type { PlannerRecommendation } from "@/domain/purchasing-planner";
import {
  addProductSupplierFn,
  addSupplierAutopartGroupFn,
  setSupplierAutopartGroupActiveFn,
  searchPurchasingProductsFn,
  setPreferredProductSupplierFn,
  setProductSupplierActiveFn,
  setPurchasingSupplierActiveFn,
  updateProductSupplierFn,
  updatePurchasingSupplierFn,
  getPurchasingSupplierFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/purchasing/suppliers/$id")({
  head: () => ({ meta: [{ title: "Supplier — Purchasing — Automotive Brands" }] }),
  component: SupplierDetailPage,
});

type Data = Extract<Awaited<ReturnType<typeof getPurchasingSupplierFn>>, { ok: true }>["data"];
type Product = Data["products"][number];
type Hit = { sku: string; name: string; productKindLabel: string };

function SupplierDetailPage() {
  const { id } = Route.useParams();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    void getPurchasingSupplierFn({ data: { id } }).then((result) => {
      if (!result.ok) {
        setError(result.error);
        setData(null);
        return;
      }
      setError(null);
      setData(result.data);
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.canManage) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    const result = await updatePurchasingSupplierFn({
      data: {
        id,
        name: String(form.get("name") ?? ""),
        code: String(form.get("code") ?? ""),
        accountNumber: String(form.get("accountNumber") ?? ""),
        contactName: String(form.get("contactName") ?? ""),
        email: String(form.get("email") ?? ""),
        telephone: String(form.get("telephone") ?? ""),
        website: String(form.get("website") ?? ""),
        notes: String(form.get("notes") ?? ""),
        defaultLeadTimeDays: String(form.get("defaultLeadTimeDays") ?? ""),
        defaultMinimumOrderValue: String(form.get("defaultMinimumOrderValue") ?? ""),
        currency: String(form.get("currency") ?? "GBP"),
      },
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    load();
  }

  async function toggleActive() {
    if (!data?.canManage) return;
    const result = await setPurchasingSupplierActiveFn({ data: { id, active: !data.supplier.active } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    load();
  }

  return (
    <>
      <PanelHeader
        title={data?.supplier.name ?? "Supplier"}
        sub="Supplier information for purchasing decisions. This does not create a purchase order."
        crumbs={[
          { label: "Purchasing", to: ROUTES.purchasing },
          { label: "Suppliers", to: ROUTES.purchasingSuppliers },
          { label: data?.supplier.name ?? "Supplier" },
        ]}
        actions={
          <Link to={ROUTES.purchasingPlanner} search={{ supplierId: id }} className={btnClass}>
            Open in planner
          </Link>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      {!data && !error ? <LoadingState label="Loading supplier…" /> : null}
      {data ? (
        <div className="grid gap-8 px-4 py-5 sm:px-6">
          <form key={data.supplier.updatedAt} onSubmit={(e) => void saveSupplier(e)} className="grid gap-6 lg:grid-cols-2">
            <section className="grid gap-3">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Supplier information</h2>
              <Field label="Name" htmlFor="name">
                <input id="name" name="name" defaultValue={data.supplier.name} required disabled={!data.canManage} className={inputClass} />
              </Field>
              <Field label="Code" htmlFor="code">
                <input id="code" name="code" defaultValue={data.supplier.code ?? ""} disabled={!data.canManage} className={inputClass} />
              </Field>
              <Field label="Account number" htmlFor="accountNumber">
                <input id="accountNumber" name="accountNumber" defaultValue={data.supplier.accountNumber ?? ""} disabled={!data.canManage} className={inputClass} />
              </Field>
              <Field label="Contact" htmlFor="contactName">
                <input id="contactName" name="contactName" defaultValue={data.supplier.contactName ?? ""} disabled={!data.canManage} className={inputClass} />
              </Field>
              <Field label="Email" htmlFor="email">
                <input id="email" name="email" defaultValue={data.supplier.email ?? ""} disabled={!data.canManage} className={inputClass} />
              </Field>
              <Field label="Telephone" htmlFor="telephone">
                <input id="telephone" name="telephone" defaultValue={data.supplier.telephone ?? ""} disabled={!data.canManage} className={inputClass} />
              </Field>
              <Field label="Website" htmlFor="website">
                <input id="website" name="website" defaultValue={data.supplier.website ?? ""} disabled={!data.canManage} className={inputClass} />
              </Field>
              <Field label="Notes" htmlFor="notes">
                <textarea id="notes" name="notes" defaultValue={data.supplier.notes ?? ""} disabled={!data.canManage} className={inputClass} rows={4} />
              </Field>
            </section>
            <section className="grid content-start gap-3">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Purchasing settings</h2>
              <Field label="Default lead time (days)" htmlFor="defaultLeadTimeDays">
                <input id="defaultLeadTimeDays" name="defaultLeadTimeDays" defaultValue={data.supplier.defaultLeadTimeDays ?? ""} disabled={!data.canManage} className={inputClass} />
              </Field>
              <Field label="Minimum order value" htmlFor="defaultMinimumOrderValue">
                <input id="defaultMinimumOrderValue" name="defaultMinimumOrderValue" defaultValue={data.supplier.defaultMinimumOrderValue ?? ""} disabled={!data.canManage} className={inputClass} />
              </Field>
              <Field label="Currency" htmlFor="currency">
                <input id="currency" name="currency" defaultValue={data.supplier.currency} maxLength={3} disabled={!data.canManage} className={inputClass} />
              </Field>
              <p className="text-[13px] text-steel">
                Products to consider {qty(data.planning.productsToConsider)} · Order now {qty(data.planning.orderNow)} ·
                Backorders at risk {qty(data.planning.backordersAtRisk)} · Suggested value {gbp(data.planning.knownValue)}
                {data.planning.belowMinimumBy ? ` · Below minimum by ${gbp(data.planning.belowMinimumBy)}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {data.canManage ? (
                  <button type="submit" className={primaryBtnClass} disabled={saving}>
                    {saving ? "Saving…" : "Save supplier"}
                  </button>
                ) : null}
                {data.canManage ? (
                  <button type="button" className={btnClass} onClick={() => void toggleActive()}>
                    {data.supplier.active ? "Deactivate" : "Reactivate"}
                  </button>
                ) : null}
                <StatusBadge tone={data.supplier.active ? "good" : "neutral"}>
                  {data.supplier.active ? "Active" : "Inactive"}
                </StatusBadge>
              </div>
            </section>
          </form>

          <AutopartGroups
            supplierId={id}
            canManage={data.canManage && data.supplier.active}
            groups={data.autopartGroups}
            onChanged={load}
          />

          <section>
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Products supplied</h2>
            {data.canManage && data.supplier.active ? <AddProduct supplierId={id} onAdded={load} /> : null}
            {data.products.length === 0 ? (
              <p className="mt-3 text-[13px] text-steel">No products assigned. A SKU with no supplier stays valid and shows as NO SUPPLIER.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-[12px]">
                  <thead className="border-b border-border text-[10px] uppercase tracking-wide text-steel">
                    <tr>
                      <th className="px-2 py-2">SKU</th>
                      <th className="px-2 py-2">Product</th>
                      <th className="px-2 py-2">Class</th>
                      <th className="px-2 py-2 text-right">Available</th>
                      <th className="px-2 py-2 text-right">Incoming</th>
                      <th className="px-2 py-2 text-right">Backorders</th>
                      <th className="px-2 py-2">Recommendation</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.products.map((product) => (
                      <ProductRow key={product.id} product={product} canManage={data.canManage} onChanged={load} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

function AutopartGroups({
  supplierId,
  canManage,
  groups,
  onChanged,
}: {
  supplierId: string;
  canManage: boolean;
  groups: Data["autopartGroups"];
  onChanged: () => void;
}) {
  const [groupCode, setGroupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function describe(result: {
    matchedProducts: number;
    relationshipsCreated: number;
    alreadyLinked: number;
    manualOverridesPreserved: number;
    changedGroup: number;
  }) {
    return `Matched products: ${result.matchedProducts}. Relationships created: ${result.relationshipsCreated}. Already linked: ${result.alreadyLinked}. Manual overrides preserved: ${result.manualOverridesPreserved}. Group changes reconciled: ${result.changedGroup}.`;
  }

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const result = await addSupplierAutopartGroupFn({ data: { supplierId, groupCode } });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      setNotice(null);
      return;
    }
    setError(null);
    setGroupCode("");
    setNotice(describe(result.data.reconciliation));
    onChanged();
  }

  async function toggle(id: string, active: boolean) {
    const result = await setSupplierAutopartGroupActiveFn({ data: { id, active } });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setNotice(describe(result.data.reconciliation));
    onChanged();
  }

  return (
    <section>
      <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Autopart Groups</h2>
      <p className="mt-1 text-[13px] text-steel">
        Products in these Autopart Groups can be automatically associated with this supplier. This is separate from the supplier code.
      </p>
      {groups.length === 0 ? <p className="mt-3 text-[13px] text-steel">No Autopart Groups —</p> : null}
      {groups.length > 0 ? (
        <ul className="mt-3 grid gap-2">
          {groups.map((group) => (
            <li key={group.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border/70 px-3 py-2 text-[13px]">
              <span>
                <span className="font-mono font-semibold">{group.groupCode}</span>
                <span className="ml-2 text-steel">{group.active ? "Active" : "Inactive"}</span>
                <span className="ml-2 text-steel">
                  {group.linkedProducts} linked · {group.productsInGroup} in group
                </span>
              </span>
              {canManage ? (
                <button type="button" className={btnClass} onClick={() => void toggle(group.id, !group.active)}>
                  {group.active ? "Deactivate" : "Reactivate"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canManage ? (
        <form onSubmit={(e) => void add(e)} className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Autopart Group" htmlFor="autopart-group">
            <input
              id="autopart-group"
              value={groupCode}
              onChange={(e) => setGroupCode(e.target.value)}
              className={inputClass}
              placeholder="SX"
            />
          </Field>
          <button type="submit" className={primaryBtnClass} disabled={saving || !groupCode.trim()}>
            {saving ? "Saving…" : "Add Group"}
          </button>
        </form>
      ) : null}
      {notice ? <p className="mt-2 text-[12px] text-steel">{notice}</p> : null}
      {error ? <p className="mt-2 text-[12px] text-destructive">{error}</p> : null}
    </section>
  );
}

function AddProduct({ supplierId, onAdded }: { supplierId: string; onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sku, setSku] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchPurchasingProductsFn({ data: { q: q.trim() } }).then((result) => {
        if (result.ok) setHits(result.data);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await addProductSupplierFn({
      data: {
        supplierId,
        sku: sku || String(form.get("sku") ?? ""),
        supplierSku: String(form.get("supplierSku") ?? ""),
        leadTimeDays: String(form.get("leadTimeDays") ?? ""),
        minimumOrderQty: String(form.get("minimumOrderQty") ?? ""),
        orderMultiple: String(form.get("orderMultiple") ?? ""),
        unitCost: String(form.get("unitCost") ?? ""),
        isPreferred: form.get("isPreferred") === "on",
      },
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSku("");
    setQ("");
    onAdded();
  }

  return (
    <form onSubmit={(e) => void add(e)} className="mt-3 grid gap-2 rounded-md border border-border p-3 md:grid-cols-4">
      <div className="md:col-span-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSku("");
          }}
          placeholder="Search SKU or product, including external"
          className={inputClass}
        />
        {hits.length > 0 && !sku ? (
          <ul className="mt-1 max-h-40 overflow-auto border border-border bg-surface text-[12px]">
            {hits.map((hit) => (
              <li key={hit.sku}>
                <button
                  type="button"
                  className="block w-full px-2 py-1 text-left hover:bg-primary/10"
                  onClick={() => {
                    setSku(hit.sku);
                    setQ(`${hit.sku} — ${hit.name}`);
                    setHits([]);
                  }}
                >
                  <span className="font-mono">{hit.sku}</span> {hit.name}{" "}
                  <span className="text-steel">{hit.productKindLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <input name="supplierSku" placeholder="Supplier SKU" className={inputClass} />
      <input name="unitCost" placeholder="Cost override" className={inputClass} />
      <input name="leadTimeDays" placeholder="Lead time days" className={inputClass} />
      <input name="minimumOrderQty" placeholder="MOQ" className={inputClass} />
      <input name="orderMultiple" placeholder="Order multiple" className={inputClass} />
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" name="isPreferred" /> Preferred
      </label>
      <button type="submit" className={primaryBtnClass} disabled={!sku}>
        Add product
      </button>
      {error ? <p className="md:col-span-4 text-[12px] text-destructive">{error}</p> : null}
    </form>
  );
}

function ProductRow({
  product,
  canManage,
  onChanged,
}: {
  product: Product;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await updateProductSupplierFn({
      data: {
        id: product.id,
        supplierSku: String(form.get("supplierSku") ?? ""),
        leadTimeDays: String(form.get("leadTimeDays") ?? ""),
        minimumOrderQty: String(form.get("minimumOrderQty") ?? ""),
        orderMultiple: String(form.get("orderMultiple") ?? ""),
        unitCost: String(form.get("unitCost") ?? ""),
      },
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(false);
    onChanged();
  }

  async function prefer() {
    const result = await setPreferredProductSupplierFn({ data: { id: product.id } });
    if (!result.ok) setError(result.error);
    else onChanged();
  }

  async function toggle() {
    const result = await setProductSupplierActiveFn({ data: { id: product.id, active: !product.active } });
    if (!result.ok) setError(result.error);
    else onChanged();
  }

  return (
    <>
      <tr className="border-b border-border/60">
        <td className="px-2 py-2 font-mono">{product.sku}</td>
        <td className="px-2 py-2">
          {product.name}
          {!product.active ? <span className="ml-2 text-steel">Inactive</span> : null}
          {product.isPreferred ? <span className="ml-2 text-primary">Preferred</span> : null}
          {product.source === "AUTOPART_GROUP" ? (
            <span className="ml-2 text-steel">Autopart Group {product.autopartGroupCode ?? ""}</span>
          ) : (
            <span className="ml-2 text-steel">Manual</span>
          )}
        </td>
        <td className="px-2 py-2">{product.productKindLabel}</td>
        <td className="px-2 py-2 text-right tabular-nums">{product.availQty == null ? "—" : qty(product.availQty)}</td>
        <td className="px-2 py-2 text-right tabular-nums">{product.incomingQty == null ? "—" : qty(product.incomingQty)}</td>
        <td className="px-2 py-2 text-right tabular-nums">{qty(product.backorderUnits)}</td>
        <td className="px-2 py-2">
          {product.recommendation ? (
            <PlannerRecommendationBadge
              recommendation={product.recommendation as PlannerRecommendation}
              reason={product.recommendationReason}
            />
          ) : (
            "—"
          )}
          {product.recommendation && !product.planningSupplierIsThis ? (
            <span className="mt-1 block text-[11px] text-steel">Not the planning supplier</span>
          ) : null}
        </td>
        <td className="px-2 py-2">
          {canManage ? (
            <div className="flex flex-wrap gap-1">
              <button type="button" className={btnClass} onClick={() => setEditing((v) => !v)}>
                Edit
              </button>
              {product.active && !product.isPreferred ? (
                <button type="button" className={btnClass} onClick={() => void prefer()}>
                  Set preferred
                </button>
              ) : null}
              <button type="button" className={btnClass} onClick={() => void toggle()}>
                {product.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          ) : null}
        </td>
      </tr>
      {editing ? (
        <tr className="border-b border-border/60 bg-surface/40">
          <td colSpan={8} className="px-2 py-2">
            <form onSubmit={(e) => void save(e)} className="grid gap-2 md:grid-cols-5">
              <input name="supplierSku" defaultValue={product.supplierSku ?? ""} placeholder="Supplier SKU" className={inputClass} />
              <input name="leadTimeDays" defaultValue={product.leadTimeDays ?? ""} placeholder="Lead time" className={inputClass} />
              <input name="minimumOrderQty" defaultValue={product.minimumOrderQty ?? ""} placeholder="MOQ" className={inputClass} />
              <input name="orderMultiple" defaultValue={product.orderMultiple ?? ""} placeholder="Multiple" className={inputClass} />
              <input name="unitCost" defaultValue={product.unitCost ?? ""} placeholder="Cost override" className={inputClass} />
              <button type="submit" className={primaryBtnClass}>
                Save relationship
              </button>
              {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
            </form>
            <p className="mt-1 text-[11px] text-steel">
              Latest cost {gbp(product.latestCost)} · Supplier SKU {product.supplierSku ?? "—"} · Lead {product.leadTimeDays ?? "—"} ·
              MOQ {product.minimumOrderQty ?? "—"} · Multiple {product.orderMultiple ?? "—"} · Override {gbp(product.unitCost)}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}
