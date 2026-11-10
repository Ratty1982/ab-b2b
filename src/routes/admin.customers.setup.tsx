import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CustomerSetupScreen } from "@/components/ab/CustomerSetupScreen";
import { parseWizardStep, type WizardStepId } from "@/domain/customer-creation-wizard";

export const Route = createFileRoute("/admin/customers/setup")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { companyId?: string; step?: WizardStepId } => {
    const companyIdRaw = search["companyId"];
    const companyId =
      typeof companyIdRaw === "string" && companyIdRaw.length > 0 ? companyIdRaw : undefined;
    const step = parseWizardStep(search["step"]);
    // Legacy wizard `step` remains accepted for old links but is unused — setup is one page.
    return {
      ...(companyId ? { companyId } : {}),
      ...(step ? { step } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Customer setup — Automotive Brands Admin" },
      {
        name: "description",
        content:
          "Single-page customer setup: Autopart, history, contacts, addresses, and ordering.",
      },
    ],
  }),
  component: AdminCustomerSetup,
});

function AdminCustomerSetup() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <CustomerSetupScreen
      companyId={search.companyId}
      onCompanyIdChange={(companyId) => {
        void navigate({
          to: "/admin/customers/setup",
          search: { companyId },
        });
      }}
    />
  );
}
