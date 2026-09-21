import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { gbp } from "@/lib/data";
import { cn } from "@/lib/utils";
import {
  deletePriceListItemFn,
  listAdminPriceListsFn,
  listPriceListItemsFn,
  listPromotionsFn,
  searchPricingVariantsFn,
  upsertPriceListFn,
  upsertPriceListItemFn,
  upsertPromotionFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/pricing")({
  head: () => ({
    meta: [
      { title: "Price Lists & Promotions — Automotive Brands Admin" },
      {
        name: "description",
        content: "Maintain trade price lists, list items and promotions. Customer-specific prices live on the customer Commercial tab.",
      },
    ],
  }),
  component: AdminPricing,
});

function AdminPricing() {
  const [tab, setTab] = useState<"Price lists" | "Promotions">("Price lists");

  return (
    <div>
      <PanelHeader title="Pricing" sub="Price lists and promotions. Customer overrides are on each customer record." />
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
  const [lists, setLists] = useState<Array<{
    id: string;
    code: string;
    name: string;
    isDefault: boolean;
    itemCount: number;
    companyCount: number;
  }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [items, setItems] = useState<Array<{ id: string; variantId: string; sku: string; productName: string; unitPrice: number | null }>>([]);
  const [name, setName] = useState("");
  const [skuQ, setSkuQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; sku: string; name: string }>>([]);
  const [itemPrice, setItemPrice] = useState("");

  async function reload() {
    const result = await listAdminPriceListsFn();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setLists(result.data);
    if (selected) {
      const itemsRes = await listPriceListItemsFn({ data: { priceListId: selected } });
      if (itemsRes.ok) setItems(itemsRes.data);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    void listPriceListItemsFn({ data: { priceListId: selected } }).then((r) => r.ok && setItems(r.data));
  }, [selected]);

  return (
    <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:p-6">
      <div>
        <p className="mb-3 text-[13px] text-steel">Trade customers never see price-list names — they see their resolved unit price only.</p>
        <form
          className="mb-4 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void upsertPriceListFn({ data: { name } }).then((r) => {
              if (!r.ok) toast.error(r.error);
              else {
                toast.success("Price list saved");
                setName("");
                void reload();
              }
            });
          }}
        >
          <Field label="New list">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Distributor" />
          </Field>
          <button type="submit" className="h-10 rounded-md bg-primary text-[12px] font-bold uppercase text-primary-foreground">
            Save list
          </button>
        </form>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {lists.map((list) => (
            <li key={list.id}>
              <button
                type="button"
                onClick={() => setSelected(list.id)}
                className={cn("flex w-full items-center justify-between px-3 py-2 text-left text-[13px]", selected === list.id && "bg-surface")}
              >
                <span>
                  <span className="font-semibold">{list.name}</span>
                  <span className="ml-2 num text-[11px] text-steel">{list.code}</span>
                </span>
                {list.isDefault ? <StatusBadge tone="good">Default</StatusBadge> : <span className="num text-[11px] text-steel">{list.itemCount}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        {!selected ? (
          <p className="text-[13px] text-steel">Select a price list to maintain variant prices.</p>
        ) : (
          <>
            <form
              className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                const hit = hits[0];
                if (!hit || !itemPrice) return;
                void upsertPriceListItemFn({
                  data: { priceListId: selected, variantId: hit.id, unitPrice: Number(itemPrice) },
                }).then((r) => {
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success("Item saved");
                    setSkuQ("");
                    setHits([]);
                    setItemPrice("");
                    void listPriceListItemsFn({ data: { priceListId: selected } }).then((x) => x.ok && setItems(x.data));
                  }
                });
              }}
            >
              <Field label="SKU / product">
                <input
                  value={skuQ}
                  onChange={(e) => {
                    setSkuQ(e.target.value);
                    void searchPricingVariantsFn({ data: { q: e.target.value } }).then((r) => r.ok && setHits(r.data));
                  }}
                  className={inputClass}
                  placeholder="GC5000"
                />
              </Field>
              <Field label="Unit price ex VAT">
                <input value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} className={inputClass} />
              </Field>
              <button type="submit" className="mt-6 h-10 rounded-md border border-border px-3 text-[12px] font-semibold">
                Add / update
              </button>
            </form>
            {hits.length ? (
              <p className="mb-2 text-[12px] text-steel">
                First match: {hits[0]?.sku} — {hits[0]?.name}
              </p>
            ) : null}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase tracking-[0.12em] text-steel">
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Unit price</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={item.id} className={cn("border-b border-border/60 last:border-0", i % 2 && "bg-surface/30")}>
                      <td className="num px-3 py-2 text-primary">{item.sku}</td>
                      <td className="px-3 py-2">{item.productName}</td>
                      <td className="num px-3 py-2 text-right">{item.unitPrice != null ? gbp(item.unitPrice) : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="text-[12px] font-semibold text-primary"
                          onClick={() => {
                            void deletePriceListItemFn({ data: { id: item.id } }).then((r) => {
                              if (!r.ok) toast.error(r.error);
                              else setItems((prev) => prev.filter((row) => row.id !== item.id));
                            });
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PromotionsPanel() {
  const [rows, setRows] = useState<Array<{
    id: string;
    code: string;
    name: string;
    type: string;
    value: number | null;
    isActive: boolean;
    startsAt: string | null;
    endsAt: string | null;
  }>>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [type, setType] = useState<"PERCENT" | "FIXED">("PERCENT");

  async function reload() {
    const result = await listPromotionsFn();
    if (result.ok) setRows(result.data);
  }
  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="p-4 sm:p-6">
      <p className="mb-4 max-w-2xl text-[13px] text-steel">
        At most one promotion applies. PERCENT is percentage off the commercial unit price; FIXED is amount-off per unit.
        QUANTITY_DEAL is stored but not applied until Phase 6.
      </p>
      <form
        className="mb-6 grid max-w-3xl gap-2 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          void upsertPromotionFn({ data: { code, name, type, value: Number(value), isActive: true } }).then((r) => {
            if (!r.ok) toast.error(r.error);
            else {
              toast.success("Promotion saved");
              setCode("");
              setName("");
              setValue("");
              void reload();
            }
          });
        }}
      >
        <Field label="Code"><input value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} /></Field>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></Field>
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as "PERCENT" | "FIXED")} className={inputClass}>
            <option value="PERCENT">Percent</option>
            <option value="FIXED">Fixed</option>
          </select>
        </Field>
        <Field label="Value"><input value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} /></Field>
        <button type="submit" className="sm:col-span-4 h-10 rounded-md bg-primary text-[12px] font-bold uppercase text-primary-foreground">
          Save promotion
        </button>
      </form>
      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((p) => (
          <li key={p.id} className="rounded-lg border border-border bg-surface/40 p-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <span className="num min-w-0 truncate font-semibold text-primary">{p.code}</span>
              <StatusBadge tone={p.isActive ? "good" : "neutral"}>{p.isActive ? "Live" : "Off"}</StatusBadge>
            </div>
            <p className="mt-1 text-[13px] font-semibold">{p.name}</p>
            <p className="num mt-2 text-[11px] text-steel">
              {p.type} {p.value} {p.endsAt ? `· ends ${p.endsAt.slice(0, 10)}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
