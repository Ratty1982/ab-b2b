import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field } from "@/components/ab/Drawer";
import { CreateSalesOrderDesk } from "@/components/orders/CreateSalesOrderDesk";
import { SalesOrderProductResults } from "@/components/orders/SalesOrderProductResults";
import {
  SalesOrderLines,
  SalesOrderMobileFooter,
  SalesOrderPriceAlert,
  SalesOrderReviewPanel,
  SalesOrderSection,
  openSalesOrderReview,
  salesOrderControlClass,
  salesOrderPageFrameClass,
  useSalesOrderKeyboard,
} from "@/components/orders/sales-order-mobile";
import {
  applySalesOrderProductAdd,
  parseStaffOrderQuantity,
  SALES_ORDER_SOURCE_LABEL,
  type SalesOrderDraftLineInput,
} from "@/domain/sales-order-entry";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/app-nav";
import {
  openSalesOrderDraftFn,
  placeSalesOrderFn,
  saveSalesOrderDraftFn,
  searchSalesOrderProductsFn,
  getSalesOrderDraftFn,
} from "@/server/phase2/fns";
import { toast } from "sonner";

export const Route = createFileRoute("/sales/orders/new")({
  validateSearch: (search: Record<string, unknown>): { companyId?: string; draftId?: string; fresh?: boolean } => {
    const companyId = typeof search["companyId"] === "string" ? search["companyId"] : "";
    const draftId = typeof search["draftId"] === "string" ? search["draftId"] : "";
    const fresh = search["fresh"] === true || search["fresh"] === "1" || search["fresh"] === "true";
    return {
      ...(companyId ? { companyId } : {}),
      ...(draftId ? { draftId } : {}),
      ...(fresh ? { fresh: true } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Create Sales Order — Sales — Automotive Brands" },
      {
        name: "description",
        content: "Search any active trade account and enter an order. The assigned representative stays on the order.",
      },
    ],
  }),
  component: NewSalesOrder,
});

type Workspace = Extract<Awaited<ReturnType<typeof getSalesOrderDraftFn>>, { ok: true }>["data"];
type ProductHit = {
  variantId: string;
  sku: string;
  name: string;
  brand: string;
  caseQty: number | null;
  minOrderQty: number;
  sellableQty: number;
  backordersAllowed: boolean;
  customerUnitPrice: string | null;
  priceSource: string | null;
  promotionCode: string | null;
  issue: string;
  issueMessage: string | null;
};

function money(value: string | null | undefined) {
  return value ? `£${value}` : "—";
}

function orderFingerprint(input: {
  companyId: string;
  source: string;
  contactId: string;
  addressId: string;
  useOneOff: boolean;
  oneOff: { line1: string; line2: string; town: string; county: string; postcode: string };
  poNumber: string;
  instructions: string;
  quoteId: string;
  lines: Array<{ variantId: string; qty: number; unitPriceOverride?: string | null }>;
}) {
  return JSON.stringify({
    companyId: input.companyId,
    source: input.source,
    contactId: input.contactId,
    addressId: input.useOneOff ? "" : input.addressId,
    oneOff: input.useOneOff ? input.oneOff : null,
    poNumber: input.poNumber,
    instructions: input.instructions,
    quoteId: input.quoteId,
    lines: input.lines.map((line) => ({
      variantId: line.variantId,
      qty: line.qty,
      unitPriceOverride: line.unitPriceOverride ?? null,
    })),
  });
}

