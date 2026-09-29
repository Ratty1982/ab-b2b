import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { dueAtFromDateOnly } from "@/domain/sales-followup";
import {
  assertLeadAccess,
  canLogCrmActivity,
  requireCrmMutator,
  requireCrmViewer,
  resolveCrmCompanyScope,
} from "@/server/crm/scope";

const listSchema = z.object({
  q: z.string().max(200).optional().nullable(),
  status: z
    .enum(["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED", "ACTIVE", "ALL"])
    .optional()
    .nullable(),
  ownerId: z.string().optional().nullable(),
  source: z.string().max(80).optional().nullable(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

export async function listCrmLeads(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  const input = listSchema.parse(raw ?? {});
  const where: Prisma.LeadWhereInput = {};

  if (
    !hasPermission(profile, "crm.manage") &&
    !hasPermission(profile, "sales.view_all_accounts") &&
    !hasPermission(profile, "admin.access")
  ) {
    const scope = await resolveCrmCompanyScope(profile);
    where.OR = [
      { ownerId: actorUserId },
      ...(scope !== "all" && scope.length ? [{ companyId: { in: scope } }] : []),
    ];
  }

  if (!input.status || input.status === "ACTIVE") {
    where.status = { in: ["NEW", "CONTACTED", "QUALIFIED"] };
  } else if (input.status !== "ALL") {
    where.status = input.status;
  }
  if (input.ownerId) where.ownerId = input.ownerId;
  if (input.source?.trim()) where.source = input.source.trim();
  if (input.q?.trim()) {
    const qq = input.q.trim();
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      {
        OR: [
          { companyName: { contains: qq, mode: "insensitive" } },
          { contactName: { contains: qq, mode: "insensitive" } },
          { email: { contains: qq, mode: "insensitive" } },
          { phone: { contains: qq, mode: "insensitive" } },
        ],
      },
    ];
  }

  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: leadListSelect,
    }),
  ]);

  return { items: rows.map(mapLeadList), page, pageSize, total };
}

const leadListSelect = {
  id: true,
  companyName: true,
  contactName: true,
  email: true,
  phone: true,
  status: true,
  source: true,
  nextActionAt: true,
  nextActionNote: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true, email: true } },
  company: { select: { id: true, name: true, autopartCustomerCode: true } },
} as const;

function mapLeadList(l: {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  source: string | null;
  nextActionAt: Date | null;
  nextActionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  owner: { id: string; name: string | null; email: string } | null;
  company: { id: string; name: string; autopartCustomerCode: string | null } | null;
}) {
  return {
    id: l.id,
    companyName: l.companyName,
    contactName: l.contactName,
    email: l.email,
    phone: l.phone,
    status: l.status,
    source: l.source,
    nextActionAt: l.nextActionAt?.toISOString() ?? null,
    nextActionNote: l.nextActionNote,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
    ownerName: l.owner?.name || l.owner?.email || null,
    ownerId: l.owner?.id ?? null,
    company: l.company,
  };
}

