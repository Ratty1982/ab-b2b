import { describe, expect, it } from "vitest";
import {
  audienceTargetsUser,
  parseVersionUpdateAudience,
  parseVersionUpdateContent,
  sanitisePlainText,
  validateVersionLabel,
} from "@/domain/version-updates";

describe("version updates domain", () => {
  it("strips HTML from plain text", () => {
    expect(sanitisePlainText("<script>x</script>Hello <b>there</b>")).toBe("Hello there");
  });

  it("parses content sections", () => {
    const c = parseVersionUpdateContent({
      intro: "Intro",
      sections: [{ heading: "SDS", body: "Added SDS" }, { heading: "", body: "" }],
    });
    expect(c.intro).toBe("Intro");
    expect(c.sections).toHaveLength(1);
    expect(c.sections[0]?.heading).toBe("SDS");
  });

  it("targets audience by role", () => {
    const all = parseVersionUpdateAudience({ mode: "ALL_INTERNAL" });
    expect(audienceTargetsUser(all, ["SALES_REPRESENTATIVE"])).toBe(true);
    const roles = parseVersionUpdateAudience({
      mode: "ROLES",
      roleKeys: ["ACCOUNTS", "MARKETING"],
    });
    expect(audienceTargetsUser(roles, ["SALES_REPRESENTATIVE"])).toBe(false);
    expect(audienceTargetsUser(roles, ["ACCOUNTS"])).toBe(true);
  });

  it("validates version labels", () => {
    expect(validateVersionLabel("1.4")).toBeNull();
    expect(validateVersionLabel("")).toBeTruthy();
    expect(validateVersionLabel("../evil")).toBeTruthy();
  });
});
