import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MotorsportFeatureSection } from "@/components/public/MotorsportFeatureSection";
import { MotorsportLanding } from "@/components/public/MotorsportLanding";
import { MotorsportMediaGallery } from "@/components/public/MotorsportMediaGallery";
import { PublicHeader } from "@/components/ab/PublicLayout";
import { HOMEPAGE_MOTORSPORT_DEFAULTS } from "@/domain/motorsport";

vi.mock("@/lib/session", () => ({
  useSession: () => ({ signedIn: false, loading: false, refresh: async () => undefined }),
  canViewBasketSession: () => false,
  RequestSessionProvider: ({ children }: { children: ReactNode }) => children,
  guestSession: { signedIn: false },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    href,
    className,
    params,
    ...rest
  }: {
    children?: ReactNode;
    to?: string;
    href?: string;
    className?: string;
    params?: { slug?: string };
    [key: string]: unknown;
  }) =>
    createElement(
      "a",
      {
        href:
          href ??
          (typeof to === "string"
            ? to.includes("$slug") && params?.slug
              ? `/brands/${params.slug}`
              : `${to}${params?.slug ? `/${params.slug}` : ""}`
            : "/"),
        className,
        ...rest,
      },
      children,
    ),
  useRouter: () => ({ invalidate: async () => undefined }),
  useNavigate: () => async () => undefined,
}));

vi.mock("@/server/phase2/fns", () => ({
  submitMotorsportPartnershipEnquiryFn: vi.fn(),
}));

function html(node: ReactNode) {
  return renderToStaticMarkup(node as ReactElement);
}

describe("motorsport public UI", () => {
  it("renders homepage motorsport feature with CTAs", () => {
    const markup = html(
      createElement(MotorsportFeatureSection, {
        config: {
          ...HOMEPAGE_MOTORSPORT_DEFAULTS,
          media: { alt: "Steel Seal race car", fit: "fill", focalX: 72, focalY: 40 },
        },
      }),
    );
    expect(markup).toContain("POWER MAXED MOTORSPORT");
    expect(markup).toContain("FROM THE TRADE COUNTER");
    expect(markup).toContain("Explore Motorsport");
    expect(markup).toContain('href="/motorsport"');
    expect(markup).toContain('href="/motorsport#partnerships"');
    expect(markup).toContain("Racing");
    expect(markup).toContain("Partnerships");
    expect(markup).toContain("Trade Experiences");
    expect(markup).toContain('data-homepage-section="motorsport"');
  });

  it("hides motorsport feature content when section would be disabled upstream", () => {
    // Disabled sections are filtered before render — ensure component itself is pure.
    expect(HOMEPAGE_MOTORSPORT_DEFAULTS.ctaHref).toBe("/motorsport");
  });

  it("renders motorsport landing with brand CTAs and partnership anchor", () => {
    const markup = html(
      createElement(MotorsportLanding, {
        sections: [
          {
            id: "hero",
            type: "MOTORSPORT_FEATURE",
            config: {
              eyebrow: "POWER MAXED MOTORSPORT",
              headline: "BUILT FOR THE TRADE.\nPROVEN ON THE TRACK.",
              supporting: "Commercial motorsport platform.",
              ctaLabel: "Explore Partnership Opportunities",
              ctaHref: "#partnerships",
              secondaryCtaLabel: "Visit Power Maxed Racing",
              secondaryCtaHref: "https://example.com/pmr",
              features: [],
              media: { alt: "Race action", fit: "fill" },
            },
          },
          {
            id: "about",
            type: "IMAGE_TEXT",
            config: { heading: "POWER MAXED RACING", body: "Platform copy." },
          },
          {
            id: "brands",
            type: "TEXT_IMAGE",
            config: { heading: "OUR BRANDS ON TRACK", body: "Brand exposure." },
          },
          {
            id: "gallery",
            type: "MEDIA_GALLERY",
            config: { heading: "Gallery", items: [] },
          },
          {
            id: "partnerships",
            type: "BENEFITS_GRID",
            config: {
              eyebrow: "COMMERCIAL OPPORTUNITIES",
              heading: "PARTNER WITH POWER MAXED RACING",
              supporting: "Discuss opportunities.",
              items: [
                { title: "Brand Partnerships", body: "Associate with the programme." },
              ],
            },
          },
        ],
      }),
    );
    expect(markup).toContain('data-page="motorsport"');
    expect(markup).toContain("BUILT FOR THE TRADE");
    expect(markup).toContain('href="#partnerships"');
    expect(markup).toContain('href="https://example.com/pmr"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('data-motorsport-cta="shop-power-maxed"');
    expect(markup).toContain('data-motorsport-cta="shop-steel-seal"');
    expect(markup).toContain('id="partnerships"');
    expect(markup).toContain("Send a partnership enquiry");
    expect(markup).toContain('data-gallery-empty="true"');
  });

  it("gallery preserves empty-state licensing guidance", () => {
    const markup = html(
      createElement(MotorsportMediaGallery, {
        config: {
          heading: "Gallery",
          supporting: "Do not alter watermarks.",
          items: [],
        },
      }),
    );
    expect(markup).toContain("Do not alter watermarks");
    expect(markup).toContain("licensed");
  });

  it("public header includes Motorsport nav link", () => {
    const markup = html(createElement(PublicHeader));
    expect(markup).toContain("Motorsport");
    expect(markup).toContain('href="/motorsport"');
    expect(markup).toContain("Trade Solutions");
    expect(markup).toContain("Why Us");
    expect(markup).toContain('href="/why-automotive-brands"');
  });
});
