import { createFileRoute, notFound } from "@tanstack/react-router";
import { PublicCmsPage } from "@/components/public/PublicCmsPage";
import { getPublicCmsPageFn } from "@/server/phase2/fns";
import { marketingCmsPageBySlug } from "@/domain/cms-marketing-pages";

const FALLBACK = marketingCmsPageBySlug("contact")!;

export const Route = createFileRoute("/contact")({
  loader: async () => {
    const result = await getPublicCmsPageFn({ data: { slug: "contact" } });
    if (!result.ok || !result.data) throw notFound();
    return result.data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.seoTitle || FALLBACK.seoTitle },
      { name: "description", content: loaderData?.metaDescription || FALLBACK.metaDescription },
      { property: "og:title", content: loaderData?.seoTitle || FALLBACK.seoTitle },
      { property: "og:description", content: loaderData?.metaDescription || FALLBACK.metaDescription },
    ],
  }),
  component: Contact,
});

function ContactCallbackForm() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <form
        className="rounded-lg border border-border bg-surface/50 p-5"
        onSubmit={(e) => e.preventDefault()}
      >
        <h2 className="font-display text-lg font-semibold uppercase">Request a callback</h2>
        <p className="mt-2 text-[13px] text-steel">
          Enquiries are reviewed by the trade team. This form does not send email yet — use it as a
          placeholder until the inbox is connected.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { id: "name", label: "Your name", type: "text" },
            { id: "company", label: "Company", type: "text" },
            { id: "email", label: "Email", type: "email" },
            { id: "phone", label: "Telephone", type: "tel" },
          ].map((f) => (
            <div key={f.id} className="grid gap-1.5">
              <label htmlFor={f.id} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
                {f.label}
              </label>
              <input
                id={f.id}
                type={f.type}
                className="h-10 rounded-md border border-border bg-ink px-3 text-[14px] outline-none focus-visible:border-primary"
              />
            </div>
          ))}
          <div className="grid gap-1.5 sm:col-span-2">
            <label htmlFor="msg" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-steel">
              How can we help?
            </label>
            <textarea
              id="msg"
              rows={4}
              className="rounded-md border border-border bg-ink p-3 text-[14px] outline-none focus-visible:border-primary"
            />
          </div>
          <button
            type="submit"
            className="mt-2 h-11 rounded-md bg-primary text-[13px] font-bold uppercase tracking-wide text-primary-foreground transition hover:brightness-110 sm:col-span-2 sm:w-fit sm:px-8"
          >
            Send enquiry
          </button>
        </div>
      </form>
    </div>
  );
}

function Contact() {
  const page = Route.useLoaderData();
  return (
    <PublicCmsPage
      page={page}
      breadcrumbs={[{ label: "Home", to: "/" }, { label: "Contact" }]}
      trailing={<ContactCallbackForm />}
    />
  );
}
