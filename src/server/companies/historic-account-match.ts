/**
 * Read-only identity report for 407EXP accounts, and the only bulk approval path.
 * Company name similarity is never loaded as evidence.
 * Approval writes the verified Autopart code and publishes staged history.
 * It does not change company status, create portal users, or send invitations.
 */
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { describeDatabaseUrl } from "@/domain/customer-data-reset";
import {
  classifyHistoricMasterAccount,
  HISTORIC_MATCH_VERIFY_PHRASE,
  prospectNoteMarksCreatedCompany,
  truncatedAccountCodes,
  type HistoricMatchCategory,
  type HistoricMatchDecision,
} from "@/domain/historic-account-match";
import { minorToMoney, moneyToMinor } from "@/domain/historic-all-file";
import { describeHistoricEnvironment, describeHistoricStorage } from "@/domain/historic-runtime";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import {
  buildHistoricMatchingReadiness,
  commitHistoricMatchUnderLock,
  promoteStagedAutopartHistory,
} from "@/server/companies/autopart-history-all";
import { hasPermission } from "@/server/rbac/access";
import { AuthError, requireSystemPermission } from "@/server/rbac/guards";

export { HISTORIC_MATCH_VERIFY_PHRASE };

export const HISTORIC_MATCH_CATEGORIES = [
  "VERIFIED",
  "LINKED_UNVERIFIED",
  "EXACT_EVIDENCE",
  "CONFLICT",
  "NO_MATCH",
] as const satisfies readonly HistoricMatchCategory[];

const CATEGORY_LABEL: Record<HistoricMatchCategory, string> = {
  VERIFIED: "Already verified",
  LINKED_UNVERIFIED: "Linked to one company, awaiting verification",
  EXACT_EVIDENCE: "Exact identity evidence",
  CONFLICT: "Conflicting or ambiguous",
  NO_MATCH: "No reliable company match",
};

type LineBucket = { lines: number; minor: number };

type ClassifiedRow = {
  accountId: string;
  accountCode: string;
  normalizedCode: string;
  originalName: string;
  decision: HistoricMatchDecision;
  companyName: string | null;
  companyStatus: string | null;
  pendingPublication: boolean;
  customerHistory: LineBucket;
  globalInvoices: LineBucket;
  staged: LineBucket;
};

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function emptyBucket(): LineBucket {
  return { lines: 0, minor: 0 };
}

function addBucket(map: Map<string, LineBucket>, code: string, count: number, net: { toString(): string } | null) {
  const key = norm(code);
  if (!key) return;
  const current = map.get(key) ?? emptyBucket();
  current.lines += count;
  current.minor += moneyToMinor(net?.toString() ?? null) ?? 0;
  map.set(key, current);
}

function bucketOf(map: Map<string, LineBucket>, code: string): LineBucket {
  return map.get(code) ?? emptyBucket();
}

