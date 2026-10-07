import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PlannerRecommendationBadge, gbp, qty } from "@/components/purchasing/workspace";
import { ROUTES } from "@/lib/app-nav";
import { getProductPurchasingPanelFn } from "@/server/phase2/fns";

type Panel = Extract<Awaited<ReturnType<typeof getProductPurchasingPanelFn>>, { ok: true }>["data"];

/**
 * Internal purchasing summary for one SKU. Hidden when the viewer lacks purchasing.view.
 * Does not replace the exact Autopart stock figures shown elsewhere on the page.
 */
export function ProductPurchasingPanel({ sku }: { sku: string }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPanel(null);
    setHidden(false);
    void getProductPurchasingPanelFn({ data: { sku } }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setHidden(result.code === "PURCHASING_FORBIDDEN" || result.code === "FORBIDDEN");
        setPanel(null);
        return;
      }
      setPanel(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [sku]);

  if (hidden || !panel?.planner) return null;
  const plan = panel.planner;
  const preferred = panel.relations.find((r) => r.active && r.isPreferred && r.supplierActive);
  const only = panel.relations.filter((r) => r.active && r.supplierActive);
  const supplier = preferred ?? (only.length === 1 ? only[0] : null);

  return (
    <section className="max-w-3xl rounded-lg border border-border p-4" data-purchasing-panel={sku}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-steel">Purchasing</p>
        <PlannerRecommendationBadge recommendation={plan.recommendation} reason={plan.recommendationReason} />
      </div>
      <p className="mt-2 text-[12px] text-steel">{plan.recommendationReason}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
        <Item label="SKU" value={sku} mono />
        <Item label="Preferred supplier" value={supplier?.supplierName ?? (panel.planningState === "NONE" ? "NO SUPPLIER" : panel.planningState === "AMBIGUOUS" ? "Several suppliers" : "—")} />
        <Item label="Supplier SKU" value={supplier?.supplierSku ?? "—"} />
        <Item label="Lead time" value={plan.leadTimeDays == null ? "—" : `${plan.leadTimeDays} days`} />
        <Item label="MOQ" value={plan.minimumOrderQty == null ? "—" : qty(plan.minimumOrderQty)} />
        <Item label="Order multiple" value={plan.orderMultiple == null ? "—" : qty(plan.orderMultiple)} />
        <Item label="Purchasing cost" value={plan.purchasingCost ? `${gbp(plan.purchasingCost)} · ${plan.costSourceLabel}` : "— · Cost missing"} />
        <Item label="Warehouse" value={qty(plan.availableQty)} />
        <Item label="Amazon FBA" value={qty(plan.fbaQty)} />
        <Item label="Total" value={qty(plan.totalStock)} />
        <Item label="Incoming" value={qty(plan.incomingQty)} />
        <Item label="Customer backorders" value={qty(plan.backorderUnits)} />
        <Item label="Uncovered backorders" value={qty(plan.backorderShortfall)} />
        <Item label="Suggested qty" value={qty(plan.suggestedQty)} />
      </dl>
      <p className="mt-3 text-[12px] text-steel">
        FBA stock updated: {plan.fbaUpdated}
        {plan.fbaStale ? " · Stale" : ""}. Total is company-owned stock. B2B sellable stock remains Warehouse.{" "}
        Internal only. Purchase orders are created in Autopart.{" "}
        <Link to={ROUTES.purchasingPlanner} search={{ q: sku }} className="text-primary hover:underline">
          Open in Purchase Planner
        </Link>
      </p>
    </section>
  );
}

function Item({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase text-steel">{label}</dt>
      <dd className={mono ? "font-mono" : undefined}>{value}</dd>
    </div>
  );
}
