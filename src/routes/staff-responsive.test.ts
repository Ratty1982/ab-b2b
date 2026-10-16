import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("staff and CRM responsive layouts", () => {
  it("lets CRM search fields use the full width on a phone", () => {
    for (const file of ["src/routes/crm.leads.tsx", "src/routes/crm.activities.tsx", "src/routes/crm.tasks.tsx"]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(source).toContain("min-w-0");
      expect(source).toContain("text-base");
      expect(source).not.toContain("min-w-[200px]");
      expect(source).not.toContain("min-w-[180px]");
    }
  });

  it("keeps promotion report figures inside a sideways scroll region", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/components/promotions/campaign-workspace.tsx"),
      "utf8",
    );
    expect(source).toContain("overflow-x-auto");
    expect(source).toContain("revenueExVat");
  });
});
