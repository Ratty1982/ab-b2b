import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("customer portal responsive layouts", () => {
  it("shows order history as cards on small screens and keeps the table for wider screens", () => {
    const source = readFileSync(path.join(process.cwd(), "src/routes/portal.orders.index.tsx"), "utf8");
    expect(source).toContain('data-layout="order-cards"');
    expect(source).toContain("md:hidden");
    expect(source).toContain('data-layout="order-table"');
    expect(source).toContain("hidden overflow-x-auto");
    expect(source).toContain("o.grandTotal");
    expect(source).toContain("View order");
  });

  it("keeps catalogue filters and quantity controls at a practical touch size", () => {
    const catalogue = readFileSync(
      path.join(process.cwd(), "src/components/public/PublicCatalogueShell.tsx"),
      "utf8",
    );
    const ordering = readFileSync(
      path.join(process.cwd(), "src/components/public/ProductTradeOrdering.tsx"),
      "utf8",
    );
    const basket = readFileSync(path.join(process.cwd(), "src/routes/portal.basket.tsx"), "utf8");
    expect(catalogue).toContain("min-h-11");
    expect(ordering).toContain("size-11");
    expect(basket).toContain("size-11");
  });
});
