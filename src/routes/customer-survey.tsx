import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout, PublicPageBreadcrumbs } from "@/components/ab/PublicLayout";
import { CustomerSurveyForm } from "@/components/survey/CustomerSurveyForm";
import { PublishedSurveyForm } from "@/components/survey/PublishedSurveyForm";
import { isPrizeDrawOpen, surveyLayout } from "@/domain/customer-survey";
import { getPublicCustomerSurveyFn } from "@/server/surveys/fns";

export const Route = createFileRoute("/customer-survey")({
  loader: async () => {
    const result = await getPublicCustomerSurveyFn();
    return {
      prizeDrawOpen: isPrizeDrawOpen(new Date()),
      survey: result.ok ? result.data : null,
    };
  },
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
  const { prizeDrawOpen, survey } = Route.useLoaderData();
  const title = survey?.title ?? "Customer Satisfaction Survey";
  const introduction = survey?.introduction ?? [
    "At Automotive Brands, we are continually looking for ways to improve our products, service and the way we work with our customers.",
    "We would really appreciate a few minutes of your time to tell us how we are doing.",
  ];
  const duration = survey?.durationLabel ?? "Approximately 2–3 minutes";
  return (
    <PublicLayout>
      <PublicPageBreadcrumbs items={[{ label: "Home", to: "/" }, { label: "Customer Survey" }]} />
      <main className={surveyLayout.page}>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Automotive Brands
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">{title}</h1>
        {introduction.map((paragraph, index) => (
          <p
            key={paragraph}
            className={index === 0 ? "mt-4 text-sm leading-6 text-muted-foreground" : "mt-2 text-sm leading-6 text-muted-foreground"}
          >
            {paragraph}
          </p>
        ))}
        <p className="mt-3 text-sm font-semibold">{duration}</p>
        <div className="mt-8">
          {!survey || !survey.enabled ? (
            <p className="text-sm leading-6">This survey is not open at the moment.</p>
          ) : survey.useLegacyForm ? (
            <CustomerSurveyForm
              prizeDrawOpen={prizeDrawOpen}
              thankYouTitle={survey.thankYouTitle}
              thankYouParagraphs={survey.thankYouParagraphs}
            />
          ) : (
            <PublishedSurveyForm document={survey.document} prizeDrawOpen={prizeDrawOpen} />
          )}
        </div>
      </main>
    </PublicLayout>
  );
}
