/**
 * Guards for integration tests that write rows.
 * The application database is never an acceptable target.
 */

const APPLICATION_DATABASE_NAMES = new Set([
  "automotive_brands",
  "postgres",
  "template0",
  "template1",
]);

export function databaseNameFromUrl(url: string): string {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname.replace(/^\//, "").split("?")[0] ?? "");
}

export function assertDedicatedIntegrationDatabase(url: string): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Integration tests cannot run when NODE_ENV is production.");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Integration test database URL is missing or invalid.");
  }
  const name = databaseNameFromUrl(url);
  if (!name || APPLICATION_DATABASE_NAMES.has(name) || !name.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration tests against database "${name || "unknown"}". Set TEST_DATABASE_URL to a dedicated database whose name ends with _test.`,
    );
  }
  const host = parsed.hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local && process.env["AB_ALLOW_REMOTE_TEST_DATABASE"] !== "1") {
    throw new Error("Refusing to run integration tests against a remote database.");
  }
  return url;
}
