import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  SiCreateFollowUpButton,
  type FollowUpRequest,
} from "@/components/sales-intelligence/create-followup-drawer";
import {
  SiEntityContext,
  SiField,
  SiMetricCard,
  SiModeSwitch,
  SiPager,
  siControlClassName,
} from "@/components/sales-intelligence/workspace";
import { formatGbp, type SalesEnquiryUrlSearch } from "@/domain/sales-intelligence";
import {
  createCrmOpportunityFn,
  exportGlobalAutopartSalesCsvFn,
  getGlobalAutopartSalesDashboardFn,
  getGlobalCustomerSalesEnquiryFn,
  getGlobalProductSalesEnquiryFn,
  listCustomerGroupsFn,
  listSalesRepsFn,
  searchGlobalAutopartSalesFn,
} from "@/server/phase2/fns";

type Dashboard = Extract<Awaited<ReturnType<typeof getGlobalAutopartSalesDashboardFn>>, { ok: true }>["data"];
type CustomerEnquiry = Extract<Awaited<ReturnType<typeof getGlobalCustomerSalesEnquiryFn>>, { ok: true }>["data"];
type ProductEnquiry = Extract<Awaited<ReturnType<typeof getGlobalProductSalesEnquiryFn>>, { ok: true }>["data"];
type SearchResult = Extract<Awaited<ReturnType<typeof searchGlobalAutopartSalesFn>>, { ok: true }>["data"];

function filtersFromSearch(search: SalesEnquiryUrlSearch) {
  return {
    companyId: search.companyId ?? null,
    customerGroupId: search.customerGroupId ?? null,
    salesRepId: search.salesRepId ?? null,
    accountCode: search.accountCode ?? null,
    q: search.q ?? null,
    sku: search.sku ?? null,
    brandId: search.brandId ?? null,
    page: search.page ?? 1,
    pageSize: 25,
    sort: search.sort ?? "NET_SALES",
  };
}

