/** Staff labels for company invoice rows. Not an account statement. */

export const COMPANY_INVOICE_STATUS_LABEL = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PART_PAID: "Part paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
} as const;

export function companyInvoiceStatusLabel(status: string): string {
  if (status in COMPANY_INVOICE_STATUS_LABEL) {
    return COMPANY_INVOICE_STATUS_LABEL[status as keyof typeof COMPANY_INVOICE_STATUS_LABEL];
  }
  return "Invoice";
}

export function companyInvoiceKindLabel(kind: string | null | undefined): string {
  if (kind === "CREDIT") return "Credit";
  return "Invoice";
}
