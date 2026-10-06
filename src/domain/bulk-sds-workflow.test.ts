import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const importSrc = readFileSync(join(root, "src/routes/admin.products.documents-import.tsx"), "utf8");
const settingsSrc = readFileSync(join(root, "src/routes/admin.settings.tsx"), "utf8");
const navSrc = readFileSync(join(root, "src/lib/app-nav.ts"), "utf8");
const dashboardSrc = readFileSync(join(root, "src/server/admin/dashboard.ts"), "utf8");

describe("Bulk SDS Upload production UI", () => {
  it("is the primary documents-import workspace", () => {
    expect(importSrc).toContain("Bulk SDS Upload");
    expect(importSrc).toContain("Drop SDS PDF files here");
    expect(importSrc).toContain("Choose files");
    expect(importSrc).toContain("accept=\"application/pdf,.pdf\"");
    expect(importSrc).toContain("Matched product");
    expect(importSrc).toContain("Match method");
    expect(importSrc).toContain("Existing SDS");
    expect(importSrc).toContain("Import summary");
    expect(importSrc).toContain("Confirm import");
    expect(importSrc).toContain("Skip file");
    expect(importSrc).toContain("Needs review");
  });

  it("hides SharePoint scan/import unless workflowEnabled", () => {
    expect(importSrc).toContain("sharePointEnabled");
    expect(importSrc).toMatch(/sharePointEnabled \? \(/);
    expect(importSrc).toContain("Scan SharePoint folder");
  });

  it("wires Operations Documents and settings to the same route", () => {
    expect(navSrc).toContain("adminProductDocumentsImport: \"/admin/products/documents-import\"");
    expect(navSrc).toMatch(/id: "documents"[\s\S]*to: ROUTES.adminProductDocumentsImport/);
    expect(settingsSrc).toContain("ROUTES.adminProductDocumentsImport");
    expect(settingsSrc).toContain("Bulk SDS Upload");
    expect(settingsSrc).toContain("Safety Data Sheets are managed manually");
  });

  it("does not surface SharePoint SDS on the dashboard when disabled", () => {
    expect(dashboardSrc).toContain("isSharePointSdsWorkflowEnabled()");
  });
});
