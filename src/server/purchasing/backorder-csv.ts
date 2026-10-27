/**
 * CSV for the purchasing backorders page.
 * Columns follow the lines (and movement) tables, then fields that are on the
 * line but truncated or only shown when a row is opened. Condition stays last.
 */

import {
  autopart216vPositionHeadline,
  type Autopart216vStockPosition,
} from "@/domain/autopart-216v-position";
import {
  AUTOPART_216V_MOVEMENT_LABEL,
  type Autopart216vMovement,
} from "@/domain/autopart-216v-movement";
import { formatDate, formatOperationalDateTime } from "@/lib/datetime";

export const BACKORDER_LINE_CSV_HEADERS = [
  "Status",
  "Age",
  "First Seen",
  "Order No",
  "Customer",
  "Customer Account",
  "Customer Order Ref",
  "Description",
  "Product Type",
  "SKU",
  "Outstanding Qty",
  "Unit Value",
  "Outstanding Value",
  "Available",
  "Incoming",
  "Stock Position",
  "Cover",
  "Last Changed",
  "Mapped Company",
  "Unmapped Account",
  "Brand",
  "Previous Qty",
  "Last Seen",
  "Physical",
  "Stock Feed",
  "Condition Code",
  "Condition",
] as const;

export type BackorderLineCsvRow = {
  statusLabel: string;
  ageLabel: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastChangedAt: string;
  orderNumber: string;
  customerName: string;
  customerAccount: string;
  customerOrderRef: string;
  description: string;
  productKindLabel: string;
  sku: string;
  outstandingQty: number;
  unitValue: string | null;
  outstandingValue: string | null;
  availQty: number | null;
  incomingQty: number | null;
  position: Autopart216vStockPosition;
  coverSummary: string;
  companyName: string | null;
  unmapped: boolean;
  brand: string | null;
  previousQty: number | null;
  physicalQty: number | null;
  stockFeedAt: string | null;
  conditionCode: string | null;
  conditionLabel: string | null;
};

export type BackorderMovementCsvRow = {
  statusLabel: string;
  orderNumber: string;
  customerName: string;
  customerAccount: string;
  customerOrderRef: string;
  description: string;
  productKindLabel: string;
  sku: string;
  previousQty: number | null;
  currentQty: number | null;
  changeQty: number | null;
  unitValue: string | null;
  previousValue: string | null;
  currentValue: string | null;
  ageLabel: string;
  firstSeenAt: string;
  lastChangedAt: string;
  clearedAt: string | null;
  availQty: number | null;
  incomingQty: number | null;
  position: Autopart216vStockPosition | null;
  coverSummary: string | null;
  companyName: string | null;
  unmapped: boolean;
  brand: string | null;
  conditionCode: string | null;
  conditionLabel: string | null;
};

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function shownQty(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-GB");
}

/** Same note drawn under the stock badge on the backorders table. */
export function backorderStockNote(input: {
  position: Autopart216vStockPosition;
  availQty: number | null;
  incomingQty: number | null;
  outstandingQty: number;
  coverSummary: string;
}): string {
  if (input.position === "STOCK_AVAILABLE") {
    return `${shownQty(input.availQty)} available against ${shownQty(input.outstandingQty)} backordered. Review allocation/despatch.`;
  }
  if (input.position === "NO_STOCK_NO_INCOMING") {
    return `${shownQty(input.outstandingQty)} units currently backordered.`;
  }
  if (input.position === "INCOMING_COVERS") {
    return `${shownQty(input.incomingQty)} incoming against ${shownQty(input.outstandingQty)} backordered. Arrival date not available.`;
  }
  return input.coverSummary;
}

function shownDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return formatDate(iso) ?? "";
}

function shownDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return formatOperationalDateTime(iso) ?? formatDate(iso) ?? "";
}

function row(cells: Array<string | number | null | undefined>): string {
  return cells.map((cell) => csvCell(cell)).join(",");
}

export function backorderLinesCsv(rows: BackorderLineCsvRow[]): string {
  return [
    BACKORDER_LINE_CSV_HEADERS.join(","),
    ...rows.map((r) =>
      row([
        r.statusLabel,
        r.ageLabel,
        shownDate(r.firstSeenAt),
        r.orderNumber,
        r.customerName,
        r.customerAccount,
        r.customerOrderRef,
        r.description,
        r.productKindLabel,
        r.sku,
        r.outstandingQty,
        r.unitValue ?? "",
        r.outstandingValue ?? "",
        r.availQty ?? "",
        r.incomingQty ?? "",
        autopart216vPositionHeadline(r.position),
        backorderStockNote({
          position: r.position,
          availQty: r.availQty,
          incomingQty: r.incomingQty,
          outstandingQty: r.outstandingQty,
          coverSummary: r.coverSummary,
        }),
        shownDateTime(r.lastChangedAt),
        r.companyName ?? "",
        r.unmapped ? "Unmapped" : "",
        r.brand ?? "",
        r.previousQty ?? "",
        shownDate(r.lastSeenAt),
        r.physicalQty ?? "",
        shownDateTime(r.stockFeedAt),
        r.conditionCode ?? "",
        r.conditionCode ? (r.conditionLabel ?? "") : "",
      ]),
    ),
  ].join("\n");
}

export function backorderMovementHeaders(movement: Autopart216vMovement): string[] {
  return [
    "Movement",
    "Status",
    "Order No",
    "Customer",
    "Customer Account",
    "Customer Order Ref",
    "Description",
    "Product Type",
    "SKU",
    "Previous Qty",
    "Current Qty",
    "Change",
    "Unit Value",
    "Previous Value",
    "Current Value",
    "Age",
    "First Seen",
    movement === "CLEARED" ? "Cleared At" : "Last Changed",
    "Available",
    "Incoming",
    "Stock Position",
    "Cover",
    "Mapped Company",
    "Unmapped Account",
    "Brand",
    ...(movement === "CLEARED"
      ? ["Current Condition Code", "Current Product Condition"]
      : ["Condition Code", "Condition"]),
  ];
}

export function backorderMovementCsv(
  movement: Autopart216vMovement,
  rows: BackorderMovementCsvRow[],
): string {
  return [
    backorderMovementHeaders(movement).join(","),
    ...rows.map((r) =>
      row([
        AUTOPART_216V_MOVEMENT_LABEL[movement],
        r.statusLabel,
        r.orderNumber,
        r.customerName,
        r.customerAccount,
        r.customerOrderRef,
        r.description,
        r.productKindLabel,
        r.sku,
        r.previousQty ?? "",
        r.currentQty ?? "",
        r.changeQty ?? "",
        r.unitValue ?? "",
        r.previousValue ?? "",
        r.currentValue ?? "",
        r.ageLabel,
        shownDate(r.firstSeenAt),
        shownDateTime(r.clearedAt ?? r.lastChangedAt),
        r.availQty ?? "",
        r.incomingQty ?? "",
        r.position ? autopart216vPositionHeadline(r.position) : "",
        r.position
          ? backorderStockNote({
              position: r.position,
              availQty: r.availQty,
              incomingQty: r.incomingQty,
              outstandingQty: r.currentQty ?? 0,
              coverSummary: r.coverSummary ?? "",
            })
          : "",
        r.companyName ?? "",
        r.unmapped ? "Unmapped" : "",
        r.brand ?? "",
        r.conditionCode ?? "",
        r.conditionCode ? (r.conditionLabel ?? "") : "",
      ]),
    ),
  ].join("\n");
}
