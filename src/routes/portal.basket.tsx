import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/ab/AppShell";
import { AvailabilityBadge } from "@/components/ab/AvailabilityBadge";
import { ROUTES } from "@/lib/app-nav";
import { cn } from "@/lib/utils";
import {
  getBasketFn,
  removeBasketItemFn,
  updateBasketItemFn,
} from "@/server/phase2/fns";
import { ProductImage } from "@/components/public/ProductImage";

export const Route = createFileRoute("/portal/basket")({
  head: () => ({
    meta: [
      { title: "Basket — Automotive Brands Trade Portal" },
      { name: "description", content: "Your trade basket with live case-quantity pricing." },
    ],
  }),
  component: BasketPage,
});

type Basket = Extract<Awaited<ReturnType<typeof getBasketFn>>, { ok: true }>["data"];

function BasketPage() {
  const [basket, setBasket] = useState<Basket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getBasketFn();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setBasket(result.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeQty(itemId: string, quantity: number) {
    setBusyId(itemId);
    const result = await updateBasketItemFn({ data: { itemId, quantity } });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setBasket(result.data);
  }

  async function remove(itemId: string) {
    setBusyId(itemId);
    const result = await removeBasketItemFn({ data: { itemId } });
    setBusyId(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setBasket(result.data);
    toast.success("Removed from basket");
  }

  if (error) {
    return (
      <div>
        <PanelHeader title="Basket" sub="Trade ordering" />
        <p className="p-6 text-sm text-bad">{error}</p>
      </div>
    );
  }

  if (!basket) {
    return (
      <div>
        <PanelHeader title="Basket" sub="Trade ordering" />
        <p className="p-6 text-[13px] text-steel">Loading basket…</p>
      </div>
    );
  }

  if (basket.lineCount === 0) {
    return (
      <div>
        <PanelHeader title="Basket" sub="Trade ordering" />
        <div className="mx-auto max-w-lg px-4 py-16 text-center sm:px-6">
          <h2 className="font-display text-2xl font-semibold uppercase">Your basket is empty</h2>
          <p className="mt-2 text-[14px] text-steel">Browse the trade catalogue to add case multiples.</p>
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

  return (
    <div>
      <PanelHeader
        title="Basket"
        sub={`${basket.lineCount} line${basket.lineCount === 1 ? "" : "s"} · ${basket.unitCount} units · ${basket.companyName}`}
      />
      <div className="grid gap-8 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ul className="space-y-4">
          {basket.lines.map((line) => (
            <li
              key={line.id}
              className={cn(
                "grid gap-4 rounded-lg border border-border bg-surface/30 p-4 sm:grid-cols-[6rem_minmax(0,1fr)]",
                line.issue !== "VALID" && "border-warn/50",
              )}
            >
              <div className="mx-auto w-24 sm:mx-0 sm:w-auto">
                <ProductImage src={line.imageSrc} alt={line.name} layout="card" />
              </div>
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to="/products/$sku"
                      params={{ sku: line.productSlug }}
                      className="font-display text-base font-semibold uppercase hover:underline"
                    >
                      {line.name}
                    </Link>
                    <p className="num mt-1 text-[12px] text-steel">{line.sku}</p>
                    {line.caseTitle ? <p className="mt-1 text-[12px] text-steel">{line.caseTitle}</p> : null}
                  </div>
                  {line.availability ? <AvailabilityBadge availability={line.availability} /> : null}
                </div>
                {line.issueMessage ? (
                  <p className="text-[13px] font-medium text-warn" role="status">
                    {line.issueMessage}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">Quantity</p>
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        type="button"
                        className="inline-grid size-9 place-items-center rounded-md border border-border disabled:opacity-40"
                        aria-label="Decrease quantity"
                        disabled={
                          busyId === line.id ||
                          !line.canDecrement ||
                          line.quantityStep == null
                        }
                        onClick={() => {
                          if (line.quantityStep == null) return;
                          void changeQty(line.id, line.quantity - line.quantityStep);
                        }}
                      >
                        <Minus className="size-3.5" aria-hidden />
                      </button>
                      <span className="num min-w-10 text-center font-semibold">{line.quantity}</span>
                      <button
                        type="button"
                        className="inline-grid size-9 place-items-center rounded-md border border-border disabled:opacity-40"
                        aria-label="Increase quantity"
                        disabled={
                          busyId === line.id ||
                          !line.canIncrement ||
                          line.quantityStep == null
                        }
                        onClick={() => {
                          if (line.quantityStep == null) return;
                          void changeQty(line.id, line.quantity + line.quantityStep);
                        }}
                      >
                        <Plus className="size-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="ml-2 inline-flex items-center gap-1 text-[12px] font-semibold text-steel hover:text-bad"
                        aria-label="Remove item"
                        disabled={busyId === line.id}
                        onClick={() => void remove(line.id)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                        Remove
                      </button>
                    </div>
                    {line.caseCountLabel ? (
                      <p className="mt-1 text-[12px] text-steel">
                        {line.caseCountLabel} · {line.quantity} units
                      </p>
                    ) : line.isFinalPartCase ? (
                      <p className="mt-1 text-[12px] text-amber-800 dark:text-amber-200">
                        {line.quantity === 1 ? "1 unit" : `${line.quantity} units`} · final stock
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    {line.unitPriceExVatDisplay ? (
                      <p className="num text-[12px] text-steel">£{line.unitPriceExVatDisplay} each ex VAT</p>
                    ) : null}
                    {line.lineNetDisplay ? (
                      <p className="num text-lg font-semibold">£{line.lineNetDisplay}</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className="h-fit rounded-lg border border-border bg-surface/40 p-5">
          <h2 className="font-display text-lg font-semibold uppercase">Summary</h2>
          <dl className="mt-4 space-y-2 text-[14px]">
            <div className="flex justify-between gap-3">
              <dt className="text-steel">Subtotal ex VAT</dt>
              <dd className="num font-semibold">£{basket.totals.netDisplay}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-steel">VAT</dt>
              <dd className="num font-semibold">£{basket.totals.vatDisplay}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-2 text-base">
              <dt className="font-semibold">Total inc VAT</dt>
              <dd className="num font-semibold">£{basket.totals.grossDisplay}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[12px] text-steel">Prices exclude VAT unless otherwise stated.</p>
          {basket.hasBlockingIssues ? (
            <p className="mt-3 text-[13px] font-medium text-warn" role="status">
              Resolve quantity or product issues before checkout (coming in Phase 6B).
            </p>
          ) : (
            <p className="mt-3 text-[13px] text-steel">Checkout is not available yet.</p>
          )}
          <Link
            to={ROUTES.products}
            className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-md border border-border text-[12px] font-bold uppercase"
          >
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}