function NewSalesOrder() {
  const search = Route.useSearch();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState("");
  const [products, setProducts] = useState<ProductHit[]>([]);
  const [addingProduct, setAddingProduct] = useState(false);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  const addingRef = useRef(false);
  const [source, setSource] = useState("TELEPHONE");
  const [contactId, setContactId] = useState("");
  const [addressId, setAddressId] = useState("");
  const [useOneOff, setUseOneOff] = useState(false);
  const [oneOff, setOneOff] = useState({ line1: "", line2: "", town: "", county: "", postcode: "" });
  const [poNumber, setPoNumber] = useState("");
  const [instructions, setInstructions] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [quoteId, setQuoteId] = useState("");
  const [lines, setLines] = useState<SalesOrderDraftLineInput[]>([]);
  const linesRef = useRef(lines);
  const saveSeq = useRef(0);
  function commitLines(next: typeof lines) {
    linesRef.current = next;
    setLines(next);
  }
  const [authorised, setAuthorised] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<{ orderNumber: string; id: string; grandTotal: string } | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [reviewed, setReviewed] = useState<{
    fingerprint: string;
    expectedReview: {
      lines: Array<{ variantId: string; qty: number; customerUnitPrice: string; lineNet: string }>;
      subtotal: string;
      vatTotal: string;
      deliveryTotal: string;
      grandTotal: string;
    };
  } | null>(null);
  const [priceChanges, setPriceChanges] = useState<
    Array<{
      variantId: string;
      sku: string;
      name: string;
      previousUnitPrice: string | null;
      newUnitPrice: string | null;
      previousLineNet: string | null;
      newLineNet: string | null;
    }>
  >([]);
  const [totalsChanged, setTotalsChanged] = useState(false);
  const [previousTotals, setPreviousTotals] = useState<{ grandTotal: string } | null>(null);
  const [acceptedPrices, setAcceptedPrices] = useState(true);
  const typing = useSalesOrderKeyboard();

  const applyWorkspace = useCallback((data: Workspace) => {
    const nextSource = data.draft.source ?? "TELEPHONE";
    const nextContact = data.draft.contactId ?? "";
    const nextAddress = data.draft.addressId ?? "";
    const nextOneOffFlag = Boolean(data.draft.oneOffAddress);
    const saved = data.draft.oneOffAddress as {
      line1?: string;
      line2?: string;
      town?: string;
      county?: string;
      postcode?: string;
    } | null;
    const nextOneOff =
      saved && typeof saved === "object"
        ? {
            line1: saved.line1 ?? "",
            line2: saved.line2 ?? "",
            town: saved.town ?? "",
            county: saved.county ?? "",
            postcode: saved.postcode ?? "",
          }
        : { line1: "", line2: "", town: "", county: "", postcode: "" };
    const nextPo = data.draft.poNumber ?? "";
    const nextInstructions = data.draft.deliveryInstructions ?? "";
    const nextLines = data.draft.lines.map((line) => ({
      variantId: line.variantId,
      qty: line.qty,
      sku: line.sku,
      name: line.name,
      unitPriceOverride: line.unitPriceOverride,
    }));
    setWorkspace(data);
    setSource(nextSource);
    setContactId(nextContact);
    setAddressId(nextAddress);
    setUseOneOff(nextOneOffFlag);
    if (saved && typeof saved === "object") setOneOff(nextOneOff);
    setPoNumber(nextPo);
    setInstructions(nextInstructions);
    setInternalNote(data.draft.internalNote ?? "");
    linesRef.current = nextLines;
    setLines(nextLines);
    setAuthorised(false);
    setPriceChanges([]);
    setTotalsChanged(false);
    setPreviousTotals(null);
    setAcceptedPrices(true);
    const review = data.review;
    const complete =
      review != null &&
      !review.hasBlockingIssues &&
      review.lines.length > 0 &&
      review.lines.every((line) => line.customerUnitPrice && line.lineNet);
    setReviewed(
      complete
        ? {
            fingerprint: orderFingerprint({
              companyId: data.draft.companyId,
              source: nextSource,
              contactId: nextContact,
              addressId: nextAddress,
              useOneOff: nextOneOffFlag,
              oneOff: nextOneOff,
              poNumber: nextPo,
              instructions: nextInstructions,
              quoteId,
              lines: nextLines,
            }),
            expectedReview: {
              lines: review.lines.map((line) => ({
                variantId: line.variantId,
                qty: line.quantity,
                customerUnitPrice: line.customerUnitPrice!,
                lineNet: line.lineNet!,
              })),
              subtotal: review.totals.subtotal,
              vatTotal: review.totals.vatTotal,
              deliveryTotal: review.totals.deliveryTotal,
              grandTotal: review.totals.grandTotal,
            },
          }
        : null,
    );
  }, [quoteId]);

  const load = useCallback(async () => {
    if (search.draftId) {
      const result = await getSalesOrderDraftFn({ data: { draftId: search.draftId } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      applyWorkspace(result.data);
      return;
    }
    if (!search.companyId) return;
    const result = await openSalesOrderDraftFn({
      data: { companyId: search.companyId, fresh: search.fresh === true },
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    applyWorkspace(result.data);
  }, [applyWorkspace, search.companyId, search.draftId, search.fresh]);

  useEffect(() => {
    void load();
  }, [load]);

  function headerPayload(nextLines = lines) {
    if (!workspace) return null;
    return {
      draftId: workspace.draft.id,
      source,
      contactId: contactId || null,
      addressId: useOneOff ? null : addressId || null,
      oneOffAddress: useOneOff
        ? {
            line1: oneOff.line1,
            line2: oneOff.line2 || null,
            town: oneOff.town,
            county: oneOff.county || null,
            postcode: oneOff.postcode,
            country: "GB",
          }
        : null,
      poNumber: poNumber || null,
      deliveryInstructions: instructions || null,
      internalNote: internalNote || null,
      lines: nextLines.map((line) => ({
        variantId: line.variantId,
        qty: line.qty,
        unitPriceOverride: line.unitPriceOverride,
      })),
    };
  }

  async function persist(nextLines?: typeof lines) {
    const saving = nextLines ?? linesRef.current;
    const payload = headerPayload(saving);
    if (!payload) return null;
    const seq = ++saveSeq.current;
    const result = await saveSalesOrderDraftFn({ data: payload });
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    if (seq !== saveSeq.current) return result.data;
    applyWorkspace(result.data);
    return result.data;
  }

  async function searchProducts() {
    if (!workspace || productQuery.trim().length < 1) return;
    const result = await searchSalesOrderProductsFn({
      data: { companyId: workspace.draft.companyId, q: productQuery.trim() },
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setProducts(result.data as ProductHit[]);
  }

  async function addProduct(hit: ProductHit) {
    const decision = applySalesOrderProductAdd({
      busy: addingRef.current,
      lines: linesRef.current,
      hit,
    });
    if (!decision.accepted) return;
    addingRef.current = true;
    setAddingProduct(true);
    setAuthorised(false);
    commitLines(decision.lines);
    if (decision.clearSearch) {
      setProducts([]);
      setProductQuery("");
      searchInputRef.current?.focus();
    }
    try {
      await persist(decision.lines);
    } finally {
      addingRef.current = false;
      setAddingProduct(false);
    }
  }

  function updateLine(variantId: string, patch: Partial<SalesOrderDraftLineInput>, persistNow: boolean) {
    const next = linesRef.current.map((item) =>
      item.variantId === variantId ? { ...item, ...patch } : item,
    );
    setAuthorised(false);
    commitLines(next);
    if (persistNow) void persist(next);
  }

  function currentFingerprint() {
    if (!workspace) return "";
    return orderFingerprint({
      companyId: workspace.draft.companyId,
      source,
      contactId,
      addressId,
      useOneOff,
      oneOff,
      poNumber,
      instructions,
      quoteId,
      lines: linesRef.current,
    });
  }

  async function place() {
    if (!workspace || placing) return;
    if (!authorised) {
      toast.error("Confirm you are authorised to place this order");
      return;
    }
    if (!quoteId && (!reviewed || reviewed.fingerprint !== currentFingerprint())) {
      setAuthorised(false);
      toast.error("Save and review the prices before placing this order.");
      return;
    }
    if (!quoteId && priceChanges.length > 0 && !acceptedPrices) {
      toast.error("Accept the updated prices before placing this order.");
      return;
    }
    if (!quoteId && !reviewed) {
      setAuthorised(false);
      toast.error("Save and review the prices, VAT, and delivery total before placing this order.");
      return;
    }
    setPlacing(true);
    const result = await placeSalesOrderFn({
      data: {
        draftId: workspace.draft.id,
        confirmAuthorised: true,
        idempotencyKey,
        source,
        contactId: contactId || null,
        addressId: useOneOff ? null : addressId || null,
        oneOffAddress: useOneOff
          ? {
              line1: oneOff.line1,
              line2: oneOff.line2 || null,
              town: oneOff.town,
              county: oneOff.county || null,
              postcode: oneOff.postcode,
              country: "GB",
            }
          : null,
        poNumber: poNumber || null,
        deliveryInstructions: instructions || null,
        internalNote: internalNote || null,
        lines: linesRef.current.map((line) => ({
          variantId: line.variantId,
          qty: line.qty,
          unitPriceOverride: line.unitPriceOverride,
        })),
        expectedReview: quoteId ? null : reviewed?.expectedReview,
        quoteId: quoteId || null,
      },
    });
    setPlacing(false);
    if (!result.ok) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    if (!result.data.ok) {
      const rejected = result.data;
      setWorkspace((current) => (current ? { ...current, review: rejected.review } : current));
      setPriceChanges(rejected.changes);
      setTotalsChanged(rejected.totalsChanged);
      setPreviousTotals(rejected.previousTotals ? { grandTotal: rejected.previousTotals.grandTotal } : null);
      setAcceptedPrices(false);
      setAuthorised(false);
      const first = result.data.changes[0];
      toast.error(
        first
          ? `${first.sku} changed from ${money(first.previousUnitPrice)} to ${money(first.newUnitPrice)}. Review it before placing the order.`
          : result.data.totalsChanged
            ? "VAT, delivery, or the order total changed. Review the totals before placing the order."
            : "Stock or quantities changed. Review the order before placing it.",
      );
      return;
    }
    toast.dismiss();
    setPlaced({
      id: result.data.order.id,
      orderNumber: result.data.order.orderNumber,
      grandTotal: result.data.order.grandTotal,
    });
    toast.success(`Order ${result.data.order.orderNumber} placed`);
  }

  if (placed) {
    return (
      <div>
        <PanelHeader title="Order placed" sub={workspace?.draft.companyName ?? "Customer order"} />
        <div className="mx-auto max-w-xl space-y-4 p-6">
          <p className="font-display text-3xl">{placed.orderNumber}</p>
          <p className="text-[14px]">Grand total £{placed.grandTotal}</p>
          <p className="text-[13px] text-steel">
            The order is in the customer’s order history. Confirmation email goes to the customer contact.
          </p>
          <div className="flex gap-3">
            <Link
              to="/admin/orders/$orderId"
              params={{ orderId: placed.id }}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[13px] font-bold uppercase text-primary-foreground"
            >
              View order
            </Link>
            <Link to={ROUTES.salesOrders} className="inline-flex h-10 items-center text-[13px] font-semibold text-primary">
              Back to drafts
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!search.companyId && !search.draftId) {
    return <CreateSalesOrderDesk />;
  }

  const review = workspace?.review;
  const priceWarning = priceChanges.length > 0 || totalsChanged;
  const contactReady = workspace?.contacts.some((contact) => contact.id === contactId) ?? false;
  const contactName = workspace?.contacts.find((contact) => contact.id === contactId)?.name;
  return (
    <div className={cn(salesOrderPageFrameClass, typing && "pb-0")}>
      <PanelHeader
        title={workspace ? workspace.draft.companyName : "Create Sales Order"}
        sub={
          workspace?.assignedSalesRep
            ? `Assigned representative: ${workspace.assignedSalesRep.name}. Prices are resolved for this customer. You are recorded as the person who places the order.`
            : "No representative is assigned to this account. Prices are resolved for this customer. You are recorded as the person who places the order."
        }
        actions={
          <Link to={ROUTES.salesOrders} className="inline-flex min-h-11 items-center text-[13px] font-semibold text-primary">
            Open drafts
          </Link>
        }
      />
      <div className="grid min-w-0 gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {error ? <p className="text-[14px] text-bad">{error}</p> : null}
          <SalesOrderPriceAlert
            changes={priceChanges}
            totalsChanged={totalsChanged}
            previousGrandTotal={previousTotals?.grandTotal ?? null}
            grandTotal={review?.totals.grandTotal}
            onReview={() => openSalesOrderReview()}
          />
          {!workspace && !error ? <p className="text-[14px] text-steel">Loading customer…</p> : null}
          {workspace ? (
            <>
              <SalesOrderSection
                title="Customer"
                hint={
                  contactReady ? (
                    <span className="truncate text-steel">{contactName}</span>
                  ) : (
                    <span className="font-semibold text-bad">Contact required</span>
                  )
                }
              >
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <Field label="Order source">
                    <select className={salesOrderControlClass} value={source} onChange={(e) => { setSource(e.target.value); setAuthorised(false); }}>
                      {Object.entries(SALES_ORDER_SOURCE_LABEL).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Customer contact">
                    <select className={salesOrderControlClass} value={contactId} onChange={(e) => { setContactId(e.target.value); setAuthorised(false); }}>
                      <option value="">Select contact…</option>
                      {workspace.contacts.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.name}
                          {contact.email ? ` · ${contact.email}` : " · no email"}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Customer PO / reference">
                    <input className={salesOrderControlClass} value={poNumber} onChange={(e) => { setPoNumber(e.target.value); setAuthorised(false); }} />
                  </Field>
                  {workspace.quotes.length > 0 ? (
                    <Field label="Use an existing quotation">
                      <select className={salesOrderControlClass} value={quoteId} onChange={(e) => { setQuoteId(e.target.value); setAuthorised(false); }}>
                        <option value="">New order — price products below</option>
                        {workspace.quotes.map((quote) => (
                          <option key={quote.id} value={quote.id}>
                            {quote.quoteNumber} · £{quote.grandTotal} · {quote.status}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                </div>
              </SalesOrderSection>
              <SalesOrderSection
                title="Delivery"
                hint={
                  useOneOff ? (
                    <span className="text-steel">One-off address</span>
                  ) : addressId ? (
                    <span className="text-steel">Saved address</span>
                  ) : (
                    <span className="font-semibold text-bad">Address required</span>
                  )
                }
              >
                <Field label="Delivery">
                  <label className="mb-2 flex min-h-11 items-center gap-3 text-[16px]">
                    <input type="checkbox" className="size-5" checked={useOneOff} onChange={(e) => { setUseOneOff(e.target.checked); setAuthorised(false); }} />
                    One-off delivery address
                  </label>
                  {useOneOff ? (
                    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                      <input className={salesOrderControlClass} placeholder="Address line 1" value={oneOff.line1} onChange={(e) => { setOneOff({ ...oneOff, line1: e.target.value }); setAuthorised(false); }} />
                      <input className={salesOrderControlClass} placeholder="Address line 2" value={oneOff.line2} onChange={(e) => { setOneOff({ ...oneOff, line2: e.target.value }); setAuthorised(false); }} />
                      <input className={salesOrderControlClass} placeholder="Town" value={oneOff.town} onChange={(e) => { setOneOff({ ...oneOff, town: e.target.value }); setAuthorised(false); }} />
                      <input className={salesOrderControlClass} placeholder="County" value={oneOff.county} onChange={(e) => { setOneOff({ ...oneOff, county: e.target.value }); setAuthorised(false); }} />
                      <input className={salesOrderControlClass} placeholder="Postcode" value={oneOff.postcode} onChange={(e) => { setOneOff({ ...oneOff, postcode: e.target.value }); setAuthorised(false); }} />
                    </div>
                  ) : (
                    <select className={salesOrderControlClass} value={addressId} onChange={(e) => { setAddressId(e.target.value); setAuthorised(false); }}>
                      <option value="">Select address…</option>
                      {workspace.addresses.map((address) => (
                        <option key={address.id} value={address.id}>
                          {address.label ? `${address.label} — ` : ""}
                          {address.line1}, {address.town}, {address.postcode}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Delivery instructions">
                  <input className={salesOrderControlClass} value={instructions} onChange={(e) => { setInstructions(e.target.value); setAuthorised(false); }} />
                </Field>
                <Field label="Internal note (not sent to the customer)">
                  <textarea className={cn(salesOrderControlClass, "h-auto min-h-24 py-2")} rows={3} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
                </Field>
              </SalesOrderSection>

              {quoteId ? (
                <p className="rounded-md border border-border bg-surface/50 p-3 text-[13px]">
                  This will accept quotation {workspace.quotes.find((quote) => quote.id === quoteId)?.quoteNumber} at its saved prices. It will not create a second order if that quotation is already converted.
                </p>
              ) : (
                <>
                  <div className="flex min-w-0 gap-2">
                    <input
                      ref={searchInputRef}
                      className={cn(salesOrderControlClass, "min-w-0 flex-1")}
                      value={productQuery}
                      onChange={(e) => setProductQuery(e.target.value)}
                      placeholder="Search SKU, name, or brand"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void searchProducts();
                      }}
                    />
                    <button type="button" onClick={() => void searchProducts()} className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-border px-4 text-[13px] font-bold uppercase">
                      Search
                    </button>
                  </div>
                  <SalesOrderProductResults
                    products={products}
                    disabled={addingProduct}
                    onSelect={(hit) => void addProduct(hit)}
                  />
                  <SalesOrderLines
                    lines={lines}
                    reviewLines={review?.lines ?? []}
                    priceDrafts={priceDrafts}
                    onQuantityChange={(variantId, raw) => {
                      const qty = parseStaffOrderQuantity(raw);
                      if (qty == null) return;
                      updateLine(variantId, { qty }, false);
                    }}
                    onQuantityBlur={() => void persist()}
                    onPriceDraftChange={(variantId, raw) =>
                      setPriceDrafts((current) => ({ ...current, [variantId]: raw }))
                    }
                    onClearPriceDraft={(variantId) =>
                      setPriceDrafts((current) => {
                        const next = { ...current };
                        delete next[variantId];
                        return next;
                      })
                    }
                    onPriceOverride={(variantId, override) => updateLine(variantId, { unitPriceOverride: override }, true)}
                    onRemove={(variantId) => {
                      const next = linesRef.current.filter((item) => item.variantId !== variantId);
                      setAuthorised(false);
                      commitLines(next);
                      void persist(next);
                    }}
                  />
                </>
              )}
              <button type="button" onClick={() => void persist()} className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-border px-4 text-[13px] font-bold uppercase sm:w-auto">
                Save and refresh prices
              </button>
            </>
          ) : null}
        </div>
        <SalesOrderReviewPanel
          companyName={workspace?.draft.companyName}
          paymentTerms={workspace?.draft.paymentTerms}
          poNumber={poNumber}
          subtotal={review?.totals.subtotal}
          deliveryTotal={review?.totals.deliveryTotal}
          vatTotal={review?.totals.vatTotal}
          grandTotal={review?.totals.grandTotal}
          blocking={Boolean(review?.hasBlockingIssues)}
          changes={priceChanges}
          totalsChanged={totalsChanged}
          previousGrandTotal={previousTotals?.grandTotal ?? null}
          acceptedPrices={acceptedPrices}
          authorised={authorised}
          placing={placing}
          placeDisabled={placing || !workspace || !authorised || (priceChanges.length > 0 && !acceptedPrices)}
          placeLabel={quoteId ? "Accept quotation" : "Place order"}
          onAcceptPrices={(checked) => {
            setAcceptedPrices(checked);
            setAuthorised(false);
            if (checked && workspace?.review) {
              setReviewed({
                fingerprint: currentFingerprint(),
                expectedReview: {
                  lines: workspace.review.lines.map((line) => ({
                    variantId: line.variantId,
                    qty: line.quantity,
                    customerUnitPrice: line.customerUnitPrice ?? "0.00",
                    lineNet: line.lineNet ?? "0.00",
                  })),
                  subtotal: workspace.review.totals.subtotal,
                  vatTotal: workspace.review.totals.vatTotal,
                  deliveryTotal: workspace.review.totals.deliveryTotal,
                  grandTotal: workspace.review.totals.grandTotal,
                },
              });
            }
          }}
          onAuthorised={setAuthorised}
          onPlace={() => void place()}
        />
      </div>
      {workspace ? (
        <SalesOrderMobileFooter
          total={review?.totals.grandTotal}
          priceWarning={priceWarning}
          hidden={typing}
          onReview={() => openSalesOrderReview()}
        />
      ) : null}
    </div>
  );
}
