import { createFileRoute } from "@tanstack/react-router";
import { InvoiceRecordView } from "@/components/ab/InvoiceRecordView";

export const Route = createFileRoute("/portal/invoices/$invoiceId")({
  validateSearch: (search: Record<string, unknown>): { origin: "b2b" | "autopart" } => ({
    origin: search["origin"] === "autopart" ? "autopart" : "b2b",
  }),
  head: () => ({
    meta: [{ title: "Invoice — Automotive Brands Trade Portal" }],
  }),
  component: PortalInvoicePage,
});

function PortalInvoicePage() {
  const { invoiceId } = Route.useParams();
  const { origin } = Route.useSearch();
  return <InvoiceRecordView invoiceId={invoiceId} origin={origin} portal />;
}
