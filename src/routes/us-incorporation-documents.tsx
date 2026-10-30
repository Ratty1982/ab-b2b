import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout, PublicPageBreadcrumbs } from "@/components/ab/PublicLayout";
import { US_INCORPORATION_DOCUMENTS } from "@/domain/us-incorporation-documents";

export const Route = createFileRoute("/us-incorporation-documents")({
  head: () => ({
    meta: [
      { title: "Automotive Brands Inc Company Documents" },
      {
        name: "description",
        content:
          "Certificate of incorporation, EIN verification, and address change confirmation for Automotive Brands Inc.",
      },
    ],
  }),
  component: UsIncorporationDocumentsPage,
});

function UsIncorporationDocumentsPage() {
  return (
    <PublicLayout>
      <PublicPageBreadcrumbs
        items={[{ label: "Home", to: "/" }, { label: "US company documents" }]}
      />
      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl font-semibold">Automotive Brands Inc Company Documents</h1>
        <ul className="mt-6 space-y-3">
          {US_INCORPORATION_DOCUMENTS.map((doc) => (
            <li key={doc.href}>
              <a href={doc.href} className="font-semibold underline">
                {doc.label}
              </a>
            </li>
          ))}
        </ul>
      </main>
    </PublicLayout>
  );
}
