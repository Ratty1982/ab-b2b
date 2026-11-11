/**
 * Team department seed — Prisma + domain only (no TanStack / request graph).
 */
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import { DEFAULT_TEAM_DEPARTMENTS } from "@/domain/team";

export async function bootstrapTeamDepartments(db: PrismaClient = prisma) {
  // Only seed when the table is empty so admin deletes of default departments stick.
  const existingCount = await db.teamDepartment.count();
  if (existingCount > 0) return { created: 0 };

  let created = 0;
  for (const dept of DEFAULT_TEAM_DEPARTMENTS) {
    await db.teamDepartment.create({
      data: {
        slug: dept.slug,
        name: dept.name,
        description: dept.description,
        sortOrder: dept.sortOrder,
        isPublic: true,
      },
    });
    created += 1;
  }
  return { created };
}
