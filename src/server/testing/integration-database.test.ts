import { describe, expect, it } from "vitest";
import { assertDedicatedIntegrationDatabase } from "@/server/testing/integration-database";

const localTest = "postgresql://ab:secret@localhost:5432/automotive_brands_test?schema=public";

describe("integration database guard", () => {
  it("accepts a local database whose name ends with _test", () => {
    expect(assertDedicatedIntegrationDatabase(localTest)).toBe(localTest);
  });

  it("refuses the application database and remote hosts", () => {
    expect(() =>
      assertDedicatedIntegrationDatabase("postgresql://ab:secret@localhost:5432/automotive_brands"),
    ).toThrow(/application database|ends with _test/i);
    expect(() =>
      assertDedicatedIntegrationDatabase("postgresql://ab:secret@db.internal:5432/automotive_brands_test"),
    ).toThrow(/remote/i);
    expect(() => assertDedicatedIntegrationDatabase("not a url")).toThrow(/invalid/i);
  });

  it("refuses production mode", () => {
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      expect(() => assertDedicatedIntegrationDatabase(localTest)).toThrow(/production/i);
    } finally {
      if (previous === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previous;
    }
  });
});
