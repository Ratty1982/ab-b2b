import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/ab/AppShell";
import { Field, inputClass } from "@/components/ab/Drawer";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import {
  getCheckoutContextFn,
  placeOrderFn,
  previewCheckoutFn,
} from "@/server/phase2/fns";

export const Route = createFileRoute("/portal/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout — Automotive Brands Trade Portal" },
      { name: "description", content: "Review delivery details and place your trade order." },
    ],
  }),
  component: CheckoutPage,
});

type CheckoutCtx = Extract<Awaited<ReturnType<typeof getCheckoutContextFn>>, { ok: true }>["data"];
type Review = Extract<Awaited<ReturnType<typeof previewCheckoutFn>>, { ok: true }>["data"];

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `ck-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function CheckoutPage() {
  const navigate = useNavigate();
  const formId = useId();
  const [ctx, setCtx] = useState<CheckoutCtx | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addressId, setAddressId] = useState<string>("");
  const [useOneOff, setUseOneOff] = useState(false);
  const [oneOff, setOneOff] = useState({
    contactName: "",
    line1: "",
    line2: "",
    town: "",
    county: "",
    postcode: "",
    country: "GB",
  });
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [placing, setPlacing] = useState(false);
  const [idempotencyKey] = useState(newIdempotencyKey);

  const load = useCallback(async () => {
    const result = await getCheckoutContextFn();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setCtx(result.data);
    setAddressId(result.data.defaultAddressId ?? result.data.addresses[0]?.id ?? "");
    setContactName(result.data.contact.name);
    setContactPhone(result.data.contact.phone ?? "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const expectedLinePrices = useMemo(() => {
    if (review?.lines?.length) {
      return review.lines
        .filter((l) => l.customerUnitPrice)
        .map((l) => ({
          variantId: l.variantId,
          customerUnitPrice: l.customerUnitPrice!,
        }));
    }
    return (ctx?.basket.lines ?? [])
      .filter((l) => l.unitPriceExVatDisplay)
      .map((l) => ({
        variantId: l.variantId,
        customerUnitPrice: l.unitPriceExVatDisplay!,
      }));
  }, [review, ctx]);

  async function runPreview() {
    const draft = {
      addressId: useOneOff ? null : addressId || null,
      oneOffAddress: useOneOff
        ? {
            ...oneOff,
            contactName: oneOff.contactName || contactName || null,
            contactPhone: contactPhone || null,
            label: null,
          }
        : null,
      contact: { name: contactName || null, phone: contactPhone || null },
      poNumber: poNumber || null,
      deliveryInstructions: deliveryInstructions || null,
    };
    const result = await previewCheckoutFn({ data: draft });
    if (!result.ok) {
      toast.error(result.error);
      return null;
    }
    setReview(result.data);
    return result.data;
  }

  async function onPlace(e: FormEvent) {
    e.preventDefault();
    if (placing) return;
    setPlacing(true);
    try {
      const preview = await runPreview();
      if (!preview) return;
      if (preview.hasBlockingIssues) {
        toast.error("Resolve basket issues before placing the order.");
        return;
      }
      const payload = {
        idempotencyKey,
        addressId: useOneOff ? null : addressId || null,
        oneOffAddress: useOneOff
          ? {
              ...oneOff,
              contactName: oneOff.contactName || contactName || null,
              contactPhone: contactPhone || null,
              label: null,
            }
          : null,
        contact: { name: contactName || null, phone: contactPhone || null },
        poNumber: poNumber || null,
        deliveryInstructions: deliveryInstructions || null,
        expectedLinePrices:
          preview.lines
            .filter((l) => l.customerUnitPrice)
            .map((l) => ({
              variantId: l.variantId,
              customerUnitPrice: l.customerUnitPrice!,
            })) ?? expectedLinePrices,
      };
      const result = await placeOrderFn({ data: payload });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (!result.data.ok) {
        setReview(result.data.review);
        toast.error("Prices or stock changed — please review before placing the order.");
        return;
      }
      toast.success(`Order ${result.data.order.orderNumber} received`);
      await navigate({
        to: "/portal/orders/$orderId/confirmation",
        params: { orderId: result.data.order.id },
      });
    } finally {
      setPlacing(false);
    }
  }

  if (error) {
    return (
      <div>
        <PanelHeader title="Checkout" sub="Trade account ordering" />
        <p className="p-6 text-sm text-bad">{error}</p>
        <Link to={ROUTES.portalBasket} className="ml-6 text-[13px] font-semibold text-primary">
          Back to basket
        </Link>
      </div>
    );
  }

  if (!ctx) {
    return (
      <div>
        <PanelHeader title="Checkout" sub="Trade account ordering" />
        <p className="p-6 text-[13px] text-steel">Loading checkout…</p>
      </div>
    );
  }

  if (ctx.basket.lineCount === 0) {
    return (
      <div>
        <PanelHeader title="Checkout" sub={ctx.companyName} />
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <h2 className="font-display text-2xl font-semibold uppercase">Basket is empty</h2>
          <Link
            to={ROUTES.products}
            className="mt-6 inline-flex h-11 items-center rounded-md bg-primary px-5 text-[12px] font-bold uppercase text-primary-foreground"
          >
            Browse products
          </Link>
        </div>
      </div>
    );
  }

  const lines = review?.lines ??
    ctx.basket.lines.map((l) => ({
      variantId: l.variantId,
      sku: l.sku,
      name: l.name,
      quantity: l.quantity,
      customerUnitPrice: l.unitPriceExVatDisplay,
      customerUnitPriceDisplay: l.unitPriceExVatDisplay,
      lineNet: l.lineNetDisplay,
      issue: (l.issue === "VALID" ? "VALID" : "QUANTITY_INVALID") as "VALID" | "QUANTITY_INVALID",
      issueMessage: l.issue === "VALID" ? null : "Review this line before placing the order",
      orderingMode: (l.isFinalPartCase ? "FINAL_PART_CASE" : "CASE") as
        | "CASE"
        | "FINAL_PART_CASE",
    }));
  const totals = review?.totals ?? {
    subtotal: ctx.basket.totals.netDisplay,
    vatTotal: ctx.basket.totals.vatDisplay,
    deliveryTotal: "0.00",
    grandTotal: ctx.basket.totals.grossDisplay,
  };
  const blocking = review?.hasBlockingIssues ?? ctx.basket.hasBlockingIssues;

  return (
    <div>
      <PanelHeader title="Checkout" sub={`${ctx.companyName} · Trade Account`} />
      <form id={formId} onSubmit={(e) => void onPlace(e)} className="p-4 sm:p-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-8">
            <section className="rounded-lg border border-border bg-surface/30 p-5">
              <h2 className="font-display text-lg font-semibold uppercase">Delivery details</h2>
              {!useOneOff ? (
                <div className="mt-4 space-y-3">
                  {ctx.addresses.length === 0 ? (
                    <p className="text-[13px] text-warn">No saved delivery addresses — enter one below.</p>
                  ) : (
                    ctx.addresses.map((a) => (
                      <label
                        key={a.id}
                        className={cn(
                          "flex cursor-pointer gap-3 rounded-md border p-3 text-[13px]",
                          addressId === a.id ? "border-primary bg-primary/5" : "border-border",
                        )}
                      >
                        <input
                          type="radio"
                          name="address"
                          checked={addressId === a.id}
                          onChange={() => setAddressId(a.id)}
                          className="mt-1"
                        />
                        <span>
                          <span className="font-semibold">{a.label || a.line1}</span>
                          <br />
                          {a.line1}
                          {a.line2 ? `, ${a.line2}` : ""}
                          <br />
                          {a.town}
                          {a.county ? `, ${a.county}` : ""} {a.postcode}
                        </span>
                      </label>
                    ))
                  )}
                  <button
                    type="button"
                    className="text-[12px] font-semibold text-primary"
                    onClick={() => setUseOneOff(true)}
                  >
                    Use a different delivery address
                  </button>
                </div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Field label="Recipient / company">
                    <input
                      className={inputClass}
                      value={oneOff.contactName}
                      onChange={(e) => setOneOff({ ...oneOff, contactName: e.target.value })}
                    />
                  </Field>
                  <Field label="Postcode">
                    <input
                      required
                      className={inputClass}
                      value={oneOff.postcode}
                      onChange={(e) => setOneOff({ ...oneOff, postcode: e.target.value })}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Address line 1">
                      <input
                        required
                        className={inputClass}
                        value={oneOff.line1}
                        onChange={(e) => setOneOff({ ...oneOff, line1: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field label="Address line 2">
                    <input
                      className={inputClass}
                      value={oneOff.line2}
                      onChange={(e) => setOneOff({ ...oneOff, line2: e.target.value })}
                    />
                  </Field>
                  <Field label="Town / city">
                    <input
                      required
                      className={inputClass}
                      value={oneOff.town}
                      onChange={(e) => setOneOff({ ...oneOff, town: e.target.value })}
                    />
                  </Field>
                  <Field label="County">
                    <input
                      className={inputClass}
                      value={oneOff.county}
                      onChange={(e) => setOneOff({ ...oneOff, county: e.target.value })}
                    />
                  </Field>
                  <button
                    type="button"
                    className="text-left text-[12px] font-semibold text-primary sm:col-span-2"
                    onClick={() => setUseOneOff(false)}
                  >
                    Use a saved address instead
                  </button>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-border bg-surface/30 p-5">
              <h2 className="font-display text-lg font-semibold uppercase">Contact</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <input
                    required
                    className={inputClass}
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                  />
                </Field>
                <Field label="Telephone">
                  <input
                    className={inputClass}
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                  />
                </Field>
                <p className="text-[12px] text-steel sm:col-span-2">
                  Confirmation email: {ctx.contact.email}
                </p>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-surface/30 p-5">
              <h2 className="font-display text-lg font-semibold uppercase">Your reference</h2>
              <div className="mt-4 grid gap-3">
                <Field label="PO / reference (optional)">
                  <input
                    className={inputClass}
                    maxLength={80}
                    value={poNumber}
                    onChange={(e) => setPoNumber(e.target.value)}
                    placeholder="e.g. PO-18472"
                  />
                </Field>
                <Field label="Delivery instructions (optional)">
                  <textarea
                    className={cn(inputClass, "min-h-[88px]")}
                    maxLength={500}
                    value={deliveryInstructions}
                    onChange={(e) => setDeliveryInstructions(e.target.value)}
                    placeholder="e.g. Deliver to rear goods entrance."
                  />
                </Field>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-surface/30 p-5">
              <h2 className="font-display text-lg font-semibold uppercase">Order review</h2>
              <ul className="mt-4 divide-y divide-border/60">
                {lines.map((line) => (
                  <li
                    key={line.variantId}
                    className="flex flex-wrap items-start justify-between gap-3 py-3 text-[13px]"
                  >
                    <div>
                      <p className="font-semibold">{line.name}</p>
                      <p className="text-steel">
                        {line.sku} · Qty {line.quantity}
                        {line.orderingMode === "FINAL_PART_CASE" ? " · Final part case" : ""}
                      </p>
                      {line.issue !== "VALID" && line.issueMessage ? (
                        <p className="mt-1 font-medium text-warn">{line.issueMessage}</p>
                      ) : null}
                      {line.issue === "PRICE_UPDATED" ? (
                        <p className="mt-1 font-medium text-warn">Price updated — review new unit price</p>
                      ) : null}
                    </div>
                    <div className="text-right">
                      {(line.customerUnitPriceDisplay || line.customerUnitPrice) ? (
                        <p className="num text-steel">
                          £{line.customerUnitPriceDisplay || line.customerUnitPrice} each ex VAT
                        </p>
                      ) : null}
                      {line.lineNet ? <p className="num font-semibold">£{line.lineNet}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="h-fit rounded-lg border border-border bg-surface/40 p-5 lg:sticky lg:top-24">
            <h2 className="font-display text-lg font-semibold uppercase">Order summary</h2>
            <dl className="mt-4 space-y-2 text-[14px]">
              <div className="flex justify-between gap-3">
                <dt className="text-steel">Goods ex VAT</dt>
                <dd className="num font-semibold">£{totals.subtotal}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-steel">Delivery</dt>
                <dd className="text-right text-[12px] text-steel">
                  Confirmed to your trade account terms
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-steel">VAT</dt>
                <dd className="num font-semibold">£{totals.vatTotal}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-border pt-2 text-base">
                <dt className="font-semibold">Total inc VAT</dt>
                <dd className="num font-semibold">£{totals.grandTotal}</dd>
              </div>
            </dl>
            {ctx.paymentTerms ? (
              <p className="mt-3 text-[12px] text-steel">Payment terms: {ctx.paymentTerms}</p>
            ) : (
              <p className="mt-3 text-[12px] text-steel">Payment terms: as agreed on your trade account</p>
            )}
            {blocking ? (
              <p className="mt-4 text-[13px] font-medium text-warn" role="status">
                Resolve review issues before placing the order.
              </p>
            ) : null}
            <button
              type="submit"
              disabled={placing || blocking || !ctx.canPlaceOrder}
              className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary text-[12px] font-bold uppercase text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {placing ? "Placing order…" : "Place order"}
            </button>
            <Link
              to={ROUTES.portalBasket}
              className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-md border border-border text-[12px] font-bold uppercase"
            >
              Back to basket
            </Link>
          </aside>
        </div>
      </form>
    </div>
  );
}
