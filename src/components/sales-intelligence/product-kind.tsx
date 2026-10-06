import { productKindQualifier } from "@/domain/autopart-product";

export function siKindQualifier(
  kind: string | null | undefined,
  brandName?: string | null,
  kindLabel?: string | null,
): string {
  if (kindLabel && kind && kind !== "CATALOGUE") return kindLabel;
  return productKindQualifier(kind, brandName);
}

export function SiSkuMeta({
  sku,
  brandName,
  productKind,
  productKindLabel,
}: {
  sku: string;
  brandName?: string | null;
  productKind?: string | null;
  productKindLabel?: string | null;
}) {
  const qualifier = siKindQualifier(productKind, brandName, productKindLabel);
  return (
    <span className="font-mono text-[11px] text-steel">
      {sku}
      {qualifier ? ` · ${qualifier}` : ""}
    </span>
  );
}

export function SiInternalStockLines({
  productKind,
  availLine,
  incomingLine,
}: {
  productKind?: string | null;
  availLine?: string | null;
  incomingLine?: string | null;
}) {
  if (productKind === "HISTORIC_ONLY") return null;
  if (!availLine && !incomingLine) return null;
  return (
    <div className="mt-0.5 text-[11px] text-steel">
      {availLine ? <div>{availLine}</div> : null}
      {incomingLine ? <div>{incomingLine}</div> : null}
    </div>
  );
}
