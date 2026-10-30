import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { US_INCORPORATION_DOCUMENTS } from "@/domain/us-incorporation-documents";

describe("preserved US incorporation documents", () => {
  it("serves the three original WordPress PDFs", () => {
    expect(US_INCORPORATION_DOCUMENTS.map((doc) => doc.label)).toEqual([
      "Automotive Brands Inc – Certificate of Incorporation",
      "147C EIN verification",
      "Automotive Brands Inc – Address Change Confirmation",
    ]);
    for (const doc of US_INCORPORATION_DOCUMENTS) {
      const bytes = readFileSync(join(process.cwd(), "public", doc.href.replace(/^\//, "")));
      expect(bytes.subarray(0, 5).toString("utf8")).toBe("%PDF-");
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(doc.sha256);
    }
  });
});
