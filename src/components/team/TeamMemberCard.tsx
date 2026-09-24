import { Link } from "@tanstack/react-router";
import { Linkedin, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicTeamMember } from "@/server/team/service";

export function TeamMemberCard({
  member,
  variant = "standard",
  priority = false,
}: {
  member: PublicTeamMember;
  /** Featured sales-style cards get a slightly richer layout. */
  variant?: "standard" | "featured";
  priority?: boolean;
}) {
  const showContact =
    member.isContactable && (member.email || member.phone || member.linkedInUrl);
  const contactLabel = member.displayName.split(" ")[0] || member.displayName;

  return (
    <article
      className={cn(
        "flex h-full flex-col items-center px-4 py-6 text-center sm:px-5",
        variant === "featured" && "rounded-md border border-border/60 bg-surface/40",
      )}
      data-team-card={variant}
    >
      <div
        className="relative mx-auto aspect-square w-full max-w-[220px] overflow-hidden rounded-full border border-border/50 bg-[#0b1220]"
        data-team-photo="circle"
      >
        {member.photo ? (
          <img
            src={member.photo.src}
            alt={member.photo.alt}
            width={member.photo.width ?? 440}
            height={member.photo.height ?? 440}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className="h-full w-full object-cover"
            style={{ objectPosition: member.photo.objectPosition }}
          />
        ) : (
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center"
            aria-hidden
          >
            <img src="/brand/ab-logo.jpg" alt="" className="h-8 w-auto opacity-80" />
            <span className="font-display text-xl font-semibold tracking-wide text-white/90">
              {member.initials}
            </span>
          </div>
        )}
      </div>
      <div className="mt-5 flex flex-1 flex-col gap-2">
        <div>
          <h3 className="font-display text-lg font-semibold uppercase leading-tight text-foreground">
            {member.displayName}
          </h3>
          {member.jobTitle ? (
            <p className="mt-1 text-[13px] font-medium text-steel">{member.jobTitle}</p>
          ) : null}
          {member.department && variant === "standard" ? (
            <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-steel/80">
              {member.department.name}
            </p>
          ) : null}
        </div>
        {member.bio ? (
          <p className="text-[13px] leading-relaxed text-steel">{member.bio}</p>
        ) : null}
        {showContact ? (
          <div className="mt-auto flex flex-wrap items-center justify-center gap-3 pt-2">
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
                <span className="sr-only">LinkedIn</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
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
      <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:px-10 lg:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Meet the Team
          </p>
          <h2
            id="meet-team-teaser-heading"
            className="mt-3 font-display text-3xl font-semibold uppercase leading-tight text-foreground sm:text-4xl"
          >
            The people behind Automotive Brands
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-steel">
            Trade is built on relationships. Meet the people behind our brands, customer support and
            operations.
          </p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {members.map((member, index) => (
            <TeamMemberCard
              key={member.id}
              member={member}
              variant={member.isContactable ? "featured" : "standard"}
              priority={index < 2}
            />
          ))}
        </div>
        <div className="mt-10 text-center">
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
