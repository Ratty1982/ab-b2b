export type SalesOrderProductResult = {
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

export function SalesOrderProductResults({
  products,
  disabled,
  onSelect,
}: {
  products: SalesOrderProductResult[];
  disabled: boolean;
  onSelect: (hit: SalesOrderProductResult) => void;
}) {
  if (products.length === 0) return null;
  return (
    <ul className="min-w-0 divide-y divide-border rounded-lg border border-border">
      {products.map((hit) => (
        <li key={hit.variantId}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(hit)}
            className="flex min-h-11 w-full min-w-0 items-start justify-between gap-3 px-3 py-2 text-left text-[13px] break-words hover:bg-surface/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary disabled:opacity-60"
            aria-label={`Add ${hit.sku} to the order`}
          >
            <span>
              <span className="block font-medium">
                {hit.sku} · {hit.name}
              </span>
              <span className="block text-steel">
                {hit.brand}
                {hit.caseQty ? ` · Case ${hit.caseQty}` : ""}
                {hit.minOrderQty > 1 ? ` · Min ${hit.minOrderQty}` : ""}
                {` · Stock ${hit.sellableQty}`}
                {hit.backordersAllowed ? " · Backorder allowed" : " · No backorder"}
                {hit.customerUnitPrice ? ` · ${money(hit.customerUnitPrice)}` : ""}
                {hit.promotionCode ? ` · Promo ${hit.promotionCode}` : ""}
                {hit.priceSource ? ` · ${hit.priceSource}` : ""}
              </span>
              {hit.issue !== "VALID" && hit.issueMessage ? (
                <span className="block text-bad">{hit.issueMessage}</span>
              ) : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
