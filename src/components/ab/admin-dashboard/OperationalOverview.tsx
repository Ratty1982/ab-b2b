import { useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatGbpIncVat } from "@/domain/admin-dashboard";
import { FRESHNESS_STATUS_LABEL, OPERATIONAL_LINKS } from "@/domain/operational-dashboard";
import type { FreshnessStatus } from "@/domain/operational-dashboard";
import { cn } from "@/lib/utils";
import type { AdminDashboardData } from "./types";
import { DashboardKpiCard } from "./DashboardKpiCard";

type Data = AdminDashboardData;
type Overview = Data["operational"];

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg bg-surface px-4 py-3.5 ring-1 ring-inset ring-border/50", className)}>
      <h2 className="font-display text-sm font-semibold uppercase tracking-wide">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function MetricLink({
  href,
  label,
  value,
  hint,
}: {
  href?: string;
  label: string;
  value: string;
  hint?: string | undefined;
}) {
  const body = (
    <>
      <div className="text-[11px] uppercase tracking-[0.12em] text-steel">{label}</div>
      <div className="num mt-1 text-lg font-semibold">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-steel">{hint}</div> : null}
    </>
  );
  if (!href) return <div className="min-w-0">{body}</div>;
  return (
    <a href={href} className="min-w-0 rounded-md hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      {body}
    </a>
  );
}

