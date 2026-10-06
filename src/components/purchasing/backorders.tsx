import { StatusBadge, type Tone } from "@/components/ab/Badges";
import {
  AUTOPART_216V_CHANGE_STATUS_LABEL,
  AUTOPART_216V_STOCK_POSITION_LABEL,
  type Autopart216vStockPosition,
} from "@/domain/autopart-216v-position";

export function changeStatusTone(
  status: keyof typeof AUTOPART_216V_CHANGE_STATUS_LABEL,
): Tone {
  if (status === "NEW") return "info";
  if (status === "QUANTITY_REDUCED") return "good";
  if (status === "QUANTITY_INCREASED") return "warn";
  if (status === "CLEARED") return "good";
  return "neutral";
}

export function stockPositionTone(position: Autopart216vStockPosition): Tone {
  if (position === "STOCK_AVAILABLE") return "good";
  if (position === "PART_STOCK_AVAILABLE") return "warn";
  if (position === "INCOMING_COVERS") return "info";
  if (position === "INCOMING_PART_COVERS") return "warn";
  if (position === "NO_STOCK_NO_INCOMING") return "bad";
  return "neutral";
}

export function ChangeStatusBadge({
  status,
  label,
}: {
  status: keyof typeof AUTOPART_216V_CHANGE_STATUS_LABEL;
  label: string;
}) {
  return <StatusBadge tone={changeStatusTone(status)}>{label}</StatusBadge>;
}

export function StockPositionBadge({
  position,
  label,
}: {
  position: Autopart216vStockPosition;
  label: string;
}) {
  return <StatusBadge tone={stockPositionTone(position)}>{label}</StatusBadge>;
}

export const BACKORDER_STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  ...Object.entries(AUTOPART_216V_CHANGE_STATUS_LABEL)
    .filter(([key]) => key !== "CLEARED")
    .map(([value, label]) => ({ value, label })),
];

export const BACKORDER_POSITION_FILTERS = [
  { value: "", label: "All stock positions" },
  ...Object.entries(AUTOPART_216V_STOCK_POSITION_LABEL).map(([value, label]) => ({ value, label })),
];

export const BACKORDER_AGE_FILTERS = [
  { value: "", label: "All ages" },
  { value: "1", label: "1+ day" },
  { value: "3", label: "3+ days" },
  { value: "7", label: "7+ days" },
  { value: "14", label: "14+ days" },
  { value: "30", label: "30+ days" },
];

export type BackorderSearch = {
  view?: "lines" | "sku" | "customer" | "attention";
  q?: string;
  status?: string;
  position?: string;
  ageDays?: number;
  customerAccount?: string;
  brand?: string;
  catalogueType?: "CATALOGUE" | "EXTERNAL" | "HISTORIC_ONLY";
  page?: number;
};

export function parseBackorderSearch(raw: Record<string, unknown>): BackorderSearch {
  const out: BackorderSearch = {};
  const str = (key: string) => {
    const value = raw[key];
    return typeof value === "string" && value ? value : null;
  };
  const view = str("view");
  if (view === "lines" || view === "sku" || view === "customer" || view === "attention") out.view = view;
  const q = str("q");
  if (q) out.q = q;
  const status = str("status");
  if (status) out.status = status;
  const position = str("position");
  if (position) out.position = position;
  const ageRaw = str("ageDays") ?? raw["ageDays"];
  const age = Number(ageRaw);
  if (age === 1 || age === 3 || age === 7 || age === 14 || age === 30) out.ageDays = age;
  const customerAccount = str("customerAccount");
  if (customerAccount) out.customerAccount = customerAccount;
  const brand = str("brand");
  if (brand) out.brand = brand;
  const catalogueType = str("catalogueType");
  if (catalogueType === "CATALOGUE" || catalogueType === "EXTERNAL" || catalogueType === "HISTORIC_ONLY") {
    out.catalogueType = catalogueType;
  }
  const pageRaw = raw["page"];
  const page = typeof pageRaw === "number" ? pageRaw : Number(pageRaw);
  if (Number.isFinite(page) && page > 1) out.page = Math.trunc(page);
  return out;
}

export type BackorderSearchPatch = { [K in keyof BackorderSearch]?: BackorderSearch[K] | undefined };

export function mergeBackorderSearch(prev: BackorderSearch, next: BackorderSearchPatch): BackorderSearch {
  const merged: BackorderSearch = { ...prev };
  (Object.keys(next) as Array<keyof BackorderSearch>).forEach((key) => {
    const value = next[key];
    if (value === undefined || value === "") {
      delete merged[key];
      return;
    }
    (merged as Record<string, unknown>)[key] = value;
  });
  if (merged.page === 1) delete merged.page;
  if (merged.view === "lines") delete merged.view;
  return merged;
}
