# Optional seed framework — does NOT invent production business data by default.
# Run with: bun run db:seed
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Intentionally empty for Phase 0.
  // Later phases may seed reference roles/permissions only.
  console.log("[ab:seed] No seed data applied (Phase 0).");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
