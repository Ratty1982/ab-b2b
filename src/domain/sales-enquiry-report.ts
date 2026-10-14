/** Client copy and retry timing for Sales Enquiry. No database details. */

export const SALES_ENQUIRY_RETRY_COOLDOWN_MS = 2_000;

export function retryAvailableAt(
  nowMs: number,
  cooldownMs = SALES_ENQUIRY_RETRY_COOLDOWN_MS,
): number {
  return nowMs + cooldownMs;
}

export function isRetryCoolingDown(nowMs: number, availableAtMs: number): boolean {
  return nowMs < availableAtMs;
}

const FRIENDLY: Record<string, string> = {
  SALES_ENQUIRY_BUSY: "A sales enquiry report is already running. Wait a moment and try again.",
  SALES_ENQUIRY_TIMEOUT:
    "This sales enquiry took too long and was stopped so the rest of the portal stays available. Try again.",
  SALES_ENQUIRY_FAILED: "Sales enquiry could not be loaded. Try again.",
  UNAVAILABLE: "Sales enquiry could not be loaded. Try again.",
};

export function salesEnquiryErrorText(error: string, code?: string): string {
  if (code && FRIENDLY[code]) return FRIENDLY[code];
  if (/prisma|syntax error|connection pool|statement timeout|select\s+|from\s+"/i.test(error)) {
    return "Sales enquiry could not be loaded. Try again.";
  }
  return error;
}
