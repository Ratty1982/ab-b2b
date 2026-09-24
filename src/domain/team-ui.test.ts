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
  TEAM_PHOTO_COMING_SOON_LABEL,
  TEAM_PHOTO_COMING_SOON_SRC,
  TeamMemberCard,
} from "@/components/team/TeamMemberCard";
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

describe("TeamMemberCard", () => {
  it("renders photo-coming-soon plate when photo is missing", () => {
    const markup = renderToStaticMarkup(
      createElement(TeamMemberCard, { member: baseMember, variant: "featured" }),
    );
    expect(markup).toContain("Wayne Radford");
    expect(markup).toContain(TEAM_PHOTO_COMING_SOON_SRC);
    expect(markup).toContain(TEAM_PHOTO_COMING_SOON_LABEL);
    expect(markup).toContain('data-team-photo-placeholder="coming-soon"');
    expect(markup).not.toContain("/brand/ab-logo.jpg");
    expect(markup).not.toContain(">WR<");
    expect(markup).toContain('data-team-photo="circle"');
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("Contact Wayne");
    expect(markup).toContain('href="mailto:wayne@example.com"');
    expect(markup).toContain('href="tel:01234000000"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('target="_blank"');
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

  it("Why Us teaser links to /meet-the-team", () => {
    const markup = renderToStaticMarkup(
      createElement(MeetTheTeamTeaser, { members: [baseMember] }),
    );
    expect(markup).toContain('data-team-teaser="why-us"');
    expect(markup).toContain('href="/meet-the-team"');
    expect(markup).toContain("The people behind Automotive Brands");
  });

  it("renders nothing when featured list is empty", () => {
    const markup = renderToStaticMarkup(createElement(MeetTheTeamTeaser, { members: [] }));
    expect(markup).toBe("");
  });
});
