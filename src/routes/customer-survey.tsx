import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout, PublicPageBreadcrumbs } from "@/components/ab/PublicLayout";
import { CustomerSurveyForm } from "@/components/survey/CustomerSurveyForm";
import { isPrizeDrawOpen, surveyLayout } from "@/domain/customer-survey";

export const Route = createFileRoute("/customer-survey")({
  loader: () => ({ prizeDrawOpen: isPrizeDrawOpen(new Date()) }),
  head: () => ({
    meta: [
      { title: "Customer Satisfaction Survey — Automotive Brands" },
      {
        name: "description",
        content:
          "Tell Automotive Brands how we are doing. The survey takes about 2–3 minutes and does not require a trade login.",
      },
    ],
  }),
  component: CustomerSurveyPage,
});

function CustomerSurveyPage() {
  const { prizeDrawOpen } = Route.useLoaderData();
  return (
    <PublicLayout>
      <PublicPageBreadcrumbs items={[{ label: "Home", to: "/" }, { label: "Customer Survey" }]} />
      <main className={surveyLayout.page}>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Automotive Brands
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
          Customer Satisfaction Survey
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          At Automotive Brands, we are continually looking for ways to improve our products, service
          and the way we work with our customers.
        </p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          We would really appreciate a few minutes of your time to tell us how we are doing.
        </p>
        <p className="mt-3 text-sm font-semibold">Approximately 2–3 minutes</p>
        <div className="mt-8">
          <CustomerSurveyForm prizeDrawOpen={prizeDrawOpen} />
        </div>
      </main>
    </PublicLayout>
  );
}
