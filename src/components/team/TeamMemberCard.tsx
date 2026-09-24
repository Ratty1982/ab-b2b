import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Linkedin, Mail, Phone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  publicTeamBio,
  publicTeamJobTitle,
  teamMemberFirstName,
  teamMemberHasProfileDialog,
  teamMemberHasPublicContact,
} from "@/domain/team";
import type { PublicTeamMember } from "@/server/team/service";

/** 4:5 portrait frame — matches real headshots and missing-photo plate. */
export const TEAM_PORTRAIT_ASPECT_CLASS = "aspect-[4/5]";
/** ~240–280px card width from tablet up; full-width on narrow phones. */
export const TEAM_CARD_MAX_WIDTH_CLASS = "w-full max-w-none sm:max-w-[280px]";
export const TEAM_PHOTO_PLACEHOLDER_MARK = "/brand/ab-logo.jpg";
/** Neutral stage behind mixed source photography (white / dark / legacy circular). */
export const TEAM_PORTRAIT_STAGE_CLASS = "bg-[#d7dbe3]";

function TeamPortrait({
  member,
  priority = false,
  sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 40vw, 280px",
  className,
}: {
  member: PublicTeamMember;
  priority?: boolean;
  sizes?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden",
        TEAM_PORTRAIT_ASPECT_CLASS,
        TEAM_PORTRAIT_STAGE_CLASS,
        className,
      )}
      data-team-photo="portrait"
    >
      {member.photo ? (
        <img
          src={member.photo.src}
          alt={member.photo.alt}
          width={560}
          height={700}
          sizes={sizes}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          className="h-full w-full object-cover"
          style={{ objectPosition: member.photo.objectPosition }}
          data-team-photo-live="true"
        />
      ) : (
        <div
          className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0b1220] px-5 text-center"
          data-team-photo-placeholder="initials"
          aria-hidden
        >
          <img
            src={TEAM_PHOTO_PLACEHOLDER_MARK}
            alt=""
            width={32}
            height={32}
            className="h-7 w-auto rounded-sm object-contain opacity-40"
          />
          <span className="font-display text-4xl font-semibold tracking-[0.1em] text-white/95 sm:text-[2.75rem]">
            {member.initials}
          </span>
        </div>
      )}
    </div>
  );
}

function TeamContactActions({
  member,
  featured = false,
  className,
}: {
  member: PublicTeamMember;
  featured?: boolean;
  className?: string;
}) {
  if (!teamMemberHasPublicContact(member)) return null;
  const firstName = teamMemberFirstName(member.displayName);
  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5", className)}
      data-team-contact-actions
    >
      {member.email ? (
        <a
          href={`mailto:${member.email}`}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <Mail className="size-3.5 shrink-0" aria-hidden />
          {featured ? `Email ${firstName}` : "Email"}
        </a>
      ) : null}
      {member.phone ? (
        <a
          href={`tel:${member.phone.replace(/\s+/g, "")}`}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-steel transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          aria-label={`Call ${member.displayName}`}
        >
          <Phone className="size-3.5 shrink-0" aria-hidden />
          Call
        </a>
      ) : null}
      {member.linkedInUrl ? (
        <a
          href={member.linkedInUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-steel transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          aria-label={`${member.displayName} on LinkedIn (opens in a new tab)`}
        >
          <Linkedin className="size-3.5 shrink-0" aria-hidden />
          LinkedIn
        </a>
      ) : null}
    </div>
  );
}

/** Profile body shared by dialog — safe public fields only. */
export function TeamMemberProfileBody({ member }: { member: PublicTeamMember }) {
  const jobTitle = publicTeamJobTitle(member.jobTitle);
  const bio = publicTeamBio(member.bio);
  return (
    <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]" data-team-profile-body>
      <TeamPortrait
        member={member}
        priority
        sizes="180px"
        className="mx-auto w-full max-w-[180px] rounded-md sm:mx-0"
      />
      <div className="min-w-0">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="font-display text-xl font-semibold uppercase tracking-wide text-foreground">
            {member.displayName}
          </DialogTitle>
          {jobTitle ? (
            <DialogDescription className="text-[14px] font-medium text-steel">
              {jobTitle}
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">
              Team member profile for {member.displayName}
            </DialogDescription>
          )}
        </DialogHeader>
        {bio ? (
          <p className="mt-4 text-[14px] leading-relaxed text-steel" data-team-profile-bio>
            {bio}
          </p>
        ) : null}
        <TeamContactActions member={member} featured className="mt-5" />
      </div>
    </div>
  );
}

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
  const [profileOpen, setProfileOpen] = useState(false);
  const jobTitle = publicTeamJobTitle(member.jobTitle);
  const showProfile = teamMemberHasProfileDialog(member);
  const showContact = teamMemberHasPublicContact(member);
  const firstName = teamMemberFirstName(member.displayName);

  return (
    <article
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md border border-border/70 bg-[#101826]",
        TEAM_CARD_MAX_WIDTH_CLASS,
      )}
      data-team-card={variant}
      data-team-portrait="card"
    >
      <TeamPortrait member={member} priority={priority} />

      <div
        className={cn(
          "flex flex-1 flex-col px-4",
          compact ? "gap-2 py-3.5" : "gap-2.5 py-4",
        )}
        data-team-card-body
      >
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

        {/* Bios stay out of the directory grid — only in the profile dialog. */}
        {(showProfile || showContact) && (
          <div className="mt-auto flex flex-col gap-2.5 pt-1">
            {showProfile ? (
              <>
                <button
                  type="button"
                  className="inline-flex w-fit items-center text-[11px] font-semibold uppercase tracking-[0.14em] text-primary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  onClick={() => setProfileOpen(true)}
                  data-team-profile-trigger
                  aria-haspopup="dialog"
                >
                  More about {firstName}
                </button>
                <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
                  <DialogContent
                    className="max-h-[min(92vh,720px)] w-[calc(100%-1.5rem)] max-w-xl overflow-y-auto border-border bg-ink p-5 text-foreground sm:p-6"
                    data-team-profile-dialog
                  >
                    <TeamMemberProfileBody member={member} />
                  </DialogContent>
                </Dialog>
              </>
            ) : null}
            {showContact ? (
              <TeamContactActions member={member} featured={variant === "featured"} />
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}

/** Shared responsive team grid — ~240–280px cards, no full-bleed stretch. */
export function teamMemberGridClassName(compact = false) {
  return cn(
    "grid grid-cols-1 justify-items-stretch gap-x-7 gap-y-8 sm:grid-cols-2 sm:justify-items-start md:grid-cols-3 xl:grid-cols-4",
    compact ? "gap-x-7 gap-y-8" : "gap-x-8 gap-y-9 sm:gap-x-8 sm:gap-y-10",
  );
}

export function MeetTheTeamTeaser({
  members,
}: {
  members: PublicTeamMember[];
}) {
  if (!members.length) return null;
  const featured = members.slice(0, 4);
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
          {featured.map((member, index) => (
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
