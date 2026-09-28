import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { Field, inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { formatQuoteDateOnlyUk } from "@/domain/quote";
import {
  acceptQuoteOnBehalfFn,
  duplicateQuoteFn,
  getQuoteCompanyContextFn,
  getStaffQuoteFn,
  listQuoteEmailsFn,
  searchQuoteProductsFn,
  sendQuoteFn,
  updateQuoteDraftFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/sales/quotes/$quoteId")({
  head: () => ({
    meta: [{ title: "Quote — Sales Portal — Automotive Brands" }],
  }),
  component: QuoteWorkspace,
});

type Quote = Extract<Awaited<ReturnType<typeof getStaffQuoteFn>>, { ok: true }>["data"];
type CompanyCtx = Extract<
  Awaited<ReturnType<typeof getQuoteCompanyContextFn>>,
  { ok: true }
>["data"];
type ProductHit = Extract<
  Awaited<ReturnType<typeof searchQuoteProductsFn>>,
  { ok: true }
>["data"][number];
type EmailRow = Extract<Awaited<ReturnType<typeof listQuoteEmailsFn>>, { ok: true }>["data"][number];

type DraftLine = {
  variantId: string;
  sku: string;
  name: string;
  qty: number;
  caseQty: number | null;
  normalUnitPrice: string;
  quotedUnitPrice: string;
  priceOverride: boolean;
};

function quoteTone(status: string) {
  if (status === "CONVERTED" || status === "ACCEPTED") return "good" as const;
  if (status === "DECLINED" || status === "REJECTED" || status === "EXPIRED") return "bad" as const;
  if (status === "DRAFT") return "neutral" as const;
  return "brand" as const;
}

