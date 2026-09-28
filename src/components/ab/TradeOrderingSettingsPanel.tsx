/**
 * Admin → Settings → Ordering — global backorder default.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getTradeOrderingSettingsFn,
  saveTradeOrderingSettingsFn,
} from "@/server/phase2/fns";

type OrderingSettingsDto = {
  defaultBackorderPolicy: "ALLOW" | "DENY";
  allowBackordersByDefault: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
};

export function TradeOrderingSettingsPanel() {
  const [state, setState] = useState<OrderingSettingsDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getTradeOrderingSettingsFn();
    if (!result.ok) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setState(result.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onToggle(next: boolean) {
    setSaving(true);
    const result = await saveTradeOrderingSettingsFn({
      data: { allowBackordersByDefault: next },
    });
    setSaving(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setState(result.data);
    toast.success(
      next
        ? "Backorders allowed by default"
        : "Backorders denied by default (SKU ALLOW overrides still apply)",
    );
  }

  return (
    <section
      data-admin-section="trade-ordering"
      className="space-y-4 rounded-lg border border-border bg-surface/30 p-4 sm:p-5 lg:col-span-2"
    >
      <div>
        <h2 className="font-display text-lg font-semibold uppercase">Ordering</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-steel">
          Trade ordering defaults. Individual SKUs can still override the global backorder
          policy from Product → Inventory.
        </p>
      </div>

      {loadError ? (
        <p className="text-[13px] text-warn" role="status">
          {loadError}
        </p>
      ) : null}

      <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
        <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-3">
          <div className="min-w-0">
            <p className="font-semibold uppercase tracking-wide">Allow backorders by default</p>
            <p className="mt-1 text-[12px] text-steel">
              When enabled, products can be ordered when stock is unavailable unless backorders
              are disabled for the individual SKU.
            </p>
          </div>
          <input
            type="checkbox"
            className="mt-1 size-4 accent-primary"
            disabled={!state || saving}
            checked={state?.allowBackordersByDefault ?? true}
            onChange={(e) => void onToggle(e.target.checked)}
            aria-label="Allow backorders by default"
            data-ordering-setting="allow-backorders-by-default"
          />
        </li>
      </ul>
    </section>
  );
}
