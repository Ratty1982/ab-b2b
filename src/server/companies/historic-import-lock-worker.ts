/**
 * Claims one historical import from a separate process.
 * Prints one JSON line: {"status":"claimed","fence":"1"} or {"status":"busy","fence":null}.
 */
import { PrismaClient } from "@prisma/client";
import { claimHistoricImport } from "@/server/companies/historic-import-lock";

const importId = process.argv[2];
const databaseUrl = process.env["DATABASE_URL"];
if (!importId || !databaseUrl) {
  console.error("import id and DATABASE_URL are required");
  process.exit(2);
}
const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (!databaseName.endsWith("_test")) {
  console.error("refusing a database whose name does not end with _test");
  process.exit(2);
}

const db = new PrismaClient();
try {
  const claim = await claimHistoricImport(importId, db);
  console.log(
    JSON.stringify({
      status: claim.status,
      fence: claim.status === "claimed" ? claim.fence.toString() : null,
    }),
  );
} finally {
  await db.$disconnect();
}
