import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("admin and reporting responsive layouts", () => {
  it("scrolls staff activity instead of clipping the security table", () => {
    const source = readFileSync(path.join(process.cwd(), "src/components/admin/StaffActivityPanel.tsx"), "utf8");
    expect(source).toContain("overflow-x-auto");
    expect(source).not.toContain("overflow-hidden rounded-md border border-border");
    expect(source).toContain("min-w-[560px]");
  });

  it("keeps sales enquiry controls readable without changing the report request", () => {
    const controls = readFileSync(
      path.join(process.cwd(), "src/components/sales-intelligence/workspace.tsx"),
      "utf8",
    );
    const dashboard = readFileSync(
      path.join(process.cwd(), "src/components/sales-intelligence/sales-enquiry-dashboard.tsx"),
      "utf8",
    );
    expect(controls).toContain("text-base");
    expect(controls).toContain("lg:text-[13px]");
    expect(dashboard).toContain('interval="preserveStartEnd"');
    expect(dashboard).toContain("min-w-0");
    expect(dashboard).not.toContain("withReportSql");
  });
});
