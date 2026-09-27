import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import { formatDate } from "@/lib/datetime";
import { formatQuoteDateOnlyUk } from "@/domain/quote";
import {
  acceptPortalQuoteFn,
  declinePortalQuoteFn,
  getPortalQuoteFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/portal/quotes/$quoteId")({
  head: () => ({
    meta: [{ title: "Quotation — Automotive Brands Trade Portal" }],
  }),
  component: PortalQuoteDetail,
});

type Quote = Extract<Awaited<ReturnType<typeof getPortalQuoteFn>>, { ok: true }>["data"];

function quoteTone(status: string) {
  if (status === "CONVERTED" || status === "ACCEPTED") return "good" as const;
  if (status === "DECLINED" || status === "REJECTED" || status === "EXPIRED") return "bad" as const;
  return "brand" as const;
}

function PortalQuoteDetail() {
  const { quoteId } = Route.useParams();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [acceptedOrder, setAcceptedOrder] = useState<{ id: string; number: string } | null>(null);

  const load = useCallback(async () => {
    const result = await getPortalQuoteFn({ data: { id: quoteId } });
    if (!result.ok) {
      setError(result.error);
      setQuote(null);
      return;
    }
    setError(null);
    setQuote(result.data);
    if (result.data.convertedOrderId && result.data.convertedOrderNumber) {
      setAcceptedOrder({
        id: result.data.convertedOrderId,
        number: result.data.convertedOrderNumber,
      });
    }
  }, [quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAccept() {
    if (!window.confirm("Accept this quotation and place the order?")) return;
    setBusy(true);
    const result = await acceptPortalQuoteFn({
      data: {
        id: quoteId,
        idempotencyKey: `portal-accept-${quoteId}-${crypto.randomUUID()}`,
      },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setAcceptedOrder({ id: result.data.orderId, number: result.data.orderNumber });
    toast.success(`Quote accepted — order ${result.data.orderNumber}`);
    await load();
  }

  async function onDecline() {
    setBusy(true);
    const result = await declinePortalQuoteFn({
      data: { id: quoteId, reason: declineReason.trim() || null },
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Quotation declined");
    await load();
  }

  if (error) {
    return (
      <div>
        <PanelHeader title="Quotation" sub="Trade portal" />
        <p className="p-6 text-sm text-bad">{error}</p>
        <Link to={ROUTES.portalQuotes} className="ml-6 text-[13px] font-semibold text-primary">
          Back to quotes
        </Link>
      </div>
    );
  }

  if (!quote) {
    return (
      <div>
        <PanelHeader title="Quotation" sub="Trade portal" />
        <p className="p-6 text-[13px] text-steel">Loading quotation…</p>
      </div>
    );
  }

  if (acceptedOrder || quote.status === "CONVERTED") {
    const orderNumber = acceptedOrder?.number ?? quote.convertedOrderNumber;
    const orderId = acceptedOrder?.id ?? quote.convertedOrderId;
    return (
      <div>
        <PanelHeader title="Quote accepted" sub={quote.quoteNumber} />
        <div className="mx-auto max-w-lg p-6 text-center">
          <p className="font-display text-2xl font-semibold uppercase">Quote accepted</p>
          <p className="mt-3 text-[14px] text-steel">
            Converted to order <strong className="text-foreground">{orderNumber}</strong>
          </p>
          {orderId ? (
            <Link
              to="/portal/orders/$orderId"
              params={{ orderId }}
              className="mt-6 inline-flex h-11 items-center rounded-md bg-primary px-6 text-[13px] font-bold uppercase text-primary-foreground"
            >
              View order
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PanelHeader
        title={quote.quoteNumber}
        sub="Automotive Brands quotation"
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge tone={quoteTone(quote.status)}>{quote.statusLabel}</StatusBadge>
            <button
              type="button"
              onClick={() => window.print()}
              className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold print:hidden"
            >
              Print
            </button>
          </div>
        }
      />

      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <header className="border-b border-border pb-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-steel">
            Automotive Brands
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold uppercase">Quotation</h1>
          <dl className="mt-4 grid gap-2 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-steel">Quote</dt>
              <dd className="font-semibold">{quote.quoteNumber}</dd>
            </div>
            <div>
              <dt className="text-steel">Prepared for</dt>
              <dd className="font-semibold">{quote.company?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-steel">Prepared by</dt>
              <dd>
                {quote.accountManager ? (
                  <>
                    <span className="font-semibold">{quote.accountManager.name}</span>
                    <span className="block text-[12px] text-steel">
                      {quote.accountManager.jobTitle}
                    </span>
                    {quote.accountManager.email ? (
                      <a
                        href={quote.accountManager.mailtoHref ?? undefined}
                        className="block text-[12px] text-primary hover:underline"
                      >
                        {quote.accountManager.email}
                      </a>
                    ) : null}
                    {quote.accountManager.phone ? (
                      <a
                        href={quote.accountManager.telHref ?? undefined}
                        className="block text-[12px] text-primary hover:underline"
                      >
                        {quote.accountManager.phone}
                      </a>
                    ) : null}
                    {quote.accountManager.mobile ? (
                      <a
                        href={quote.accountManager.mobileTelHref ?? undefined}
                        className="block text-[12px] text-primary hover:underline"
                      >
                        {quote.accountManager.mobile}
                      </a>
                    ) : null}
                  </>
                ) : (
                  quote.salesRepName || "Automotive Brands"
                )}
              </dd>
            </div>
            <div>
              <dt className="text-steel">Issued</dt>
              <dd>{formatDate(quote.sentAt ?? quote.createdAt) ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-steel">Valid until</dt>
              <dd className="text-lg font-semibold">{formatQuoteDateOnlyUk(quote.validUntil)}</dd>
            </div>
          </dl>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead>
              <tr className="border-b-2 border-foreground text-[11px] uppercase tracking-wide text-steel">
                <th className="py-2 pr-2">Product</th>
                <th className="py-2 pr-2">SKU</th>
                <th className="py-2 pr-2 text-right">Qty</th>
                <th className="py-2 pr-2 text-right">Unit price</th>
                <th className="py-2 text-right">Line total</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item) => (
                <tr key={String(item.id)} className="border-b border-border/60">
                  <td className="py-3 pr-2 font-medium">{item.name}</td>
                  <td className="py-3 pr-2 font-mono text-[12px] text-steel">{item.sku}</td>
                  <td className="py-3 pr-2 text-right">{item.qty as number}</td>
                  <td className="py-3 pr-2 text-right">£{item.customerUnitPrice}</td>
                  <td className="py-3 text-right font-medium">£{item.lineTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto max-w-xs space-y-2 text-[13px]">
          <div className="flex justify-between gap-4">
            <dt className="text-steel">Goods ex VAT</dt>
            <dd>£{quote.subtotal}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-steel">Delivery</dt>
            <dd>{quote.deliveryTotal === "0.00" ? "FREE" : `£${quote.deliveryTotal}`}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-steel">VAT</dt>
            <dd>£{quote.vatTotal}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-border pt-2 text-base font-semibold">
            <dt>Total inc VAT</dt>
            <dd>£{quote.grandTotal}</dd>
          </div>
        </dl>

        {quote.customerNotes ? (
          <section className="rounded-lg border border-border p-4">
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-steel">Notes</h2>
            <p className="mt-2 whitespace-pre-wrap text-[13px]">{quote.customerNotes}</p>
          </section>
        ) : null}

        {quote.canCustomerAccept ? (
          <section className="space-y-3 rounded-lg border border-border p-4 print:hidden">
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onAccept()}
                className="h-12 flex-1 rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-50"
              >
                Accept quote
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onDecline()}
                className="h-12 flex-1 rounded-md border border-border text-[13px] font-bold uppercase tracking-wide disabled:opacity-50"
              >
                Decline quote
              </button>
            </div>
            <textarea
              className={inputClass}
              rows={2}
              placeholder="Optional decline reason"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
            />
          </section>
        ) : null}

        <p className="text-[12px] text-steel print:hidden">
          <Link to={ROUTES.portalQuotes} className="font-semibold text-primary">
            Back to quotes
          </Link>
        </p>
      </div>

      <style>{`
        @media print {
          nav, .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}
