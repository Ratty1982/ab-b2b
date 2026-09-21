import type { ProductSellingContent, SpecRow } from "@/domain/product-specifications";

export function sanitizeStringList(items: string[] | null | undefined, max = 240): string[] {
  if (!items?.length) return [];
  return items.map((item) => item.trim().slice(0, max)).filter(Boolean);
}

export function moveListItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

export function emptyToNull(value: string | null | undefined, max = 4000): string | null {
  const trimmed = value?.trim().slice(0, max) ?? "";
  return trimmed ? trimmed : null;
}

export function sanitizeSpecRows(rows: SpecRow[] | null | undefined): SpecRow[] {
  if (!rows?.length) return [];
  return rows
    .map((row) => ({ name: row.name.trim().slice(0, 80), value: row.value.trim().slice(0, 240) }))
    .filter((row) => row.name && row.value);
}

export function sellingFromDraft(input: {
  keyBenefits?: string[];
  features?: string[];
  applications?: string[];
  directions?: string | null;
  warnings?: string | null;
}): ProductSellingContent {
  return {
    keyBenefits: sanitizeStringList(input.keyBenefits),
    features: sanitizeStringList(input.features),
    applications: sanitizeStringList(input.applications),
    directions: emptyToNull(input.directions),
    warnings: emptyToNull(input.warnings),
  };
}
