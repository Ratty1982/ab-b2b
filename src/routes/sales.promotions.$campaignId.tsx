import { createFileRoute } from "@tanstack/react-router";
import { CampaignWorkspace } from "@/components/promotions/campaign-workspace";

export const Route = createFileRoute("/sales/promotions/$campaignId")({
  head: () => ({
    meta: [{ title: "Promotion — Sales — Automotive Brands" }],
  }),
  component: CampaignPage,
});

function CampaignPage() {
  const { campaignId } = Route.useParams();
  return <CampaignWorkspace campaignId={campaignId} />;
}
