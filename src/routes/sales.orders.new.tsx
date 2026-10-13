import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import { CreateSalesOrderDesk } from "@/components/orders/CreateSalesOrderDesk";
import { SalesOrderProductResults } from "@/components/orders/SalesOrderProductResults";
import {
  applySalesOrderProductAdd,
  parseStaffOrderQuantity,
  parseStaffOrderUnitPrice,
  SALES_ORDER_SOURCE_LABEL,
  type SalesOrderDraftLineInput,
} from "@/domain/sales-order-entry";
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
  return (
    <div>
      <PanelHeader
        title={workspace ? workspace.draft.companyName : "Create Sales Order"}
        sub={
          workspace?.assignedSalesRep
            ? `Assigned representative: ${workspace.assignedSalesRep.name}. Prices are resolved for this customer. You are recorded as the person who places the order.`
            : "No representative is assigned to this account. Prices are resolved for this customer. You are recorded as the person who places the order."
        }
        actions={
          <Link to={ROUTES.salesOrders} className="text-[13px] font-semibold text-primary">
            Open drafts
          </Link>
        }
      />
      <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_320px] sm:p-6">
        <div className="space-y-5">
          {error ? <p className="text-sm text-bad">{error}</p> : null}
          {!workspace && !error ? <p className="text-[13px] text-steel">Loading customer…</p> : null}
          {workspace ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Order source">
                  <select className={inputClass} value={source} onChange={(e) => { setSource(e.target.value); setAuthorised(false); }}>
                    {Object.entries(SALES_ORDER_SOURCE_LABEL).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Customer contact">
                  <select className={inputClass} value={contactId} onChange={(e) => { setContactId(e.target.value); setAuthorised(false); }}>
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
                  <input className={inputClass} value={poNumber} onChange={(e) => { setPoNumber(e.target.value); setAuthorised(false); }} />
                </Field>
                {workspace.quotes.length > 0 ? (
                  <Field label="Use an existing quotation">
                    <select className={inputClass} value={quoteId} onChange={(e) => { setQuoteId(e.target.value); setAuthorised(false); }}>
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
              <Field label="Delivery">
                <label className="mb-2 flex items-center gap-2 text-[13px]">
                  <input type="checkbox" checked={useOneOff} onChange={(e) => { setUseOneOff(e.target.checked); setAuthorised(false); }} />
                  One-off delivery address
                </label>
                {useOneOff ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className={inputClass} placeholder="Address line 1" value={oneOff.line1} onChange={(e) => { setOneOff({ ...oneOff, line1: e.target.value }); setAuthorised(false); }} />
                    <input className={inputClass} placeholder="Address line 2" value={oneOff.line2} onChange={(e) => { setOneOff({ ...oneOff, line2: e.target.value }); setAuthorised(false); }} />
                    <input className={inputClass} placeholder="Town" value={oneOff.town} onChange={(e) => { setOneOff({ ...oneOff, town: e.target.value }); setAuthorised(false); }} />
                    <input className={inputClass} placeholder="County" value={oneOff.county} onChange={(e) => { setOneOff({ ...oneOff, county: e.target.value }); setAuthorised(false); }} />
                    <input className={inputClass} placeholder="Postcode" value={oneOff.postcode} onChange={(e) => { setOneOff({ ...oneOff, postcode: e.target.value }); setAuthorised(false); }} />
                  </div>
                ) : (
                  <select className={inputClass} value={addressId} onChange={(e) => { setAddressId(e.target.value); setAuthorised(false); }}>
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
                <input className={inputClass} value={instructions} onChange={(e) => { setInstructions(e.target.value); setAuthorised(false); }} />
              </Field>
              <Field label="Internal note (not sent to the customer)">
                <textarea className={inputClass} rows={2} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
              </Field>

              {quoteId ? (
                <p className="rounded-md border border-border bg-surface/50 p-3 text-[13px]">
                  This will accept quotation {workspace.quotes.find((quote) => quote.id === quoteId)?.quoteNumber} at its saved prices. It will not create a second order if that quotation is already converted.
                </p>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input
                      ref={searchInputRef}
                      className={inputClass}
                      value={productQuery}
                      onChange={(e) => setProductQuery(e.target.value)}
                      placeholder="Search SKU, name, or brand"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void searchProducts();
                      }}
                    />
                    <button type="button" onClick={() => void searchProducts()} className="h-10 shrink-0 rounded-md border border-border px-4 text-[12px] font-bold uppercase">
                      Search
                    </button>
                  </div>
                  <SalesOrderProductResults
                    products={products}
                    disabled={addingProduct}
                    onSelect={(hit) => void addProduct(hit)}
                  />
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[640px] text-[13px]">
                      <thead>
                        <tr className="border-b border-border bg-surface/60 text-left text-[10px] uppercase text-steel">
                          <th className="px-3 py-2">Product</th>
                          <th className="px-3 py-2">Qty</th>
                          <th className="px-3 py-2">Price</th>
                          <th className="px-3 py-2">Stock</th>
                          <th className="px-3 py-2 text-right">Line</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((line) => {
                          const priced = review?.lines.find((item) => item.variantId === line.variantId);
                          return (
                            <tr key={line.variantId} className="border-b border-border/60">
                              <td className="px-3 py-2">
                                <p className="font-medium">{line.sku}</p>
                                <p className="text-steel">{line.name}</p>
                                {priced?.promotionCode ? <p className="text-steel">Promo {priced.promotionCode}</p> : null}
                                {priced?.issue !== "VALID" && priced?.issueMessage ? (
                                  <p className="text-bad">{priced.issueMessage}</p>
                                ) : null}
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  className={`${inputClass} w-20`}
                                  type="number"
                                  inputMode="numeric"
                                  min={1}
                                  step={1}
                                  value={line.qty}
                                  onChange={(e) => {
                                    const qty = parseStaffOrderQuantity(e.target.value);
                                    if (qty == null) return;
                                    updateLine(line.variantId, { qty }, false);
                                  }}
                                  onBlur={() => void persist()}
                                />
                                {priced?.caseQty ? <p className="text-[11px] text-steel">Case {priced.caseQty}</p> : null}
                              </td>
                              <td className="px-3 py-2">
                                <label className="block text-[11px] text-steel">
                                  {line.unitPriceOverride ? "Manual price ex VAT" : "Unit price ex VAT"}
                                  <input
                                    className={`${inputClass} mt-1 w-24 ${line.unitPriceOverride ? "border-primary" : ""}`}
                                    inputMode="decimal"
                                    aria-label={`Unit price for ${line.sku}`}
                                    value={
                                      priceDrafts[line.variantId] ??
                                      line.unitPriceOverride ??
                                      priced?.resolvedUnitPrice ??
                                      priced?.customerUnitPrice ??
                                      ""
                                    }
                                    onChange={(e) =>
                                      setPriceDrafts((current) => ({
                                        ...current,
                                        [line.variantId]: e.target.value,
                                      }))
                                    }
                                    onBlur={() => {
                                      const raw = priceDrafts[line.variantId];
                                      if (raw == null) return;
                                      const parsed = parseStaffOrderUnitPrice(raw);
                                      if (!parsed) {
                                        toast.error("Enter a unit price in pounds and pence, excluding VAT");
                                        setPriceDrafts((current) => {
                                          const next = { ...current };
                                          delete next[line.variantId];
                                          return next;
                                        });
                                        return;
                                      }
                                      const resolved =
                                        priced?.resolvedUnitPrice ?? priced?.customerUnitPrice ?? null;
                                      const override = resolved != null && parsed === resolved ? null : parsed;
                                      setPriceDrafts((current) => {
                                        const next = { ...current };
                                        delete next[line.variantId];
                                        return next;
                                      });
                                      updateLine(line.variantId, { unitPriceOverride: override }, true);
                                    }}
                                  />
                                </label>
                                {line.unitPriceOverride ? (
                                  <button
                                    type="button"
                                    className="mt-1 text-[11px] font-semibold text-primary"
                                    onClick={() => {
                                      setPriceDrafts((current) => {
                                        const next = { ...current };
                                        delete next[line.variantId];
                                        return next;
                                      });
                                      updateLine(line.variantId, { unitPriceOverride: null }, true);
                                    }}
                                  >
                                    Use customer price
                                    {priced?.resolvedUnitPrice ? ` ${money(priced.resolvedUnitPrice)}` : ""}
                                  </button>
                                ) : priced?.priceSource ? (
                                  <p className="text-[11px] text-steel">{priced.priceSource}</p>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-steel">
                                {priced ? `${priced.availableQtyAtOrder} available` : "—"}
                                {priced && priced.backorderQtyAtOrder > 0 ? (
                                  <p>{priced.backorderQtyAtOrder} backorder{priced.backordersAllowed ? "" : " blocked"}</p>
                                ) : null}
                              </td>
                              <td className="num px-3 py-2 text-right">{money(priced?.lineNet)}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  className="text-[12px] font-semibold text-steel"
                                  onClick={() => {
                                    const next = linesRef.current.filter((item) => item.variantId !== line.variantId);
                                    setAuthorised(false);
                                    commitLines(next);
                                    void persist(next);
                                  }}
                                >
                                  Remove
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <button type="button" onClick={() => void persist()} className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase">
                Save and refresh prices
              </button>
            </>
          ) : null}
        </div>
        <aside className="h-fit space-y-3 rounded-lg border border-border p-4 text-[13px]">
          <h2 className="font-display text-base uppercase">Order review</h2>
          <p>{workspace?.draft.companyName}</p>
          <p className="text-steel">Payment terms: {workspace?.draft.paymentTerms || "As agreed"}</p>
          <p className="text-steel">PO: {poNumber || "—"}</p>
          <p>Net {money(review?.totals.subtotal)}</p>
          <p>Delivery {money(review?.totals.deliveryTotal)}</p>
          <p>VAT {money(review?.totals.vatTotal)}</p>
          <p className="text-base font-semibold">Total {money(review?.totals.grandTotal)}</p>
          {review?.hasBlockingIssues ? (
            <p className="text-bad">Resolve the line issues shown before placing the order.</p>
          ) : null}
          {priceChanges.length > 0 || totalsChanged ? (
            <div className="space-y-2 rounded-md border border-bad/40 bg-bad/5 p-3">
              <p className="font-semibold text-bad">Review these changes before placing the order.</p>
              {priceChanges.map((change) => (
                <p key={change.variantId}>
                  {change.sku}: {money(change.previousUnitPrice)} becomes {money(change.newUnitPrice)}
                  {change.previousLineNet !== change.newLineNet
                    ? ` (line ${money(change.previousLineNet)} becomes ${money(change.newLineNet)})`
                    : ""}
                </p>
              ))}
              {totalsChanged && previousTotals ? (
                <p>
                  Order total {money(previousTotals.grandTotal)} becomes {money(review?.totals.grandTotal)}. This includes VAT and delivery.
                </p>
              ) : null}
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={acceptedPrices}
                  onChange={(e) => {
                    const checked = e.target.checked;
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
                  className="mt-1"
                />
                <span>I have reviewed the updated prices and totals.</span>
              </label>
            </div>
          ) : (
            <p className="text-steel">Place order uses the prices shown here. A later price change stops the order for review.</p>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} className="mt-1" />
            <span>I am authorised to submit this order on the customer’s behalf.</span>
          </label>
          <button
            type="button"
            disabled={placing || !workspace || !authorised || (priceChanges.length > 0 && !acceptedPrices)}
            onClick={() => void place()}
            className="h-11 w-full rounded-md bg-primary text-[13px] font-bold uppercase text-primary-foreground disabled:opacity-50"
          >
            {placing ? "Placing…" : quoteId ? "Accept quotation" : "Place order"}
          </button>
        </aside>
      </div>
    </div>
  );
}
