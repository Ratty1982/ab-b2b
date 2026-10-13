import { describe, expect, it } from "vitest";
import { customerSearchResponseIsCurrent, pageAfterQueryChange } from "@/components/orders/customer-search-session";

describe("customer search response ordering", () => {
  it("ignores an older query that finishes after a newer one", () => {
    const first = { seq: 1, query: "ABC", page: 1 };
    const current = { seq: 2, query: "ABCD", page: 1 };
    const applied: string[] = [];

    if (
      customerSearchResponseIsCurrent({
        mounted: true,
        responseSeq: current.seq,
        currentSeq: current.seq,
        responseQuery: current.query,
        currentQuery: current.query,
        responsePage: current.page,
        currentPage: current.page,
      })
    ) {
      applied.push(current.query);
    }
    if (
      customerSearchResponseIsCurrent({
        mounted: true,
        responseSeq: first.seq,
        currentSeq: current.seq,
        responseQuery: first.query,
        currentQuery: current.query,
        responsePage: first.page,
        currentPage: current.page,
      })
    ) {
      applied.push(first.query);
    }

    expect(applied).toEqual(["ABCD"]);
  });

  it("ignores a stale page, a stale error, and a response after unmount", () => {
    expect(
      customerSearchResponseIsCurrent({
        mounted: true,
        responseSeq: 3,
        currentSeq: 4,
        responseQuery: "motor",
        currentQuery: "motor",
        responsePage: 2,
        currentPage: 1,
      }),
    ).toBe(false);
    expect(
      customerSearchResponseIsCurrent({
        mounted: true,
        responseSeq: 2,
        currentSeq: 3,
        responseQuery: "ABC",
        currentQuery: "ABCD",
        responsePage: 1,
        currentPage: 1,
      }),
    ).toBe(false);
    expect(
      customerSearchResponseIsCurrent({
        mounted: false,
        responseSeq: 5,
        currentSeq: 5,
        responseQuery: "ABCD",
        currentQuery: "ABCD",
        responsePage: 1,
        currentPage: 1,
      }),
    ).toBe(false);
  });

  it("resets the page when the search term changes and keeps it when the page changes", () => {
    expect(pageAfterQueryChange("ABC", "ABCD", 3)).toBe(1);
    expect(pageAfterQueryChange("ABCD", "ABCD", 3)).toBe(3);
  });
});
