import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression: Windows/Chrome dark color-scheme + light native option popup
 * made <option> text invisible. Global base styles must force readable option
 * foreground/background for all native selects (portal + admin).
 */
describe("native select option contrast", () => {
  const css = readFileSync(resolve(import.meta.dirname, "./styles.css"), "utf8");

  it("sets closed select to dark theme foreground/surface", () => {
    expect(css).toMatch(/select\s*\{[^}]*color:\s*var\(--color-foreground\)/s);
    expect(css).toMatch(/select\s*\{[^}]*background-color:\s*var\(--color-surface\)/s);
  });

  it("forces readable option text on a light option surface", () => {
    expect(css).toMatch(/select option[\s\S]*?color:\s*var\(--ink\)/);
    expect(css).toMatch(/select option[\s\S]*?background-color:\s*oklch\(1 0 0\)/);
  });

  it("styles disabled options without relying on hover", () => {
    expect(css).toMatch(/select option:disabled[\s\S]*?color:\s*var\(--steel\)/);
  });
});