export async function getCrmLead(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  const { leadId } = z.object({ leadId: z.string().min(1) }).parse(raw ?? {});
  await assertLeadAccess(profile, leadId);
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      company: {
        select: {
          id: true,
          name: true,
          tradingName: true,
          autopartCustomerCode: true,
          status: true,
        },
      },
      activities: {
        orderBy: { occurredAt: "desc" },
        take: 30,
        include: { user: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  return {
    id: lead.id,
    companyName: lead.companyName,
    contactName: lead.contactName,
    email: lead.email,
    phone: lead.phone,
    status: lead.status,
    source: lead.source,
    notes: lead.notes,
    nextActionAt: lead.nextActionAt?.toISOString() ?? null,
    nextActionNote: lead.nextActionNote,
    lostReason: lead.lostReason,
    convertedAt: lead.convertedAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    owner: lead.owner
      ? { id: lead.owner.id, name: lead.owner.name || lead.owner.email }
      : null,
    company: lead.company,
    activities: lead.activities.map((a) => ({
      id: a.id,
      type: a.type,
      subject: a.subject,
      body: a.body,
      occurredAt: a.occurredAt.toISOString(),
      actorName: a.user?.name || a.user?.email || null,
    })),
  };
}

const createSchema = z.object({
  companyName: z.string().min(1).max(200),
  contactName: z.string().max(200).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  phone: z.string().max(80).optional().nullable(),
  source: z.string().max(80).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  ownerId: z.string().optional().nullable(),
  nextActionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  nextActionNote: z.string().max(500).optional().nullable(),
});

export async function createCrmLead(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  requireCrmMutator(profile);
  const input = createSchema.parse(raw ?? {});
  const ownerId = input.ownerId || actorUserId;
  const lead = await prisma.lead.create({
    data: {
      companyName: input.companyName.trim(),
      contactName: input.contactName?.trim() || null,
      email: input.email?.trim() || null,
      phone: input.phone?.trim() || null,
      source: input.source?.trim() || "SALES_REP",
      notes: input.notes?.trim() || null,
      ownerId,
      status: "NEW",
      nextActionAt: input.nextActionAt ? dueAtFromDateOnly(input.nextActionAt) : null,
      nextActionNote: input.nextActionNote?.trim() || null,
    },
  });
  await recordAuditEvent({
    action: "crm.lead.created",
    entityType: "Lead",
    entityId: lead.id,
    actorUserId,
    metadata: { status: lead.status, source: lead.source },
  });
  return { id: lead.id };
}

const updateSchema = z.object({
  leadId: z.string().min(1),
  companyName: z.string().min(1).max(200).optional(),
  contactName: z.string().max(200).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  phone: z.string().max(80).optional().nullable(),
  source: z.string().max(80).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
  ownerId: z.string().optional().nullable(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED"]).optional(),
  nextActionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  nextActionNote: z.string().max(500).optional().nullable(),
});

export async function updateCrmLead(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  requireCrmMutator(profile);
  const input = updateSchema.parse(raw ?? {});
  const existing = await assertLeadAccess(profile, input.leadId);
  if (existing && (await prisma.lead.findUnique({ where: { id: input.leadId } }))?.status === "CONVERTED") {
    throw new AuthError("Converted leads cannot be edited this way", "BAD_REQUEST", 400);
  }
  const lead = await prisma.lead.update({
    where: { id: input.leadId },
    data: {
      ...(input.companyName != null ? { companyName: input.companyName.trim() } : {}),
      ...(input.contactName !== undefined ? { contactName: input.contactName?.trim() || null } : {}),
      ...(input.email !== undefined ? { email: input.email?.trim() || null } : {}),
      ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
      ...(input.source !== undefined ? { source: input.source?.trim() || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.nextActionAt !== undefined
        ? { nextActionAt: input.nextActionAt ? dueAtFromDateOnly(input.nextActionAt) : null }
        : {}),
      ...(input.nextActionNote !== undefined
        ? { nextActionNote: input.nextActionNote?.trim() || null }
        : {}),
    },
  });
  await recordAuditEvent({
    action: "crm.lead.updated",
    entityType: "Lead",
    entityId: lead.id,
    actorUserId,
    metadata: { status: lead.status },
  });
  return { id: lead.id, status: lead.status };
}

export async function markCrmLeadLost(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  requireCrmMutator(profile);
  const input = z
    .object({
      leadId: z.string().min(1),
      reason: z.string().min(1).max(120),
      notes: z.string().max(2000).optional().nullable(),
    })
    .parse(raw ?? {});
  await assertLeadAccess(profile, input.leadId);
  const existingNotes = (
    await prisma.lead.findUnique({
      where: { id: input.leadId },
      select: { notes: true },
    })
  )?.notes;
  const lead = await prisma.lead.update({
    where: { id: input.leadId },
    data: {
      status: "DISQUALIFIED",
      lostReason: input.reason,
      ...(input.notes?.trim()
        ? {
            notes: `${existingNotes ?? ""}\n\nLost: ${input.notes.trim()}`.trim(),
          }
        : {}),
    },
  });
  await recordAuditEvent({
    action: "crm.lead.lost",
    entityType: "Lead",
    entityId: lead.id,
    actorUserId,
    metadata: { reason: input.reason },
  });
  return { id: lead.id, status: lead.status };
}

export async function searchCompaniesForLeadConvert(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  requireCrmMutator(profile);
  const { q } = z.object({ q: z.string().min(1).max(200) }).parse(raw ?? {});
  const scope = await resolveCrmCompanyScope(profile);
  const qq = q.trim();
  const companies = await prisma.company.findMany({
    where: {
      AND: [
        scope === "all" ? {} : { id: { in: scope.length ? scope : ["__none__"] } },
        {
          OR: [
            { name: { contains: qq, mode: "insensitive" } },
            { tradingName: { contains: qq, mode: "insensitive" } },
            { primaryEmail: { contains: qq, mode: "insensitive" } },
            { autopartCustomerCode: { contains: qq, mode: "insensitive" } },
            { accountNumber: { contains: qq, mode: "insensitive" } },
          ],
        },
      ],
    },
    take: 15,
    select: {
      id: true,
      name: true,
      tradingName: true,
      status: true,
      autopartCustomerCode: true,
      primaryEmail: true,
    },
    orderBy: { name: "asc" },
  });
  return { items: companies };
}

export async function convertCrmLead(actorUserId: string, raw: unknown) {
  const profile = await requireCrmViewer(actorUserId);
  requireCrmMutator(profile);
  const input = z
    .object({
      leadId: z.string().min(1),
      mode: z.enum(["LINK_EXISTING", "CREATE_NEW"]),
      companyId: z.string().optional().nullable(),
      createOpportunity: z.boolean().optional(),
      opportunityTitle: z.string().max(200).optional().nullable(),
    })
    .parse(raw ?? {});

  const lead = await prisma.lead.findUnique({ where: { id: input.leadId } });
  if (!lead) throw new AuthError("Lead not found", "NOT_FOUND", 404);
  await assertLeadAccess(profile, input.leadId);
  if (lead.status === "CONVERTED") {
    throw new AuthError("Lead already converted", "BAD_REQUEST", 400);
  }

  let companyId = lead.companyId;
  if (input.mode === "LINK_EXISTING") {
    if (!input.companyId) throw new AuthError("companyId required", "BAD_REQUEST", 400);
    const co = await prisma.company.findUnique({ where: { id: input.companyId } });
    if (!co) throw new AuthError("Company not found", "NOT_FOUND", 404);
    companyId = co.id;
  } else {
    const created = await prisma.company.create({
      data: {
        name: lead.companyName,
        status: "PROSPECT",
        paymentTerms: "30 days",
        primaryEmail: lead.email,
        phone: lead.phone,
      },
    });
    companyId = created.id;
    if (lead.contactName?.trim()) {
      const parts = lead.contactName.trim().split(/\s+/);
      await prisma.contact.create({
        data: {
          companyId,
          firstName: parts[0]!,
          lastName: parts.slice(1).join(" ") || parts[0]!,
          email: lead.email,
          phone: lead.phone,
          isPrimary: true,
        },
      });
    }
  }

  const updated = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      status: "CONVERTED",
      companyId,
      convertedAt: new Date(),
    },
  });

  let opportunityId: string | null = null;
  if (input.createOpportunity) {
    const opp = await prisma.opportunity.create({
      data: {
        companyId: companyId!,
        title: input.opportunityTitle?.trim() || `Opportunity — ${lead.companyName}`,
        stage: "NEW_LEAD",
        ownerId: lead.ownerId ?? actorUserId,
      },
    });
    opportunityId = opp.id;
    await recordAuditEvent({
      action: "crm.opportunity.created",
      entityType: "Opportunity",
      entityId: opp.id,
      actorUserId,
      companyId,
      metadata: { fromLeadId: lead.id },
    });
  }

  if (canLogCrmActivity(profile)) {
    await prisma.activity.create({
      data: {
        companyId,
        leadId: lead.id,
        userId: actorUserId,
        type: "SYSTEM",
        subject: "Lead converted",
        body: `Lead “${lead.companyName}” converted and linked to company.`,
        metadata: { kind: "lead_converted", leadId: lead.id },
      },
    });
  }

  await recordAuditEvent({
    action: "crm.lead.converted",
    entityType: "Lead",
    entityId: lead.id,
    actorUserId,
    companyId,
    metadata: { mode: input.mode, opportunityId },
  });

  // Lifecycle: CREATE_NEW sets PROSPECT only; never alter existing ACTIVE company status.
  return {
    leadId: updated.id,
    companyId,
    opportunityId,
    status: updated.status,
  };
}
