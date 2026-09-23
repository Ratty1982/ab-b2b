import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Drawer, Field, inputClass } from "@/components/ab/Drawer";
import { ValidityBadge } from "@/components/pricing/ValidityBadge";
import { cn } from "@/lib/utils";
import { InstantText } from "@/components/ab/InstantText";
import { useSession } from "@/lib/session";
import {
  listAdminPriceListsFn,
  listPromotionsFn,
  pricingOverviewFn,
  previewPromotionFn,
  searchPricingVariantsFn,
  upsertPriceListFn,
  upsertPromotionFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/pricing/")({
  head: () => ({
    meta: [
      { title: "Price Lists — Automotive Brands Admin" },
      {
        name: "description",
        content: "Manage trade price lists, promotions and commercial pricing.",
      },
    ],
  }),
  component: AdminPricingHub,
});

function AdminPricingHub() {
  const [tab, setTab] = useState<"Price lists" | "Promotions">("Price lists");

  return (
    <div>
      <PanelHeader title="Price Lists" sub="Trade price lists, company assignment and promotions. Customer overrides live on each customer record." />
      <div className="flex gap-1 border-b border-border/70 px-4 sm:px-6">
        {(["Price lists", "Promotions"] as const).map((t) => (
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
      {tab === "Price lists" ? <PriceListsPanel /> : <PromotionsPanel />}
    </div>
  );
}

function PriceListsPanel() {
  const session = useSession();
  const canEdit = session.signedIn && session.user.navPermissions.includes("pricing.edit");
  const [lists, setLists] = useState<Array<{
    id: string;
    code: string;
    name: string;
    status: string;
    isDefault: boolean;
    itemCount: number;
    companyCount: number;
    updatedAt: string;
  }>>([]);
  const [overview, setOverview] = useState<{
    priceLists: number;
    customerOverrides: number;
    activePromotions: number;
    productsWithQuantityBreaks: number;
  } | null>(null);
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  async function reload() {
    const [listsRes, overviewRes] = await Promise.all([listAdminPriceListsFn(), pricingOverviewFn()]);
    if (!listsRes.ok) {
      toast.error(listsRes.error);
      return;
    }
    setLists(listsRes.data);
    if (overviewRes.ok) setOverview(overviewRes.data);
  }

  useEffect(() => {
    void reload();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return lists;
    return lists.filter((list) => list.name.toLowerCase().includes(needle) || list.code.toLowerCase().includes(needle));
  }, [lists, q]);

  return (
    <div className="p-4 sm:p-6">
      {overview ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Price lists" value={String(overview.priceLists)} />
          <SummaryCard label="Customer overrides" value={String(overview.customerOverrides)} />
          <SummaryCard label="Active promotions" value={String(overview.activePromotions)} />
          <SummaryCard label="Products with quantity breaks" value={String(overview.productsWithQuantityBreaks)} />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Field label="Search lists">
          <input value={q} onChange={(e) => setQ(e.target.value)} className={cn(inputClass, "w-64")} placeholder="Name or code" />
        </Field>
        {canEdit ? (
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
            onClick={() => setCreateOpen(true)}
          >
            New price list
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <p className="text-[13px] text-steel">No price lists yet.</p>
          {canEdit ? (
            <button type="button" className="mt-3 text-[12px] font-semibold text-primary" onClick={() => setCreateOpen(true)}>
              Create a price list
            </button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                <th className="px-3 py-2">Price list</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Products</th>
                <th className="px-3 py-2 text-right">Assigned customers</th>
                <th className="px-3 py-2">Last updated</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((list, i) => (
                <tr key={list.id} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{list.name}</div>
                    <div className="num text-[11px] text-steel">{list.code}</div>
                  </td>
                  <td className="px-3 py-2">
                    {list.isDefault ? <StatusBadge tone="brand">Default</StatusBadge> : <StatusBadge tone="good">Live</StatusBadge>}
                  </td>
                  <td className="num px-3 py-2 text-right">{list.itemCount}</td>
                  <td className="num px-3 py-2 text-right">{list.companyCount}</td>
                  <td className="num px-3 py-2 text-steel"><InstantText value={list.updatedAt} variant="audit" /></td>
                  <td className="px-3 py-2 text-right">
                    <Link to="/admin/pricing/$id" params={{ id: list.id }} className="text-[12px] font-semibold text-primary">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen ? (
        <Drawer open title="New price list" onClose={() => setCreateOpen(false)}>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void upsertPriceListFn({ data: { name, code: code || undefined } }).then((r) => {
                if (!r.ok) toast.error(r.error);
                else {
                  toast.success("Price list created");
                  setName("");
                  setCode("");
                  setCreateOpen(false);
                  void reload();
                }
              });
            }}
          >
            <Field label="Name">
              <input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Code (optional)">
              <input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} placeholder="DISTRIBUTOR" />
            </Field>
            <p className="text-[12px] text-steel">Price lists cannot be deactivated in the current schema. Default is a label only — companies do not inherit it automatically.</p>
            <button type="submit" className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground">
              Create
            </button>
          </form>
        </Drawer>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">{label}</div>
      <div className="num mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function PromotionsPanel() {
  const session = useSession();
  const canEdit = session.signedIn && session.user.navPermissions.includes("pricing.edit");
  const [rows, setRows] = useState<Array<{
    id: string;
    code: string;
    name: string;
    type: string;
    typeLabel: string;
    value: number | null;
    isActive: boolean;
    status: string;
    engineApplies: boolean;
    engineNote: string | null;
    startsAt: string | null;
    endsAt: string | null;
    catalogueWide: boolean;
    skus: string[];
  }>>([]);
  const [editor, setEditor] = useState<null | { id?: string }>(null);

  async function reload() {
    const result = await listPromotionsFn();
    if (result.ok) setRows(result.data);
  }
  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13px] text-steel">
          At most one promotion applies. Percent is percentage off the commercial unit price. Fixed is amount-off per unit.
          Quantity deals already stored remain visible but are not applied.
        </p>
        {canEdit ? (
          <button
            type="button"
            className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
            onClick={() => setEditor({})}
          >
            New promotion
          </button>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-[13px] text-steel">
          No promotions yet.
          {canEdit ? (
            <div>
              <button type="button" className="mt-3 font-semibold text-primary" onClick={() => setEditor({})}>
                Create a percent or fixed promotion
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <li key={p.id} className="rounded-lg border border-border bg-surface/40 p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <span className="num min-w-0 truncate font-semibold text-primary">{p.code}</span>
                <ValidityBadge status={p.status} />
              </div>
              <p className="mt-1 text-[13px] font-semibold">{p.name}</p>
              <p className="mt-2 text-[12px] text-steel">{p.typeLabel}{p.value != null ? ` · ${p.value}` : ""}</p>
              <p className="mt-1 text-[12px] text-steel">{p.catalogueWide ? "Entire catalogue" : `Selected products (${p.skus.length || "variant ids"})`}</p>
              {!p.engineApplies ? <p className="mt-2 text-[12px] text-warn">{p.engineNote}</p> : null}
              {canEdit ? (
                <button type="button" className="mt-3 text-[12px] font-semibold text-primary" onClick={() => setEditor({ id: p.id })}>
                  Edit
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editor ? (
        <PromotionEditor
          existing={rows.find((row) => row.id === editor.id) ?? null}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

function PromotionEditor({
  existing,
  onClose,
  onSaved,
}: {
  existing: {
    id: string;
    code: string;
    name: string;
    type: string;
    value: number | null;
    isActive: boolean;
    startsAt: string | null;
    endsAt: string | null;
    catalogueWide: boolean;
    skus: string[];
    engineApplies: boolean;
  } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const lockedDeal = existing?.type === "QUANTITY_DEAL";
  const [code, setCode] = useState(existing?.code ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState<"PERCENT" | "FIXED" | "QUANTITY_DEAL">(
    existing?.type === "FIXED" || existing?.type === "QUANTITY_DEAL" ? existing.type : "PERCENT",
  );
  const [value, setValue] = useState(existing?.value != null ? String(existing.value) : "");
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [startsAt, setStartsAt] = useState(existing?.startsAt ? existing.startsAt.slice(0, 16) : "");
  const [endsAt, setEndsAt] = useState(existing?.endsAt ? existing.endsAt.slice(0, 16) : "");
  const [catalogueWide, setCatalogueWide] = useState(existing?.catalogueWide ?? true);
  const [skuQ, setSkuQ] = useState("");
  const [hits, setHits] = useState<Array<{ sku: string; name: string; brand: string }>>([]);
  const [skus, setSkus] = useState<string[]>(existing?.skus ?? []);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!value || type === "QUANTITY_DEAL") {
      setPreview(null);
      return;
    }
    void previewPromotionFn({ data: { unitPrice: 8.7, type, value: Number(value) } }).then((r) => {
      if (r.ok && r.data.resultDisplay) {
        setPreview(`Current resolved price £8.70 → ${type === "PERCENT" ? `${value}%` : `£${value} off`} £${r.data.resultDisplay}`);
      } else if (r.ok) setPreview(r.data.note);
    });
  }, [type, value]);

  return (
    <Drawer open title={existing ? "Edit promotion" : "New promotion"} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (type === "QUANTITY_DEAL" && !existing) return;
          void upsertPromotionFn({
            data: {
              id: existing?.id,
              code,
              name,
              type,
              value: Number(value),
              isActive,
              startsAt: startsAt ? new Date(startsAt).toISOString() : null,
              endsAt: endsAt ? new Date(endsAt).toISOString() : null,
              catalogueWide,
              skus: catalogueWide ? [] : skus,
            },
          }).then((r) => {
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Promotion saved");
              onSaved();
            }
          });
        }}
      >
        {lockedDeal ? (
          <p className="rounded-md border border-border bg-surface px-3 py-2 text-[12px] text-steel">
            This quantity deal is stored but is not applied by the pricing engine. It cannot be created as a new promotion.
          </p>
        ) : null}
        <Field label="Code"><input required value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} disabled={Boolean(existing)} /></Field>
        <Field label="Name"><input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></Field>
        <Field label="Type">
          <select
            value={type}
            disabled={lockedDeal}
            onChange={(e) => setType(e.target.value as "PERCENT" | "FIXED")}
            className={inputClass}
          >
            <option value="PERCENT">Percent off</option>
            <option value="FIXED">Fixed amount off per unit</option>
            {lockedDeal ? <option value="QUANTITY_DEAL">Quantity deal (not applied)</option> : null}
          </select>
        </Field>
        <Field label={type === "PERCENT" ? "Percent" : "Amount off"}>
          <input value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
        <Field label="Starts"><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputClass} /></Field>
        <Field label="Ends"><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inputClass} /></Field>
        <fieldset className="grid gap-2">
          <legend className="text-[12px] font-semibold uppercase tracking-[0.12em] text-steel">Scope</legend>
          <label className="text-[13px]"><input type="radio" checked={catalogueWide} onChange={() => setCatalogueWide(true)} /> Entire catalogue</label>
          <label className="text-[13px]"><input type="radio" checked={!catalogueWide} onChange={() => setCatalogueWide(false)} /> Selected products</label>
        </fieldset>
        {!catalogueWide ? (
          <div>
            <Field label="Search SKU / name / brand">
              <input
                value={skuQ}
                onChange={(e) => {
                  setSkuQ(e.target.value);
                  void searchPricingVariantsFn({ data: { q: e.target.value } }).then((r) => r.ok && setHits(r.data));
                }}
                className={inputClass}
              />
            </Field>
            <ul className="mt-2 max-h-40 overflow-auto text-[13px]">
              {hits.map((hit) => (
                <li key={hit.sku}>
                  <button
                    type="button"
                    className="text-primary"
                    onClick={() => setSkus((prev) => (prev.includes(hit.sku) ? prev : [...prev, hit.sku]))}
                  >
                    {hit.sku} — {hit.name} ({hit.brand})
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-steel">{skus.length ? skus.join(", ") : "No products selected."}</p>
          </div>
        ) : null}
        {preview ? <p className="text-[12px] text-steel">{preview}</p> : null}
        <button
          type="submit"
          disabled={type === "QUANTITY_DEAL" && !existing}
          className="h-11 rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
        >
          Save
        </button>
      </form>
    </Drawer>
  );
}