function qty(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

export function OperationalKpis({ data }: { data: Data }) {
  const ops = data.operational;
  const cards: Array<{ key: string; node: ReactNode }> = [];
  if (ops.sales?.today) {
    cards.push({
      key: "sales",
      node: (
        <DashboardKpiCard
          label="Sales today"
          value={ops.sales.today.valueLabel}
          hint={ops.sales.today.versusYesterday ?? "Order value including VAT"}
          href={OPERATIONAL_LINKS.orders}
          accent="brand"
        />
      ),
    });
    cards.push({
      key: "orders",
      node: (
        <DashboardKpiCard
          label="Orders today"
          value={ops.sales.today.orders === 0 ? "None" : String(ops.sales.today.orders)}
          hint={ops.sales.today.orders === 0 ? "No orders placed today" : "Placed today, excluding drafts and cancellations"}
          href={OPERATIONAL_LINKS.orders}
        />
      ),
    });
  }
  if (ops.backorders?.summary) {
    const summary = ops.backorders.summary;
    cards.push({
      key: "backorders",
      node: (
        <DashboardKpiCard
          label="Outstanding backorders"
          value={summary.outstandingOrders === 0 ? "None" : String(summary.outstandingOrders)}
          hint={
            summary.outstandingOrders === 0
              ? "No customer backorders"
              : `${qty(summary.outstandingUnits)} units · ${formatGbpIncVat(summary.outstandingValue)}`
          }
          href={OPERATIONAL_LINKS.backorders}
          accent={summary.outstandingOrders > 0 ? "warn" : "none"}
        />
      ),
    });
  } else if (ops.sales && !ops.backorders) {
    const customer = data.ordersAttention.backorderedOrders;
    cards.push({
        key: "customer-backorders",
        node: (
          <DashboardKpiCard
            label="Customer backorders"
            value={customer.count === 0 ? "None" : String(customer.count)}
            hint={customer.count === 0 ? "No open orders waiting on stock" : `${qty(customer.units)} units still to despatch`}
            href={customer.href}
            accent={customer.count > 0 ? "warn" : "none"}
          />
        ),
      });
  }
  if (ops.purchasing?.summary) {
    const attention = ops.purchasing.summary.orderNow + ops.purchasing.summary.backordersAtRisk;
    const supplierGaps = ops.purchasing.summary.missingSupplier;
    const costGaps = ops.purchasing.summary.missingCost;
    cards.push({
      key: "purchasing",
      node: (
        <DashboardKpiCard
          label="Purchasing attention"
          value={attention === 0 ? "None" : String(attention)}
          hint={
            attention === 0 && supplierGaps + costGaps === 0
              ? "Nothing currently requires immediate purchasing attention"
              : attention === 0
                ? `${supplierGaps} missing a supplier · ${costGaps} missing cost`
                : `${ops.purchasing.summary.orderNow} order now · ${ops.purchasing.summary.backordersAtRisk} backorder risk`
          }
          href={OPERATIONAL_LINKS.plannerOrderNow}
          accent={attention > 0 ? "warn" : "good"}
        />
      ),
    });
  }
  if (ops.crm?.openOpportunities != null) {
    cards.push({
      key: "opportunities",
      node: (
        <DashboardKpiCard
          label="Open opportunities"
          value={ops.crm.openOpportunities === 0 ? "None" : String(ops.crm.openOpportunities)}
          hint={ops.crm.openOpportunities === 0 ? "No open CRM opportunities" : "Not won or lost"}
          href={OPERATIONAL_LINKS.crmOpportunities}
        />
      ),
    });
  }
  if (ops.crm?.tradeApplications != null) {
    const count = ops.crm.tradeApplications;
    cards.push({
      key: "apps",
      node: (
        <DashboardKpiCard
          label="Trade applications"
          value={count === 0 ? "None" : String(count)}
          hint={count === 0 ? "None awaiting review" : "Awaiting review"}
          href={OPERATIONAL_LINKS.tradeApplications}
          accent={count > 0 ? "warn" : "none"}
        />
      ),
    });
  }
  const shown = cards.slice(0, 6);
  if (shown.length === 0) return null;
  return (
    <div
      className={cn(
        "grid gap-2 px-4 py-4 sm:grid-cols-2 sm:px-6",
        shown.length >= 5 ? "xl:grid-cols-6 lg:grid-cols-3" : shown.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3",
      )}
    >
      {shown.map((card) => (
        <div key={card.key}>{card.node}</div>
      ))}
    </div>
  );
}

export function SalesTrendPanel({ sales }: { sales: NonNullable<Overview["sales"]> }) {
  const [range, setRange] = useState<30 | 90>(30);
  const points = useMemo(() => (sales.trend ?? []).slice(range === 30 ? -30 : -90), [sales.trend, range]);
  return (
    <Panel title="Sales trend">
      {sales.error ? <p className="text-[13px] text-destructive">{sales.error}</p> : null}
      {sales.trend ? (
        <>
          <div className="mb-3 flex gap-2">
            {([30, 90] as const).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setRange(days)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12px] font-semibold",
                  range === days ? "bg-primary text-primary-foreground" : "bg-surface-2 text-steel",
                )}
              >
                {days} days
              </button>
            ))}
          </div>
          <div className="h-44 w-full text-primary">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.15} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 10 }} width={48} />
                <Tooltip
                  formatter={(value) => [formatGbpIncVat(String(value ?? "0")), "Sales"]}
                  labelFormatter={(label) => String(label)}
                />
                <Line type="monotone" dataKey="value" stroke="currentColor" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] text-steel">Daily order value including VAT. Drafts and cancellations are excluded.</p>
        </>
      ) : sales.error ? null : (
        <p className="text-[13px] text-steel">No orders in this period.</p>
      )}
    </Panel>
  );
}

function freshnessTone(status: FreshnessStatus): string {
  if (status === "current") return "text-good";
  if (status === "due_soon" || status === "partial") return "text-warn";
  if (status === "late" || status === "failed") return "text-primary";
  return "text-steel";
}

