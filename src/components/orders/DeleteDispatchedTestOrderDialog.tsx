import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { validateDeleteDispatchedTestOrderConfirmation } from "@/domain/delete-dispatched-test-order";
import {
  deleteDispatchedTestOrderFn,
  previewDispatchedTestOrderDeletionFn,
} from "@/server/phase2/fns";

type Preview = Extract<
  Awaited<ReturnType<typeof previewDispatchedTestOrderDeletionFn>>,
  { ok: true }
>["data"];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: string;
  grandTotal: string;
  currency: string;
  onDeleted: (orderNumber: string) => void;
};

export function DeleteDispatchedTestOrderDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  customerName,
  status,
  grandTotal,
  currency,
  onDeleted,
}: Props) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmTestData, setConfirmTestData] = useState(false);
  const [confirmOrderNumber, setConfirmOrderNumber] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    setReason("");
    setConfirmTestData(false);
    setConfirmOrderNumber("");
    setFormError(null);
    void previewDispatchedTestOrderDeletionFn({ data: { orderId } }).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setPreviewError(result.error);
        return;
      }
      setPreview(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  const blocked = preview != null && !preview.eligible;
  const totalLabel = currency === "GBP" ? `£${grandTotal}` : `${currency} ${grandTotal}`;

  async function onConfirm() {
    setFormError(null);
    const confirmation = validateDeleteDispatchedTestOrderConfirmation({
      reason,
      confirmTestData,
      confirmOrderNumber,
      expectedOrderNumber: orderNumber,
    });
    if (!confirmation.ok) {
      setFormError(confirmation.message);
      return;
    }
    setDeleting(true);
    const result = await deleteDispatchedTestOrderFn({
      data: {
        orderId,
        reason: confirmation.reason,
        confirmTestData: true,
        confirmOrderNumber,
      },
    });
    setDeleting(false);
    if (!result.ok) {
      toast.error(result.error);
      setFormError(result.error);
      return;
    }
    onOpenChange(false);
    onDeleted(result.data.orderNumber);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete test order</DialogTitle>
          <DialogDescription>
            Permanent deletion. This cannot be undone, and the order number will not be reused.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[13px] text-destructive">
          Deleting this order is permanent. It is removed from the orders list, search, and reports
          that use live orders. Linked financial records and real Autopart records are never
          deleted or unlinked. Physical stock quantities are not changed.
        </div>

        <dl className="space-y-2 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-steel">Order number</dt>
            <dd className="font-semibold">{orderNumber}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-steel">Customer</dt>
            <dd>{customerName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-steel">Order status</dt>
            <dd>{status}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-steel">Order total</dt>
            <dd>{totalLabel}</dd>
          </div>
        </dl>

        {previewError ? <p className="text-[13px] text-destructive">{previewError}</p> : null}
        {!preview && !previewError ? (
          <p className="text-[13px] text-steel">Checking linked records…</p>
        ) : null}

        {preview ? (
          <div className="space-y-3 text-[13px]">
            <div>
              <h3 className="font-semibold">Linked invoices, exports and fulfilment</h3>
              {preview.invoices.length === 0 &&
              preview.autopartDocuments.length === 0 &&
              preview.fulfilmentRecords.length === 0 &&
              preview.exportCount === 0 &&
              !preview.externalRef &&
              !preview.exportBatchReference ? (
                <p className="mt-1 text-steel">No linked invoices, exports, or fulfilment records.</p>
              ) : (
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {preview.invoices.map((invoice) => (
                    <li key={invoice.invoiceNumber}>
                      {invoice.kind === "CREDIT" ? "Credit note" : "Invoice"} {invoice.invoiceNumber}{" "}
                      ({invoice.status})
                    </li>
                  ))}
                  {preview.autopartDocuments.map((document) => (
                    <li key={`${document.documentType}-${document.documentReference}`}>
                      Autopart {document.documentType} {document.documentReference} ({document.source})
                    </li>
                  ))}
                  {preview.exportCount > 0 || preview.exportBatchReference || preview.externalRef ? (
                    <li>
                      Autopart export {preview.exportStatus}
                      {preview.exportCount > 0 ? `, ${preview.exportCount} file(s)` : ""}
                      {preview.exportBatchReference ? `, batch ${preview.exportBatchReference}` : ""}
                      {preview.externalRef ? `, external ref ${preview.externalRef}` : ""}
                    </li>
                  ) : null}
                  {preview.fulfilmentRecords.map((event, index) => (
                    <li key={`${event.kind}-${event.source}-${index}`}>
                      {event.kind} from {event.source}: {event.summary}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {blocked ? (
              <div className="rounded-md border border-destructive/40 p-3 text-destructive">
                <p className="font-semibold">Deletion is blocked</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {preview.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <label className="block text-[13px]">
          <span className="font-semibold">Reason for deletion</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={blocked || deleting}
            rows={3}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Why this dispatched order is test data"
          />
        </label>

        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmTestData}
            disabled={blocked || deleting}
            onChange={(event) => setConfirmTestData(event.target.checked)}
          />
          <span>I confirm this order is test data and no physical goods were shipped.</span>
        </label>

        <label className="block text-[13px]">
          <span className="font-semibold">Type {orderNumber} to confirm</span>
          <input
            value={confirmOrderNumber}
            onChange={(event) => setConfirmOrderNumber(event.target.value)}
            disabled={blocked || deleting}
            autoComplete="off"
            className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-base"
          />
        </label>

        {formError ? <p className="text-[13px] text-destructive">{formError}</p> : null}

        <DialogFooter>
          <button
            type="button"
            className="h-9 rounded-md border border-border px-3 text-[12px] font-semibold"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="h-9 rounded-md bg-destructive px-3 text-[12px] font-bold text-white hover:bg-destructive/90 disabled:opacity-50"
            disabled={blocked || deleting || !preview}
            onClick={() => void onConfirm()}
          >
            {deleting ? "Deleting…" : "Delete permanently"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
