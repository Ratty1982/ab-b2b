import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { inputClass } from "@/components/ab/Drawer";
import { campaignInstantForSave, utcIsoToDatetimeLocal, CampaignLocalTimeError } from "@/domain/campaign-local-time";
import { ROUTES } from "@/lib/app-nav";
import {
  approvePromotionCampaignFn,
  cancelPromotionCampaignFn,
  getPromotionCampaignFn,
  getPromotionPerformanceFn,
  previewPromotionCampaignFn,
  rejectPromotionCampaignFn,
  savePromotionCampaignFn,
  searchPromotionProductsFn,
  setPromotionNegotiatedEligibilityFn,
  submitPromotionCampaignFn,
} from "@/server/phase2/fns";

type Campaign = Extract<Awaited<ReturnType<typeof getPromotionCampaignFn>>, { ok: true }>["data"]["campaign"];
type Performance = Extract<Awaited<ReturnType<typeof getPromotionPerformanceFn>>, { ok: true }>["data"];

export function CampaignWorkspace({ campaignId }: { campaignId: string | null }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [type, setType] = useState<"PERCENT" | "FIXED">("PERCENT");
  const [value, setValue] = useState("10");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [originalStartsAt, setOriginalStartsAt] = useState<string | null>(null);
  const [originalEndsAt, setOriginalEndsAt] = useState<string | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [skus, setSkus] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Array<{ sku: string; name: string; brand: string }>>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [allowNegotiated, setAllowNegotiated] = useState(false);
  const [locked, setLocked] = useState(false);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!campaignId) return;
    void getPromotionCampaignFn({ data: { id: campaignId } }).then((result) => {
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const row = result.data.campaign;
      setCampaign(row);
      setCanApprove(result.data.canApprove);
      setName(row.name);
      setCode(row.code);
      setDescription(row.description ?? "");
      setImageUrl(row.imageUrl ?? "");
      if (row.type === "PERCENT" || row.type === "FIXED") setType(row.type);
      setValue(String(Number(row.value)));
      setOriginalStartsAt(row.startsAt);
      setOriginalEndsAt(row.endsAt);
      setStartsAt(row.startsAt ? utcIsoToDatetimeLocal(row.startsAt, timeZone) : "");
      setEndsAt(row.endsAt ? utcIsoToDatetimeLocal(row.endsAt, timeZone) : "");
      setSkus(row.skus);
      setAllowNegotiated(row.appliesToNegotiatedPrices);
      setLocked(!row.editable);
    });
  }, [campaignId, timeZone]);

  useEffect(() => {
    if (!campaignId) return;
    void getPromotionPerformanceFn({ data: { promotionId: campaignId, page: 1, pageSize: 10 } }).then((result) => {
      if (result.ok) setPerformance(result.data);
    });
  }, [campaignId]);

  function localInstant(localValue: string, originalIso: string | null): string | null {
    return campaignInstantForSave({ localValue, originalIso, timeZone });
  }

  function payload(id?: string) {
    return {
      id,
      code,
      name,
      description: description.trim() || null,
      imageUrl: imageUrl.trim() || null,
      type,
      value: Number(value),
      startsAt: localInstant(startsAt, originalStartsAt),
      endsAt: localInstant(endsAt, originalEndsAt),
      skus,
      appliesToNegotiatedPrices: allowNegotiated,
      expectedUpdatedAt: campaign?.updatedAt,
    };
  }

  async function save() {
    setBusy(true);
    let body: ReturnType<typeof payload>;
    try {
      body = payload(campaign?.id);
    } catch (error) {
      setBusy(false);
      toast.error(error instanceof CampaignLocalTimeError ? error.message : "Enter a valid start and end time");
      return;
    }
    const result = await savePromotionCampaignFn({ data: body });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      campaign?.campaignStatus === "PENDING_APPROVAL"
        ? "Saved as a draft. Submit it again before it can be approved."
        : "Draft saved",
    );
    window.location.assign(ROUTES.salesPromotion(result.data.id));
  }

  async function submit() {
    if (!campaign) return;
    setBusy(true);
    let body: ReturnType<typeof payload>;
    try {
      body = payload(campaign.id);
    } catch (error) {
      setBusy(false);
      toast.error(error instanceof CampaignLocalTimeError ? error.message : "Enter a valid start and end time");
      return;
    }
    const saved = await savePromotionCampaignFn({ data: body });
    if (!saved.ok) {
      setBusy(false);
      toast.error(saved.error);
      return;
    }
    const result = await submitPromotionCampaignFn({ data: { id: campaign.id } });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Submitted for approval");
    window.location.reload();
  }

  async function review(action: "approve" | "reject" | "cancel" | "stack") {
    if (!campaign) return;
    const enablingNegotiated = allowNegotiated && !campaign.appliesToNegotiatedPrices;
    if ((action === "approve" && allowNegotiated) || (action === "stack" && enablingNegotiated)) {
      const confirmed = window.confirm(
        "This discount will apply to negotiated customer prices. Eligible customers may see a lower price immediately for the selected SKUs. Approve this change?",
      );
      if (!confirmed) return;
    }
    setBusy(true);
    const body = {
      id: campaign.id,
      reason: reason.trim() || undefined,
      appliesToNegotiatedPrices: allowNegotiated,
      confirmNegotiatedPrices: allowNegotiated,
      expectedUpdatedAt: campaign.updatedAt,
    };
    const result =
      action === "approve"
        ? await approvePromotionCampaignFn({ data: body })
        : action === "reject"
          ? await rejectPromotionCampaignFn({ data: body })
          : action === "cancel"
            ? await cancelPromotionCampaignFn({ data: body })
            : await setPromotionNegotiatedEligibilityFn({ data: body });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Campaign updated");
    window.location.reload();
  }

  useEffect(() => {
    if (!value || Number(value) <= 0) {
      setPreview(null);
      return;
    }
    void previewPromotionCampaignFn({ data: { type, value: Number(value) } }).then((result) => {
      if (!result.ok) return;
      setPreview(
        result.data.resultDisplay
          ? `£10.00 becomes £${result.data.resultDisplay}. ${result.data.negotiatedNote}`
          : result.data.note,
      );
    });
  }, [type, value]);

  return (
    <div className="grid gap-6 p-4 sm:p-6">
      <PanelHeader
        title={campaign ? campaign.name : "New campaign"}
        sub="Prices are resolved by the trade engine when the campaign is active. A draft does not change customer prices."
        actions={
          <Link to={ROUTES.salesPromotions} className="text-[13px] font-semibold text-primary">
            All campaigns
          </Link>
        }
      />
      {campaign ? <StatusBadge tone="brand">{campaign.displayLabel}</StatusBadge> : null}
      {campaign?.reviewReason ? <p className="text-[13px] text-steel">Reason: {campaign.reviewReason}</p> : null}
      {campaign?.legacy ? (
        <p className="rounded-md border border-border bg-surface/40 p-4 text-[13px] text-steel">
          This promotion already exists and keeps its current pricing behaviour. It is not moved into the new approval workflow.
        </p>
      ) : (
        <form
          className="grid max-w-3xl gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="grid gap-1 text-[12px] font-semibold">
            Campaign name
            <input className={inputClass} value={name} disabled={locked} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold">
            Code
            <input className={inputClass} value={code} disabled={locked} onChange={(e) => setCode(e.target.value)} required />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold">
            Description
            <textarea className={inputClass} value={description} disabled={locked} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold">
            Banner image URL
            <input className={inputClass} value={imageUrl} disabled={locked} onChange={(e) => setImageUrl(e.target.value)} placeholder="https:// or /media/…" />
          </label>
          {imageUrl ? <img src={imageUrl} alt="" className="h-24 max-w-xs rounded-md object-cover" /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-[12px] font-semibold">
              Discount
              <select className={inputClass} value={type} disabled={locked} onChange={(e) => setType(e.target.value as "PERCENT" | "FIXED")}>
                <option value="PERCENT">Percent</option>
                <option value="FIXED">Fixed amount per unit</option>
              </select>
            </label>
            <label className="grid gap-1 text-[12px] font-semibold">
              Value
              <input className={inputClass} value={value} disabled={locked} onChange={(e) => setValue(e.target.value)} inputMode="decimal" required />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold">
              Starts (your local time)
              <input className={inputClass} type="datetime-local" value={startsAt} disabled={locked} onChange={(e) => setStartsAt(e.target.value)} />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold">
              Ends (your local time)
              <input className={inputClass} type="datetime-local" value={endsAt} disabled={locked} onChange={(e) => setEndsAt(e.target.value)} />
            </label>
          </div>
          <p className="text-[12px] leading-relaxed text-steel">
            Times use {timeZone.replaceAll("_", " ")}. The offer starts and ends at these local instants, including GMT and British Summer Time changes. Leaving the times unchanged keeps the stored instants.
          </p>
          {preview ? <p className="text-[13px] text-steel">{preview}</p> : null}
          <div className="grid gap-2">
            <label className="grid gap-1 text-[12px] font-semibold">
              Find products
              <input
                className={inputClass}
                value={query}
                disabled={locked}
                placeholder="SKU, name or brand"
                onChange={(e) => {
                  const next = e.target.value;
                  setQuery(next);
                  if (next.trim().length < 2) {
                    setHits([]);
                    return;
                  }
                  void searchPromotionProductsFn({ data: { q: next } }).then((result) => {
                    if (result.ok) setHits(result.data);
                  });
                }}
              />
            </label>
            {hits.length > 0 ? (
              <ul className="rounded-md border border-border">
                {hits.map((hit) => (
                  <li key={hit.sku}>
                    <button
                      type="button"
                      className="flex w-full justify-between px-3 py-2 text-left text-[13px] hover:bg-secondary/40"
                      onClick={() => {
                        setSkus((current) => (current.includes(hit.sku) ? current : [...current, hit.sku]));
                        setHits([]);
                        setQuery("");
                      }}
                    >
                      <span>{hit.sku}</span>
                      <span className="text-steel">{hit.brand} · {hit.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <ul className="flex flex-wrap gap-2">
              {skus.map((sku) => (
                <li key={sku} className="inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 text-[12px]">
                  {sku}
                  {locked ? null : (
                    <button type="button" onClick={() => setSkus((current) => current.filter((item) => item !== sku))}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {canApprove ? (
            <label className="flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={allowNegotiated}
                onChange={(e) => setAllowNegotiated(e.target.checked)}
              />
              <span>Allow this discount on negotiated customer prices. Leave this off to protect those prices.</span>
            </label>
          ) : (
            <p className="text-[13px] text-steel">Negotiated customer prices stay protected unless management allows an additional discount.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {locked ? null : (
              <button type="submit" disabled={busy} className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground">
                Save draft
              </button>
            )}
            {campaign?.canSubmit ? (
              <button type="button" disabled={busy} className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase" onClick={() => void submit()}>
                Submit for approval
              </button>
            ) : null}
          </div>
        </form>
      )}
      {campaign?.canApprove || campaign?.canReject || campaign?.canCancel || campaign?.canSetNegotiatedPrices ? (
        <section className="grid max-w-3xl gap-3 rounded-lg border border-border p-4">
          <h2 className="text-[14px] font-semibold">Management review</h2>
          <label className="grid gap-1 text-[12px] font-semibold">
            Reason
            <textarea className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </label>
          <div className="flex flex-wrap gap-2">
            {campaign.canApprove ? (
              <button type="button" disabled={busy} className="h-10 rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground" onClick={() => void review("approve")}>
                Approve
              </button>
            ) : null}
            {campaign.canReject ? (
              <button type="button" disabled={busy} className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase" onClick={() => void review("reject")}>
                Reject
              </button>
            ) : null}
            {campaign.canCancel ? (
              <button type="button" disabled={busy} className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase" onClick={() => void review("cancel")}>
                Cancel campaign
              </button>
            ) : null}
            {campaign.canSetNegotiatedPrices ? (
              <button type="button" disabled={busy} className="h-10 rounded-md border border-border px-4 text-[12px] font-bold uppercase" onClick={() => void review("stack")}>
                Save negotiated-price rule
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      {performance ? <PerformancePanel report={performance} /> : null}
    </div>
  );
}

function PerformancePanel({ report }: { report: Performance }) {
  return (
    <section className="grid gap-4">
      <h2 className="text-[16px] font-semibold">Performance</h2>
      <p className="text-[13px] text-steel">
        {report.scope === "organisation" ? "Organisation-wide placed orders." : "Customers in your sales scope only."}{" "}
        Basket additions are not included. {report.revenueNote}
      </p>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Placed orders" value={String(report.placed.orders)} detail={`${report.placed.customers} customers · £${report.placed.revenueExVat}`} />
        <Metric label="Standing orders" value={String(report.standing.orders)} detail={`£${report.standing.revenueExVat} ex VAT`} />
        <Metric label="Completed" value={String(report.completed.orders)} detail={`£${report.completed.revenueExVat} ex VAT`} />
        <Metric label="Cancelled" value={String(report.cancelled.orders)} detail={`£${report.cancelled.revenueExVat} ex VAT`} />
      </dl>
      <p className="text-[13px] text-steel">
        Promotional units on standing orders: {report.standing.units}. Net after cancellation: £{report.netAfterCancellationExVat} ex VAT.
        Savings: {report.savings.savingsExVat == null ? "unavailable" : `£${report.savings.savingsExVat}`} ({report.savings.coverage}). {report.savings.note}
      </p>
      <p className="text-[13px] text-steel">
        Linked credit documents: {report.credits.linkedCreditDocuments} (£{report.credits.linkedCreditSubtotalExVat} ex VAT). {report.credits.note}
      </p>
      {report.months.length > 0 ? (
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase text-steel">
              <th className="py-1">Month</th>
              <th>Orders</th>
              <th>Units</th>
              <th>Revenue ex VAT</th>
            </tr>
          </thead>
          <tbody>
            {report.months.map((month) => (
              <tr key={month.month} className="border-t border-border">
                <td className="py-1">{month.month}</td>
                <td>{month.orders}</td>
                <td>{month.units}</td>
                <td>£{month.revenueExVat}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {report.customers.items.length > 0 ? (
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase text-steel">
              <th className="py-1">Customer</th>
              <th>Orders</th>
              <th>Units</th>
              <th>Revenue ex VAT</th>
            </tr>
          </thead>
          <tbody>
            {report.customers.items.map((customer) => (
              <tr key={customer.companyId} className="border-t border-border">
                <td className="py-1">{customer.companyName}</td>
                <td>{customer.orders}</td>
                <td>{customer.units}</td>
                <td>£{customer.revenueExVat}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {report.orders.items.length > 0 ? (
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase text-steel">
              <th className="py-1">Order</th>
              <th>Status</th>
              <th>Customer</th>
              <th>Representative</th>
              <th>Lines</th>
              <th>Revenue ex VAT</th>
            </tr>
          </thead>
          <tbody>
            {report.orders.items.map((order) => (
              <tr key={order.id} className="border-t border-border">
                <td className="py-1">{order.orderNumber}</td>
                <td>{order.status}</td>
                <td>{order.companyName}</td>
                <td>{order.salesRepresentative ?? "Unassigned"}</td>
                <td>{order.lines}</td>
                <td>£{order.revenueExVat}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-steel">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-[12px] text-steel">{detail}</div>
    </div>
  );
}
