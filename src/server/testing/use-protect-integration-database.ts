/**
 * Imported first by the historical-protection integration test.
 * Points this process at TEST_DATABASE_URL before Prisma connects.
 */
import { assertDedicatedIntegrationDatabase } from "@/server/testing/integration-database";

const url = process.env["TEST_DATABASE_URL"];
if (!url) {
  throw new Error(
    "Set TEST_DATABASE_URL to a dedicated database whose name ends with _test. The historical protection tests will not use the application database.",
  );
}

process.env["DATABASE_URL"] = assertDedicatedIntegrationDatabase(url);
