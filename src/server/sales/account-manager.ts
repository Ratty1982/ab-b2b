/**
 * Authoritative customer Account Manager resolver.
 *
 * Source of truth: Company → primary CompanyAssignment → active SalesRep → User,
 * using SalesRep customer-facing profile fields first, then optional linked
 * TeamMember enrichment, then User email fallback.
 *
 * Never invents people. Never exposes internal IDs, Autopart data, roles, or notes.
 */
import { prisma } from "@/infra/database/client";
import { cmsMediaPublicPath, cmsFocalStyle } from "@/lib/cms-media";
import {
  publicTeamJobTitle,
  teamMemberDisplayName,
  teamMemberInitials,
} from "@/domain/team";
import { defaultSalesRepJobTitle, telHrefFromPhone } from "@/domain/sales-rep-profile";
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
  /** Contact email when customer contact is enabled and available. */
  email: string | null;
  /** Landline when customer contact is enabled and configured. */
  phone: string | null;
  /** Mobile when customer contact is enabled and configured. */
  mobile: string | null;
  /** Profile photo when configured. */
  photo: AccountManagerPhoto | null;
  /** mailto: href when email present. */
  mailtoHref: string | null;
  /** tel: href for landline when present. */
  telHref: string | null;
  /** tel: href for mobile when present. */
  mobileTelHref: string | null;
  /** Preferred CTA: mailto, else landline tel, else mobile tel. */
  primaryContactHref: string | null;
  /** Label for primary CTA. */
  primaryContactLabel: string | null;
};

export type GeneralTradeContact = {
  label: string;
  email: string | null;
  mailtoHref: string | null;
};

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

export const salesRepAmInclude = {
  user: { select: { id: true, name: true, email: true, status: true } },
  photoMedia: {
    select: { id: true, altText: true, width: true, height: true },
  },
  publicTeamProfile: {
    include: {
      photoMedia: {
        select: { id: true, altText: true, width: true, height: true },
      },
    },
  },
} as const;

type RepWithProfile = {
  id: string;
  active: boolean;
  displayName: string | null;
  jobTitle: string | null;
  businessEmail: string | null;
  phone: string | null;
  mobile: string | null;
  customerContactEnabled: boolean;
  photoAlt: string | null;
  photoFocalX: number;
  photoFocalY: number;
  photoMedia: { id: string; altText: string | null } | null;
  user: { id: string; name: string | null; email: string; status: string };
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
  const teamPublic = Boolean(profile?.isPublic);
  const teamContactable = Boolean(teamPublic && profile?.isContactable);
  const contactEnabled = rep.customerContactEnabled !== false;

  const teamName =
    teamPublic && profile ? teamMemberDisplayName(profile.firstName, profile.lastName) : null;
  const name =
    rep.displayName?.trim() || teamName || rep.user.name?.trim() || rep.user.email;

  const jobTitle =
    rep.jobTitle?.trim() ||
    (teamPublic && profile ? publicTeamJobTitle(profile.jobTitle) : null) ||
    defaultSalesRepJobTitle(null);

  let email: string | null = null;
  let phone: string | null = null;
  let mobile: string | null = null;

  if (contactEnabled) {
    email =
      (rep.businessEmail?.trim().toLowerCase() || null) ||
      (teamContactable && profile?.email?.trim()
        ? profile.email.trim().toLowerCase()
        : null) ||
      rep.user.email.trim().toLowerCase() ||
      null;

    phone =
      (rep.phone?.trim() || null) ||
      (teamContactable && profile?.phone?.trim() ? profile.phone.trim() : null);

    mobile =
      (rep.mobile?.trim() || null) ||
      (teamContactable && profile?.mobile?.trim() ? profile.mobile.trim() : null);
  }

  let photo: AccountManagerPhoto | null = null;
  if (rep.photoMedia) {
    photo = {
      src: cmsMediaPublicPath(rep.photoMedia.id),
      alt: rep.photoAlt || rep.photoMedia.altText || name,
      objectPosition: cmsFocalStyle({
        focalX: rep.photoFocalX,
        focalY: rep.photoFocalY,
      }).objectPosition as string,
    };
  } else if (teamPublic && profile?.photoMedia) {
    photo = {
      src: cmsMediaPublicPath(profile.photoMedia.id),
      alt: profile.photoAlt || profile.photoMedia.altText || name,
      objectPosition: cmsFocalStyle({
        focalX: profile.photoFocalX,
        focalY: profile.photoFocalY,
      }).objectPosition as string,
    };
  }

  const mail = mailtoHref(email);
  const landline = telHrefFromPhone(phone);
  const mobileTel = telHrefFromPhone(mobile);
  const primaryContactHref = mail || landline || mobileTel;
  const primaryContactLabel = mail
    ? "Contact account manager"
    : landline || mobileTel
      ? "Call account manager"
      : null;

  return {
    name,
    initials:
      teamPublic && profile
        ? teamMemberInitials(profile.firstName, profile.lastName)
        : initialsFromName(name),
    jobTitle,
    email,
    phone,
    mobile,
    photo,
    mailtoHref: mail,
    telHref: landline,
    mobileTelHref: mobileTel,
    primaryContactHref,
    primaryContactLabel,
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
 * Internal routing helper for callbacks / notifications.
 * Uses the same SalesRep assignment + contact email resolution as the portal card.
 */
export async function resolveSalesRepAssignmentRoute(companyId: string): Promise<{
  salesRepId: string;
  assigneeUserId: string;
  accountManagerName: string;
  notificationEmail: string | null;
} | null> {
  const assignment = await prisma.companyAssignment.findFirst({
    where: { companyId, isPrimary: true },
    include: {
      salesRep: { include: salesRepAmInclude },
    },
  });
  const rep = assignment?.salesRep;
  if (!rep) return null;
  const am = mapRepToAccountManager(rep);
  if (!am) return null;
  return {
    salesRepId: rep.id,
    assigneeUserId: rep.user.id,
    accountManagerName: am.name,
    notificationEmail: am.email,
  };
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
