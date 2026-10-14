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
import { validateArchiveTestOrdersConfirmation } from "@/domain/archive-test-order";
import { archiveTestOrdersFn, previewArchiveTestOrderFn, restoreTestOrderFn } from "@/server/phase2/fns";

type Preview = Extract<Awaited<ReturnType<typeof previewArchiveTestOrderFn>>, { ok: true }>["data"];

type OrderRef = { id: string; orderNumber: string };

export function ArchiveTestOrderDialog({
  open,
  onOpenChange,
  orders,
  onArchived,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: OrderRef[];
  onArchived: (orderNumbers: string[]) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmTestData, setConfirmTestData] = useState(false);
  const [confirmOrderNumbers, setConfirmOrderNumbers] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const single = orders.length === 1 ? orders[0] : null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    setReason("");
    setConfirmTestData(false);
    setConfirmOrderNumbers("");
    setFormError(null);
    if (!single) return;
    void previewArchiveTestOrderFn({ data: { orderId: single.id } }).then((result) => {
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
  }, [open, single?.id]);

  async function onConfirm() {
    setFormError(null);
    const confirmation = validateArchiveTestOrdersConfirmation({
      reason,
      confirmTestData,
      confirmOrderNumbers,
      expectedOrderNumbers: orders.map((order) => order.orderNumber),
    });
    if (!confirmation.ok) {
      setFormError(confirmation.message);
      return;
    }
    setSaving(true);
    const result = await archiveTestOrdersFn({
      data: {
        orderIds: orders.map((order) => order.id),
        reason: confirmation.reason,
        confirmTestData: true,
        confirmOrderNumbers,
      },
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      setFormError(result.error);
      return;
    }
    onOpenChange(false);
    onArchived(result.data.archived.map((order) => order.orderNumber));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{orders.length > 1 ? "Archive test orders" : "Archive test order"}</DialogTitle>
          <DialogDescription>
            Hides the order from normal lists, search, and operational sales statistics. Invoices,
            credits, Autopart documents, export batches, fulfilment history, and stock stay as they
            are.
          </DialogDescription>
        </DialogHeader>
        {previewError ? <p className="text-sm text-destructive">{previewError}</p> : null}
        <div className="space-y-3 text-[13px]">
          <p>
            {orders.length > 1
              ? `${orders.length} orders: ${orders.map((order) => order.orderNumber).join(", ")}`
              : `${single?.orderNumber ?? "Order"}${preview ? ` · ${preview.customerName} · ${preview.status}` : ""}`}
          </p>
          {preview && preview.invoices.length > 0 ? (
            <ul className="space-y-1 text-steel">
              {preview.invoices.map((invoice) => (
                <li key={invoice.invoiceNumber}>
                  Linked {invoice.kind === "CREDIT" ? "credit" : "invoice"} {invoice.invoiceNumber} (
                  {invoice.status}) stays on the financial record.
                </li>
              ))}
            </ul>
          ) : null}
          {preview && preview.autopartDocuments.length > 0 ? (
            <ul className="space-y-1 text-steel">
              {preview.autopartDocuments.map((document) => (
                <li key={`${document.documentType}-${document.documentReference}`}>
                  Autopart {document.documentType} {document.documentReference} is not changed.
                </li>
              ))}
            </ul>
          ) : null}
          <label className="block font-semibold">
            Reason
            <textarea
              className="mt-1 w-full rounded-md border border-border px-2 py-2 font-normal"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="flex min-h-11 items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmTestData}
              onChange={(event) => setConfirmTestData(event.target.checked)}
            />
            <span>I confirm this is test data and archiving must not change financial or fulfilment history.</span>
          </label>
          <label className="block font-semibold">
            {orders.length > 1 ? "Type every order number" : "Type the exact order number"}
            <input
              className="mt-1 h-10 w-full rounded-md border border-border px-2 font-normal"
              value={confirmOrderNumbers}
              onChange={(event) => setConfirmOrderNumbers(event.target.value)}
              autoComplete="off"
            />
          </label>
          {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        </div>
        <DialogFooter>
          <button
            type="button"
            className="h-10 rounded-md border border-border px-3 text-[11px] font-bold uppercase"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || orders.length === 0}
            className="h-10 rounded-md bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => void onConfirm()}
          >
            {saving ? "Archiving…" : "Archive test order"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RestoreTestOrderDialog({
  open,
  onOpenChange,
  orderId,
  orderNumber,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  orderNumber: string;
  onRestored: (orderNumber: string) => void;
}) {
  const [confirmOrderNumber, setConfirmOrderNumber] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmOrderNumber("");
    setFormError(null);
  }, [open, orderId]);

  async function onConfirm() {
    if (confirmOrderNumber !== orderNumber) {
      setFormError("Type the exact order number to confirm restore.");
      return;
    }
    setSaving(true);
    const result = await restoreTestOrderFn({ data: { orderId, confirmOrderNumber } });
    setSaving(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    onOpenChange(false);
    onRestored(result.data.orderNumber);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Restore order</DialogTitle>
          <DialogDescription>
            Puts {orderNumber} back on normal order lists. Status, invoices, and fulfilment history
            stay as they were while it was archived.
          </DialogDescription>
        </DialogHeader>
        <label className="block text-[13px] font-semibold">
          Type the exact order number
          <input
            className="mt-1 h-10 w-full rounded-md border border-border px-2 font-normal"
            value={confirmOrderNumber}
            onChange={(event) => setConfirmOrderNumber(event.target.value)}
            autoComplete="off"
          />
        </label>
        {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
        <DialogFooter>
          <button
            type="button"
            className="h-10 rounded-md border border-border px-3 text-[11px] font-bold uppercase"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            className="h-10 rounded-md bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground disabled:opacity-50"
            onClick={() => void onConfirm()}
          >
            {saving ? "Restoring…" : "Restore order"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
