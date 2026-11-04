/**
 * Strong customer duplicate checks used when a company is created.
 * Format-insensitive phone matching lives in the domain helper.
 */
import { prisma } from "@/infra/database/client";
import { AuthError } from "@/server/rbac/guards";
import {
  classifyCustomerDuplicate,
  normalisePhone,
  phoneMatchTail,
  type DuplicateMatchReason,
  type DuplicateStrength,
} from "@/domain/customer-creation-wizard";

export type CustomerDuplicateMatch = {
  id: string;
  name: string;
  status: string;
  primaryEmail: string | null;
  phone: string | null;
  strength: DuplicateStrength;
  reason: DuplicateMatchReason;
};

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length ? trimmed : null;
}

export async function findCustomerDuplicates(input: {
  name: string;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  excludeCompanyId?: string | null | undefined;
}): Promise<CustomerDuplicateMatch[]> {
  const name = input.name.trim();
  const email = blankToNull(input.email);
  const phone = blankToNull(input.phone);
  if (name.length < 2 && !email && !phone) return [];

  const or: Array<Record<string, unknown>> = [];
  if (name.length >= 2) {
    or.push({ name: { contains: name, mode: "insensitive" } });
    or.push({ tradingName: { contains: name, mode: "insensitive" } });
  }
  if (email) or.push({ primaryEmail: { equals: email, mode: "insensitive" } });

  const byId = new Map<
    string,
    {
      id: string;
      name: string;
      tradingName: string | null;
      status: string;
      primaryEmail: string | null;
      phone: string | null;
    }
  >();

  if (or.length > 0) {
    const rows = await prisma.company.findMany({
      where: {
        OR: or,
        ...(input.excludeCompanyId ? { id: { not: input.excludeCompanyId } } : {}),
      },
      select: {
        id: true,
        name: true,
        tradingName: true,
        status: true,
        primaryEmail: true,
        phone: true,
      },
      take: 40,
      orderBy: { name: "asc" },
    });
    for (const row of rows) byId.set(row.id, row);
  }

  const tail = phone ? phoneMatchTail(phone) : "";
  if (tail.length >= 6) {
    type PhoneRow = {
      id: string;
      name: string;
      tradingName: string | null;
      status: string;
      primaryEmail: string | null;
      phone: string | null;
    };
    const like = `%${tail}`;
    const phoneRows = input.excludeCompanyId
      ? await prisma.$queryRaw<PhoneRow[]>`
          SELECT id, name, "tradingName", status, "primaryEmail", phone
          FROM "Company"
          WHERE phone IS NOT NULL
            AND id <> ${input.excludeCompanyId}
            AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${like}
          ORDER BY name ASC
          LIMIT 40
        `
      : await prisma.$queryRaw<PhoneRow[]>`
          SELECT id, name, "tradingName", status, "primaryEmail", phone
          FROM "Company"
          WHERE phone IS NOT NULL
            AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE ${like}
          ORDER BY name ASC
          LIMIT 40
        `;
    for (const row of phoneRows) byId.set(row.id, row);
  }

  const matches: CustomerDuplicateMatch[] = [];
  for (const row of byId.values()) {
    const classified = classifyCustomerDuplicate({ name, email, phone }, row);
    if (!classified) continue;
    matches.push({
      id: row.id,
      name: row.name,
      status: row.status,
      primaryEmail: row.primaryEmail,
      phone: row.phone,
      strength: classified.strength,
      reason: classified.reason,
    });
  }
  matches.sort((a, b) => {
    if (a.strength === b.strength) return a.name.localeCompare(b.name);
    return a.strength === "strong" ? -1 : 1;
  });
  return matches;
}

export async function assertNoStrongCustomerDuplicates(input: {
  name: string;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  excludeCompanyId?: string | null | undefined;
  confirmDespiteDuplicates?: boolean | undefined;
}): Promise<CustomerDuplicateMatch[]> {
  const matches = await findCustomerDuplicates(input);
  if (input.confirmDespiteDuplicates) return matches;
  const strong = matches.filter((match) => match.strength === "strong");
  if (strong.length === 0) return matches;
  const names = strong
    .slice(0, 5)
    .map((match) => match.name)
    .join(", ");
  throw new AuthError(
    `A customer already matches this name or contact: ${names}. Open that customer, or confirm that this is a separate customer.`,
    "DUPLICATE_CUSTOMER",
    409,
  );
}

export function phonesMatchForDuplicate(left: string, right: string): boolean {
  const a = normalisePhone(left);
  const b = normalisePhone(right);
  return a.length >= 8 && b.length >= 8 && a === b;
}
