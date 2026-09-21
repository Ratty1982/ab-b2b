import { describe, expect, it } from "vitest";
import {
  emptyToNull,
  moveListItem,
  sanitizeSpecRows,
  sanitizeStringList,
  sellingFromDraft,
} from "@/domain/product-content-editor";
import { productWorkspaceSchema } from "@/domain/catalogue";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("editable product content lists", () => {
  it("trims and drops blank benefit/feature/application lines", () => {
    expect(sanitizeStringList(["  Streak-free  ", "", "   ", "Fast evaporating"])).toEqual([
      "Streak-free",
      "Fast evaporating",
    ]);
  });

  it("reorders list items", () => {
    expect(moveListItem(["A", "B", "C"], 2, 0)).toEqual(["C", "A", "B"]);
    expect(moveListItem(["A", "B", "C"], 0, 2)).toEqual(["B", "C", "A"]);
    expect(moveListItem(["A", "B"], 1, 1)).toEqual(["A", "B"]);
  });

  it("treats empty directions and warnings as absent", () => {
    expect(emptyToNull("  Apply and wipe  ")).toBe("Apply and wipe");
    expect(emptyToNull("   ")).toBeNull();
    expect(emptyToNull(null)).toBeNull();
  });

  it("sanitises specification rows and drops blanks", () => {
    expect(
      sanitizeSpecRows([
        { name: " Finish ", value: " Streak-Free " },
        { name: "", value: "No" },
        { name: "Residue Free", value: "  " },
      ]),
    ).toEqual([{ name: "Finish", value: "Streak-Free" }]);
  });

  it("builds selling content from a draft", () => {
    expect(
      sellingFromDraft({
        keyBenefits: ["One", ""],
        features: ["Two"],
        applications: ["Glass"],
        directions: "Wipe",
        warnings: "",
      }),
    ).toEqual({
      keyBenefits: ["One"],
      features: ["Two"],
      applications: ["Glass"],
      directions: "Wipe",
      warnings: null,
    });
  });
});

describe("product workspace content schema", () => {
  it("accepts selling copy on the same save payload as overview/commercial/SEO", () => {
    const parsed = productWorkspaceSchema.parse({
      id: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
      shortDescription: "Short copy",
      description: "<p>Full</p>",
      selling: {
        keyBenefits: ["Clear glass"],
        features: ["Professional"],
        applications: ["Windscreens"],
        directions: "Apply and wipe",
        warnings: "Keep away from children",
      },
      specifications: [{ name: "Finish", value: "Streak-Free" }],
      metaTitle: "Title",
      metaDescription: "Desc",
      tradePrice: 8.7,
    });
    expect(parsed.selling?.keyBenefits).toEqual(["Clear glass"]);
    expect(parsed.shortDescription).toBe("Short copy");
    expect(parsed.metaTitle).toBe("Title");
    expect(parsed.tradePrice).toBe(8.7);
  });
});

describe("admin content tab is a live editor", () => {
  it("does not render imported selling copy as a read-only bullet dump", () => {
    const src = readFileSync(path.join(process.cwd(), "src/routes/admin.products.$id.tsx"), "utf8");
    expect(src).toContain("EditableStringList");
    expect(src).toContain('id="ws-directions"');
    expect(src).toContain('id="ws-warnings"');
    expect(src).toContain("Add specification");
    expect(src).not.toMatch(/selling\?\.keyBenefits\.map/);
    expect(src).not.toMatch(/list-disc pl-5[\s\S]*keyBenefits/);
    expect(src).toContain("ImportProductJsonButton");
    expect(src).toContain('label="Meta title"');
    expect(src).toContain('label="Pack qty"');
    expect(src).toContain('label="Case qty"');
  });
});
