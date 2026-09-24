import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  } & Record<string, unknown>) =>
    createElement("a", { href: to, className, ...rest }, children),
}));

import {
  MeetTheTeamTeaser,
  TEAM_PHOTO_PLACEHOLDER_MARK,
  TEAM_PORTRAIT_ASPECT_CLASS,
  TeamMemberCard,
  teamMemberGridClassName,
} from "@/components/team/TeamMemberCard";
import { publicTeamJobTitle } from "@/domain/team";
import type { PublicTeamMember } from "@/server/team/service";

const baseMember: PublicTeamMember = {
  id: "m1",
  displayName: "Wayne Radford",
  initials: "WR",
  jobTitle: "Retail Sales Manager",
  bio: "Supporting Automotive Brands trade customers across our product portfolio.",
  isFeatured: true,
  isContactable: true,
  department: { id: "d1", name: "Trade Sales & Accounts", slug: "trade-sales-accounts" },
  photo: null,
  email: "wayne@example.com",
  phone: "01234 000000",
  linkedInUrl: "https://www.linkedin.com/in/example",
};

describe("publicTeamJobTitle", () => {
  it("keeps real titles", () => {
    expect(publicTeamJobTitle("Managing Director")).toBe("Managing Director");
    expect(publicTeamJobTitle(" Export Manager ")).toBe("Export Manager");
  });

  it("suppresses blank and placeholder CMS values", () => {
    expect(publicTeamJobTitle(null)).toBeNull();
    expect(publicTeamJobTitle("")).toBeNull();
    expect(publicTeamJobTitle("What is my job title?")).toBeNull();
    expect(publicTeamJobTitle("what is my job title")).toBeNull();
    expect(publicTeamJobTitle("TBC")).toBeNull();
    expect(publicTeamJobTitle("TODO")).toBeNull();
    expect(publicTeamJobTitle("Unknown")).toBeNull();
    expect(publicTeamJobTitle("Job title here")).toBeNull();
  });
});

describe("TeamMemberCard", () => {
  it("renders a 4:5 portrait card with intentional initials placeholder", () => {
    const markup = renderToStaticMarkup(
      createElement(TeamMemberCard, { member: baseMember, variant: "featured" }),
    );
    expect(markup).toContain("Wayne Radford");
    expect(markup).toContain("Retail Sales Manager");
    expect(markup).toContain('data-team-portrait="card"');
    expect(markup).toContain('data-team-photo="portrait"');
    expect(markup).toContain(TEAM_PORTRAIT_ASPECT_CLASS);
    expect(markup).toContain('data-team-photo-placeholder="initials"');
    expect(markup).toContain(TEAM_PHOTO_PLACEHOLDER_MARK);
    expect(markup).toContain("WR");
    expect(markup).not.toContain("rounded-full");
    expect(markup).not.toContain('data-team-photo="circle"');
    expect(markup).not.toContain("Trade Sales & Accounts");
    expect(markup).toContain("Contact Wayne");
    expect(markup).toContain('href="mailto:wayne@example.com"');
    expect(markup).toContain('href="tel:01234000000"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('target="_blank"');
  });

  it("does not repeat department under each card by default", () => {
    const markup = renderToStaticMarkup(createElement(TeamMemberCard, { member: baseMember }));
    expect(markup).not.toContain("Trade Sales & Accounts");
  });

  it("suppresses placeholder job titles publicly", () => {
    const markup = renderToStaticMarkup(
      createElement(TeamMemberCard, {
        member: { ...baseMember, jobTitle: "What is my job title?" },
      }),
    );
    expect(markup).not.toContain("What is my job title?");
    expect(markup).not.toContain('data-team-job-title');
  });

  it("still displays a real job title", () => {
    const markup = renderToStaticMarkup(
      createElement(TeamMemberCard, {
        member: { ...baseMember, jobTitle: "Operations Director" },
      }),
    );
    expect(markup).toContain("Operations Director");
    expect(markup).toContain('data-team-job-title');
  });

  it("renders live portrait with object-cover and sizes hint", () => {
    const markup = renderToStaticMarkup(
      createElement(TeamMemberCard, {
        member: {
          ...baseMember,
          photo: {
            mediaId: "media1",
            src: "/api/cms-media/media1",
            alt: "Wayne Radford",
            width: 800,
            height: 1000,
            focalX: 50,
            focalY: 40,
            objectPosition: "50% 40%",
          },
        },
        priority: true,
      }),
    );
    expect(markup).toContain('data-team-photo-live="true"');
    expect(markup).toContain("object-cover");
    expect(markup).toContain('sizes="(max-width: 640px) 100vw, (max-width: 1024px) 40vw, 280px"');
    expect(markup).toContain('loading="eager"');
    expect(markup).not.toContain('data-team-photo-placeholder');
  });

  it("omits contact details when not contactable", () => {
    const member: PublicTeamMember = {
      ...baseMember,
      isContactable: false,
      email: null,
      phone: null,
      linkedInUrl: null,
      bio: null,
    };
    const markup = renderToStaticMarkup(createElement(TeamMemberCard, { member }));
    expect(markup).not.toContain("mailto:");
    expect(markup).not.toContain("tel:");
    expect(markup).not.toContain("linkedin.com");
    expect(markup).not.toContain("Supporting Automotive Brands");
  });

  it("Why Us teaser uses portrait cards and links to /meet-the-team", () => {
    const markup = renderToStaticMarkup(
      createElement(MeetTheTeamTeaser, { members: [baseMember] }),
    );
    expect(markup).toContain('data-team-teaser="why-us"');
    expect(markup).toContain('data-team-portrait="card"');
    expect(markup).toContain('href="/meet-the-team"');
    expect(markup).toContain("The people behind Automotive Brands");
    expect(markup).not.toContain("rounded-full");
  });

  it("renders nothing when featured list is empty", () => {
    const markup = renderToStaticMarkup(createElement(MeetTheTeamTeaser, { members: [] }));
    expect(markup).toBe("");
  });

  it("exposes a compact responsive grid class", () => {
    expect(teamMemberGridClassName()).toContain("xl:grid-cols-4");
    expect(teamMemberGridClassName()).toContain("sm:grid-cols-2");
    expect(teamMemberGridClassName(true)).toContain("gap-y-10");
  });
});
