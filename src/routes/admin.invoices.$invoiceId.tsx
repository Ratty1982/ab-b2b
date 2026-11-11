import { createFileRoute } from "@tanstack/react-router";
import { InvoiceRecordView } from "@/components/ab/InvoiceRecordView";

export const Route = createFileRoute("/admin/invoices/$invoiceId")({
  validateSearch: (search: Record<string, unknown>): { origin: "b2b" | "autopart" } => ({
    origin: search["origin"] === "autopart" ? "autopart" : "b2b",
  }),
  head: () => ({
    meta: [{ title: "Invoice — Admin — Automotive Brands" }],
  }),
  component: AdminInvoicePage,
});

function AdminInvoicePage() {
  const { invoiceId } = Route.useParams();
  const { origin } = Route.useSearch();
  return <InvoiceRecordView invoiceId={invoiceId} origin={origin} portal={false} />;
}
