/**
 * From / Reply-To address builders + branded email shell.
 */
import { describe, expect, it } from "vitest";
import {
  buildFromAddress,
  buildReplyToAddress,
  buildSmtpMailAddresses,
  formatMailAddress,
} from "@/server/email/addresses";
import {
  EMAIL_SHELL_COLORS,
  brandLogoUrl,
  powerMaxedLogoUrl,
  renderTransactionalEmailShell,
  steelSealLogoUrl,
} from "@/server/email/shell";
import { buildDiagnosticTestEmailBodies } from "@/server/email/test-template";
import { buildOrderReceivedCustomerBodies } from "@/server/orders/email";
import { buildTradeApplicationReceivedBodies } from "@/server/email/application-templates";

describe("SMTP From / Reply-To builders", () => {
  it("uses configured From Name and From Email (structured)", () => {
    const from = buildFromAddress({
      fromName: "Automotive Brands",
      fromEmail: "b2b@automotivebrands.co.uk",
      smtpUsername: "b2b@automotivebrands.co.uk",
    });
    expect(from).toEqual({
      name: "Automotive Brands",
      address: "b2b@automotivebrands.co.uk",
    });
    expect(formatMailAddress(from)).toBe(
      '"Automotive Brands" <b2b@automotivebrands.co.uk>',
    );
  });

  it("does not use SMTP username as From display name", () => {
    const from = buildFromAddress({
      fromName: "Automotive Brands",
      fromEmail: "b2b@automotivebrands.co.uk",
      smtpUsername: "b2b",
    });
    expect(from.name).toBe("Automotive Brands");
    expect(from.name).not.toBe("b2b");
    expect(formatMailAddress(from)).not.toMatch(/^"?b2b"?\s*</);
  });

  it("omits name when From Name is blank", () => {
    const from = buildFromAddress({
      fromName: "  ",
      fromEmail: "b2b@automotivebrands.co.uk",
    });
    expect(from).toEqual({ address: "b2b@automotivebrands.co.uk" });
  });

  it("uses Reply-To Name when present", () => {
    const reply = buildReplyToAddress({
      fromName: "Automotive Brands",
      fromEmail: "b2b@automotivebrands.co.uk",
      replyToName: "Orders Desk",
      replyToEmail: "orders@automotivebrands.co.uk",
    });
    expect(reply).toEqual({
      name: "Orders Desk",
      address: "orders@automotivebrands.co.uk",
    });
  });

  it("handles blank Reply-To Name with email only", () => {
    const reply = buildReplyToAddress({
      fromName: "Automotive Brands",
      fromEmail: "b2b@automotivebrands.co.uk",
      replyToName: "",
      replyToEmail: "orders@automotivebrands.co.uk",
    });
    expect(reply).toEqual({ address: "orders@automotivebrands.co.uk" });
  });

  it("omits Reply-To when email blank", () => {
    expect(
      buildReplyToAddress({
        fromName: "Automotive Brands",
        fromEmail: "b2b@automotivebrands.co.uk",
        replyToName: "X",
        replyToEmail: null,
      }),
    ).toBeUndefined();
  });

  it("buildSmtpMailAddresses returns both headers", () => {
    const addrs = buildSmtpMailAddresses({
      fromName: "Automotive Brands",
      fromEmail: "b2b@automotivebrands.co.uk",
      replyToName: null,
      replyToEmail: "reply@automotivebrands.co.uk",
      smtpUsername: "b2b@automotivebrands.co.uk",
    });
    expect(addrs.from.name).toBe("Automotive Brands");
    expect(addrs.from.address).toBe("b2b@automotivebrands.co.uk");
    expect(addrs.replyTo).toEqual({ address: "reply@automotivebrands.co.uk" });
    expect(addrs.fromHeader).toContain("Automotive Brands");
    expect(addrs.fromHeader).toContain("b2b@automotivebrands.co.uk");
  });
});

