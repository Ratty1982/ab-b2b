/** Sample sizes for the read-only ongoing sales safety report. Totals are counted separately. */
export const ONGOING_SAFETY_SAMPLE_LIMITS = {
  collisions: 100,
  attentionImports: 40,
  documents: 500,
  invoices: 500,
  ordersInspected: 200,
  ordersShown: 20,
} as const;

export function describeSafetyReportCoverage(input: {
  collisionTotal: number;
  collisionShown: number;
  attentionTotal: number;
  attentionShown: number;
  candidateOrders: number;
  inspectedOrders: number;
  blockingInSample: number;
  blockingShown: number;
  documentsTruncated: boolean;
  invoicesTruncated: boolean;
}): { note: string; inspectedEveryCandidate: boolean } {
  const inspectedEveryCandidate =
    input.inspectedOrders >= input.candidateOrders && !input.documentsTruncated && !input.invoicesTruncated;
  const shown = `Showing ${input.collisionShown} of ${input.collisionTotal} collision groups, ${input.attentionShown} of ${input.attentionTotal} imports that need attention, and ${input.blockingShown} of ${input.blockingInSample} blocking orders from the ${input.inspectedOrders} orders inspected.`;
  const candidates = `${input.candidateOrders} candidate orders have invoice or ongoing-document evidence and are still confirmed, picking, or partially despatched.`;
  const coverage = inspectedEveryCandidate
    ? "Every candidate order in this query was inspected."
    : "This sample has not classified every candidate order. Records outside the sample limits were not given a blocking reason.";
  return { note: `${shown} ${candidates} ${coverage}`, inspectedEveryCandidate };
}
