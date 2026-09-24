import { Link } from "@tanstack/react-router";
import { Linkedin, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { publicTeamJobTitle } from "@/domain/team";
import type { PublicTeamMember } from "@/server/team/service";

/** 4:5 portrait frame — matches real headshots and missing-photo plate. */
export const TEAM_PORTRAIT_ASPECT_CLASS = "aspect-[4/5]";
/** ~240–280px card width from tablet up; full-width on narrow phones. */
export const TEAM_CARD_MAX_WIDTH_CLASS = "w-full max-w-none sm:max-w-[280px]";
export const TEAM_PHOTO_PLACEHOLDER_MARK = "/brand/ab-logo.jpg";

export function TeamMemberCard({
  member,
  variant = "standard",
  priority = false,
  showDepartment = false,
  compact = false,
}: {
  member: PublicTeamMember;
  /** Featured contactable cards get slightly stronger contact CTAs. */
  variant?: "standard" | "featured";
  priority?: boolean;
  /** Department headings already provide context — keep off on the public roster. */
  showDepartment?: boolean;
  /** Tighter spacing for Why Us teaser. */
  compact?: boolean;
}) {
  const jobTitle = publicTeamJobTitle(member.jobTitle);
  const showContact =
    member.isContactable && (member.email || member.phone || member.linkedInUrl);
  const contactLabel = member.displayName.split(" ")[0] || member.displayName;

  return (
    <article
      className={cn(
        "flex w-full flex-col",
        TEAM_CARD_MAX_WIDTH_CLASS,
        compact ? "gap-3" : "gap-3.5",
      )}
      data-team-card={variant}
      data-team-portrait="card"
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-md bg-[#0b1220]",
          TEAM_PORTRAIT_ASPECT_CLASS,
        )}
        data-team-photo="portrait"
      >
        {member.photo ? (
          <img
            src={member.photo.src}
            alt={member.photo.alt}
            width={560}
            height={700}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 40vw, 280px"
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className="h-full w-full object-cover"
            style={{ objectPosition: member.photo.objectPosition }}
            data-team-photo-live="true"
          />
        ) : (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-3 px-5 text-center"
            data-team-photo-placeholder="initials"
            aria-hidden
          >
            <img
              src={TEAM_PHOTO_PLACEHOLDER_MARK}
              alt=""
              width={36}
              height={36}
              className="h-8 w-auto rounded-sm object-contain opacity-45"
            />
            <span className="font-display text-4xl font-semibold tracking-[0.08em] text-white/95 sm:text-[2.65rem]">
              {member.initials}
            </span>
          </div>
        )}
      </div>

      <div className={cn("flex flex-1 flex-col", compact ? "gap-1.5" : "gap-2")}>
        <div>
          <h3 className="font-display text-[15px] font-semibold uppercase leading-snug tracking-wide text-foreground sm:text-base">
            {member.displayName}
          </h3>
          {jobTitle ? (
            <p className="mt-1 text-[13px] font-medium leading-snug text-steel" data-team-job-title>
              {jobTitle}
            </p>
          ) : null}
          {showDepartment && member.department ? (
            <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-steel/80">
              {member.department.name}
            </p>
          ) : null}
        </div>
        {member.bio ? (
          <p className="text-[13px] leading-relaxed text-steel">{member.bio}</p>
        ) : null}
        {showContact ? (
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
            {member.email ? (
              <a
                href={`mailto:${member.email}`}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-primary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <Mail className="size-3.5" aria-hidden />
                {variant === "featured" ? `Contact ${contactLabel}` : "Email"}
              </a>
            ) : null}
            {member.phone ? (
              <a
                href={`tel:${member.phone.replace(/\s+/g, "")}`}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-steel transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                aria-label={`Call ${member.displayName}`}
              >
                <Phone className="size-3.5" aria-hidden />
                <span className="sr-only sm:not-sr-only">{member.phone}</span>
              </a>
            ) : null}
            {member.linkedInUrl ? (
              <a
                href={member.linkedInUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-steel transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                aria-label={`${member.displayName} on LinkedIn (opens in a new tab)`}
              >
                <Linkedin className="size-3.5" aria-hidden />
                <span className="sr-only sm:not-sr-only">LinkedIn</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** Shared responsive team grid — ~240–280px cards, no full-bleed stretch. */
export function teamMemberGridClassName(compact = false) {
  return cn(
    "grid grid-cols-1 justify-items-stretch gap-x-8 gap-y-12 sm:grid-cols-2 sm:justify-items-start md:grid-cols-3 xl:grid-cols-4",
    compact ? "gap-x-7 gap-y-10" : "gap-x-8 gap-y-12 sm:gap-x-9 sm:gap-y-14",
  );
}

export function MeetTheTeamTeaser({
  members,
}: {
  members: PublicTeamMember[];
}) {
  if (!members.length) return null;
  return (
    <section
      className="border-t border-border bg-ink"
      data-team-teaser="why-us"
      aria-labelledby="meet-team-teaser-heading"
    >
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-10 lg:py-12">
        <div className="max-w-[42rem]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Meet the Team
          </p>
          <h2
            id="meet-team-teaser-heading"
            className="mt-2 font-display text-2xl font-semibold uppercase leading-tight text-foreground sm:text-3xl"
          >
            The people behind Automotive Brands
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-steel">
            Trade is built on relationships. Meet the people behind our brands, customer support and
            operations.
          </p>
        </div>
        <div className={cn("mt-8", teamMemberGridClassName(true))}>
          {members.map((member, index) => (
            <TeamMemberCard
              key={member.id}
              member={member}
              variant={member.isContactable ? "featured" : "standard"}
              priority={index < 2}
              compact
            />
          ))}
        </div>
        <div className="mt-8">
          <Link
            to="/meet-the-team"
            className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-[12px] font-bold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            Meet the Team
          </Link>
        </div>
      </div>
    </section>
  );
}
