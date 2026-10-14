export const ORDER_AMENDMENT_EMAIL_STATUSES = ["sent", "pending", "failed", "skipped"] as const;

export type OrderAmendmentEmailStatus = (typeof ORDER_AMENDMENT_EMAIL_STATUSES)[number];

export type OrderAmendmentEmailFeedback = {
  status: OrderAmendmentEmailStatus;
  emailId: string | null;
};

/** Staff feedback after a submitted order is amended. */
export function orderAmendmentConfirmationMessage(
  status: OrderAmendmentEmailStatus | null | undefined,
): string {
  switch (status) {
    case "sent":
      return "Order updated and confirmation sent";
    case "pending":
      return "Order updated, confirmation pending";
    case "failed":
      return "Order updated but email failed, with retry available";
    default:
      return "Order updated";
  }
}
