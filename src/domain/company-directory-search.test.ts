import { describe, expect, it } from "vitest";
import { companyListQuerySchema, resolveCompanyListStatusScope } from "@/domain/company";

describe("admin customer directory status scope", () => {
  it("defaults to active customers when the directory has no search", () => {
    expect(resolveCompanyListStatusScope({ statusScope: "DIRECTORY_DEFAULT" })).toEqual({
      mode: "ACTIVE",
      label: "Active customers",
      statuses: ["ACTIVE"],
    });
  });

  it("includes prospects while a directory search is in effect", () => {
    expect(
      resolveCompanyListStatusScope({ statusScope: "DIRECTORY_DEFAULT", q: "york" }),
    ).toEqual({
      mode: "ACTIVE_AND_PROSPECT",
      label: "Active customers and prospects",
      statuses: ["ACTIVE", "PROSPECT"],
    });
  });

  it("treats a cleared search as active only", () => {
    expect(
      resolveCompanyListStatusScope({ statusScope: "DIRECTORY_DEFAULT", q: "   " }),
    ).toMatchObject({ mode: "ACTIVE", statuses: ["ACTIVE"] });
  });

  it("lets an explicit status override the directory default", () => {
    expect(
      resolveCompanyListStatusScope({
        statusScope: "DIRECTORY_DEFAULT",
        q: "york",
        status: "SUSPENDED",
      }),
    ).toEqual({
      mode: "STATUS",
      label: "Suspended customers",
      statuses: ["SUSPENDED"],
    });
    expect(
      resolveCompanyListStatusScope({
        statusScope: "DIRECTORY_DEFAULT",
        q: "york",
        statusGroup: "CLOSED_OR_SUSPENDED",
      }).statuses,
    ).toEqual(["CLOSED", "SUSPENDED", "ON_HOLD"]);
  });

  it("keeps other company pickers unscoped unless they opt into the directory", () => {
    expect(resolveCompanyListStatusScope({ q: "york" }).mode).toBe("ALL");
    expect(resolveCompanyListStatusScope({ statusScope: "ALL" }).statuses).toEqual([]);
  });

  it("accepts the directory scope on the list query", () => {
    const parsed = companyListQuerySchema.parse({
      q: " GB123 ",
      statusScope: "DIRECTORY_DEFAULT",
      page: 2,
    });
    expect(parsed.q).toBe("GB123");
    expect(parsed.statusScope).toBe("DIRECTORY_DEFAULT");
    expect(parsed.page).toBe(2);
  });
});
