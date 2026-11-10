import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("customer setup layout scroll contract", () => {
  const setup = readFileSync("src/components/ab/CustomerSetupScreen.tsx", "utf8");
  const history = readFileSync("src/components/ab/autopart/AutopartHistoryImport.tsx", "utf8");
  const shell = readFileSync("src/components/ab/AppShell.tsx", "utf8");

  it("owns a dedicated scroll region instead of sticky-bottom footer inflation", () => {
    expect(setup).toContain('data-customer-setup-scroll=""');
    expect(setup).toContain('data-customer-setup-footer=""');
    expect(setup).toContain("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden");
    expect(setup).not.toContain("sticky bottom-0");
  });

  it("keeps AppShell main as block-flow by default and only fills for Customer Setup", () => {
    expect(shell).toContain('data-app-shell-main=""');
    expect(shell).toContain('data-app-shell-main-layout={fillMainContent ? "fill" : "scroll"}');
    expect(shell).toContain('pathname.startsWith("/admin/customers/setup")');
    expect(shell).toContain('fillMainContent && "flex flex-col"');
    // Must not force flex-column on every admin/purchasing page (shrinks fragment siblings).
    expect(shell).not.toMatch(
      /main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip overflow-y-auto"/,
    );
    expect(shell).toContain('"min-h-0 min-w-0 flex-1 overflow-x-clip overflow-y-auto"');
  });

  it("keeps file inputs inside a relative drop target and preserves scroll on preview", () => {
    expect(history).toContain("relative mt-3 flex cursor-pointer");
    expect(history).toContain("absolute inset-0 cursor-pointer opacity-0");
    expect(history).not.toMatch(/className="sr-only"/);
    expect(history).toContain("data-customer-setup-scroll");
    expect(history).toContain("restoreScrollTop");
    expect(history).toContain("previewCustomerSalesHistoryUploadFn");
  });
});