function moneyBucket(bucket: LineBucket) {
  return { lines: bucket.lines, net: minorToMoney(bucket.minor) };
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ present: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS present
  `;
  return Boolean(rows[0]?.present);
}

function pushId(ids: string[], id: string | null | undefined) {
  if (id) ids.push(id);
}

function indexCompanyKeys(entries: Array<{ key: string; companyId: string }>): {
  unique: Map<string, string>;
  duplicated: Set<string>;
} {
  const grouped = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!entry.key) continue;
    const companies = grouped.get(entry.key) ?? new Set<string>();
    companies.add(entry.companyId);
    grouped.set(entry.key, companies);
  }
  const unique = new Map<string, string>();
  const duplicated = new Set<string>();
  for (const [key, companies] of grouped) {
    if (companies.size === 1) unique.set(key, [...companies][0]!);
    else duplicated.add(key);
  }
  return { unique, duplicated };
}

async function loadClassifiedAccounts(): Promise<{
  rows: ClassifiedRow[];
  outsideMaster: { customerHistory: LineBucket; globalInvoices: LineBucket; staged: LineBucket };
  verifiedCompanyCodes: number;
  verifiedCompanyCodesNotOnMaster: number;
}> {
  const historyTables = await tableExists("AutopartHistoryAllImport");
  const [masters, companies, aliases, staffLinks, customerLines, globalLines] = await Promise.all([
    prisma.autopartAccount.findMany({
      select: { id: true, accountCode: true, originalName: true, companyId: true },
    }),
    prisma.company.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        autopartCustomerCode: true,
        autopartCustomerCodeVerifiedAt: true,
        externalRef: true,
        accountNumber: true,
        notes: true,
      },
    }),
    prisma.autopartCustomerAccountAlias.findMany({ select: { companyId: true, alias: true } }),
    prisma.auditEvent.findMany({
      where: { action: "autopart_account_linked", entityType: "AutopartAccount" },
      select: { entityId: true, companyId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.autopartSalesLine.groupBy({
      by: ["autopartCustomerCode"],
      where: { source: { not: "ONGOING_TRM21QC" } },
      _count: { _all: true },
      _sum: { salesNet: true },
    }),
    prisma.autopartInvoiceLine.groupBy({
      by: ["accountCode"],
      _count: { _all: true },
      _sum: { salesAmount: true },
    }),
  ]);

  const latest = historyTables
    ? await prisma.autopartHistoryAllImport.findFirst({
        where: { status: "COMMITTED" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    : null;
  const [stagedLines, pendingReviews] = latest
    ? await Promise.all([
        prisma.autopartHistoryStagedLine.groupBy({
          by: ["accountCode"],
          where: { importId: latest.id },
          _count: { _all: true },
          _sum: { salesNet: true },
        }),
        prisma.autopartHistoryReviewAccount.findMany({
          where: {
            importId: latest.id,
            status: { in: ["OPEN", "VERIFYING"] },
            reason: { in: ["UNLINKED", "NOT_VERIFIED"] },
          },
          select: { accountCode: true },
        }),
      ])
    : [[], []];

  const companyById = new Map(companies.map((company) => [company.id, company]));
  const storedCodes = indexCompanyKeys(
    companies.flatMap((company) => {
      const key = norm(company.autopartCustomerCode);
      return key ? [{ key, companyId: company.id }] : [];
    }),
  );
  const externalRefs = indexCompanyKeys(
    companies.flatMap((company) => {
      const key = norm(company.externalRef);
      return key ? [{ key, companyId: company.id }] : [];
    }),
  );
  const accountNumbers = indexCompanyKeys(
    companies.flatMap((company) => {
      const key = norm(company.accountNumber);
      return key ? [{ key, companyId: company.id }] : [];
    }),
  );
  const verifiedByCode = new Map<string, string[]>();
  const verifiedCodes = new Set<string>();

  function rememberVerified(code: string, companyId: string) {
    const key = norm(code);
    if (!key) return;
    const current = verifiedByCode.get(key) ?? [];
    if (!current.includes(companyId)) current.push(companyId);
    verifiedByCode.set(key, current);
  }

  for (const company of companies) {
    const stored = norm(company.autopartCustomerCode);
    if (company.autopartCustomerCodeVerifiedAt && stored) {
      rememberVerified(stored, company.id);
      verifiedCodes.add(stored);
    }
  }
  for (const alias of aliases) rememberVerified(alias.alias, alias.companyId);
  const staffByAccount = new Map<string, Array<{ companyId: string | null }>>();
  for (const event of staffLinks) {
    if (!event.entityId) continue;
    const list = staffByAccount.get(event.entityId) ?? [];
    list.push({ companyId: event.companyId });
    staffByAccount.set(event.entityId, list);
  }

  const mastersOnCompany = new Map<string, number>();
  const masterCodes = new Set<string>();
  for (const account of masters) {
    masterCodes.add(norm(account.accountCode));
    if (!account.companyId) continue;
    mastersOnCompany.set(account.companyId, (mastersOnCompany.get(account.companyId) ?? 0) + 1);
  }
  const truncated = truncatedAccountCodes(masters.map((account) => account.accountCode));

  const customerHistory = new Map<string, LineBucket>();
  const globalInvoices = new Map<string, LineBucket>();
  const staged = new Map<string, LineBucket>();
  for (const row of customerLines) addBucket(customerHistory, row.autopartCustomerCode, row._count._all, row._sum.salesNet);
  for (const row of globalLines) addBucket(globalInvoices, row.accountCode, row._count._all, row._sum.salesAmount);
  for (const row of stagedLines) addBucket(staged, row.accountCode, row._count._all, row._sum.salesNet);
  const pending = new Set(pendingReviews.map((review) => norm(review.accountCode)));

  const rows: ClassifiedRow[] = masters.map((account) => {
    const code = norm(account.accountCode);
    const linked = account.companyId ? companyById.get(account.companyId) : undefined;
    const verifiedCompanyIds = verifiedByCode.get(code) ?? [];
    const staffEvents = staffByAccount.get(account.id) ?? [];
    const latestStaff = staffEvents.length ? staffEvents[staffEvents.length - 1] : undefined;
    const staffAgrees = Boolean(account.companyId) && latestStaff?.companyId === account.companyId;
    const indicated: string[] = [];
    pushId(indicated, account.companyId);
    pushId(indicated, storedCodes.duplicated.has(code) ? null : storedCodes.unique.get(code));
    pushId(indicated, accountNumbers.duplicated.has(code) ? null : accountNumbers.unique.get(code));
    if (verifiedCompanyIds.length === 1) pushId(indicated, verifiedCompanyIds[0]);
    const foreignStoredCode = [...new Set(indicated)].some((companyId) => {
      const stored = norm(companyById.get(companyId)?.autopartCustomerCode);
      return Boolean(stored) && stored !== code;
    });
    const decision = classifyHistoricMasterAccount({
      accountCode: code,
      linkedCompanyId: account.companyId,
      otherMastersOnCompany: account.companyId ? Math.max(0, (mastersOnCompany.get(account.companyId) ?? 1) - 1) : 0,
      truncatedCode: truncated.has(code),
      verifiedCompanyIds,
      codeHolderCompanyId: storedCodes.duplicated.has(code) ? null : (storedCodes.unique.get(code) ?? null),
      duplicateStoredCodes: storedCodes.duplicated.has(code),
      externalRefCompanyId: externalRefs.duplicated.has(code) ? null : (externalRefs.unique.get(code) ?? null),
      duplicateExternalRefs: externalRefs.duplicated.has(code),
      accountNumberCompanyId: accountNumbers.duplicated.has(code) ? null : (accountNumbers.unique.get(code) ?? null),
      duplicateAccountNumbers: accountNumbers.duplicated.has(code),
      linkedCompanyCode: linked?.autopartCustomerCode ? norm(linked.autopartCustomerCode) : null,
      staffLinkCompanyId: staffAgrees ? account.companyId : null,
      staffLinkDisputed: staffEvents.length > 0 && !staffAgrees,
      prospectCreated: prospectNoteMarksCreatedCompany(linked?.notes),
      foreignStoredCode,
    });
    const company = decision.companyId ? companyById.get(decision.companyId) : undefined;
    return {
      accountId: account.id,
      accountCode: account.accountCode,
      normalizedCode: code,
      originalName: account.originalName,
      decision,
      companyName: company?.name ?? null,
      companyStatus: company?.status ?? null,
      pendingPublication: pending.has(code),
      customerHistory: bucketOf(customerHistory, code),
      globalInvoices: bucketOf(globalInvoices, code),
      staged: bucketOf(staged, code),
    };
  });

  function outside(map: Map<string, LineBucket>): LineBucket {
    const total = emptyBucket();
    for (const [code, bucket] of map) {
      if (masterCodes.has(code)) continue;
      total.lines += bucket.lines;
      total.minor += bucket.minor;
    }
    return total;
  }

  return {
    rows,
    outsideMaster: {
      customerHistory: outside(customerHistory),
      globalInvoices: outside(globalInvoices),
      staged: outside(staged),
    },
    verifiedCompanyCodes: verifiedCodes.size,
    verifiedCompanyCodesNotOnMaster: [...verifiedCodes].filter((code) => !masterCodes.has(code)).length,
  };
}

function emptyCategoryTotals() {
  return {
    accounts: 0,
    customerHistory: emptyBucket(),
    globalInvoices: emptyBucket(),
    staged: emptyBucket(),
  };
}

function addTotals(target: ReturnType<typeof emptyCategoryTotals>, row: ClassifiedRow) {
  target.accounts += 1;
  target.customerHistory.lines += row.customerHistory.lines;
  target.customerHistory.minor += row.customerHistory.minor;
  target.globalInvoices.lines += row.globalInvoices.lines;
  target.globalInvoices.minor += row.globalInvoices.minor;
  target.staged.lines += row.staged.lines;
  target.staged.minor += row.staged.minor;
}

function presentTotals(totals: ReturnType<typeof emptyCategoryTotals>) {
  return {
    accounts: totals.accounts,
    customerHistory: moneyBucket(totals.customerHistory),
    globalInvoices: moneyBucket(totals.globalInvoices),
    staged: moneyBucket(totals.staged),
  };
}

function selectable(row: ClassifiedRow): boolean {
  return row.decision.category === "EXACT_EVIDENCE" || (row.decision.category === "VERIFIED" && row.pendingPublication);
}

export async function historicAccountMatchReport(actorUserId: string, raw: unknown) {
  const profile = await requireSystemPermission(actorUserId, "autopart.import.view");
  const input = z
    .object({
      category: z.enum(HISTORIC_MATCH_CATEGORIES).optional(),
      query: z.string().max(40).optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(50).optional(),
    })
    .parse(raw ?? {});
  const category = input.category ?? "EXACT_EVIDENCE";
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 25;
  const query = norm(input.query);
  const [loaded, readiness] = await Promise.all([loadClassifiedAccounts(), buildHistoricMatchingReadiness()]);
  const totals = {
    VERIFIED: emptyCategoryTotals(),
    LINKED_UNVERIFIED: emptyCategoryTotals(),
    EXACT_EVIDENCE: emptyCategoryTotals(),
    CONFLICT: emptyCategoryTotals(),
    NO_MATCH: emptyCategoryTotals(),
  };
  let reviewable = 0;
  let publicationPending = 0;
  for (const row of loaded.rows) {
    addTotals(totals[row.decision.category], row);
    if (row.decision.category === "EXACT_EVIDENCE") reviewable += 1;
    if (row.pendingPublication && row.decision.category === "VERIFIED") publicationPending += 1;
  }
  const filtered = loaded.rows.filter((row) => {
    if (row.decision.category !== category) return false;
    if (query && !row.normalizedCode.includes(query)) return false;
    return true;
  });
  filtered.sort((left, right) => left.normalizedCode.localeCompare(right.normalizedCode));
  const start = (page - 1) * pageSize;
  const environment = describeHistoricEnvironment(process.env, describeDatabaseUrl(process.env["DATABASE_URL"] ?? ""));
  return {
    environment,
    storage: describeHistoricStorage(process.env, process.cwd()),
    canApprove: hasPermission(profile, "autopart.import.manage"),
    categories: HISTORIC_MATCH_CATEGORIES.map((key) => ({
      category: key,
      label: CATEGORY_LABEL[key],
      ...presentTotals(totals[key]),
    })),
    reviewableAccounts: reviewable,
    verifiedPublicationPending: publicationPending,
    verifiedCompanyCodes: loaded.verifiedCompanyCodes,
    verifiedCompanyCodesNotOnMaster: loaded.verifiedCompanyCodesNotOnMaster,
    outsideMaster: {
      customerHistory: moneyBucket(loaded.outsideMaster.customerHistory),
      globalInvoices: moneyBucket(loaded.outsideMaster.globalInvoices),
      staged: moneyBucket(loaded.outsideMaster.staged),
    },
    readiness,
    page,
    pageSize,
    total: filtered.length,
    rows: filtered.slice(start, start + pageSize).map((row) => ({
      accountId: row.accountId,
      accountCode: row.accountCode,
      originalName: row.originalName,
      category: row.decision.category,
      companyId: row.decision.companyId,
      companyName: row.companyName,
      companyStatus: row.companyStatus,
      evidence: row.decision.evidence,
      conflicts: row.decision.conflicts,
      pendingPublication: row.pendingPublication,
      selectable: selectable(row),
      customerHistory: moneyBucket(row.customerHistory),
      globalInvoices: moneyBucket(row.globalInvoices),
      staged: moneyBucket(row.staged),
    })),
    rules: [
      "Company name similarity is not evidence and is not used.",
      "A company number, VAT number, order, trade application, or portal user does not prove an Autopart code.",
      "A stored Autopart code is not evidence until it is already verified, or a staff link ties this account to this company.",
      "An external reference can be a legacy non-Autopart reference, so it is not identity evidence.",
      "The same external reference, account number, or Autopart code on more than one company is a conflict.",
      "A truncated code, two companies, or two master accounts on one company stay conflicts.",
      "A company created from the Autopart row is not identity evidence on its own.",
      "Customer history, global invoice lines, and staged ALL-file lines are separate. Adding them would count the same sale more than once.",
      "Approval waits for the historical import lock and does not change company status, create portal users, or send invitations.",
    ],
  };
}

const approveSchema = z.object({
  accountCodes: z.array(z.string().trim().min(1).max(40)).min(1).max(100),
  confirmation: z.string(),
});

export async function approveHistoricAccountMatches(actorUserId: string, raw: unknown) {
  await requireSystemPermission(actorUserId, "autopart.import.manage");
  const input = approveSchema.parse(raw);
  if (input.confirmation !== HISTORIC_MATCH_VERIFY_PHRASE) {
    throw new AuthError("Type the verification confirmation before saving mappings", "CONFIRMATION_REQUIRED", 400);
  }
  const requested = [...new Set(input.accountCodes.map((code) => norm(code)).filter(Boolean))];
  const loaded = await loadClassifiedAccounts();
  const byCode = new Map(loaded.rows.map((row) => [row.normalizedCode, row]));
  const approved: Array<{ accountCode: string; companyId: string; documents: number; lines: number; applied: boolean }> = [];
  const republished: Array<{ accountCode: string; companyId: string; documents: number; lines: number }> = [];
  const preserved: Array<{ accountCode: string; companyId: string }> = [];
  const skipped: Array<{ accountCode: string; detail: string }> = [];
  const incomplete: Array<{ accountCode: string; companyId: string; detail: string }> = [];

  for (const code of requested) {
    const row = byCode.get(code);
    if (!row || !row.decision.companyId) {
      skipped.push({ accountCode: code, detail: "This account has no single company with exact identity evidence." });
      continue;
    }
    if (row.decision.category === "VERIFIED") {
      if (!row.pendingPublication) {
        preserved.push({ accountCode: row.accountCode, companyId: row.decision.companyId });
        continue;
      }
      try {
        const promoted = await promoteStagedAutopartHistory(actorUserId, row.decision.companyId, code);
        if (!promoted.completed) {
          incomplete.push({
            accountCode: row.accountCode,
            companyId: row.decision.companyId,
            detail: "The verified mapping was kept. Staged history was not fully applied and can be retried.",
          });
          continue;
        }
        republished.push({
          accountCode: row.accountCode,
          companyId: row.decision.companyId,
          documents: promoted.documents,
          lines: promoted.lines,
        });
        await recordAuditEvent({
          action: "autopart.historic_match.published",
          entityType: "AutopartAccount",
          entityId: row.accountId,
          actorUserId,
          companyId: row.decision.companyId,
          after: { accountCode: code, documents: promoted.documents, lines: promoted.lines, status: "APPLIED" },
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "staged history failed";
        incomplete.push({ accountCode: row.accountCode, companyId: row.decision.companyId, detail });
        if (error instanceof AuthError && error.code === "IMPORT_IN_PROGRESS") break;
      }
      continue;
    }
    if (row.decision.category !== "EXACT_EVIDENCE") {
      skipped.push({
        accountCode: row.accountCode,
        detail: row.decision.conflicts[0] ?? row.decision.evidence[0] ?? "This account is not exact identity evidence.",
      });
      continue;
    }
    const companyId = row.decision.companyId;
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        status: true,
        autopartCustomerCode: true,
        autopartCustomerCodeVerifiedAt: true,
        autopartCustomerCodeVerifiedById: true,
      },
    });
    if (!company) {
      skipped.push({ accountCode: row.accountCode, detail: "The company no longer exists." });
      continue;
    }
    const stored = norm(company.autopartCustomerCode);
    if (company.autopartCustomerCodeVerifiedAt && stored === code) {
      preserved.push({ accountCode: row.accountCode, companyId: company.id });
      continue;
    }
    if (stored && stored !== code) {
      skipped.push({ accountCode: row.accountCode, detail: "That company already has a different Autopart code." });
      continue;
    }
    const otherVerified = await prisma.company.findFirst({
      where: { autopartCustomerCode: code, id: { not: company.id }, autopartCustomerCodeVerifiedAt: { not: null } },
      select: { id: true },
    });
    if (otherVerified) {
      skipped.push({ accountCode: row.accountCode, detail: "Another company is already verified with this account." });
      continue;
    }
    const account = await prisma.autopartAccount.findUnique({
      where: { id: row.accountId },
      select: { id: true, companyId: true, portalEligible: true, historicalAccessEnabled: true },
    });
    if (!account) {
      skipped.push({ accountCode: row.accountCode, detail: "The 407EXP account no longer exists." });
      continue;
    }
    if (account.companyId && account.companyId !== company.id) {
      skipped.push({ accountCode: row.accountCode, detail: "The 407EXP account is linked to a different company." });
      continue;
    }
    let promoted: { completed: boolean; applied: boolean; documents: number; lines: number };
    try {
      promoted = await commitHistoricMatchUnderLock(actorUserId, {
        companyId: company.id,
        accountId: account.id,
        code,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        skipped.push({ accountCode: row.accountCode, detail: "That Autopart code is already stored on another company." });
        continue;
      }
      const detail = error instanceof Error ? error.message : "staged history failed";
      incomplete.push({
        accountCode: row.accountCode,
        companyId: company.id,
        detail: `The mapping was not saved (${detail}). Retry verification after the historical import lock is free.`,
      });
      await recordAuditEvent({
        action: "autopart.historic_match.incomplete",
        entityType: "AutopartAccount",
        entityId: account.id,
        actorUserId,
        companyId: company.id,
        before: { status: company.status, autopartCustomerCode: company.autopartCustomerCode },
        after: { status: company.status, autopartCustomerCode: company.autopartCustomerCode, publication: "rolled-back" },
      });
      if (error instanceof AuthError && error.code === "IMPORT_IN_PROGRESS") break;
      continue;
    }
    if (!promoted.completed) {
      incomplete.push({
        accountCode: row.accountCode,
        companyId: company.id,
        detail: "The mapping was not saved. Staged history was not fully applied and can be retried.",
      });
      continue;
    }
    approved.push({
      accountCode: row.accountCode,
      companyId: company.id,
      documents: promoted.documents,
      lines: promoted.lines,
      applied: promoted.applied,
    });
    await recordAuditEvent({
      action: "autopart.historic_match.verified",
      entityType: "AutopartAccount",
      entityId: account.id,
      actorUserId,
      companyId: company.id,
      before: { status: company.status, autopartCustomerCode: company.autopartCustomerCode },
      after: {
        status: company.status,
        autopartCustomerCode: code,
        documents: promoted.documents,
        lines: promoted.lines,
        portalEligible: account.portalEligible,
        historicalAccessEnabled: account.historicalAccessEnabled,
      },
    });
  }

  await recordAuditEvent({
    action: "autopart.historic_match.bulk_verified",
    entityType: "AutopartAccount",
    actorUserId,
    metadata: {
      requested,
      approved: approved.map((row) => row.accountCode),
      republished: republished.map((row) => row.accountCode),
      preserved: preserved.map((row) => row.accountCode),
      skipped: skipped.map((row) => row.accountCode),
      incomplete: incomplete.map((row) => row.accountCode),
    },
  });

  return { approved, republished, preserved, skipped, incomplete };
}