function QuoteWorkspace() {
  const { quoteId } = Route.useParams();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [company, setCompany] = useState<CompanyCtx | null>(null);
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [productQ, setProductQ] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [customerNotes, setCustomerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [contactId, setContactId] = useState("");
  const [deliveryAddressId, setDeliveryAddressId] = useState("");
  const [acceptNote, setAcceptNote] = useState("");

  const isDraft = quote?.status === "DRAFT";

  const load = useCallback(async () => {
    const result = await getStaffQuoteFn({ data: { id: quoteId } });
    if (!result.ok) {
      setError(result.error);
      setQuote(null);
      return;
    }
    setError(null);
    setQuote(result.data);
    setCustomerNotes(result.data.customerNotes ?? "");
    setInternalNotes(result.data.internalNotes ?? "");
    setPoNumber(result.data.poNumber ?? "");
    setValidUntil(result.data.validUntil ?? "");
    setLines(
      result.data.items.map((it) => ({
        variantId: String(it.variantId ?? ""),
        sku: it.sku,
        name: it.name,
        qty: it.qty as number,
        caseQty: (it.caseQty as number | null) ?? null,
        normalUnitPrice: it.normalUnitPrice,
        quotedUnitPrice: it.unitPrice,
        priceOverride: Boolean(it.priceOverride),
      })),
    );

    const ctx = await getQuoteCompanyContextFn({ data: { companyId: result.data.companyId } });
    if (ctx.ok) {
      setCompany(ctx.data);
      const snap = result.data.contactSnapshot as { id?: string } | null;
      setContactId(snap?.id ?? ctx.data.contacts.find((c) => c.isPrimary)?.id ?? "");
      const defaultAddr =
        ctx.data.addresses.find((a) => a.isDefaultDelivery) ?? ctx.data.addresses[0];
      setDeliveryAddressId(defaultAddr?.id ?? "");
    }

    const mail = await listQuoteEmailsFn({ data: { quoteId } });
    if (mail.ok) setEmails(mail.data);
  }, [quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!quote || !isDraft || productQ.trim().length < 1) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      void searchQuoteProductsFn({
        data: { companyId: quote.companyId, q: productQ.trim() },
      }).then((r) => {
        if (r.ok) setHits(r.data);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [productQ, quote, isDraft]);

  function addProduct(hit: ProductHit) {
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === hit.variantId);
      if (existing) {
        const step = hit.caseQty && hit.caseQty > 1 ? hit.caseQty : 1;
        return prev.map((l) =>
          l.variantId === hit.variantId ? { ...l, qty: l.qty + step } : l,
        );
      }
      return [
        ...prev,
        {
          variantId: hit.variantId,
          sku: hit.sku,
          name: hit.name,
          qty: hit.caseQty && hit.caseQty > 1 ? hit.caseQty : 1,
          caseQty: hit.caseQty,
          normalUnitPrice: hit.unitPrice ?? "0.0000",
          quotedUnitPrice: hit.unitPrice ?? "0.0000",
          priceOverride: false,
        },
      ];
    });
    setProductQ("");
    setHits([]);
  }

  async function saveDraft(): Promise<boolean> {
    if (!quote || !isDraft) return false;
    if (lines.some((l) => !l.variantId)) {
      toast.error("Some lines are missing product links — remove and re-add them");
      return false;
    }
    setSaving(true);
    const result = await updateQuoteDraftFn({
      data: {
        id: quote.id,
        contactId: contactId || null,
        deliveryAddressId: deliveryAddressId || null,
        poNumber: poNumber || null,
        customerNotes: customerNotes || null,
        internalNotes: internalNotes || null,
        validUntil: validUntil || null,
        lines: lines.map((l) => ({
          variantId: l.variantId,
          qty: l.qty,
          quotedUnitPrice: l.priceOverride ? l.quotedUnitPrice : null,
        })),
      },
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setQuote(result.data);
    setLines(
      result.data.items.map((it) => ({
        variantId: String(it.variantId ?? ""),
        sku: it.sku,
        name: it.name,
        qty: it.qty as number,
        caseQty: (it.caseQty as number | null) ?? null,
        normalUnitPrice: it.normalUnitPrice,
        quotedUnitPrice: it.unitPrice,
        priceOverride: Boolean(it.priceOverride),
      })),
    );
    toast.success("Draft saved");
    return true;
  }

  async function send() {
    if (!quote) return;
    if (isDraft) {
      const ok = await saveDraft();
      if (!ok) return;
    }
    const result = await sendQuoteFn({ data: { id: quote.id } });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      result.data.emailSent
        ? `Quote sent to ${result.data.toEmail}`
        : `Quote marked Sent — email to ${result.data.toEmail} failed (use Resend)`,
    );
    await load();
  }

  async function duplicate() {
    const result = await duplicateQuoteFn({ data: { id: quoteId } });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Duplicated as ${result.data.quoteNumber}`);
    window.location.href = ROUTES.salesQuote(result.data.id);
  }

  async function acceptOnBehalf() {
    if (!acceptNote.trim()) {
      toast.error("Add a confirmation note");
      return;
    }
    if (!window.confirm("Accept this quotation on behalf of the customer and create an order?")) {
      return;
    }
    const result = await acceptQuoteOnBehalfFn({
      data: {
        id: quoteId,
        idempotencyKey: `staff-accept-${quoteId}-${Date.now()}`,
        note: acceptNote.trim(),
      },
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Converted to order ${result.data.orderNumber}`);
    await load();
  }

  if (error) {
    return (
      <div>
        <PanelHeader title="Quote" sub="Sales workspace" />
        <p className="p-6 text-sm text-bad">{error}</p>
      </div>
    );
  }

  if (!quote) {
    return (
      <div>
        <PanelHeader title="Quote" sub="Sales workspace" />
        <p className="p-6 text-[13px] text-steel">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <PanelHeader
        title={quote.quoteNumber}
        sub={quote.company?.name ?? "Trade quotation"}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <StatusBadge tone={quoteTone(quote.status)}>{quote.statusLabel}</StatusBadge>
            <Link
              to={ROUTES.salesQuotes}
              className="inline-flex h-9 items-center rounded-md border border-border px-3 text-[12px] font-semibold"
            >
              All quotes
            </Link>
            {isDraft ? (
              <button
                type="button"
                onClick={() => void saveDraft()}
                disabled={saving}
                className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
              >
                {saving ? "Saving…" : "Save draft"}
              </button>
            ) : null}
            {isDraft || quote.status === "SENT" || quote.status === "VIEWED" ? (
              <button
                type="button"
                onClick={() => void send()}
                className="h-9 rounded-md bg-primary px-3 text-[12px] font-bold uppercase text-primary-foreground"
              >
                {quote.status === "DRAFT" ? "Send quote" : "Resend email"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void duplicate()}
              className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
            >
              Duplicate
            </button>
            {quote.convertedOrderId ? (
              <Link
                to="/admin/orders/$orderId"
                params={{ orderId: quote.convertedOrderId }}
                className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold leading-9"
              >
                View order {quote.convertedOrderNumber}
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => window.print()}
              className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
            >
              Print
            </button>
          </div>
        }
      />

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {quote.status === "CONVERTED" || quote.convertedOrderId ? (
            <section className="rounded-lg border border-good/40 bg-good/5 p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-good">
                Converted to order
              </p>
              <p className="mt-2 font-display text-2xl font-semibold uppercase">
                {quote.convertedOrderNumber ?? "Order created"}
              </p>
              <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
                <div>
                  <dt className="text-steel">Converted</dt>
                  <dd>{quote.convertedAt ? formatDateTime(quote.convertedAt) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-steel">Accepted by</dt>
                  <dd>{quote.acceptedByName || "—"}</dd>
                </div>
                <div>
                  <dt className="text-steel">Acceptance channel</dt>
                  <dd>{quote.acceptanceChannelLabel || "—"}</dd>
                </div>
                {quote.acceptanceNote ? (
                  <div className="sm:col-span-2">
                    <dt className="text-steel">Confirmation note</dt>
                    <dd>{quote.acceptanceNote}</dd>
                  </div>
                ) : null}
              </dl>
              {quote.convertedOrderId ? (
                <Link
                  to="/admin/orders/$orderId"
                  params={{ orderId: quote.convertedOrderId }}
                  className="mt-4 inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
                >
                  View order
                </Link>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-lg border border-border p-5">
            <h2 className="font-display text-base font-semibold uppercase">Customer & delivery</h2>
            {company ? (
              <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
                <div>
                  <dt className="text-steel">Company</dt>
                  <dd className="font-medium">{company.name}</dd>
                </div>
                <div>
                  <dt className="text-steel">Account status</dt>
                  <dd>{company.status}</dd>
                </div>
                <div>
                  <dt className="text-steel">Payment terms</dt>
                  <dd>{company.paymentTerms || "—"}</dd>
                </div>
                <div>
                  <dt className="text-steel">Sales rep</dt>
                  <dd>{company.salesRep.name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-steel">Price list</dt>
                  <dd>{company.priceList?.name || "—"}</dd>
                </div>
                <div>
                  <dt className="text-steel">Autopart linked</dt>
                  <dd>{company.autopartAccountLinked ? "Yes" : "No"}</dd>
                </div>
              </dl>
            ) : null}

            {isDraft ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Contact">
                  <select
                    className={inputClass}
                    value={contactId}
                    onChange={(e) => setContactId(e.target.value)}
                  >
                    <option value="">—</option>
                    {(company?.contacts ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.email ? ` <${c.email}>` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Delivery address">
                  <select
                    className={inputClass}
                    value={deliveryAddressId}
                    onChange={(e) => setDeliveryAddressId(e.target.value)}
                  >
                    <option value="">—</option>
                    {(company?.addresses ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label ? `${a.label}: ` : ""}
                        {a.line1}, {a.postcode}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            ) : (
              <div className="mt-3 text-[13px] text-steel">
                <p>
                  {(quote.contactSnapshot as { name?: string } | null)?.name ?? "—"}
                  {(quote.contactSnapshot as { email?: string } | null)?.email
                    ? ` · ${(quote.contactSnapshot as { email?: string }).email}`
                    : ""}
                </p>
                {quote.deliveryAddress ? (
                  <p className="mt-1">
                    {[
                      (quote.deliveryAddress as { line1?: string }).line1,
                      (quote.deliveryAddress as { town?: string }).town,
                      (quote.deliveryAddress as { postcode?: string }).postcode,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                ) : null}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border p-5">
            <h2 className="font-display text-base font-semibold uppercase">Products</h2>
            {isDraft ? (
              <div className="relative mt-3 print:hidden">
                <input
                  className={inputClass}
                  value={productQ}
                  onChange={(e) => setProductQ(e.target.value)}
                  placeholder="Search SKU, name or brand…"
                />
                {hits.length > 0 ? (
                  <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-background shadow-lg">
                    {hits.map((hit) => (
                      <li key={hit.variantId}>
                        <button
                          type="button"
                          className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-[13px] hover:bg-muted"
                          onClick={() => addProduct(hit)}
                        >
                          <span>
                            <span className="font-semibold">{hit.sku}</span> — {hit.name}
                            <span className="block text-[11px] text-steel">
                              Case {hit.caseQty ?? 1} · avail {hit.sellableQty} · £
                              {hit.customerUnitPrice ?? "—"}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-steel">
                    <th className="py-2 pr-2">Product</th>
                    <th className="py-2 pr-2">Qty</th>
                    <th className="py-2 pr-2 text-right">Normal</th>
                    <th className="py-2 pr-2 text-right">Quoted</th>
                    <th className="py-2 text-right">Line</th>
                    {isDraft ? <th className="py-2 pl-2 print:hidden" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {(isDraft ? lines : quote.items).map((line, idx) => {
                    const draft = isDraft ? (line as DraftLine) : null;
                    const item = !isDraft ? (line as Quote["items"][number]) : null;
                    return (
                      <tr
                        key={`${draft?.variantId ?? item?.id ?? idx}`}
                        className="border-b border-border/50"
                      >
                        <td className="py-2 pr-2">
                          <div className="font-medium">{draft?.name ?? item?.name}</div>
                          <div className="font-mono text-[11px] text-steel">
                            {draft?.sku ?? item?.sku}
                          </div>
                        </td>
                        <td className="py-2 pr-2">
                          {draft ? (
                            <input
                              type="number"
                              min={1}
                              className={`${inputClass} w-20`}
                              value={draft.qty}
                              onChange={(e) => {
                                const v = Number(e.target.value);
                                setLines((prev) =>
                                  prev.map((l, i) => (i === idx ? { ...l, qty: v } : l)),
                                );
                              }}
                            />
                          ) : (
                            (item?.qty as number)
                          )}
                        </td>
                        <td className="py-2 pr-2 text-right text-steel">
                          £
                          {item?.normalCustomerUnitPrice ??
                            (draft?.normalUnitPrice
                              ? Number(draft.normalUnitPrice).toFixed(2)
                              : "—")}
                        </td>
                        <td className="py-2 pr-2 text-right">
                          {draft ? (
                            <input
                              className={`${inputClass} w-24 text-right`}
                              value={draft.quotedUnitPrice}
                              onChange={(e) => {
                                const v = e.target.value;
                                setLines((prev) =>
                                  prev.map((l, i) =>
                                    i === idx
                                      ? { ...l, quotedUnitPrice: v, priceOverride: true }
                                      : l,
                                  ),
                                );
                              }}
                            />
                          ) : (
                            <>£{item?.customerUnitPrice}</>
                          )}
                        </td>
                        <td className="py-2 text-right font-medium">
                          {item ? `£${item.lineTotal}` : ""}
                        </td>
                        {isDraft ? (
                          <td className="py-2 pl-2 print:hidden">
                            <button
                              type="button"
                              className="text-[12px] text-bad"
                              onClick={() =>
                                setLines((prev) => prev.filter((_, i) => i !== idx))
                              }
                            >
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
          </section>

          <section className="rounded-lg border border-border p-5">
            <h2 className="font-display text-base font-semibold uppercase">Notes</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Customer notes">
                <textarea
                  className={inputClass}
                  rows={4}
                  disabled={!isDraft}
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                />
              </Field>
              <Field label="Internal notes">
                <textarea
                  className={inputClass}
                  rows={4}
                  disabled={!isDraft}
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                />
              </Field>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-lg border border-border p-5">
            <h2 className="font-display text-base font-semibold uppercase">Commercial</h2>
            <dl className="mt-3 space-y-2 text-[13px]">
              <div className="flex justify-between gap-2">
                <dt className="text-steel">Goods ex VAT</dt>
                <dd>£{quote.subtotal}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-steel">Delivery</dt>
                <dd>
                  {quote.deliveryTotal === "0.00" ? "FREE" : `£${quote.deliveryTotal}`}
                  {quote.deliveryOverridden ? " (override)" : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-steel">VAT</dt>
                <dd>£{quote.vatTotal}</dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-border pt-2 font-semibold">
                <dt>Total inc VAT</dt>
                <dd>£{quote.grandTotal}</dd>
              </div>
            </dl>
            {isDraft ? (
              <div className="mt-4 space-y-3">
                <Field label="Customer reference / PO">
                  <input
                    className={inputClass}
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                  />
                </Field>
                <Field label="Valid until">
                  <input
                    type="date"
                    className={inputClass}
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                  />
                </Field>
              </div>
            ) : (
              <dl className="mt-4 space-y-2 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-steel">PO / reference</dt>
                  <dd>{quote.poNumber || "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-steel">Valid until</dt>
                  <dd>{formatQuoteDateOnlyUk(quote.validUntil)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-steel">Sent</dt>
                  <dd>{quote.sentAt ? formatDateTime(quote.sentAt) : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-steel">Created</dt>
                  <dd>{formatDate(quote.createdAt)}</dd>
                </div>
              </dl>
            )}
          </section>

          {(quote.status === "SENT" || quote.status === "VIEWED") && !quote.convertedOrderId ? (
            <section className="rounded-lg border border-border p-5 print:hidden">
              <h2 className="font-display text-base font-semibold uppercase">
                Accept on behalf
              </h2>
              <p className="mt-2 text-[12px] text-steel">
                Record telephone/email acceptance. Creates a normal Received order.
              </p>
              <textarea
                className={`${inputClass} mt-3`}
                rows={3}
                placeholder="Confirmation note (required)"
                value={acceptNote}
                onChange={(e) => setAcceptNote(e.target.value)}
              />
              <button
                type="button"
                onClick={() => void acceptOnBehalf()}
                className="mt-3 h-10 w-full rounded-md bg-primary text-[12px] font-bold uppercase text-primary-foreground"
              >
                Accept on behalf of customer
              </button>
            </section>
          ) : null}

          <section className="rounded-lg border border-border p-5 print:hidden">
            <h2 className="font-display text-base font-semibold uppercase">
              Transactional email
            </h2>
            {emails.length === 0 ? (
              <p className="mt-2 text-[12px] text-steel">No emails yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-[12px]">
                {emails.map((e) => (
                  <li key={e.id} className="border-b border-border/50 pb-2">
                    <div className="font-semibold">
                      {e.purpose} · {e.status}
                    </div>
                    <div className="text-steel">
                      {e.toEmail}
                      {e.sentAt ? ` · ${formatDateTime(e.sentAt)}` : ""}
                    </div>
                    {e.lastError ? <div className="text-bad">{e.lastError}</div> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
