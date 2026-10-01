/**
 * Autopart customer account mapping for ongoing 504 / TRM21QC imports.
 * Reuses AutopartCustomerAccountAlias + primary Company.autopartCustomerCode.
 * Explicit, auditable, no fuzzy auto-mapping.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";
import { hasPermission } from "@/server/rbac/access";
import { normaliseAccountToken } from "@/domain/autopart-report-money";
import { confirmAutopart504Import, confirmAutopartTrm21qcImport } from "@/server/companies/autopart-ongoing-sales";
import { isAutopart504Report } from "@/domain/autopart-504";
import { isAutopartTrm21qcReport } from "@/domain/autopart-trm21qc";

async function requireMappingView(userId: string) {
  const profile = await requireSystemPermission(userId, "companies.view");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade customers cannot access Autopart account mapping", "FORBIDDEN", 403);
  }
  return profile;
}

async function requireMappingEdit(userId: string) {
  const profile = await requireSystemPermission(userId, "companies.edit");
  if (profile.actorType === "TRADE") {
    throw new AuthError("Trade customers cannot map Autopart accounts", "FORBIDDEN", 403);
  }
  if (
    !hasPermission(profile, "admin.access") &&
    !hasPermission(profile, "companies.edit") &&
    !hasPermission(profile, "companies.manage_users")
  ) {
    throw new AuthError("Not permitted to map Autopart accounts", "FORBIDDEN", 403);
  }
  return profile;
}

export type AutopartAccountBinding = {
  accountCode: string;
  kind: "PRIMARY" | "ALIAS";
  companyId: string;
  companyName: string;
  aliasId: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
};

async function findBinding(accountCode: string): Promise<AutopartAccountBinding | null> {
  const code = normaliseAccountToken(accountCode);
  if (!code) return null;

  const primary = await prisma.company.findFirst({
    where: { autopartCustomerCode: { equals: code, mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      autopartCustomerCodeVerifiedBy: { select: { name: true, email: true } },
    },
  });
  if (primary?.autopartCustomerCode) {
    return {
      accountCode: code,
      kind: "PRIMARY",
      companyId: primary.id,
      companyName: primary.name,
      aliasId: null,
      verifiedAt: primary.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
      verifiedByName:
        primary.autopartCustomerCodeVerifiedBy?.name ??
        primary.autopartCustomerCodeVerifiedBy?.email ??
        null,
    };
  }

  const alias = await prisma.autopartCustomerAccountAlias.findFirst({
    where: { alias: code },
    include: {
      company: { select: { id: true, name: true } },
      verifiedBy: { select: { name: true, email: true } },
    },
  });
  if (alias) {
    return {
      accountCode: code,
      kind: "ALIAS",
      companyId: alias.companyId,
      companyName: alias.company.name,
      aliasId: alias.id,
      verifiedAt: alias.verifiedAt.toISOString(),
      verifiedByName: alias.verifiedBy.name ?? alias.verifiedBy.email,
    };
  }
  return null;
}

export async function getAutopartAccountMappingStatus(actorUserId: string, accountCode: string) {
  await requireMappingView(actorUserId);
  const code = normaliseAccountToken(accountCode);
  if (!code) throw new AuthError("Autopart account code is required", "VALIDATION", 400);
  const binding = await findBinding(code);
  return { accountCode: code, binding };
}

export async function searchCompaniesForAutopartMapping(
  actorUserId: string,
  raw: { q?: string; limit?: number },
) {
  await requireMappingView(actorUserId);
  const q = raw.q?.trim() ?? "";
  const limit = Math.min(40, Math.max(1, raw.limit ?? 20));
  if (q.length < 2) return { items: [] as const };

  const where: Prisma.CompanyWhereInput = {
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      { tradingName: { contains: q, mode: "insensitive" } },
      { accountNumber: { contains: q, mode: "insensitive" } },
      { primaryEmail: { contains: q, mode: "insensitive" } },
      { vatNumber: { contains: q, mode: "insensitive" } },
      { autopartCustomerCode: { contains: q, mode: "insensitive" } },
      { autopartAccountAliases: { some: { alias: { contains: q, mode: "insensitive" } } } },
      { contacts: { some: { OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ] } } },
      { addresses: { some: { postcode: { contains: q, mode: "insensitive" } } } },
    ],
  };

  const rows = await prisma.company.findMany({
    where,
    take: limit,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      tradingName: true,
      status: true,
      primaryEmail: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      autopartAccountAliases: {
        select: { alias: true },
        orderBy: { alias: "asc" },
        take: 8,
      },
      contacts: {
        select: { firstName: true, lastName: true, email: true },
        take: 1,
        orderBy: { createdAt: "asc" },
      },
      addresses: {
        select: { postcode: true },
        take: 1,
        orderBy: [{ isDefaultBilling: "desc" }, { createdAt: "asc" }],
      },
      assignments: {
        where: { isPrimary: true },
        take: 1,
        select: {
          salesRep: {
            select: {
              displayName: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
  });

  return {
    items: rows.map((r) => {
      const contact = r.contacts[0];
      const rep = r.assignments[0]?.salesRep;
      return {
        id: r.id,
        name: r.name,
        tradingName: r.tradingName,
        status: r.status,
        primaryEmail: r.primaryEmail,
        autopartCustomerCode: r.autopartCustomerCode,
        autopartVerified: Boolean(r.autopartCustomerCode && r.autopartCustomerCodeVerifiedAt),
        aliases: r.autopartAccountAliases.map((a) => a.alias),
        aliasCount: r.autopartAccountAliases.length,
        salesperson:
          rep?.displayName || rep?.user.name || rep?.user.email || null,
        primaryContact: contact
          ? `${contact.firstName} ${contact.lastName}`.trim()
          : null,
        postcode: r.addresses[0]?.postcode ?? null,
      };
    }),
  };
}

const mapSchema = z.object({
  accountCode: z.string().min(1).max(80),
  companyId: z.string().cuid(),
  allowReassign: z.boolean().optional().default(false),
  note: z.string().max(500).optional().nullable(),
  sourceContext: z
    .object({
      importRunId: z.string().optional(),
      diagnosticId: z.string().optional(),
    })
    .optional(),
});

/**
 * Map an Autopart account code to a Company.
 * - Empty primary → set + verify primary
 * - Different primary → add as alias (requires verified primary)
 * - Conflict with another company → require allowReassign
 */