export function GlobalAutopartSalesPanel({
  search,
  onSearch,
  onFollowUp,
  onExport,
}: {
  search: SalesEnquiryUrlSearch;
  onSearch: (next: SalesEnquiryUrlSearch) => void;
  onFollowUp: (request: FollowUpRequest) => void;
  onExport: () => void;
}) {
  const mode = search.mode ?? "customers";
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [customer, setCustomer] = useState<CustomerEnquiry | null>(null);
  const [product, setProduct] = useState<ProductEnquiry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchResult | null>(null);
  const [reps, setReps] = useState<Array<{ id: string; code: string | null; label: string }>>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [opportunityNote, setOpportunityNote] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  function apply(patch: {
    mode?: "customers" | "products";
    companyId?: string | null;
    customerGroupId?: string | null;
    sku?: string | null;
    accountCode?: string | null;
    salesRepId?: string | null;
    brandId?: string | null;
    q?: string | null;
    sort?: string | null;
    page?: number;
  }) {
    const draft: SalesEnquiryUrlSearch = { source: "global" };
    const nextMode = patch.mode ?? mode;
    if (nextMode === "products") draft.mode = "products";
    const companyId = patch.companyId === null ? undefined : (patch.companyId ?? search.companyId);
    const groupId = patch.customerGroupId === null ? undefined : (patch.customerGroupId ?? search.customerGroupId);
    const sku = patch.sku === null ? undefined : (patch.sku ?? search.sku);
    const accountCode = patch.accountCode === null ? undefined : (patch.accountCode ?? search.accountCode);
    const salesRepId = patch.salesRepId === null ? undefined : (patch.salesRepId ?? search.salesRepId);
    const brandId = patch.brandId === null ? undefined : (patch.brandId ?? search.brandId);
    const q = patch.q === null ? undefined : (patch.q ?? search.q);
    const sort = patch.sort === null ? undefined : (patch.sort ?? search.sort);
    const page = patch.page ?? 1;
    if (companyId) draft.companyId = companyId;
    if (groupId) draft.customerGroupId = groupId;
    if (sku) draft.sku = sku;
    if (accountCode) draft.accountCode = accountCode;
    if (salesRepId) draft.salesRepId = salesRepId;
    if (brandId) draft.brandId = brandId;
    if (q) draft.q = q;
    if (sort && sort !== "NET_SALES") draft.sort = sort;
    if (page > 1) draft.page = page;
    onSearch(draft);
  }

  useEffect(() => {
    void listSalesRepsFn().then((result) => {
      if (result.ok) setReps(result.data);
    });
    void listCustomerGroupsFn({ data: { includeInactive: false } }).then((result) => {
      if (result.ok) setGroups(result.data.items.map((group) => ({ id: group.id, name: group.name })));
    });
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (query.trim().length < 1) {
        setHits(null);
        return;
      }
      void searchGlobalAutopartSalesFn({ data: { q: query.trim(), limit: 12 } }).then((result) => {
        if (result.ok) setHits(result.data);
      });
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getGlobalAutopartSalesDashboardFn({ data: filtersFromSearch(search) }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setDashboard(null);
      } else {
        setError(null);
        setDashboard(result.data);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [search]);

  useEffect(() => {
    if (mode !== "customers" || !search.companyId) {
      setCustomer(null);
      return;
    }
    let cancelled = false;
    void getGlobalCustomerSalesEnquiryFn({ data: filtersFromSearch(search) }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setCustomer(null);
      } else {
        setError(null);
        setCustomer(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mode, search]);

  useEffect(() => {
    if (mode !== "products" || !search.sku) {
      setProduct(null);
      return;
    }
    let cancelled = false;
    void getGlobalProductSalesEnquiryFn({ data: filtersFromSearch(search) }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setProduct(null);
      } else {
        setError(null);
        setProduct(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mode, search]);

  const summary = customer && mode === "customers" ? customer.summary : product && mode === "products" ? product.summary : dashboard?.summary;
  const period = dashboard?.period ?? customer?.period ?? product?.period;
  const customerPages = customer ? Math.max(1, Math.ceil(customer.products.total / customer.products.pageSize)) : 1;
  const productPages = product ? Math.max(1, Math.ceil(product.customers.total / product.customers.pageSize)) : 1;
  const account = hits?.account ?? dashboard?.account ?? null;

  async function createOpportunity(companyId: string, companyName: string, netSales: string) {
    setOpportunityNote(null);
    const result = await createCrmOpportunityFn({
      data: {
        companyId,
        title: `Historical Autopart sales — ${companyName}`,
        description: `${companyName} has undated Autopart invoice history of ${formatGbp(netSales)} net excluding VAT. Invoice dates are not available, so this is not a stopped-buying signal. No customer message was sent.`,
      },
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpportunityNote(`Opportunity created. No customer message was sent.`);
  }

  return (
    <div className="space-y-4">
      <SiModeSwitch
        mode={mode}
        onChange={(value) => {
          setChanging(false);
          apply({
            mode: value,
            companyId: value === "customers" ? (search.companyId ?? null) : null,
            sku: value === "products" ? (search.sku ?? null) : null,
            page: 1,
          });
        }}
      />
      <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-[12px] text-steel">
        <p className="font-bold uppercase tracking-wide text-foreground">{period?.label ?? "All Available History"}</p>
        <p className="mt-1">{period?.note}</p>
        <p className="mt-1">{dashboard?.overlapNote ?? customer?.overlapNote}</p>
      </div>

      {mode === "customers" && customer && !changing ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SiEntityContext
            eyebrow="Customer · undated Autopart history"
            title={customer.company.name}
            meta={[
              customer.company.status,
              customer.company.linkedAccountCodes.join(", ") || "No linked Autopart account",
              customer.company.salesperson?.name ?? "",
            ]}
            onChange={() => setChanging(true)}
            changeLabel="Change customer"
          />
          <div className="flex flex-wrap gap-2">
            <SiCreateFollowUpButton
              onClick={() =>
                onFollowUp({
                  sourceModule: "SALES_ENQUIRY",
                  sourceReason: "CUSTOMER",
                  companyId: customer.company.id,
                  historySource: "global",
                })
              }
            />
            <button
              type="button"
              className="h-8 rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide"
              onClick={() => void createOpportunity(customer.company.id, customer.company.name, customer.summary.netSales)}
            >
              Create opportunity
            </button>
            <Link
              to={customer.company.customer360Href.startsWith("/admin/") ? "/admin/customers/$id" : "/sales/customers/$id"}
              params={{ id: customer.company.id }}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[11px] font-bold uppercase tracking-wide"
            >
              Customer 360
            </Link>
          </div>
        </div>
      ) : mode === "products" && product && !changing ? (
        <SiEntityContext
          eyebrow="Product · undated Autopart history"
          title={product.product.name}
          meta={[product.product.sku, product.product.brandName ?? "", product.product.catalogueStatus]}
          onChange={() => setChanging(true)}
          changeLabel="Change product"
        />
      ) : (
        <SiField label={mode === "customers" ? "Customer, account code, or product" : "Product SKU or description"} className="max-w-xl">
          <input
            className={siControlClassName()}
            value={query}
            placeholder="Search a CRM name, exact Autopart code, SKU, or description"
            onChange={(event) => setQuery(event.target.value)}
          />
          {hits && (hits.companies.length > 0 || hits.products.length > 0) ? (
            <ul className="mt-1 max-h-56 overflow-auto rounded-md border border-border bg-card text-[13px]">
              {hits.companies.map((company) => (
                <li key={company.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col px-3 py-2 text-left hover:bg-secondary/60"
                    onClick={() => {
                      setQuery("");
                      setHits(null);
                      setChanging(false);
                      apply({ mode: "customers", companyId: company.id, sku: null, page: 1 });
                    }}
                  >
                    <span className="font-medium">{company.name}</span>
                    <span className="text-[11px] text-steel">
                      {company.status}
                      {company.accountCodes ? ` · ${company.accountCodes}` : ""}
                      {company.salespersonName ? ` · ${company.salespersonName}` : ""}
                    </span>
                  </button>
                </li>
              ))}
              {hits.products.map((item) => (
                <li key={item.sku}>
                  <button
                    type="button"
                    className="flex w-full flex-col px-3 py-2 text-left hover:bg-secondary/60"
                    onClick={() => {
                      setQuery("");
                      setHits(null);
                      setChanging(false);
                      apply({ mode: "products", sku: item.sku, companyId: null, page: 1 });
                    }}
                  >
                    <span className="font-medium">{item.name}</span>
                    <span className="font-mono text-[11px] text-steel">
                      {item.sku}
                      {item.brandName ? ` · ${item.brandName}` : item.inCatalogue ? "" : " · Historic only"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </SiField>
      )}

      {account && account.state === "unlinked" ? (
        <p className="text-[12px] text-steel">
          Autopart account {account.accountCode} is not linked to a CRM company. Private account details stay hidden.
        </p>
      ) : null}
      {account && account.state === "restricted" ? (
        <p className="text-[12px] text-steel">
          Autopart account {account.accountCode} is outside your customer scope.
        </p>
      ) : null}
      {opportunityNote ? <p className="text-[12px] text-steel">{opportunityNote}</p> : null}
      {error ? <p className="text-[12px] text-bad">{error}</p> : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SiField label="Exact Autopart account">
          <input
            className={siControlClassName(Boolean(search.accountCode))}
            defaultValue={search.accountCode ?? ""}
            key={search.accountCode ?? ""}
            placeholder="Exact code"
            onBlur={(event) => apply({ accountCode: event.target.value.trim() || null, page: 1 })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                apply({ accountCode: event.currentTarget.value.trim() || null, page: 1 });
              }
            }}
          />
        </SiField>
        <SiField label="Brand">
          <select
            className={siControlClassName(Boolean(search.brandId))}
            value={search.brandId ?? ""}
            onChange={(event) => apply({ brandId: event.target.value || null, page: 1 })}
          >
            <option value="">Any mapped brand</option>
            {(dashboard?.brands ?? []).map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </SiField>
        <SiField label="Sales representative">
          <select
            className={siControlClassName(Boolean(search.salesRepId))}
            value={search.salesRepId ?? ""}
            onChange={(event) => apply({ salesRepId: event.target.value || null, page: 1 })}
          >
            <option value="">Anyone in scope</option>
            {reps.map((rep) => (
              <option key={rep.id} value={rep.id}>
                {rep.code ? `${rep.code} · ${rep.label}` : rep.label}
              </option>
            ))}
          </select>
        </SiField>
        <SiField label="Customer group">
          <select
            className={siControlClassName(Boolean(search.customerGroupId))}
            value={search.customerGroupId ?? ""}
            onChange={(event) => apply({ customerGroupId: event.target.value || null, page: 1 })}
          >
            <option value="">Any group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </SiField>
      </div>

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SiMetricCard label="Net sales ex VAT" value={formatGbp(summary.netSales)} primary />
          <SiMetricCard label="Gross positive sales" value={formatGbp(summary.grossSales)} />
          <SiMetricCard label="Credits and negative sales" value={formatGbp(summary.credits)} />
          <SiMetricCard label="Product lines" value={String(summary.lineCount)} />
          <SiMetricCard label="Distinct invoices" value={String(summary.invoiceCount)} />
          <SiMetricCard label="Distinct products" value={String(summary.productCount)} />
          <SiMetricCard label="Signed units" value={summary.units} />
          <SiMetricCard label="Customers represented" value={String(summary.customersRepresented)} />
          <SiMetricCard label="Customers without linked history" value={String(summary.customersWithoutLinkedHistory)} />
        </div>
      ) : loading ? (
        <p className="text-[13px] text-steel">Loading historical sales…</p>
      ) : null}

      {mode === "customers" && customer ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-steel">Previously purchased products</h3>
            <button type="button" className="text-[11px] font-bold uppercase text-steel" onClick={onExport}>
              Export these rows
            </button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-steel">
                  <th className="py-2 pr-2">SKU</th>
                  <th className="py-2 pr-2">Description</th>
                  <th className="py-2 pr-2 text-right">Lines</th>
                  <th className="py-2 pr-2 text-right">Units</th>
                  <th className="py-2 pr-2 text-right">Sales</th>
                  <th className="py-2 pr-2 text-right">Credits</th>
                  <th className="py-2 pr-2 text-right">Net</th>
                  <th className="py-2 pr-2">Catalogue</th>
                  <th className="py-2 pr-2">Studley</th>
                  <th className="py-2 pr-2">Price</th>
                  <th className="py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {customer.products.items.map((item) => (
                  <tr key={item.sku} className="border-b border-border/50">
                    <td className="py-2 pr-2 font-mono text-[12px]">{item.sku}</td>
                    <td className="py-2 pr-2">{item.description}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{item.lines}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{item.units}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatGbp(item.grossSales)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatGbp(item.credits)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatGbp(item.netSales)}</td>
                    <td className="py-2 pr-2">
                      {item.productHref ? (
                        <a href={item.productHref} className="text-primary hover:underline">
                          {item.catalogueStatus}
                        </a>
                      ) : (
                        item.catalogueStatus
                      )}
                    </td>
                    <td className="py-2 pr-2 text-[12px] text-steel">
                      {customer.studleyStockPermitted
                        ? item.studleyAvailableQty == null
                          ? "No Studley figure"
                          : `${item.studleyAvailableQty} available`
                        : "Stock hidden"}
                    </td>
                    <td className="py-2 pr-2 text-[12px] tabular-nums">
                      {customer.pricingPermitted
                        ? item.customerPrice
                          ? formatGbp(item.customerPrice)
                          : item.tradePrice
                            ? formatGbp(item.tradePrice)
                            : "—"
                        : "Price hidden"}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-[11px] font-bold uppercase text-primary"
                        onClick={() =>
                          onFollowUp({
                            sourceModule: "SALES_ENQUIRY",
                            sourceReason: "PRODUCT",
                            companyId: customer.company.id,
                            sku: item.sku,
                            historySource: "global",
                          })
                        }
                      >
                        Task
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SiPager
            page={customer.products.page}
            totalPages={customerPages}
            total={customer.products.total}
            onPage={(page) => apply({ page })}
          />
          <div>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-steel">
              Catalogue cross-sell
            </h3>
            <p className="mb-2 text-[12px] text-steel">{customer.crossSell.note}</p>
            {customer.crossSell.items.length === 0 ? (
              <p className="text-[12px] text-steel">No other current catalogue product shares a purchased brand and category.</p>
            ) : (
              <ul className="space-y-2 text-[13px]">
                {customer.crossSell.items.map((item) => (
                  <li key={item.sku} className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-[12px]">{item.sku}</span>
                    <span>{item.name}</span>
                    <span className="text-steel">{item.brandName}</span>
                    {item.productHref ? (
                      <a href={item.productHref} className="text-primary hover:underline">
                        Product workspace
                      </a>
                    ) : null}
                    <button
                      type="button"
                      className="text-[11px] font-bold uppercase text-primary"
                      onClick={() =>
                        onFollowUp({
                          sourceModule: "SALES_ENQUIRY",
                          sourceReason: "CROSS_SELL",
                          companyId: customer.company.id,
                          sku: item.sku,
                          historySource: "global",
                        })
                      }
                    >
                      Create task
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {mode === "products" && product ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            {product.product.productHref ? (
              <a href={product.product.productHref} className="text-primary hover:underline">
                Open product workspace
              </a>
            ) : (
              <span className="text-steel">{product.product.catalogueStatus}</span>
            )}
            <span className="text-steel">{product.scopeNote}</span>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-steel">
                  <th className="py-2 pr-2">Customer</th>
                  <th className="py-2 pr-2">Salesperson</th>
                  <th className="py-2 pr-2 text-right">Lines</th>
                  <th className="py-2 pr-2 text-right">Units</th>
                  <th className="py-2 pr-2 text-right">Net</th>
                  <th className="py-2 pr-2 text-right">Credits</th>
                  <th className="py-2"> </th>
                </tr>
              </thead>
              <tbody>
                {product.customers.items.map((item) => (
                  <tr key={item.companyId} className="border-b border-border/50">
                    <td className="py-2 pr-2">
                      <button
                        type="button"
                        className="font-medium text-primary"
                        onClick={() => apply({ mode: "customers", companyId: item.companyId, page: 1 })}
                      >
                        {item.name}
                      </button>
                      <div className="text-[11px] text-steel">{item.status}</div>
                    </td>
                    <td className="py-2 pr-2">{item.salespersonName ?? "—"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{item.lines}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{item.units}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatGbp(item.netSales)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{formatGbp(item.credits)}</td>
                    <td className="py-2">
                      <Link to={item.customer360Href.startsWith("/admin/") ? "/admin/customers/$id" : "/sales/customers/$id"} params={{ id: item.companyId }} className="text-[11px] font-bold uppercase text-primary">
                        Customer 360
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SiPager
            page={product.customers.page}
            totalPages={productPages}
            total={product.customers.total}
            onPage={(page) => apply({ page })}
          />
        </div>
      ) : null}
    </div>
  );
}

export async function downloadGlobalHistoryCsv(search: SalesEnquiryUrlSearch) {
  const mode = search.mode ?? "customers";
  const kind = mode === "customers" && search.companyId ? "customer" : mode === "products" && search.sku ? "product" : "summary";
  const result = await exportGlobalAutopartSalesCsvFn({ data: { kind, ...filtersFromSearch(search) } });
  if (!result.ok) return result.error;
  const blob = new Blob([result.data.csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.data.filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return null;
}
