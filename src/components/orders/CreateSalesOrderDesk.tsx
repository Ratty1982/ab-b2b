import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { customerSearchResponseIsCurrent, pageAfterQueryChange } from "@/components/orders/customer-search-session";
import { SalesOrderCustomerResults, salesOrderControlClass } from "@/components/orders/sales-order-mobile";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import { listSalesOrderDraftsFn, searchOrderEntryCustomersFn } from "@/server/phase2/fns";

type CustomerRow = {
  id: string;
  name: string;
  tradingName: string | null;
  accountNumber: string | null;
  phone: string | null;
  primaryEmail: string | null;
  autopartCustomerCode: string | null;
  town: string | null;
  postcode: string | null;
  contactName: string | null;
  assignedSalesRep: { name: string; code: string } | null;
};

type DraftRow = {
  id: string;
  companyId: string;
  companyName: string;
  poNumber: string | null;
  updatedAt: string;
  lines: Array<{ id: string }>;
};

type CustomerSearchPage = {
  items: CustomerRow[];
  total: number;
  page: number;
  pageSize: number;
};

const PAGE_SIZE = 20;

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function CreateSalesOrderDesk() {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSeq = useRef(0);
  const queryRef = useRef(query);
  const pageRef = useRef(page);
  queryRef.current = query;
  pageRef.current = page;

  useEffect(() => {
    let mounted = true;
    const request = { seq: ++requestSeq.current, query, page };
    setLoading(true);
    const handle = window.setTimeout(() => {
      void searchOrderEntryCustomersFn({
        data: { q: query.trim() || undefined, page, pageSize: PAGE_SIZE },
      })
        .then((result) => {
          if (
            !customerSearchResponseIsCurrent({
              mounted,
              responseSeq: request.seq,
              currentSeq: requestSeq.current,
              responseQuery: request.query,
              currentQuery: queryRef.current,
              responsePage: request.page,
              currentPage: pageRef.current,
            })
          ) {
            return;
          }
          setLoading(false);
          if (!result.ok) {
            setError(result.error);
            setCustomers([]);
            setTotal(0);
            return;
          }
          const data = result.data as CustomerSearchPage;
          setError(null);
          setCustomers(data.items);
          setTotal(data.total);
          setPageSize(data.pageSize);
        })
        .catch(() => {
          if (
            !customerSearchResponseIsCurrent({
              mounted,
              responseSeq: request.seq,
              currentSeq: requestSeq.current,
              responseQuery: request.query,
              currentQuery: queryRef.current,
              responsePage: request.page,
              currentPage: pageRef.current,
            })
          ) {
            return;
          }
          setLoading(false);
          setError("Customer search failed. Try again.");
          setCustomers([]);
          setTotal(0);
        });
    }, 200);
    return () => {
      mounted = false;
      window.clearTimeout(handle);
    };
  }, [query, page]);

  useEffect(() => {
    let mounted = true;
    void listSalesOrderDraftsFn().then((result) => {
      if (mounted && result.ok) setDrafts(result.data as DraftRow[]);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const matchLabel = query.trim() ? (total === 1 ? "matches" : "match") : total === 1 ? "is open for ordering" : "are open for ordering";

  return (
    <div>
      <PanelHeader
        title="Create Sales Order"
        sub="Search any active trade account. The assigned representative stays on the order, and you are recorded as the person who took it."
        actions={
          <Link to={ROUTES.salesOrders} className="text-[13px] font-semibold text-primary">
            Open drafts
          </Link>
        }
      />
      <div className="grid min-w-0 gap-6 p-4 max-lg:overflow-x-hidden sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          <label className="grid gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-steel">
            Find a customer
            <input
              className={cn(salesOrderControlClass, "h-12")}
              value={query}
              autoFocus
              placeholder="Company, trading name, account, contact, phone, or email"
              onChange={(event) => {
                const next = event.target.value;
                setPage((current) => pageAfterQueryChange(query, next, current));
                setQuery(next);
              }}
            />
          </label>
          <p className="mt-2 text-[12px] text-steel" data-testid="customer-match-count">
            {loading
              ? "Searching active accounts…"
              : total === 0
                ? query.trim()
                  ? "No active accounts match"
                  : "No active accounts"
                : `${total} active account${total === 1 ? "" : "s"} ${matchLabel}. Showing ${start}–${end}.`}
          </p>
          {error ? <p className="mt-3 text-[14px] text-bad">{error}</p> : null}
          <SalesOrderCustomerResults customers={customers} showEmpty={!loading && customers.length === 0} />
          {total > pageSize ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] text-steel">
                Page {page} of {Math.ceil(total / pageSize)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-[13px] font-semibold disabled:opacity-40"
                  disabled={loading || page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous page
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-[13px] font-semibold disabled:opacity-40"
                  disabled={loading || page * pageSize >= total}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next page
                </button>
              </div>
            </div>
          ) : null}
        </section>
        <aside className="h-fit rounded-lg border border-border p-4">
          <h2 className="font-display text-base uppercase">Your open drafts</h2>
          <p className="mt-1 text-[12px] text-steel">Only drafts you started. Another salesperson’s draft stays theirs.</p>
          {drafts.length === 0 ? (
            <p className="mt-4 text-[13px] text-steel">No unfinished orders.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {drafts.map((draft) => (
                <li key={draft.id} className="py-3">
                  <p className="font-semibold">{draft.companyName}</p>
                  <p className="text-[12px] text-steel">
                    {draft.lines.length} line{draft.lines.length === 1 ? "" : "s"}
                    {draft.poNumber ? ` · PO ${draft.poNumber}` : ""}
                    {" · "}
                    {formatWhen(draft.updatedAt)}
                  </p>
                  <Link
                    to="/sales/orders/new"
                    search={{ draftId: draft.id }}
                    className="mt-2 inline-flex min-h-11 items-center text-[13px] font-semibold text-primary"
                  >
                    Continue
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