export async function mapAutopartCustomerAccount(actorUserId: string, raw: unknown) {
  await requireMappingEdit(actorUserId);
  const input = mapSchema.parse(raw);
  const code = normaliseAccountToken(input.accountCode);
  if (!code) throw new AuthError("Autopart account code is required", "VALIDATION", 400);

  const company = await prisma.company.findUnique({
    where: { id: input.companyId },
    select: {
      id: true,
      name: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);

  const existing = await findBinding(code);
  if (existing && existing.companyId === company.id) {
    return {
      ok: true as const,
      alreadyMapped: true,
      binding: existing,
      reassigned: false,
      recoveryHint:
        "Account already mapped. Re-upload the TRM21QC/504 report to import any previously skipped lines.",
    };
  }

  if (existing && existing.companyId !== company.id) {
    if (!input.allowReassign) {
      throw new AuthError(
        `Autopart account ${code} is already mapped to ${existing.companyName}. Confirm reassignment to move it.`,
        "AUTOPART_ACCOUNT_MAPPED_ELSEWHERE",
        409,
      );
    }
    // Remove previous binding
    if (existing.kind === "ALIAS" && existing.aliasId) {
      await prisma.autopartCustomerAccountAlias.delete({ where: { id: existing.aliasId } });
    } else if (existing.kind === "PRIMARY") {
      await prisma.company.update({
        where: { id: existing.companyId },
        data: {
          autopartCustomerCode: null,
          autopartCustomerCodeVerifiedAt: null,
          autopartCustomerCodeVerifiedById: null,
        },
      });
    }
    await recordAuditEvent({
      action: "autopart.customer_account_reassigned",
      entityType: "Company",
      entityId: company.id,
      actorUserId,
      companyId: company.id,
      metadata: {
        accountCode: code,
        previousCompanyId: existing.companyId,
        previousCompanyName: existing.companyName,
        newCompanyId: company.id,
        newCompanyName: company.name,
        importRunId: input.sourceContext?.importRunId ?? null,
      },
    });
  }

  let binding: AutopartAccountBinding;

  const primaryNorm = normaliseAccountToken(company.autopartCustomerCode);
  if (!primaryNorm) {
    await prisma.company.update({
      where: { id: company.id },
      data: {
        autopartCustomerCode: code,
        autopartCustomerCodeVerifiedAt: new Date(),
        autopartCustomerCodeVerifiedById: actorUserId,
      },
    });
    binding = {
      accountCode: code,
      kind: "PRIMARY",
      companyId: company.id,
      companyName: company.name,
      aliasId: null,
      verifiedAt: new Date().toISOString(),
      verifiedByName: null,
    };
  } else if (primaryNorm === code) {
    if (!company.autopartCustomerCodeVerifiedAt) {
      await prisma.company.update({
        where: { id: company.id },
        data: {
          autopartCustomerCodeVerifiedAt: new Date(),
          autopartCustomerCodeVerifiedById: actorUserId,
        },
      });
    }
    binding = {
      accountCode: code,
      kind: "PRIMARY",
      companyId: company.id,
      companyName: company.name,
      aliasId: null,
      verifiedAt: new Date().toISOString(),
      verifiedByName: null,
    };
  } else {
    if (!company.autopartCustomerCodeVerifiedAt) {
      throw new AuthError(
        "Verify this company's primary Autopart account before adding another account as an alias",
        "AUTOPART_NOT_VERIFIED",
        400,
      );
    }
    // Ensure no other company holds this as alias (race)
    const clash = await prisma.autopartCustomerAccountAlias.findFirst({
      where: { alias: code, NOT: { companyId: company.id } },
    });
    if (clash) {
      throw new AuthError(
        `Autopart account ${code} is already mapped to another company`,
        "AUTOPART_ACCOUNT_MAPPED_ELSEWHERE",
        409,
      );
    }
    const row = await prisma.autopartCustomerAccountAlias.upsert({
      where: { companyId_alias: { companyId: company.id, alias: code } },
      create: {
        companyId: company.id,
        alias: code,
        verifiedById: actorUserId,
        note: input.note ?? "Mapped from ongoing sales import diagnostics",
      },
      update: {
        verifiedById: actorUserId,
        verifiedAt: new Date(),
        ...(input.note != null ? { note: input.note } : {}),
      },
    });
    binding = {
      accountCode: code,
      kind: "ALIAS",
      companyId: company.id,
      companyName: company.name,
      aliasId: row.id,
      verifiedAt: row.verifiedAt.toISOString(),
      verifiedByName: null,
    };
  }

  if (!existing || existing.companyId === company.id) {
    await recordAuditEvent({
      action: "autopart.customer_account_mapped",
      entityType: "Company",
      entityId: company.id,
      actorUserId,
      companyId: company.id,
      metadata: {
        accountCode: code,
        kind: binding.kind,
        importRunId: input.sourceContext?.importRunId ?? null,
        diagnosticId: input.sourceContext?.diagnosticId ?? null,
      },
    });
  }

  // Attach companyId to unmapped document headers for this account (does not invent lines).
  await prisma.autopartSalesDocument.updateMany({
    where: {
      autopartCustomerCode: { equals: code, mode: "insensitive" },
      companyId: null,
    },
    data: { companyId: company.id },
  });

  return {
    ok: true as const,
    alreadyMapped: false,
    reassigned: Boolean(existing && existing.companyId !== company.id),
    binding,
    recoveryHint:
      "Re-upload the original TRM21QC or 504 report to import previously skipped lines. Existing lines stay unchanged (idempotent).",
  };
}

export async function unmapAutopartCustomerAccount(
  actorUserId: string,
  raw: { accountCode: string; companyId: string },
) {
  await requireMappingEdit(actorUserId);
  const code = normaliseAccountToken(raw.accountCode);
  if (!code) throw new AuthError("Autopart account code is required", "VALIDATION", 400);
  const binding = await findBinding(code);
  if (!binding || binding.companyId !== raw.companyId) {
    throw new AuthError("Mapping not found for this company", "NOT_FOUND", 404);
  }
  if (binding.kind === "ALIAS" && binding.aliasId) {
    await prisma.autopartCustomerAccountAlias.delete({ where: { id: binding.aliasId } });
  } else {
    await prisma.company.update({
      where: { id: raw.companyId },
      data: {
        autopartCustomerCode: null,
        autopartCustomerCodeVerifiedAt: null,
        autopartCustomerCodeVerifiedById: null,
      },
    });
  }
  await recordAuditEvent({
    action: "autopart.customer_account_unmapped",
    entityType: "Company",
    entityId: raw.companyId,
    actorUserId,
    companyId: raw.companyId,
    metadata: { accountCode: code, kind: binding.kind },
  });
  return { ok: true as const };
}

export type UnmappedAccountWorkspaceRow = {
  accountCode: string;
  customerNameSnapshot: string | null;
  unmappedDocuments: number;
  unmappedLines: number;
  netSalesAffected: string;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  status: "UNMAPPED" | "MAPPED" | "REVIEW";
  mappedCompanyId: string | null;
  mappedCompanyName: string | null;
  mappingKind: "PRIMARY" | "ALIAS" | null;
};

export async function listAutopartAccountMappingWorkspace(
  actorUserId: string,
  raw?: {
    status?: string;
    q?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  },
) {
  await requireMappingView(actorUserId);
  const statusFilter = (raw?.status ?? "UNMAPPED").toUpperCase();
  const q = raw?.q?.trim().toUpperCase() ?? "";
  const page = Math.max(1, raw?.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, raw?.pageSize ?? 50));
  const sort = raw?.sort ?? "netSales";

  // Aggregate from diagnostics (authoritative for skipped lines + net sales).
  const skipped = await prisma.autopartImportDiagnostic.findMany({
    where: { reasonCode: "UNMAPPED_CUSTOMER" },
    select: {
      customerAccount: true,
      documentReference: true,
      salesNet: true,
      createdAt: true,
      importRunId: true,
    },
  });

  // Also include unmapped document headers (may lack diagnostic rows on historic runs).
  const unmappedDocs = await prisma.autopartSalesDocument.findMany({
    where: {
      companyId: null,
      OR: [{ has504: true }, { hasTrm21qc: true }],
    },
    select: {
      autopartCustomerCode: true,
      customerNameSnapshot: true,
      documentReference: true,
      createdAt: true,
      updatedAt: true,
      linesNetSum: true,
    },
  });

  type Agg = {
    accountCode: string;
    customerNameSnapshot: string | null;
    docs: Set<string>;
    lines: number;
    netSales: number;
    firstSeen: Date | null;
    lastSeen: Date | null;
  };
  const byAccount = new Map<string, Agg>();

  function touch(
    codeRaw: string | null | undefined,
    opts: {
      doc?: string | null;
      lineInc?: number;
      sales?: number;
      seen?: Date | null;
      name?: string | null;
    },
  ) {
    const code = normaliseAccountToken(codeRaw);
    if (!code) return;
    let row = byAccount.get(code);
    if (!row) {
      row = {
        accountCode: code,
        customerNameSnapshot: null,
        docs: new Set(),
        lines: 0,
        netSales: 0,
        firstSeen: null,
        lastSeen: null,
      };
      byAccount.set(code, row);
    }
    if (opts.name && !row.customerNameSnapshot) row.customerNameSnapshot = opts.name;
    if (opts.doc) row.docs.add(opts.doc);
    if (opts.lineInc) row.lines += opts.lineInc;
    if (opts.sales != null && Number.isFinite(opts.sales)) row.netSales += opts.sales;
    if (opts.seen) {
      if (!row.firstSeen || opts.seen < row.firstSeen) row.firstSeen = opts.seen;
      if (!row.lastSeen || opts.seen > row.lastSeen) row.lastSeen = opts.seen;
    }
  }

  for (const d of skipped) {
    touch(d.customerAccount, {
      doc: d.documentReference,
      lineInc: 1,
      sales: Number(d.salesNet ?? 0),
      seen: d.createdAt,
    });
  }
  for (const d of unmappedDocs) {
    touch(d.autopartCustomerCode, {
      doc: d.documentReference,
      sales: d.linesNetSum != null ? Number(d.linesNetSum) : 0,
      seen: d.updatedAt ?? d.createdAt,
      name: d.customerNameSnapshot,
    });
  }

  const codes = [...byAccount.keys()];
  const primaries = codes.length
    ? await prisma.company.findMany({
        where: {
          OR: codes.map((c) => ({
            autopartCustomerCode: { equals: c, mode: "insensitive" as const },
          })),
        },
        select: { id: true, name: true, autopartCustomerCode: true },
      })
    : [];
  const aliases = codes.length
    ? await prisma.autopartCustomerAccountAlias.findMany({
        where: { alias: { in: codes } },
        select: {
          alias: true,
          companyId: true,
          company: { select: { name: true } },
        },
      })
    : [];

  const primaryByCode = new Map(
    primaries
      .map((p) => [normaliseAccountToken(p.autopartCustomerCode)!, p] as const)
      .filter(([c]) => Boolean(c)),
  );
  const aliasByCode = new Map(aliases.map((a) => [a.alias, a]));

  let rows: UnmappedAccountWorkspaceRow[] = codes.map((code) => {
    const agg = byAccount.get(code)!;
    const primary = primaryByCode.get(code);
    const alias = aliasByCode.get(code);
    const mapped = Boolean(primary || alias);
    return {
      accountCode: code,
      customerNameSnapshot: agg.customerNameSnapshot,
      unmappedDocuments: agg.docs.size,
      unmappedLines: agg.lines,
      netSalesAffected: agg.netSales.toFixed(2),
      firstSeenAt: agg.firstSeen?.toISOString() ?? null,
      lastSeenAt: agg.lastSeen?.toISOString() ?? null,
      status: mapped ? ("MAPPED" as const) : ("UNMAPPED" as const),
      mappedCompanyId: primary?.id ?? alias?.companyId ?? null,
      mappedCompanyName: primary?.name ?? alias?.company.name ?? null,
      mappingKind: primary ? ("PRIMARY" as const) : alias ? ("ALIAS" as const) : null,
    };
  });

  if (statusFilter === "UNMAPPED") rows = rows.filter((r) => r.status === "UNMAPPED");
  else if (statusFilter === "MAPPED") rows = rows.filter((r) => r.status === "MAPPED");
  else if (statusFilter === "REVIEW") {
    // REVIEW: mapped but still have skipped diagnostics / unmapped docs outstanding
    rows = rows.filter((r) => r.status === "MAPPED" && r.unmappedLines > 0);
  }

  if (q) {
    rows = rows.filter(
      (r) =>
        r.accountCode.includes(q) ||
        (r.customerNameSnapshot ?? "").toUpperCase().includes(q) ||
        (r.mappedCompanyName ?? "").toUpperCase().includes(q),
    );
  }

  rows.sort((a, b) => {
    if (sort === "account") return a.accountCode.localeCompare(b.accountCode);
    if (sort === "lines") return b.unmappedLines - a.unmappedLines;
    if (sort === "documents") return b.unmappedDocuments - a.unmappedDocuments;
    if (sort === "latest") {
      return (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "");
    }
    // netSales default — absolute magnitude then signed
    const an = Math.abs(Number(a.netSalesAffected));
    const bn = Math.abs(Number(b.netSalesAffected));
    if (bn !== an) return bn - an;
    return Number(b.netSalesAffected) - Number(a.netSalesAffected);
  });

  const total = rows.length;
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  return {
    total,
    page,
    pageSize,
    status: statusFilter,
    items: pageRows,
    summary: {
      unmappedAccounts: rows.filter((r) => r.status === "UNMAPPED").length,
      mappedAccounts: rows.filter((r) => r.status === "MAPPED").length,
      totalAccounts: total,
    },
  };
}

export async function listCompanyAutopartAccounts(actorUserId: string, companyId: string) {
  await requireMappingView(actorUserId);
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      name: true,
      autopartCustomerCode: true,
      autopartCustomerCodeVerifiedAt: true,
      autopartCustomerCodeVerifiedBy: { select: { id: true, name: true, email: true } },
      autopartAccountAliases: {
        orderBy: { alias: "asc" },
        select: {
          id: true,
          alias: true,
          note: true,
          verifiedAt: true,
          createdAt: true,
          verifiedBy: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  if (!company) throw new AuthError("Company not found", "NOT_FOUND", 404);

  const accounts: Array<{
    accountCode: string;
    kind: "PRIMARY" | "ALIAS";
    aliasId: string | null;
    verifiedAt: string | null;
    mappedAt: string | null;
    mappedBy: string | null;
    note: string | null;
    source: string;
  }> = [];

  if (company.autopartCustomerCode) {
    accounts.push({
      accountCode: company.autopartCustomerCode,
      kind: "PRIMARY",
      aliasId: null,
      verifiedAt: company.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
      mappedAt: company.autopartCustomerCodeVerifiedAt?.toISOString() ?? null,
      mappedBy:
        company.autopartCustomerCodeVerifiedBy?.name ??
        company.autopartCustomerCodeVerifiedBy?.email ??
        null,
      note: null,
      source: "Company primary Autopart account",
    });
  }
  for (const a of company.autopartAccountAliases) {
    accounts.push({
      accountCode: a.alias,
      kind: "ALIAS",
      aliasId: a.id,
      verifiedAt: a.verifiedAt.toISOString(),
      mappedAt: a.createdAt.toISOString(),
      mappedBy: a.verifiedBy.name ?? a.verifiedBy.email,
      note: a.note,
      source: "Verified account alias",
    });
  }
  return { companyId: company.id, companyName: company.name, accounts };
}

/**
 * Recover previously skipped lines by re-running the existing import pipeline
 * against a re-uploaded source file. Raw report text is not retained on historic runs.
 */
export async function reprocessSkippedAutopartSales(
  actorUserId: string,
  raw: { text: string; filename?: string; accountCode?: string },
) {
  await requireMappingEdit(actorUserId);
  const text = raw.text;
  const filename = raw.filename ?? "reprocess.csv";

  let run;
  if (isAutopartTrm21qcReport(text)) {
    run = await confirmAutopartTrm21qcImport(actorUserId, {
      text,
      filename,
      source: "MANUAL",
    });
  } else if (isAutopart504Report(text)) {
    run = await confirmAutopart504Import(actorUserId, {
      text,
      filename,
      source: "MANUAL",
    });
  } else {
    throw new AuthError(
      "File does not look like an Autopart 504 or TRM21QC report",
      "VALIDATION",
      400,
    );
  }

  const accountCode = normaliseAccountToken(raw.accountCode ?? "");
  let accountInserted = 0;
  if (accountCode) {
    accountInserted = await prisma.autopartImportDiagnostic.count({
      where: {
        importRunId: run.id,
        status: "INSERTED",
        customerAccount: accountCode,
      },
    });
  }

  await recordAuditEvent({
    action: "autopart.skipped_lines_reprocessed",
    entityType: "AutopartCustomerImportRun",
    entityId: run.id,
    actorUserId,
    metadata: {
      filename,
      accountCode: accountCode || null,
      rowsImported: run.rowsImported,
      rowsUpdated: run.rowsUpdated,
      rowsSkipped: run.rowsSkipped,
      accountInserted,
    },
  });

  return {
    runId: run.id,
    status: run.status,
    rowsImported: run.rowsImported,
    rowsUpdated: run.rowsUpdated,
    rowsSkipped: run.rowsSkipped,
    accountCode: accountCode || null,
    accountInserted,
    message:
      "Reprocess used the standard import pipeline. Previously written lines remain unchanged; newly mapped accounts can insert skipped lines.",
  };
}

/** Create company then map originating Autopart account in one staff action. */
export async function createCompanyAndMapAutopartAccount(
  actorUserId: string,
  raw: unknown,
) {
  await requireMappingEdit(actorUserId);
  const input = z
    .object({
      accountCode: z.string().min(1).max(80),
      name: z.string().min(1).max(200),
      tradingName: z.string().max(200).optional().nullable(),
      primaryEmail: z.string().email().optional().nullable().or(z.literal("")),
      phone: z.string().max(40).optional().nullable(),
      salesRepId: z.string().cuid().optional().nullable(),
      sourceContext: z
        .object({ importRunId: z.string().optional() })
        .optional(),
    })
    .parse(raw);

  const code = normaliseAccountToken(input.accountCode);
  if (!code) throw new AuthError("Autopart account code is required", "VALIDATION", 400);

  const existing = await findBinding(code);
  if (existing) {
    throw new AuthError(
      `Autopart account ${code} is already mapped to ${existing.companyName}`,
      "AUTOPART_ACCOUNT_MAPPED_ELSEWHERE",
      409,
    );
  }

  const { createCompany } = await import("@/server/companies/service");
  const company = await createCompany(actorUserId, {
    name: input.name,
    tradingName: input.tradingName ?? null,
    primaryEmail: input.primaryEmail || null,
    phone: input.phone ?? null,
    salesRepId: input.salesRepId ?? null,
    status: "PROSPECT",
  });

  const mapped = await mapAutopartCustomerAccount(actorUserId, {
    accountCode: code,
    companyId: company.id,
    sourceContext: input.sourceContext,
    note: "Mapped when creating customer from unmapped Autopart account",
  });

  return { company, mapping: mapped };
}
