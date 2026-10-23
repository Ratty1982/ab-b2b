import { useState } from "react";
import { Field, inputClass } from "@/components/ab/Drawer";
import { InstantText } from "@/components/ab/InstantText";
import { ConfirmAction } from "@/components/pricing/ConfirmAction";
import { closeOrderAdministrativelyFn, fulfilOrderManuallyFn } from "@/server/workspace/fns";
import { toast } from "sonner";

type Line = {
  id: string;
  sku: string;
  name: string;
  qty: number;
  despatchedQty: number;
};

export function ManualOrderResolutionPanel({
  order,
  canEdit,
  onChanged,
}: {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    manualResolutionKind: string;
    manualResolutionReason: string | null;
    manualResolvedAt: string | null;
    manualResolvedByName: string | null;
    invoiceEvidence: string;
    items: Line[];
  };
  canEdit: boolean;
  onChanged: () => Promise<void>;
}) {
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.items.map((item) => [item.id, String(item.qty)])),
  );
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState<"OUTSTANDING" | "UNAVAILABLE">("OUTSTANDING");
  const [mode, setMode] = useState<"FULFIL" | "CLOSE" | null>(null);
  const [saving, setSaving] = useState(false);
  const resolved = order.manualResolutionKind !== "NONE";
  const blocked = ["DRAFT", "CANCELLED", "DELIVERED", "DISPATCHED", "ADMINISTRATIVELY_CLOSED"].includes(order.status);

  const lines = order.items.map((item) => ({
    orderItemId: item.id,
    despatchedQty: Number(qty[item.id] ?? item.despatchedQty),
  }));
  const preview = order.items
    .map((item) => {
      const next = Number(qty[item.id] ?? item.qty);
      return `${item.sku}: ordered ${item.qty}, already despatched ${item.despatchedQty}, confirm ${next}`;
    })
    .join("; ");

  async function submit() {
    if (!mode) return;
    setSaving(true);
    const result =
      mode === "FULFIL"
        ? await fulfilOrderManuallyFn({
            data: { orderId: order.id, reason, invoiceEvidence: evidence, lines },
          })
        : await closeOrderAdministrativelyFn({
            data: { orderId: order.id, reason, invoiceEvidence: evidence },
          });
    setSaving(false);
    setMode(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.data.idempotent ? "Already recorded. Nothing changed." : "Order resolution saved");
    await onChanged();
  }

  return (
    <section className="rounded-lg border border-border p-5 lg:col-span-2" data-order-section="manual-resolution">
      <h2 className="font-display text-base font-semibold uppercase">Manual Order Resolution</h2>
      <p className="mt-2 max-w-3xl text-[13px] text-steel">
        Use this when an old order was supplied or is no longer outstanding, and the Autopart invoice
        was not imported. This does not create an invoice or email the customer.
      </p>
      {resolved ? (
        <div className="mt-3 rounded-md border border-border bg-surface/50 px-3 py-2 text-[13px]">
          <div className="font-semibold">
            {order.manualResolutionKind === "FULFILLED_MANUALLY"
              ? "Fulfilled manually"
              : "Closed administratively"}
          </div>
          <p className="mt-1 text-steel">
            {order.manualResolvedByName ?? "Staff"} · <InstantText value={order.manualResolvedAt} variant="audit" /> · Invoice evidence{" "}
            {order.invoiceEvidence.toLowerCase().replaceAll("_", " ")}.
          </p>
          {order.manualResolutionReason ? <p className="mt-1">{order.manualResolutionReason}</p> : null}
          {order.manualResolutionKind === "CLOSED_ADMINISTRATIVELY" ? (
            <p className="mt-1">Goods were not recorded as despatched.</p>
          ) : (
            <p className="mt-1">Invoice evidence is still flagged. A later Autopart invoice can be linked without despatching again.</p>
          )}
        </div>
      ) : null}
      {canEdit && !blocked && order.manualResolutionKind !== "FULFILLED_MANUALLY" ? (
        <div className="mt-4 grid gap-4">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[13px]">
              <thead className="text-[11px] uppercase text-steel">
                <tr>
                  {["Product", "Ordered", "Previously despatched", "Outstanding", "Fulfilled quantity"].map((heading) => (
                    <th key={heading} className="px-2 py-1 font-semibold">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id} className="border-t border-border/60">
                    <td className="px-2 py-2">
                      <div className="font-semibold">{item.sku}</div>
                      <div className="text-steel">{item.name}</div>
                    </td>
                    <td className="px-2 py-2">{item.qty}</td>
                    <td className="px-2 py-2">{item.despatchedQty}</td>
                    <td className="px-2 py-2">{Math.max(0, item.qty - item.despatchedQty)}</td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min={item.despatchedQty}
                        max={item.qty}
                        value={qty[item.id] ?? ""}
                        onChange={(event) => setQty((current) => ({ ...current, [item.id]: event.target.value }))}
                        className={inputClass}
                        aria-label={`Fulfilled quantity for ${item.sku}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Field label="Reason">
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} className={inputClass} rows={3} required />
          </Field>
          <Field label="Invoice evidence">
            <select
              value={evidence}
              onChange={(event) => setEvidence(event.target.value as "OUTSTANDING" | "UNAVAILABLE")}
              className={inputClass}
            >
              <option value="OUTSTANDING">Outstanding</option>
              <option value="UNAVAILABLE">Unavailable</option>
            </select>
          </Field>
          <div className="flex flex-wrap gap-2">
            {order.manualResolutionKind === "NONE" ? (
              <button
                type="button"
                onClick={() => setMode("FULFIL")}
                className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
              >
                Mark as Fulfilled Manually
              </button>
            ) : null}
            {order.status !== "ADMINISTRATIVELY_CLOSED" && order.manualResolutionKind === "NONE" ? (
              <button
                type="button"
                onClick={() => setMode("CLOSE")}
                className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase"
              >
                Close Administratively
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <ConfirmAction
        open={mode != null}
        title={mode === "CLOSE" ? "Close this order administratively?" : "Mark this order fulfilled manually?"}
        description={
          mode === "CLOSE"
            ? `No goods will be marked despatched and no invoice will be created. Reason: ${reason || "—"}. Invoice evidence ${evidence.toLowerCase()}.`
            : `This updates despatch quantities and the order status. No invoice is created and no despatch email is sent. ${preview}. Reason: ${reason || "—"}. Invoice evidence ${evidence.toLowerCase()}.`
        }
        confirmLabel={saving ? "Saving…" : "Confirm resolution"}
        onOpenChange={(open) => {
          if (!open && !saving) setMode(null);
        }}
        onConfirm={() => {
          void submit();
        }}
      />
    </section>
  );
}
