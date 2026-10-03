/**
 * Email template preview rendering — production builders + fixtures only.
 */
import { describe, expect, it } from "vitest";
import {
  TEST_EMAIL_CALLOUT_TITLE,
  TEST_EMAIL_SUBJECT_PREFIX,
  decorateAsTemplateTest,
} from "@/server/email/shell";
import {
  listPreviewTemplateMeta,
  renderAllPreviewTemplates,
  renderPreviewTemplate,
} from "@/server/email/preview/registry";
import { PREVIEW_ACCOUNT_MANAGER, PREVIEW_CUSTOMER } from "@/server/email/preview/fixtures";

describe("email template preview registry", () => {
  const all = renderAllPreviewTemplates();
  const metas = listPreviewTemplateMeta();

  it("registers every live outbound template", () => {
    const ids = metas.map((m) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "trade-application-received",
        "trade-application-more-info",
        "trade-application-approved",
        "trade-application-rejected",
        "trade-account-activated",
        "company-user-invited",
        "password-reset",
        "order-received",
        "order-part-despatched",
        "order-despatched",
        "order-remaining-despatched",
        "quote-sent",
        "trade-application-internal",
        "order-received-internal",
        "quote-declined-internal",
        "callback-request-internal",
        "motorsport-partnership-internal",
        "user-invitation",
      ]),
    );
    expect(ids).toHaveLength(18);
  });

  it("every registered preview template renders subject + HTML + text", () => {
    expect(all.length).toBeGreaterThan(18);
    for (const preview of all) {
      expect(preview.subject.trim().length).toBeGreaterThan(3);
      expect(preview.html).toContain("<!DOCTYPE html>");
      expect(preview.text.trim().length).toBeGreaterThan(10);
      expect(preview.html).toContain("Automotive Brands");
    }
  });

  it("customer templates do not expose forbidden internal fields", () => {
    const customer = all.filter((p) => p.audience === "customer");
    expect(customer.length).toBeGreaterThan(8);
    for (const preview of customer) {
      const blob = `${preview.subject}\n${preview.text}\n${preview.html}`;
      expect(blob, `${preview.templateId} leaked Autopart`).not.toMatch(/Autopart/i);
      expect(blob, `${preview.templateId} leaked smtp`).not.toMatch(/smtpPassword/i);
      expect(blob, `${preview.templateId} leaked SUPER_ADMIN`).not.toContain("SUPER_ADMIN");
      expect(preview.text, `${preview.templateId} leaked margin`).not.toMatch(/\bmargin\b/i);
      expect(preview.text, `${preview.templateId} leaked cost`).not.toMatch(/\bcost\b/i);
      expect(preview.text, `${preview.templateId} leaked internal notes`).not.toMatch(/internal note/i);
    }
  });

  it("order preview uses snapshot/sample prices, not live catalogue", () => {
    const normal = renderPreviewTemplate("order-received", "normal");
    expect(normal.html).toContain("£4.50");
    expect(normal.html).toContain("£54.00");
    expect(normal.html).toContain("£196.50");
    expect(normal.html).toContain("FREE");
    expect(normal.text).toContain("Goods ex VAT: £196.50");
    expect(normal.html).toContain("AB-001234");
    expect(normal.html).toContain("BM-45821");
    expect(normal.html).toContain(PREVIEW_CUSTOMER.firstName);
  });

  it("backorder order preview renders the backorder warning", () => {
    const backorder = renderPreviewTemplate("order-received", "backorder");
    expect(backorder.html).toMatch(/some items are on backorder/i);
    expect(backorder.text).toMatch(/SOME ITEMS ARE ON BACKORDER/);
    expect(backorder.html).toContain("currently on backorder");
    expect(backorder.text).toContain("You don't need to place another order");
  });

  it("part-despatch known quantity scenario lists line quantities", () => {
    const known = renderPreviewTemplate("order-part-despatched", "known-qty");
    expect(known.html).toContain("12 × Power Maxed All Purpose Cleaner 500ml");
    expect(known.html).toContain("12 × Power Maxed Glass Cleaner 5L");
    expect(known.text).toContain("STILL TO COME");
  });

  it("part-despatch unknown quantity scenario does not fabricate line quantities", () => {
    const unknown = renderPreviewTemplate("order-part-despatched", "unknown-qty");
    expect(unknown.html).not.toContain("12 × Power Maxed All Purpose Cleaner 500ml");
    expect(unknown.html).not.toContain("6 × Steel Seal Head Gasket Fix");
    expect(unknown.text).toMatch(/exact item quantities/i);
    expect(unknown.html).not.toMatch(/Autopart/i);
  });

  it("quote preview renders total, expiry and prepared-by", () => {
    const quote = renderPreviewTemplate("quote-sent");
    expect(quote.html).toContain("Q-001234");
    expect(quote.html).toMatch(/£282\.96/);
    expect(quote.html).toContain("17/10/2026");
    expect(quote.html).toContain(PREVIEW_ACCOUNT_MANAGER.name);
    expect(quote.text).toContain("VALID UNTIL");
    expect(quote.html).toContain("View quotation");
  });

  it("welcome preview with account manager includes the card", () => {
    const welcome = renderPreviewTemplate("trade-account-activated", "with-account-manager");
    expect(welcome.html).toContain(PREVIEW_ACCOUNT_MANAGER.name);
    expect(welcome.html).toContain("Your account manager");
    expect(welcome.text).toContain("YOUR ACCOUNT MANAGER");
  });

  it("welcome preview without account manager does not invent one", () => {
    const welcome = renderPreviewTemplate("trade-account-activated", "no-account-manager");
    expect(welcome.html).not.toContain(PREVIEW_ACCOUNT_MANAGER.name);
    expect(welcome.html).not.toContain("Your account manager");
    expect(welcome.text).not.toContain("YOUR ACCOUNT MANAGER");
  });

  it("test subjects contain [TEST] and test HTML contains the callout", () => {
    for (const preview of all) {
      const testBodies = decorateAsTemplateTest(preview);
      expect(testBodies.subject.startsWith(`${TEST_EMAIL_SUBJECT_PREFIX} `)).toBe(true);
      expect(testBodies.html).toContain(TEST_EMAIL_CALLOUT_TITLE);
      expect(testBodies.text).toContain(TEST_EMAIL_CALLOUT_TITLE);
      expect(testBodies.html).toContain("No real customer/order/application has been affected");
    }
  });

  it("production HTML does not contain the test callout", () => {
    for (const preview of all) {
      expect(preview.subject.startsWith("[TEST]")).toBe(false);
      expect(preview.html).not.toContain(TEST_EMAIL_CALLOUT_TITLE);
      expect(preview.text).not.toContain(TEST_EMAIL_CALLOUT_TITLE);
    }
  });

  it("order received copy is preparing, not a defensive despatch disclaimer", () => {
    const normal = renderPreviewTemplate("order-received", "normal");
    expect(normal.html).toContain("We're now preparing your order");
    expect(normal.html).not.toContain("This confirmation does not mean");
    expect(normal.html).toContain("View your order");
  });
});
