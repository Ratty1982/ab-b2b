/**
 * Meet the Team — domain + service integration tests.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { bootstrapRbac } from "../../../prisma/bootstrap/rbac";
import { AuthError } from "@/server/rbac/guards";
import {
  bootstrapTeamDepartments,
  deleteTeamDepartment,
  deleteTeamMember,
  getPublicTeamMemberForSalesRep,
  listFeaturedPublicTeamMembers,
  listPublicTeamPage,
  listTeamDepartmentsAdmin,
  listTeamMembersAdmin,
  upsertTeamDepartment,
  upsertTeamMember,
} from "@/server/team/service";
import {
  teamMemberDisplayName,
  teamMemberInitials,
  teamMemberUpsertSchema,
} from "@/domain/team";

const prisma = new PrismaClient();
let adminId: string;
let salesRepUserId: string;
let salesRepId: string;

async function ensureUser(email: string, roles: string[]) {
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0]!,
        actorType: "INTERNAL",
        status: "ACTIVE",
        emailVerified: true,
      },
    });
  }
  for (const key of roles) {
    const role = await prisma.role.findUnique({ where: { key } });
    if (!role) continue;
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
  }
  return user.id;
}

beforeAll(async () => {
  await bootstrapRbac(prisma);
  await bootstrapTeamDepartments(prisma);
  adminId = await ensureUser("team.admin@example.invalid", ["SUPER_ADMIN"]);
  salesRepUserId = await ensureUser("team.sales@example.invalid", ["SALES_REPRESENTATIVE"]);
  let rep = await prisma.salesRep.findUnique({ where: { userId: salesRepUserId } });
  if (!rep) {
    rep = await prisma.salesRep.create({
      data: { userId: salesRepUserId, code: "TEAMREP", active: true },
    });
  }
  salesRepId = rep.id;
});

afterAll(async () => {
  await prisma.teamMember.deleteMany({
    where: {
      OR: [
        { email: { endsWith: "@team.test.invalid" } },
        { firstName: { startsWith: "TmTest" } },
      ],
    },
  });
  await prisma.$disconnect();
});

describe("team domain helpers", () => {
  it("formats display name and initials", () => {
    expect(teamMemberDisplayName("Wayne", "Radford")).toBe("Wayne Radford");
    expect(teamMemberInitials("Wayne", "Radford")).toBe("WR");
  });

  it("defaults new members to hidden / not contactable", () => {
    const parsed = teamMemberUpsertSchema.parse({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect(parsed.isPublic).toBe(false);
    expect(parsed.isContactable).toBe(false);
    expect(parsed.isFeatured).toBe(false);
  });
});

describe("team public roster", () => {
  it("hides unpublished members and empty departments; orders by sortOrder", async () => {
    const departments = await prisma.teamDepartment.findMany({
      orderBy: { sortOrder: "asc" },
    });
    expect(departments.length).toBeGreaterThanOrEqual(4);
    const leadership = departments.find((d) => d.slug === "leadership")!;
    const sales = departments.find((d) => d.slug === "trade-sales-accounts")!;

    const hidden = await upsertTeamMember(adminId, {
      firstName: "TmTest",
      lastName: "Hidden",
      jobTitle: "Hidden Role",
      departmentId: leadership.id,
      sortOrder: 1,
      isPublic: false,
    });
    const publicLate = await upsertTeamMember(adminId, {
      firstName: "TmTest",
      lastName: "Zebra",
      jobTitle: "Later",
      departmentId: sales.id,
      sortOrder: 20,
      isPublic: true,
      email: "zebra@team.test.invalid",
      isContactable: false,
    });
    const publicEarly = await upsertTeamMember(adminId, {
      firstName: "TmTest",
      lastName: "Alpha",
      jobTitle: "Earlier",
      departmentId: sales.id,
      sortOrder: 5,
      isPublic: true,
      email: "alpha@team.test.invalid",
      phone: "01234 567890",
      linkedInUrl: "https://www.linkedin.com/in/example",
      isContactable: true,
      isFeatured: true,
      salesRepId,
    });

    const page = await listPublicTeamPage();
    const hiddenDept = page.departments.find((d) => d.id === leadership.id);
    expect(hiddenDept).toBeUndefined();

    const salesDept = page.departments.find((d) => d.id === sales.id);
    expect(salesDept).toBeTruthy();
    expect(salesDept!.members.map((m) => m.id)).toEqual([publicEarly.id, publicLate.id]);

    const contactable = salesDept!.members.find((m) => m.id === publicEarly.id)!;
    expect(contactable.email).toBe("alpha@team.test.invalid");
    expect(contactable.phone).toBe("01234 567890");
    expect(contactable.linkedInUrl).toBe("https://www.linkedin.com/in/example");

    const privateContact = salesDept!.members.find((m) => m.id === publicLate.id)!;
    expect(privateContact.email).toBeNull();
    expect(privateContact.phone).toBeNull();
    expect(privateContact.linkedInUrl).toBeNull();

    const featured = await listFeaturedPublicTeamMembers(4);
    expect(featured.some((m) => m.id === publicEarly.id)).toBe(true);
    expect(featured.every((m) => m.isFeatured)).toBe(true);

    const linked = await getPublicTeamMemberForSalesRep(salesRepId);
    expect(linked?.id).toBe(publicEarly.id);

    await expect(listTeamMembersAdmin(salesRepUserId, {})).rejects.toBeInstanceOf(AuthError);

    await deleteTeamMember(adminId, hidden.id);
    await deleteTeamMember(adminId, publicLate.id);
    await deleteTeamMember(adminId, publicEarly.id);

    const afterUnlink = await getPublicTeamMemberForSalesRep(salesRepId);
    expect(afterUnlink).toBeNull();
  });

  it("allows department reordering without code changes", async () => {
    const dept = await prisma.teamDepartment.findFirst({
      where: { slug: "marketing-administration" },
    });
    expect(dept).toBeTruthy();
    const updated = await upsertTeamDepartment(adminId, {
      id: dept!.id,
      name: dept!.name,
      slug: dept!.slug,
      description: dept!.description,
      sortOrder: 99,
      isPublic: true,
    });
    expect(updated.sortOrder).toBe(99);
    await upsertTeamDepartment(adminId, {
      id: dept!.id,
      name: dept!.name,
      slug: dept!.slug,
      description: dept!.description,
      sortOrder: 30,
      isPublic: true,
    });
  });

  it("deletes a department and unassigns members without recreating seeds", async () => {
    const created = await upsertTeamDepartment(adminId, {
      name: "Temp Delete Dept",
      slug: `temp-delete-dept-${Date.now()}`,
      description: null,
      sortOrder: 500,
      isPublic: true,
    });
    const member = await upsertTeamMember(adminId, {
      firstName: "TmTest",
      lastName: "Unassign",
      jobTitle: "Temp",
      departmentId: created.id,
      isPublic: false,
      sortOrder: 1,
    });

    const result = await deleteTeamDepartment(adminId, created.id);
    expect(result.ok).toBe(true);
    expect(result.memberCount).toBe(1);

    const gone = await prisma.teamDepartment.findUnique({ where: { id: created.id } });
    expect(gone).toBeNull();

    const stillThere = await prisma.teamMember.findUnique({ where: { id: member.id } });
    expect(stillThere).toBeTruthy();
    expect(stillThere!.departmentId).toBeNull();

    // Bootstrap must not recreate deleted departments while any remain.
    await bootstrapTeamDepartments(prisma);
    const resurrected = await prisma.teamDepartment.findUnique({ where: { id: created.id } });
    expect(resurrected).toBeNull();
    const bySlug = await prisma.teamDepartment.findUnique({ where: { slug: created.slug } });
    expect(bySlug).toBeNull();

    await deleteTeamMember(adminId, member.id);

    // Deleting a seed department must also stick.
    const leadership = await prisma.teamDepartment.findUnique({ where: { slug: "leadership" } });
    expect(leadership).toBeTruthy();
    await deleteTeamDepartment(adminId, leadership!.id);
    await bootstrapTeamDepartments(prisma);
    const leadershipAgain = await prisma.teamDepartment.findUnique({
      where: { slug: "leadership" },
    });
    expect(leadershipAgain).toBeNull();

    // Restore leadership for other tests / local admin UX.
    await upsertTeamDepartment(adminId, {
      name: "Leadership",
      slug: "leadership",
      description: null,
      sortOrder: 10,
      isPublic: true,
    });

    const listed = await listTeamDepartmentsAdmin(adminId);
    expect(listed.some((d) => d.slug === "leadership")).toBe(true);
  });

  it("renders without a SalesRep link and without a photo", async () => {
    const sales = await prisma.teamDepartment.findUniqueOrThrow({
      where: { slug: "operations-production" },
    });
    const member = await upsertTeamMember(adminId, {
      firstName: "TmTest",
      lastName: "NoPhoto",
      jobTitle: "Operator",
      departmentId: sales.id,
      isPublic: true,
      sortOrder: 1,
    });
    const page = await listPublicTeamPage();
    const found = page.departments
      .flatMap((d) => d.members)
      .find((m) => m.id === member.id);
    expect(found).toBeTruthy();
    expect(found!.photo).toBeNull();
    expect(found!.initials).toBe("TN");
    expect(found!.jobTitle).toBe("Operator");
    await deleteTeamMember(adminId, member.id);
  });

  it("suppresses placeholder job titles on the public roster only", async () => {
    const sales = await prisma.teamDepartment.findUniqueOrThrow({
      where: { slug: "operations-production" },
    });
    const member = await upsertTeamMember(adminId, {
      firstName: "TmTest",
      lastName: "PlaceholderTitle",
      jobTitle: "What is my job title?",
      departmentId: sales.id,
      isPublic: true,
      sortOrder: 2,
    });
    const page = await listPublicTeamPage();
    const found = page.departments
      .flatMap((d) => d.members)
      .find((m) => m.id === member.id);
    expect(found).toBeTruthy();
    expect(found!.jobTitle).toBeNull();

    const adminRows = await listTeamMembersAdmin(adminId, { q: "PlaceholderTitle" });
    expect(adminRows[0]?.jobTitle).toBe("What is my job title?");

    await deleteTeamMember(adminId, member.id);
  });
});
