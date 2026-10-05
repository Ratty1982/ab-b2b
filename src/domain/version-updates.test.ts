import { describe, expect, it } from "vitest";
import {
  audienceTargetsUser,
  parseQuickPasteUpdate,
  parseVersionUpdateAudience,
  parseVersionUpdateContent,
  quickUpdateVersionFromDate,
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
    expect(validateVersionLabel("2026.10.05")).toBeNull();
    expect(quickUpdateVersionFromDate("2026-10-05")).toBe("2026.10.05");
  });
});

describe("quick paste update parser", () => {
  it("uses the first non-empty line as title and the rest as body", () => {
    const parsed = parseQuickPasteUpdate("Purchasing Intelligence\n\nWe've added a new area.");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.title).toBe("Purchasing Intelligence");
    expect(parsed.intro).toBe("We've added a new area.");
    expect(parsed.content.sections).toEqual([]);
    expect(parsed.titleOnly).toBe(false);
  });

  it("normalises dash-only and asterisk-only bullet lists", () => {
    const dash = parseQuickPasteUpdate("Title\n\n- One\n- Two");
    const star = parseQuickPasteUpdate("Title\n\n* One\n* Two");
    expect(dash.ok && dash.intro).toBe("• One\n• Two");
    expect(star.ok && star.intro).toBe("• One\n• Two");
  });

  it("normalises mixed • - * bullets and keeps paragraphs", () => {
    const sample = `
Purchasing Intelligence

We've added a new Purchasing Intelligence area to help plan future
stock requirements.

• See current stock and incoming purchase orders
- Forecast demand using sales history
* Identify products running low or potentially overstocked
`;
    const parsed = parseQuickPasteUpdate(sample);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.title).toBe("Purchasing Intelligence");
    expect(parsed.intro).toContain("We've added a new Purchasing Intelligence area");
    expect(parsed.intro).toMatch(/^We've added[\s\S]*\n\n• See current stock/m);
    expect(parsed.intro).toContain("• Forecast demand using sales history");
    expect(parsed.intro).toContain("• Identify products running low or potentially overstocked");
    expect(parsed.intro).not.toMatch(/^- /m);
    expect(parsed.intro).not.toMatch(/^\* /m);
  });

  it("trims leading and trailing blank lines without collapsing inner paragraphs", () => {
    const parsed = parseQuickPasteUpdate("\n\nTitle\n\nPara one.\n\nPara two.\n\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.title).toBe("Title");
    expect(parsed.intro).toBe("Para one.\n\nPara two.");
  });

  it("rejects a blank paste", () => {
    expect(parseQuickPasteUpdate("").ok).toBe(false);
    expect(parseQuickPasteUpdate("   \n\n  ").ok).toBe(false);
  });

  it("accepts a title-only paste", () => {
    const parsed = parseQuickPasteUpdate("Purchasing Intelligence\n\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.title).toBe("Purchasing Intelligence");
    expect(parsed.intro).toBe("");
    expect(parsed.titleOnly).toBe(true);
  });

  it("strips HTML and script from title and body", () => {
    const parsed = parseQuickPasteUpdate(
      "<script>alert(1)</script>Purchasing Intelligence\n\nWe've added <b>stock</b> tools.\n• <img src=x onerror=alert(1)> See current stock",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.title).toBe("Purchasing Intelligence");
    expect(parsed.intro).toContain("We've added stock tools.");
    expect(parsed.intro).toContain("• See current stock");
    expect(parsed.intro).not.toMatch(/<script|onerror|<b>|<img/i);
    expect(parsed.title).not.toMatch(/<script/i);
  });
});
