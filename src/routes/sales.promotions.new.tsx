import { createFileRoute } from "@tanstack/react-router";
import { CampaignWorkspace } from "@/components/promotions/campaign-workspace";

export const Route = createFileRoute("/sales/promotions/new")({
  head: () => ({
    meta: [{ title: "New promotion — Sales — Automotive Brands" }],
  }),
  component: NewCampaign,
});

function NewCampaign() {
  return <CampaignWorkspace campaignId={null} />;
}
