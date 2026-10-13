import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/ab/AppShell";
import { StatusBadge } from "@/components/ab/Badges";
import { ROUTES } from "@/lib/app-nav";
import { listPromotionCampaignsFn } from "@/server/phase2/fns";

export const Route = createFileRoute("/sales/promotions/")({
  head: () => ({
    meta: [
      { title: "Promotions — Sales — Automotive Brands" },
      { name: "description", content: "Draft, submit and review trade promotion campaigns." },
    ],
  }),
  component: PromotionsList,
});

type Payload = Extract<Awaited<ReturnType<typeof listPromotionCampaignsFn>>, { ok: true }>["data"];

function tone(status: string) {
  if (status === "ACTIVE" || status === "LEGACY_ACTIVE") return "good" as const;
  if (status === "REJECTED" || status === "CANCELLED" || status === "EXPIRED" || status === "LEGACY_EXPIRED")
    return "bad" as const;
  if (status === "PENDING_APPROVAL" || status === "APPROVED" || status === "SCHEDULED" || status === "LEGACY_SCHEDULED")
    return "warn" as const;
  return "neutral" as const;
}

function PromotionsList() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listPromotionCampaignsFn().then((result) => {
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setData(result.data);
    });
  }, []);

  return (
    <div className="p-4 sm:p-6">
      <PanelHeader
        title="Promotions"
        sub="Campaigns are drafted by sales and applied to trade prices only after management approval."
        actions={
          data?.canSubmit ? (
            <Link
              to={ROUTES.salesPromotionsNew}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-[12px] font-bold uppercase text-primary-foreground"
            >
              New campaign
            </Link>
          ) : null
        }
      />
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
      {!data ? <p className="text-[13px] text-steel">Loading campaigns…</p> : null}
      {data && data.items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-[13px] text-steel">
          No campaigns yet.
        </p>
      ) : null}
      {data && data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="bg-secondary/50 text-[11px] uppercase tracking-wide text-steel">
              <tr>
                <th className="px-3 py-2 font-semibold">Campaign</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Offer</th>
                <th className="px-3 py-2 font-semibold">Products</th>
                <th className="px-3 py-2 font-semibold">Negotiated prices</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-3">
                    <Link
                      to="/sales/promotions/$campaignId"
                      params={{ campaignId: row.id }}
                      className="font-semibold text-primary"
                    >
                      {row.name}
                    </Link>
                    <div className="text-[12px] text-steel">{row.code}</div>
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={tone(row.displayStatus)}>{row.displayLabel}</StatusBadge>
                  </td>
                  <td className="px-3 py-3">
                    {row.type === "PERCENT" ? `${row.value}%` : row.type === "FIXED" ? `£${row.value} off` : row.type}
                  </td>
                  <td className="px-3 py-3 text-steel">
                    {row.catalogueWide ? "Catalogue" : row.skus.slice(0, 3).join(", ") || "None selected"}
                  </td>
                  <td className="px-3 py-3 text-steel">
                    {row.legacy ? "Existing rule" : row.appliesToNegotiatedPrices ? "Additional discount" : "Protected"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