describe("branded transactional email shell", () => {
  it("renders navy header with AB + supporting brand logos, red CTA, no Trade Supply", () => {
    const html = renderTransactionalEmailShell({
      preheader: "Preview line",
      bodyHtml: "<p>Hello trade customer</p>",
      cta: { label: "View order", href: "https://example.com/portal/orders/1" },
      footer: {
        fromName: "Automotive Brands",
        fromEmail: "b2b@automotivebrands.co.uk",
        replyToEmail: "orders@automotivebrands.co.uk",
      },
    });
    expect(html).toContain(EMAIL_SHELL_COLORS.navy);
    expect(html).toContain(EMAIL_SHELL_COLORS.red);
    expect(html).toContain("View order");
    expect(html).toContain("https://example.com/portal/orders/1");
    expect(html).toContain(brandLogoUrl());
    expect(html).toContain(powerMaxedLogoUrl());
    expect(html).toContain(steelSealLogoUrl());
    expect(html).toContain('alt="Automotive Brands"');
    expect(html).toContain('alt="Power Maxed"');
    expect(html).toContain('alt="Steel Seal"');
    expect(html).toContain("automotivebrands.co.uk");
    expect(html).toContain("Automotive Brands");
    expect(html).toContain("orders@automotivebrands.co.uk");
    expect(html).not.toMatch(/Trade Supply/i);
    expect(html).not.toContain("smtpPassword");
    expect(html).not.toContain("smtp.office365.com");
    expect(html).toContain("max-width:600px");
    // Supporting logos smaller than dominant AB identity block
    expect(html).toContain('width="88"');
    expect(html).toContain('width="96"');
  });

  it("exposes absolute brand logo helpers under APP_URL", () => {
    expect(brandLogoUrl()).toMatch(/^https?:\/\/.+\/brand\/ab-logo\.jpg$/);
    expect(powerMaxedLogoUrl()).toMatch(/^https?:\/\/.+\/brand\/power-maxed-logo\.png$/);
    expect(steelSealLogoUrl()).toMatch(/^https?:\/\/.+\/brand\/steel-seal-logo\.jpg$/);
    // Relative filesystem paths must never be used in email HTML
    expect(brandLogoUrl()).not.toMatch(/^\.\.?\/|^\/workspace/);
    expect(powerMaxedLogoUrl()).not.toMatch(/^\.\.?\/|^\/workspace/);
  });

  it("test email uses branded shell + plain text", () => {
    const bodies = buildDiagnosticTestEmailBodies({
      toName: "Wayne",
      sentAt: new Date("2026-09-24T15:00:00.000Z"),
      footer: { fromName: "Automotive Brands", fromEmail: "b2b@automotivebrands.co.uk" },
    });
    expect(bodies.subject).toBe("Automotive Brands Email Test");
    expect(bodies.text).toContain("TRANSACTIONAL EMAIL TEST");
    expect(bodies.text).toContain("Admin → Settings → Email");
    expect(bodies.html).toContain("Transactional email test");
    expect(bodies.html).toContain(EMAIL_SHELL_COLORS.navy);
    expect(bodies.html).not.toMatch(/password|smtpUsername/i);
  });

  it("order customer email uses shell + summary table + plain text", () => {
    const bodies = buildOrderReceivedCustomerBodies(
      {
        orderId: "ord1",
        orderNumber: "AB-000001",
        companyName: "Acme Factors",
        status: "SUBMITTED",
        poNumber: "PO-9",
        currency: "GBP",
        subtotal: "10.00",
        vatTotal: "2.00",
        deliveryTotal: "0.00",
        grandTotal: "12.00",
        placedAt: new Date(),
        paymentTerms: "Net 30",
        deliveryInstructions: null,
        deliveryAddress: {
          line1: "1 High St",
          line2: null,
          town: "Leeds",
          county: null,
          postcode: "LS1 1AA",
          country: "GB",
        },
        contact: { name: "Sam", email: "sam@example.com", phone: null },
        items: [
          {
            sku: "SKU-1",
            name: "Widget",
            qty: 4,
            customerUnitPrice: "2.50",
            lineTotal: "10.00",
            orderingMode: "CASE",
          },
        ],
        autopartAccountLinked: false,
        autopartCustomerCodeSnapshot: null,
        salesRepNameSnapshot: null,
        salesRepCodeSnapshot: null,
        portalOrderUrl: "https://example.com/portal/orders/ord1",
        adminOrderUrl: "https://example.com/admin/orders/ord1",
      },
      { fromName: "Automotive Brands", fromEmail: "b2b@automotivebrands.co.uk" },
    );
    expect(bodies.html).toContain("Product");
    expect(bodies.html).toContain("SKU-1");
    expect(bodies.html).toContain("Unit Price");
    expect(bodies.html).toContain("Goods ex VAT");
    expect(bodies.html).toContain("Delivery");
    expect(bodies.html).toContain("FREE");
    expect(bodies.html).toContain("View your order");
    expect(bodies.html).toContain(EMAIL_SHELL_COLORS.red);
    expect(bodies.text).toContain("AB-000001");
    expect(bodies.text).toContain("Goods ex VAT");
    expect(bodies.text).toContain("Delivery: FREE");
    expect(bodies.text).toContain("VIEW YOUR ORDER");
    expect(bodies.html).not.toContain("smtp.office365");
  });

  it("trade application email uses shared shell", () => {
    const bodies = buildTradeApplicationReceivedBodies(
      {
        applicationId: "app1",
        reference: "APP-20260924-0001",
        companyName: "Trade Co",
        contactName: "Alex",
        contactEmail: "alex@example.com",
      },
      { fromName: "Automotive Brands", fromEmail: "b2b@automotivebrands.co.uk" },
    );
    expect(bodies.html).toContain(EMAIL_SHELL_COLORS.navy);
    expect(bodies.text).toContain("APP-20260924-0001");
    expect(bodies.html).toContain("Automotive Brands");
  });
});
