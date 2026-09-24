import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout, PublicPageBreadcrumbs } from "@/components/ab/PublicLayout";
import { TeamMemberCard, teamMemberGridClassName } from "@/components/team/TeamMemberCard";
import { getPublicTeamPageFn } from "@/server/phase2/fns";

const SEO_TITLE = "Meet the Team | Automotive Brands";
const SEO_DESCRIPTION =
  "Meet the people behind Automotive Brands, supporting trade customers, our brands and automotive operations across the UK.";

export const Route = createFileRoute("/meet-the-team")({
  loader: async () => {
    const result = await getPublicTeamPageFn();
    if (!result.ok) {
      return { departments: [], error: result.error };
    }
    return { ...result.data, error: null };
  },
  headers: () => ({
    "Cache-Control": "private, no-store",
  }),
  head: () => ({
    meta: [
      { title: SEO_TITLE },
      { name: "description", content: SEO_DESCRIPTION },
      { property: "og:title", content: SEO_TITLE },
      { property: "og:description", content: SEO_DESCRIPTION },
      { name: "robots", content: "index,follow" },
    ],
    links: [{ rel: "canonical", href: "/meet-the-team" }],
  }),
  component: MeetTheTeamPage,
});

function MeetTheTeamPage() {
  const data = Route.useLoaderData();
  return (
    <PublicLayout>
      <PublicPageBreadcrumbs
        items={[{ label: "Home", to: "/" }, { label: "Meet the Team" }]}
      />
      <section className="border-b border-border bg-ink" data-team-page="hero">
        <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10 lg:py-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Meet the Team
          </p>
          <h1 className="mt-2 max-w-3xl font-display text-3xl font-semibold uppercase leading-[1.05] text-foreground sm:text-4xl lg:text-[2.75rem]">
            The people behind
            <br />
            Automotive Brands
          </h1>
          <p className="mt-4 max-w-[42rem] text-[15px] leading-relaxed text-steel sm:text-base">
            Automotive Brands combines product expertise, trade sales, customer support and
            operational know-how — real people supporting Power Maxed and Steel Seal trade customers
            across the UK.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
        {data.error ? (
          <p className="text-sm text-bad" role="alert">
            {data.error}
          </p>
        ) : null}
        {!data.error && data.departments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-surface/30 p-8">
            <p className="font-display text-lg font-semibold uppercase">Team profiles coming soon</p>
            <p className="mt-2 max-w-xl text-sm text-steel">
              Staff profiles are managed in Website → Team and published only after they have been
              verified.
            </p>
          </div>
        ) : null}
        <div className="grid gap-12 lg:gap-14">
          {data.departments.map((dept) => (
            <section
              key={dept.id}
              aria-labelledby={`dept-${dept.slug}`}
              data-team-department={dept.slug}
            >
              <div className="max-w-[42rem]">
                <h2
                  id={`dept-${dept.slug}`}
                  className="font-display text-xl font-semibold uppercase tracking-wide text-foreground sm:text-2xl"
                >
                  {dept.name}
                </h2>
                {dept.description ? (
                  <p className="mt-2 text-[14px] text-steel">{dept.description}</p>
                ) : null}
              </div>
              <div
                className={
                  dept.members.length > 0 && dept.members.length <= 3
                    ? "mt-6 grid grid-cols-1 justify-items-stretch gap-x-8 gap-y-12 sm:grid-cols-2 sm:justify-items-start md:grid-cols-3"
                    : `mt-6 ${teamMemberGridClassName()}`
                }
              >
                {dept.members.map((member, index) => (
                  <TeamMemberCard
                    key={member.id}
                    member={member}
                    variant={member.isContactable && member.isFeatured ? "featured" : "standard"}
                    priority={index < 2}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
