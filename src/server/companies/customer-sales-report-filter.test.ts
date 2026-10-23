import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { streamFilterReport } from "@/server/companies/customer-sales-report-filter";

let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "sales-filter-"));
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("customer sales report filter", () => {
  it("keeps the selected account, its continuation lines, and drops other customers", async () => {
    const file = path.join(directory, "561l.csv");
    const text = [
      "Acct.,Inv & Ln,Part Number,Description,Units,Sales",
      "OTHER99,I/OTH1/1,PART,Other customer,1,\"£1.00\"",
      ",I/OTH1/2,PART,Other continuation,1,\"£1.00\"",
      "RETAIL1,I/KEEP/1,WIDGET,First,2,\"£20.00\"",
      ",I/KEEP/2,WIDGET,Continuation,1,\"£5.00\"",
      "ALIAS1,I/ALS/1,ALSKU,Alias,1,\"£3.00\"",
      "RETAIL1,I/BADLINE,MISSING,Bad,1,\"£1.00\"",
    ].join("\n");
    await writeFile(file, text);
    const filtered = await streamFilterReport({
      filePath: file,
      mode: "HISTORY_561L",
      accountCodes: ["retail1", "alias1"],
    });
    expect(filtered.rowsRead).toBe(6);
    expect(filtered.matchingRows).toBe(4);
    expect(filtered.otherCustomerRows).toBe(2);
    expect(filtered.text).toContain("RETAIL1,I/KEEP/1");
    expect(filtered.text).toContain(",I/KEEP/2");
    expect(filtered.text).toContain("ALIAS1,I/ALS/1");
    expect(filtered.text).toContain("BADLINE");
    expect(filtered.text).not.toContain("OTHER99");
    expect(filtered.text).not.toContain("OTH1/2");
  });

  it("stops when the selected customer's own rows exceed the processing limit", async () => {
    const file = path.join(directory, "huge-own.csv");
    const header = "Acct.,Inv & Ln,Part Number,Description,Units,Sales\n";
    const line = "RETAIL1,I/KEEP/1,WIDGET,Own row,1,\"£1.00\"\n";
    await writeFile(file, header + line.repeat(50));
    await expect(
      streamFilterReport({
        filePath: file,
        mode: "HISTORY_561L",
        accountCodes: ["RETAIL1"],
        maxChars: 200,
      }),
    ).rejects.toThrow(/processing limit/);
  });

  it("does not treat a stored upload as Sales Enquiry inclusion", () => {
    const source = readFileSync(
      path.resolve(import.meta.dirname, "../sales-intelligence/unified-sales.ts"),
      "utf8",
    );
    const dated = source.slice(source.indexOf("d_raw AS ("), source.indexOf("all_raw AS"));
    expect(dated).toContain(`l."source" = 'ONGOING_TRM21QC'`);
    expect(dated).not.toContain("'561L'");
  });
});
