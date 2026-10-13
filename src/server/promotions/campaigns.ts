/**
 * Sales promotion campaigns.
 * Approval gates isActive. The trade-price resolver still decides the unit price.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireAnySystemPermission } from "@/server/rbac/guards";
import { hasPermission, type LoadedAccessProfile } from "@/server/rbac/access";
import { previewPromotionUnit, parsePromotionMetadata } from "@/domain/pricing-management";
import { customerPromotionCopy } from "@/domain/customer-promotions";
import {
  CampaignInputError,
  assertCampaignCommercial,
  campaignDisplayStatus,
  campaignDraftSchema,
  campaignImageUrl,
  campaignReviewSchema,
  type CampaignGovernance,
} from "@/domain/promotion-campaigns";

const READ_PERMISSIONS = ["promotions.submit", "promotions.approve", "promotions.report"] as const;

type CampaignRow = {
  id: string;
  code: string;
  name: string;
  type: "PERCENT" | "FIXED" | "QUANTITY_DEAL";
  value: Prisma.Decimal;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  metadata: Prisma.JsonValue;
  campaignStatus: CampaignGovernance;
  description: string | null;
  imageUrl: string | null;
  appliesToNegotiatedPrices: boolean;
  createdByUserId: string | null;
  submittedAt: Date | null;
  submittedByUserId: string | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  reviewReason: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

async function requireReader(actorUserId: string): Promise<LoadedAccessProfile> {
  const profile = await requireAnySystemPermission(actorUserId, [...READ_PERMISSIONS]);
  if (profile.actorType !== "INTERNAL") {
    throw new AuthError("Trade users cannot manage promotions", "FORBIDDEN", 403);
  }
  return profile;
}

async function requireApprover(actorUserId: string): Promise<LoadedAccessProfile> {
  const profile = await requireReader(actorUserId);
  if (!hasPermission(profile, "promotions.approve")) {
    throw new AuthError("Not permitted to approve promotions", "FORBIDDEN", 403);
  }
  return profile;
}

function flags(profile: LoadedAccessProfile) {
  return {
    canSubmit: hasPermission(profile, "promotions.submit"),
    canApprove: hasPermission(profile, "promotions.approve"),
    canReport: hasPermission(profile, "promotions.report") || hasPermission(profile, "promotions.approve"),
  };
}

function present(row: CampaignRow, actorUserId: string, profile: LoadedAccessProfile) {
  const at = new Date();
  const scope = parsePromotionMetadata(row.metadata);
  const copy = customerPromotionCopy(row.metadata, {
    description: row.description,
    imageUrl: row.imageUrl,
  });
  const display = campaignDisplayStatus({
    campaignStatus: row.campaignStatus,
    isActive: row.isActive,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    at,
  });
  const own = row.createdByUserId === actorUserId;
  const approver = hasPermission(profile, "promotions.approve");
  const editable =
    (approver && (row.campaignStatus === "DRAFT" || row.campaignStatus === "PENDING_APPROVAL" || row.campaignStatus === "REJECTED")) ||
    (own && (row.campaignStatus === "DRAFT" || row.campaignStatus === "REJECTED"));
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: copy.description,
    imageUrl: copy.imageUrl,
    type: row.type,
    value: row.value.toString(),
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    isActive: row.isActive,
    campaignStatus: row.campaignStatus,
    displayStatus: display.status,
    displayLabel: display.label,
    appliesToNegotiatedPrices: row.appliesToNegotiatedPrices,
    skus: scope.skus,
    catalogueWide: scope.catalogueWide,
    legacy: row.campaignStatus === "LEGACY",
    reviewReason: row.reviewReason,
    createdByUserId: row.createdByUserId,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    editable,
    canSubmit: editable && (row.campaignStatus === "DRAFT" || row.campaignStatus === "REJECTED"),
    canApprove: approver && row.campaignStatus === "PENDING_APPROVAL",
    canReject: approver && row.campaignStatus === "PENDING_APPROVAL",
    canCancel: approver && row.campaignStatus === "APPROVED",
    canSetNegotiatedPrices: approver && row.campaignStatus === "APPROVED",
  };
}

async function loadCampaign(id: string): Promise<CampaignRow> {
  const row = await prisma.promotion.findUnique({ where: { id } });
  if (!row) throw new AuthError("Promotion not found", "NOT_FOUND", 404);
  return row;
}

function metadataFor(input: {
  variantIds: string[];
  skus: string[];
  description: string | null;
  imageUrl: string | null;
}): Prisma.InputJsonValue {
  const metadata: Record<string, unknown> = {};
  if (input.variantIds.length) metadata["variantIds"] = input.variantIds;
  if (input.skus.length) metadata["skus"] = input.skus;
  if (input.description) metadata["description"] = input.description;
  if (input.imageUrl) metadata["imageUrl"] = input.imageUrl;
  return metadata as Prisma.InputJsonValue;
}

async function resolveSkus(skus: string[]): Promise<{ variantIds: string[]; skus: string[] }> {
  const wanted = [...new Set(skus.map((sku) => sku.trim()).filter(Boolean))];
  if (!wanted.length) return { variantIds: [], skus: [] };
  const rows = await prisma.productVariant.findMany({
    where: { sku: { in: wanted, mode: "insensitive" } },
    select: { id: true, sku: true },
  });
  const found = new Map(rows.map((row) => [row.sku.toUpperCase(), row]));
  const missing = wanted.filter((sku) => !found.has(sku.toUpperCase()));
  if (missing.length) {
    throw new AuthError(`Unknown SKU: ${missing.slice(0, 5).join(", ")}`, "VALIDATION", 400);
  }
  const ordered = wanted.map((sku) => found.get(sku.toUpperCase())!);
  return { variantIds: ordered.map((row) => row.id), skus: ordered.map((row) => row.sku) };
}

export async function listCampaigns(actorUserId: string) {
  const profile = await requireReader(actorUserId);
  const rows = await prisma.promotion.findMany({ orderBy: [{ updatedAt: "desc" }] });
  return { ...flags(profile), items: rows.map((row) => present(row, actorUserId, profile)) };
}

export async function getCampaign(actorUserId: string, id: string) {
  const profile = await requireReader(actorUserId);
  const row = await loadCampaign(id);
  return { ...flags(profile), campaign: present(row, actorUserId, profile) };
}

export async function saveCampaignDraft(actorUserId: string, raw: unknown) {
  const profile = await requireReader(actorUserId);
  if (!hasPermission(profile, "promotions.submit") && !hasPermission(profile, "promotions.approve")) {
    throw new AuthError("Not permitted to edit promotions", "FORBIDDEN", 403);
  }
  const input = campaignDraftSchema.parse(raw);
  let image: string | null = null;
  try {
    image = campaignImageUrl(input.imageUrl);
    const startsAt = input.startsAt ? new Date(input.startsAt) : null;
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    assertCampaignCommercial({
      type: input.type,
      value: input.value,
      startsAt,
      endsAt,
      skus: input.skus ?? [],
      requireSkus: false,
    });
  } catch (error) {
    if (error instanceof CampaignInputError) throw new AuthError(error.message, "VALIDATION", 400);
    throw error;
  }

  const existing = input.id ? await loadCampaign(input.id) : null;
  if (existing) {
    const view = present(existing, actorUserId, profile);
    if (existing.campaignStatus === "LEGACY") {
      throw new AuthError("Existing promotions stay on the current pricing rules", "CAMPAIGN_LEGACY", 400);
    }
    if (!view.editable) {
      throw new AuthError("This campaign cannot be edited", "CAMPAIGN_LOCKED", 409);
    }
  }

  const scope = await resolveSkus(input.skus ?? []);
  const description = input.description?.trim() ? input.description.trim().slice(0, 500) : null;
  const approver = hasPermission(profile, "promotions.approve");
  const appliesToNegotiatedPrices = approver
    ? (input.appliesToNegotiatedPrices ?? existing?.appliesToNegotiatedPrices ?? false)
    : (existing?.appliesToNegotiatedPrices ?? false);
  const data = {
    code: input.code,
    name: input.name.trim(),
    type: input.type,
    value: input.value.toFixed(4),
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    description,
    imageUrl: image,
    metadata: metadataFor({ ...scope, description, imageUrl: image }),
    appliesToNegotiatedPrices,
    isActive: false,
  };

  const duplicate = await prisma.promotion.findUnique({ where: { code: input.code } });
  if (duplicate && duplicate.id !== existing?.id) {
    throw new AuthError("Promotion code is already in use", "CODE_TAKEN", 409);
  }

  const row = existing
    ? await prisma.promotion.update({ where: { id: existing.id }, data })
    : await prisma.promotion.create({
        data: {
          ...data,
          campaignStatus: "DRAFT",
          createdByUserId: actorUserId,
        },
      });

  await recordAuditEvent({
    action: existing ? "promotions.campaign.updated" : "promotions.campaign.created",
    entityType: "Promotion",
    entityId: row.id,
    actorUserId,
    after: {
      code: row.code,
      campaignStatus: row.campaignStatus,
      type: row.type,
      appliesToNegotiatedPrices: row.appliesToNegotiatedPrices,
      skus: scope.skus,
    },
  });
  return present(row, actorUserId, profile);
}

export async function submitCampaign(actorUserId: string, raw: unknown) {
  const profile = await requireReader(actorUserId);
  const input = campaignReviewSchema.parse(raw);
  const existing = await loadCampaign(input.id);
  if (existing.campaignStatus === "LEGACY") {
    throw new AuthError("Existing promotions are already in the pricing engine", "CAMPAIGN_LEGACY", 400);
  }
  const own = existing.createdByUserId === actorUserId;
  const approver = hasPermission(profile, "promotions.approve");
  if (!own && !approver) throw new AuthError("Not permitted to submit this campaign", "FORBIDDEN", 403);
  if (!hasPermission(profile, "promotions.submit") && !approver) {
    throw new AuthError("Not permitted to submit promotions", "FORBIDDEN", 403);
  }
  if (existing.campaignStatus !== "DRAFT" && existing.campaignStatus !== "REJECTED") {
    throw new AuthError("Only a draft or rejected campaign can be submitted", "CAMPAIGN_LOCKED", 409);
  }
  const scope = parsePromotionMetadata(existing.metadata);
  try {
    assertCampaignCommercial({
      type: existing.type === "FIXED" ? "FIXED" : "PERCENT",
      value: Number(existing.value.toString()),
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
      skus: scope.skus,
      requireSkus: true,
    });
  } catch (error) {
    if (error instanceof CampaignInputError) throw new AuthError(error.message, "VALIDATION", 400);
    throw error;
  }
  if (existing.type === "QUANTITY_DEAL") {
    throw new AuthError("QUANTITY_DEAL is not applied by the pricing engine", "VALIDATION", 400);
  }
  const row = await prisma.promotion.update({
    where: { id: existing.id },
    data: {
      campaignStatus: "PENDING_APPROVAL",
      isActive: false,
      submittedAt: new Date(),
      submittedByUserId: actorUserId,
      reviewReason: null,
    },
  });
  await recordAuditEvent({
    action: "promotions.campaign.submitted",
    entityType: "Promotion",
    entityId: row.id,
    actorUserId,
    after: { code: row.code, campaignStatus: row.campaignStatus },
  });
  return present(row, actorUserId, profile);
}

export async function approveCampaign(actorUserId: string, raw: unknown) {
  const profile = await requireApprover(actorUserId);
  const input = campaignReviewSchema.parse(raw);
  const existing = await loadCampaign(input.id);
  if (existing.campaignStatus !== "PENDING_APPROVAL") {
    throw new AuthError("Only a campaign pending approval can be approved", "CAMPAIGN_LOCKED", 409);
  }
  if (existing.type === "QUANTITY_DEAL") {
    throw new AuthError("QUANTITY_DEAL cannot be activated", "VALIDATION", 400);
  }
  const now = new Date();
  if (existing.endsAt && existing.endsAt <= now) {
    throw new AuthError("This campaign has already ended", "CAMPAIGN_EXPIRED", 400);
  }
  const scope = parsePromotionMetadata(existing.metadata);
  if (scope.skus.length === 0 && scope.variantIds.length === 0) {
    throw new AuthError("Choose at least one product SKU", "VALIDATION", 400);
  }
  const row = await prisma.promotion.update({
    where: { id: existing.id },
    data: {
      campaignStatus: "APPROVED",
      isActive: true,
      reviewedAt: now,
      reviewedByUserId: actorUserId,
      reviewReason: null,
      appliesToNegotiatedPrices: input.appliesToNegotiatedPrices ?? false,
    },
  });
  await recordAuditEvent({
    action: "promotions.campaign.approved",
    entityType: "Promotion",
    entityId: row.id,
    actorUserId,
    after: {
      code: row.code,
      campaignStatus: row.campaignStatus,
      isActive: true,
      appliesToNegotiatedPrices: row.appliesToNegotiatedPrices,
    },
  });
  return present(row, actorUserId, profile);
}

export async function rejectCampaign(actorUserId: string, raw: unknown) {
  const profile = await requireApprover(actorUserId);
  const input = campaignReviewSchema.parse(raw);
  if (!input.reason) throw new AuthError("A rejection reason is required", "VALIDATION", 400);
  const existing = await loadCampaign(input.id);
  if (existing.campaignStatus !== "PENDING_APPROVAL") {
    throw new AuthError("Only a campaign pending approval can be rejected", "CAMPAIGN_LOCKED", 409);
  }
  const row = await prisma.promotion.update({
    where: { id: existing.id },
    data: {
      campaignStatus: "REJECTED",
      isActive: false,
      reviewedAt: new Date(),
      reviewedByUserId: actorUserId,
      reviewReason: input.reason,
    },
  });
  await recordAuditEvent({
    action: "promotions.campaign.rejected",
    entityType: "Promotion",
    entityId: row.id,
    actorUserId,
    after: { code: row.code, campaignStatus: row.campaignStatus, reason: input.reason },
  });
  return present(row, actorUserId, profile);
}

export async function cancelCampaign(actorUserId: string, raw: unknown) {
  const profile = await requireApprover(actorUserId);
  const input = campaignReviewSchema.parse(raw);
  if (!input.reason) throw new AuthError("A cancellation reason is required", "VALIDATION", 400);
  const existing = await loadCampaign(input.id);
  if (existing.campaignStatus !== "APPROVED") {
    throw new AuthError("Only an approved campaign can be cancelled", "CAMPAIGN_LOCKED", 409);
  }
  const row = await prisma.promotion.update({
    where: { id: existing.id },
    data: {
      campaignStatus: "CANCELLED",
      isActive: false,
      cancelledAt: new Date(),
      cancelledByUserId: actorUserId,
      reviewReason: input.reason,
    },
  });
  await recordAuditEvent({
    action: "promotions.campaign.cancelled",
    entityType: "Promotion",
    entityId: row.id,
    actorUserId,
    after: { code: row.code, campaignStatus: row.campaignStatus, isActive: false, reason: input.reason },
  });
  return present(row, actorUserId, profile);
}

export async function setNegotiatedEligibility(actorUserId: string, raw: unknown) {
  const profile = await requireApprover(actorUserId);
  const input = campaignReviewSchema.parse(raw);
  if (input.appliesToNegotiatedPrices == null) {
    throw new AuthError("Choose whether negotiated prices are eligible", "VALIDATION", 400);
  }
  const existing = await loadCampaign(input.id);
  if (existing.campaignStatus !== "APPROVED") {
    throw new AuthError("Negotiated-price eligibility is set on an approved campaign", "CAMPAIGN_LOCKED", 409);
  }
  const row = await prisma.promotion.update({
    where: { id: existing.id },
    data: { appliesToNegotiatedPrices: input.appliesToNegotiatedPrices },
  });
  await recordAuditEvent({
    action: "promotions.campaign.stacking_updated",
    entityType: "Promotion",
    entityId: row.id,
    actorUserId,
    before: { appliesToNegotiatedPrices: existing.appliesToNegotiatedPrices },
    after: { appliesToNegotiatedPrices: row.appliesToNegotiatedPrices, code: row.code },
  });
  return present(row, actorUserId, profile);
}

export async function previewCampaign(actorUserId: string, raw: unknown) {
  await requireReader(actorUserId);
  const input = campaignDraftSchema.pick({ type: true, value: true }).parse(raw);
  const preview = previewPromotionUnit({ unitPrice: "10.00", type: input.type, value: input.value });
  return {
    ...preview,
    negotiatedNote:
      "New campaigns leave negotiated customer prices unchanged unless management allows an additional discount.",
  };
}

export async function searchCampaignProducts(actorUserId: string, query: string) {
  await requireReader(actorUserId);
  const q = query.trim();
  if (q.length < 1) return [];
  const rows = await prisma.productVariant.findMany({
    where: {
      product: { isActive: true },
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { product: { name: { contains: q, mode: "insensitive" } } },
        { product: { brand: { name: { contains: q, mode: "insensitive" } } } },
      ],
    },
    take: 20,
    select: {
      id: true,
      sku: true,
      product: { select: { name: true, brand: { select: { name: true } } } },
    },
    orderBy: { sku: "asc" },
  });
  return rows.map((row) => ({
    variantId: row.id,
    sku: row.sku,
    name: row.product.name,
    brand: row.product.brand.name,
  }));
}
