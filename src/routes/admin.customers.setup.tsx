import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CustomerCreationWizard } from "@/components/ab/CustomerCreationWizard";
import { parseWizardStep, type WizardStepId } from "@/domain/customer-creation-wizard";

export const Route = createFileRoute("/admin/customers/setup")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { companyId?: string; step?: WizardStepId } => {
    const companyIdRaw = search["companyId"];
    const companyId =
      typeof companyIdRaw === "string" && companyIdRaw.length > 0 ? companyIdRaw : undefined;
    const step = parseWizardStep(search["step"]);
    return {
      ...(companyId ? { companyId } : {}),
      ...(step ? { step } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Customer setup — Automotive Brands Admin" },
      { name: "description", content: "Guided customer creation and onboarding." },
    ],
  }),
  component: AdminCustomerSetup,
});

function AdminCustomerSetup() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  return (
    <CustomerCreationWizard
      companyId={search.companyId}
      step={search.step}
      onNavigate={(next) => {
        void navigate({
          to: "/admin/customers/setup",
          search: {
            ...(next.companyId ? { companyId: next.companyId } : {}),
            ...(next.step ? { step: next.step } : {}),
          },
        });
      }}
    />
  );
}
