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
      status: 302,
      location: "https://automotivebrands.co.uk/why-automotive-brands",
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

  it("does not redirect API callers on the b2b host", () => {
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

describe("temporary b2b hostname redirect", () => {
  it("302s the homepage, login, and portal and keeps the query string", () => {
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://b2b.automotivebrands.co.uk/",
        appUrl: APP,
      }),
    ).toEqual({ status: 302, location: "https://automotivebrands.co.uk/" });
    expect(
      migrationRequestDecision({
        method: "HEAD",
        requestUrl: "https://b2b.automotivebrands.co.uk/login?returnTo=%2Fportal",
        appUrl: APP,
      }),
    ).toEqual({
      status: 302,
      location: "https://automotivebrands.co.uk/login?returnTo=%2Fportal",
    });
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://b2b.automotivebrands.co.uk/portal/orders/1?tab=lines",
        appUrl: APP,
      }),
    ).toEqual({
      status: 302,
      location: "https://automotivebrands.co.uk/portal/orders/1?tab=lines",
    });
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://B2B.automotivebrands.co.uk/?utm=email&ref=old",
        appUrl: APP,
      }),
    ).toEqual({
      status: 302,
      location: "https://automotivebrands.co.uk/?utm=email&ref=old",
    });
  });

  it("leaves API, auth callbacks, webhooks, and static resources on b2b", () => {
    const stay = [
      "https://b2b.automotivebrands.co.uk/api",
      "https://b2b.automotivebrands.co.uk/api/auth/callback/google?code=abc",
      "https://b2b.automotivebrands.co.uk/api/webhooks/stripe",
      "https://b2b.automotivebrands.co.uk/api/internal/stock-sync",
      "https://b2b.automotivebrands.co.uk/api/build",
      "https://b2b.automotivebrands.co.uk/api/cms-media/logo",
      "https://b2b.automotivebrands.co.uk/brand/ab-logo.jpg",
      "https://b2b.automotivebrands.co.uk/favicon.png",
      "https://b2b.automotivebrands.co.uk/robots.txt",
      "https://b2b.automotivebrands.co.uk/assets/index-abc123.js",
      "https://b2b.automotivebrands.co.uk/company-documents/Certificate-of-Incorporation.pdf",
    ];
    for (const requestUrl of stay) {
      expect(
        migrationRequestDecision({ method: "GET", requestUrl, appUrl: APP }),
        requestUrl,
      ).toBeNull();
    }
  });

  it("does not redirect POST or other write methods", () => {
    expect(
      migrationRequestDecision({
        method: "POST",
        requestUrl: "https://b2b.automotivebrands.co.uk/login",
        appUrl: APP,
      }),
    ).toBeNull();
    expect(
      migrationRequestDecision({
        method: "PUT",
        requestUrl: "https://b2b.automotivebrands.co.uk/portal",
        appUrl: APP,
      }),
    ).toBeNull();
  });

  it("does not redirect the main domain and cannot loop onto itself", () => {
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://automotivebrands.co.uk/",
        appUrl: APP,
      }),
    ).toBeNull();
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://automotivebrands.co.uk/login",
        appUrl: APP,
      }),
    ).toBeNull();
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://automotivebrands.co.uk/portal?tab=orders",
        appUrl: APP,
      }),
    ).toBeNull();
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://b2b.automotivebrands.co.uk/portal",
        appUrl: "https://b2b.automotivebrands.co.uk",
      }),
    ).toBeNull();
  });

  it("stops the temporary redirect when it is turned off for the warehouse", () => {
    for (const b2bLegacyRedirect of ["off", "false", "0", "no"]) {
      expect(
        migrationRequestDecision({
          method: "GET",
          requestUrl: "https://b2b.automotivebrands.co.uk/",
          appUrl: APP,
          b2bLegacyRedirect,
        }),
      ).toBeNull();
      expect(
        migrationRequestDecision({
          method: "GET",
          requestUrl: "https://b2b.automotivebrands.co.uk/login",
          appUrl: APP,
          b2bLegacyRedirect,
        }),
      ).toBeNull();
      expect(
        migrationRequestDecision({
          method: "GET",
          requestUrl: "https://b2b.automotivebrands.co.uk/portal?tab=orders",
          appUrl: APP,
          b2bLegacyRedirect,
        }),
      ).toBeNull();
    }
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://b2b.automotivebrands.co.uk/our-story/?ref=old",
        appUrl: APP,
        b2bLegacyRedirect: "off",
      }),
    ).toEqual({
      status: 301,
      location: "https://b2b.automotivebrands.co.uk/why-automotive-brands?ref=old",
    });
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://www.automotivebrands.co.uk/products",
        appUrl: APP,
        b2bLegacyRedirect: "off",
      }),
    ).toEqual({
      status: 301,
      location: "https://automotivebrands.co.uk/products",
    });
  });

  it("keeps WordPress login gone on the b2b host", () => {
    expect(
      migrationRequestDecision({
        method: "GET",
        requestUrl: "https://b2b.automotivebrands.co.uk/wp-login.php",
        appUrl: APP,
      }),
    ).toEqual({ status: 410 });
  });
});
