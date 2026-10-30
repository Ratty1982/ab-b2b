import { describe, expect, it } from "vitest";
import { migrationRequestDecision } from "@/domain/legacy-redirects";

const APP = "https://automotivebrands.co.uk";

describe("legacy WordPress redirects", () => {
  it("permanently redirects /our-story and the trailing-slash form", () => {
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://b2b.automotivebrands.co.uk/our-story/",
        appUrl: APP,
      }),
    ).toEqual({
      status: 301,
      location: "https://b2b.automotivebrands.co.uk/why-automotive-brands",
    });
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://automotivebrands.co.uk/our-story?utm=wp",
        appUrl: APP,
      }),
    ).toEqual({
      status: 301,
      location: "https://automotivebrands.co.uk/why-automotive-brands?utm=wp",
    });
  });

  it("redirects the WordPress sample page home and keeps the published survey path", () => {
    const sample = migrationRequestDecision({
      method: "GET",
      requestUrl: "https://automotivebrands.co.uk/sample-page/",
      appUrl: APP,
    });
    expect(sample).toEqual({ status: 301, location: "https://automotivebrands.co.uk/" });
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://automotivebrands.co.uk/customer-survey/",
        appUrl: APP,
      }),
    ).toEqual({
      status: 301,
      location: "https://automotivebrands.co.uk/customer-survey",
    });
  });

  it("does not send WordPress login to the trade login", () => {
    const decision = migrationRequestDecision({
      method: "GET",
      requestUrl: "https://automotivebrands.co.uk/wp-login.php?redirect_to=/wp-admin/",
      appUrl: APP,
    });
    expect(decision).toEqual({ status: 410 });
    expect(decision).not.toHaveProperty("location");
  });

  it("leaves unknown paths and the trade application alone", () => {
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://automotivebrands.co.uk/privacy-policy",
        appUrl: APP,
      }),
    ).toBeNull();
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://automotivebrands.co.uk/portal/orders/1?tab=lines",
        appUrl: APP,
      }),
    ).toBeNull();
  });
});

describe("host redirects", () => {
  it("sends www to the APP_URL origin and preserves path and query", () => {
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://www.automotivebrands.co.uk/products?brand=steel-seal",
        appUrl: APP,
      }),
    ).toEqual({
      status: 301,
      location: "https://automotivebrands.co.uk/products?brand=steel-seal",
    });
  });

  it("combines www with the our-story redirect in one hop", () => {
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://www.automotivebrands.co.uk/our-story/?ref=home",
        appUrl: APP,
      }),
    ).toEqual({
      status: 301,
      location: "https://automotivebrands.co.uk/why-automotive-brands?ref=home",
    });
  });

  it("preserves the method when www receives a non-GET", () => {
    expect(
      migrationRequestDecision({
        method: "POST",
        requestUrl: "https://www.automotivebrands.co.uk/contact",
        appUrl: APP,
      }),
    ).toEqual({
      status: 308,
      location: "https://automotivebrands.co.uk/contact",
    });
  });

  it("does not blanket-redirect the b2b host, including API callers", () => {
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://b2b.automotivebrands.co.uk/portal",
        appUrl: APP,
      }),
    ).toBeNull();
    expect(
      migrationRequestDecision({
        method: "POST",
        requestUrl: "https://b2b.automotivebrands.co.uk/api/internal/stock-sync",
        appUrl: APP,
      }),
    ).toBeNull();
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://b2b.automotivebrands.co.uk/api/auth/get-session",
        appUrl: APP,
      }),
    ).toBeNull();
  });
});
