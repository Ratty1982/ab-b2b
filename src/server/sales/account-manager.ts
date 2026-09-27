/**
 * Authoritative customer Account Manager resolver.
 *
 * Source of truth: Company → primary CompanyAssignment → active SalesRep → User,
 * enriched by an optional public TeamMember profile (Website → Team) for
 * customer-facing job title, phone, mobile, and photo.
 *
 * Never invents people. Never exposes internal IDs, Autopart data, or notes.
 */
import { prisma } from "@/infra/database/client";
import { cmsMediaPublicPath, cmsFocalStyle } from "@/lib/cms-media";
import {
  publicTeamJobTitle,
  teamMemberDisplayName,
  teamMemberInitials,
} from "@/domain/team";
import { getEmailFooterMeta } from "@/server/email/settings";

export type AccountManagerPhoto = {
  src: string;
  alt: string;
  objectPosition: string;
};

/** Customer-safe account manager contact card. */
export type AccountManagerPublic = {
  /** Display name (never empty when this object is returned). */
  name: string;
  /** Initials for avatar fallback. */
  initials: string;
  /** Customer-facing job title, or "Account Manager". */
  jobTitle: string;
  /** Contact email when available. */
  email: string | null;
  /** Landline when configured on a contactable TeamMember profile. */
  phone: string | null;
  /** Mobile when configured on a contactable TeamMember profile. */
  mobile: string | null;
  /** Profile photo from CMS media when configured. */
  photo: AccountManagerPhoto | null;
  /** mailto: href when email present. */
  mailtoHref: string | null;
  /** tel: href for landline when present. */
  telHref: string | null;
  /** tel: href for mobile when present. */
  mobileTelHref: string | null;
};

export type GeneralTradeContact = {
  label: string;
  email: string | null;
  mailtoHref: string | null;
};

function telHref(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? `tel:${digits}` : null;
}

function mailtoHref(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e && e.includes("@") ? `mailto:${e}` : null;
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

const salesRepAmInclude = {
  user: { select: { name: true, email: true, status: true } },
  publicTeamProfile: {
    include: {
      photoMedia: {
        select: { id: true, altText: true, width: true, height: true },
      },
    },
  },
} as const;

type RepWithProfile = {
  active: boolean;
  user: { name: string | null; email: string; status: string };
  publicTeamProfile: {
    isPublic: boolean;
    isContactable: boolean;
    firstName: string;
    lastName: string;
    jobTitle: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    photoAlt: string | null;
    photoFocalX: number;
    photoFocalY: number;
    photoMedia: { id: string; altText: string | null } | null;
  } | null;
};

function mapRepToAccountManager(rep: RepWithProfile): AccountManagerPublic | null {
  if (!rep.active || rep.user.status !== "ACTIVE") return null;

  const profile = rep.publicTeamProfile;
  const usePublic = Boolean(profile?.isPublic);
  const contactable = Boolean(usePublic && profile?.isContactable);

  const name =
    usePublic && profile
      ? teamMemberDisplayName(profile.firstName, profile.lastName)
      : rep.user.name?.trim() || rep.user.email;

  const jobTitle =
    (usePublic && profile ? publicTeamJobTitle(profile.jobTitle) : null) || "Account Manager";

  const email =
    contactable && profile?.email?.trim()
      ? profile.email.trim().toLowerCase()
      : rep.user.email.trim().toLowerCase();

  const phone = contactable && profile?.phone?.trim() ? profile.phone.trim() : null;
  const mobile = contactable && profile?.mobile?.trim() ? profile.mobile.trim() : null;

  let photo: AccountManagerPhoto | null = null;
  if (usePublic && profile?.photoMedia) {
    photo = {
      src: cmsMediaPublicPath(profile.photoMedia.id),
      alt: profile.photoAlt || profile.photoMedia.altText || name,
      objectPosition: cmsFocalStyle({
        focalX: profile.photoFocalX,
        focalY: profile.photoFocalY,
      }).objectPosition as string,
    };
  }

  return {
    name,
    initials:
      usePublic && profile
        ? teamMemberInitials(profile.firstName, profile.lastName)
        : initialsFromName(name),
    jobTitle,
    email: email || null,
    phone,
    mobile,
    photo,
    mailtoHref: mailtoHref(email),
    telHref: telHref(phone),
    mobileTelHref: telHref(mobile),
  };
}

/**
 * Resolve the assigned Account Manager for a company.
 * Returns null when no active primary SalesRep is assigned.
 */
export async function resolveAccountManagerForCompany(
  companyId: string,
): Promise<AccountManagerPublic | null> {
  const assignment = await prisma.companyAssignment.findFirst({
    where: { companyId, isPrimary: true },
    include: {
      salesRep: { include: salesRepAmInclude },
    },
  });
  if (!assignment?.salesRep) return null;
  return mapRepToAccountManager(assignment.salesRep);
}

/**
 * Resolve Account Manager by SalesRep id (e.g. quote prepared-by).
 * Returns null when the rep is inactive / missing.
 */
export async function resolveAccountManagerForSalesRep(
  salesRepId: string,
): Promise<AccountManagerPublic | null> {
  const rep = await prisma.salesRep.findUnique({
    where: { id: salesRepId },
    include: salesRepAmInclude,
  });
  if (!rep) return null;
  return mapRepToAccountManager(rep);
}

/**
 * General Automotive Brands contact for companies with no assigned SalesRep.
 * Uses configured transactional reply-to / from email only — never invents addresses.
 */
export async function resolveGeneralTradeContact(): Promise<GeneralTradeContact> {
  const footer = await getEmailFooterMeta();
  const email = (footer.replyToEmail || footer.fromEmail || "").trim().toLowerCase() || null;
  return {
    label: "Automotive Brands",
    email,
    mailtoHref: mailtoHref(email),
  };
}
