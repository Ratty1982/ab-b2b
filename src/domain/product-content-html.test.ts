import { describe, expect, it } from "vitest";
import { sanitizeProductDescriptionHtml } from "@/domain/product-content-html";

describe("product description HTML sanitiser", () => {
  it("keeps the allowed subset and strips unsafe markup", () => {
    const out = sanitizeProductDescriptionHtml(
      `<h2>Title</h2><p>Use <strong>PPE</strong></p><ul><li>Glass</li></ul><script>alert(1)</script><iframe src="https://evil"></iframe><p onclick="steal()">Ok</p>`,
    );
    expect(out).toContain("<h2>Title</h2>");
    expect(out).toContain("<strong>PPE</strong>");
    expect(out).toContain("<li>Glass</li>");
    expect(out).not.toMatch(/script/i);
    expect(out).not.toMatch(/iframe/i);
    expect(out).not.toMatch(/onclick/i);
  });
});