export function OperationalSections({ data }: { data: Data }) {
  const ops = data.operational;
  const purchasing = ops.purchasing?.summary ?? null;
  const backorders = ops.backorders?.summary ?? null;
  return (
    <div className="grid gap-4 px-4 sm:px-6 lg:grid-cols-2">
      {ops.backorders ? (
        <Panel title="Backorders">
          {ops.backorders.error ? <p className="text-[13px] text-destructive">{ops.backorders.error}</p> : null}
          {backorders && backorders.outstandingOrders === 0 && !ops.backorders.error ? (
            <p className="text-[13px] text-steel">No customer backorders.</p>
          ) : null}
          {backorders && (backorders.outstandingOrders > 0 || ops.backorders.error) ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MetricLink href={OPERATIONAL_LINKS.backorders} label="Orders" value={String(backorders.outstandingOrders)} />
              <MetricLink href={OPERATIONAL_LINKS.backorders} label="Units" value={qty(backorders.outstandingUnits)} />
              <MetricLink href={OPERATIONAL_LINKS.backorders} label="Value" value={formatGbpIncVat(backorders.outstandingValue)} />
              <MetricLink href={OPERATIONAL_LINKS.backordersMovementNew} label="New" value={String(backorders.movement.new)} />
              <MetricLink href={OPERATIONAL_LINKS.backordersMovementIncreased} label="Increased" value={String(backorders.movement.increased)} />
              <MetricLink href={OPERATIONAL_LINKS.backordersMovementReduced} label="Reduced" value={String(backorders.movement.reduced)} />
              <MetricLink href={OPERATIONAL_LINKS.backordersMovementCleared} label="Cleared" value={String(backorders.movement.cleared)} />
            </div>
          ) : null}
        </Panel>
      ) : null}

      {ops.purchasing ? (
        <Panel title="Purchasing attention">
          {ops.purchasing.error ? <p className="mb-2 text-[13px] text-destructive">{ops.purchasing.error}</p> : null}
          {purchasing ? (
            purchasing.orderNow + purchasing.backordersAtRisk + purchasing.missingSupplier + purchasing.missingCost === 0 ? (
              <p className="text-[13px] text-steel">Nothing currently requires immediate purchasing attention.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <MetricLink href={OPERATIONAL_LINKS.plannerOrderNow} label="Order now" value={String(purchasing.orderNow)} />
                <MetricLink href={OPERATIONAL_LINKS.plannerBackordersAtRisk} label="Backorder risk" value={String(purchasing.backordersAtRisk)} />
                <MetricLink
                  href={OPERATIONAL_LINKS.plannerOrderNow}
                  label="Suggested purchase value"
                  value={purchasing.suggestedPurchaseValue ? formatGbpIncVat(purchasing.suggestedPurchaseValue) : "—"}
                  hint={
                    purchasing.suggestedValueMissingCost > 0
                      ? `${purchasing.suggestedValueMissingCost} lines excluded — cost is missing`
                      : undefined
                  }
                />
                <MetricLink href={OPERATIONAL_LINKS.plannerMissingSupplier} label="Missing supplier" value={String(purchasing.missingSupplier)} />
                <MetricLink href={OPERATIONAL_LINKS.plannerMissingCost} label="Missing cost" value={String(purchasing.missingCost)} />
              </div>
            )
          ) : null}
        </Panel>
      ) : null}

      {purchasing ? (
        <Panel title="Stock at risk">
          {purchasing.critical + purchasing.noWarehouseWithBackorders + purchasing.orderNow === 0 ? (
            <p className="text-[13px] text-steel">No products are currently flagged as stock at risk.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <MetricLink href={OPERATIONAL_LINKS.forecastCritical} label="Likely to run out" value={String(purchasing.critical)} hint="Critical cover" />
              <MetricLink href={OPERATIONAL_LINKS.plannerOrderNow} label="Order now" value={String(purchasing.orderNow)} />
              <MetricLink href={OPERATIONAL_LINKS.backorders} label="No warehouse + backorders" value={String(purchasing.noWarehouseWithBackorders)} />
              <MetricLink href={OPERATIONAL_LINKS.backordersNoStock} label="No warehouse + no incoming" value={String(purchasing.noWarehouseNoIncoming)} />
            </div>
          )}
        </Panel>
      ) : null}

      {purchasing ? (
        <Panel title="Incoming and owned stock">
          <div className="grid grid-cols-2 gap-3">
            <MetricLink href={OPERATIONAL_LINKS.forecast} label="SKUs with incoming" value={purchasing.incomingSkus === 0 ? "None" : String(purchasing.incomingSkus)} />
            <MetricLink href={OPERATIONAL_LINKS.forecast} label="Incoming units" value={qty(purchasing.incomingUnits)} />
            <MetricLink
              href={OPERATIONAL_LINKS.forecast}
              label="Incoming value"
              value={purchasing.incomingValue ? formatGbpIncVat(purchasing.incomingValue) : "—"}
              hint={purchasing.incomingValue ? "At latest cost" : "Omitted where any incoming SKU has no cost"}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border/40 pt-3">
            <MetricLink label="Warehouse" value={qty(purchasing.warehouseUnits)} />
            <MetricLink href={OPERATIONAL_LINKS.forecast} label="FBA" value={qty(purchasing.fbaUnits)} hint={purchasing.fbaStale ? "Stale" : purchasing.fbaUpdatedLabel} />
            <MetricLink label="Total owned" value={qty(purchasing.totalOwnedUnits)} hint="Not available to trade customers" />
          </div>
        </Panel>
      ) : null}

      {ops.conditions && (ops.conditions.error || ops.conditions.items.length > 0) ? (
        <Panel title="Product conditions on backorders">
          {ops.conditions.error ? <p className="mb-2 text-[13px] text-destructive">{ops.conditions.error}</p> : null}
          {ops.conditions.items.length === 0 ? (
            <p className="text-[13px] text-steel">No obsolete, delete, superseded or made-to-order backorders.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {ops.conditions.items.map((item) => (
                <MetricLink key={item.code} href={item.href} label={item.label} value={String(item.count)} />
              ))}
            </div>
          )}
        </Panel>
      ) : null}

      {ops.crm ? (
        <Panel title="CRM and sales workload">
          {ops.crm.error ? <p className="mb-2 text-[13px] text-destructive">{ops.crm.error}</p> : null}
          <div className="grid grid-cols-2 gap-3">
            {ops.crm.openLeads != null ? (
              <MetricLink href={OPERATIONAL_LINKS.crmLeads} label="Open leads" value={ops.crm.openLeads === 0 ? "None" : String(ops.crm.openLeads)} />
            ) : null}
            {ops.crm.openOpportunities != null ? (
              <MetricLink href={OPERATIONAL_LINKS.crmOpportunities} label="Open opportunities" value={ops.crm.openOpportunities === 0 ? "None" : String(ops.crm.openOpportunities)} />
            ) : null}
            {ops.crm.overdueTasks != null ? (
              <MetricLink
                href={OPERATIONAL_LINKS.crmTasks}
                label="Overdue tasks"
                value={ops.crm.overdueTasks === 0 ? "None" : String(ops.crm.overdueTasks)}
                hint={ops.crm.overdueTasks === 0 ? "No overdue CRM tasks" : undefined}
              />
            ) : null}
            {ops.crm.tasksDueToday != null ? (
              <MetricLink href={OPERATIONAL_LINKS.crmTasks} label="Tasks due today" value={ops.crm.tasksDueToday === 0 ? "None" : String(ops.crm.tasksDueToday)} />
            ) : null}
            {ops.crm.tradeApplications != null ? (
              <MetricLink href={OPERATIONAL_LINKS.tradeApplications} label="Trade applications" value={ops.crm.tradeApplications === 0 ? "None" : String(ops.crm.tradeApplications)} />
            ) : null}
          </div>
        </Panel>
      ) : null}

      <Panel title="Data freshness" className="lg:col-span-2">
        {ops.freshness.error ? <p className="mb-2 text-[13px] text-destructive">{ops.freshness.error}</p> : null}
        {ops.freshness.rows.length === 0 ? (
          <p className="text-[13px] text-steel">No import status is available for your access.</p>
        ) : (
          <ul className="divide-y divide-border/40">
            {ops.freshness.rows.map((row) => {
              const inner = (
                <span className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                  <span>
                    <span className="font-medium">{row.label}</span>
                    <span className="mt-0.5 block text-[12px] text-steel">
                      {row.kind === "manual" ? `Last updated ${row.detail}` : row.detail}
                      {row.scheduleLabel ? ` · ${row.scheduleLabel}` : ""}
                    </span>
                  </span>
                  <span className={cn("text-[12px] font-semibold", freshnessTone(row.status))}>
                    {row.kind === "manual" && row.status === "current"
                      ? "Manual"
                      : row.statusLabel || FRESHNESS_STATUS_LABEL[row.status]}
                  </span>
                </span>
              );
              return (
                <li key={row.id}>
                  {row.href ? (
                    <a href={row.href} className="block hover:bg-surface-2">
                      {inner}
                    </a>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
