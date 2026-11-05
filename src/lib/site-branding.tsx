/**
 * Site chrome branding context — header logo src shared by Logo across
 * public, portal, and staff shells.
 */
import { createContext, useContext, type ReactNode } from "react";
import {
  DEFAULT_SITE_HEADER_LOGO_SRC,
  type PublicSiteBranding,
} from "@/domain/site-branding";

export type SiteBrandingChrome = {
  headerLogoSrc: string;
  isCustom: boolean;
  cacheKey: string | null;
};

const DEFAULT_CHROME: SiteBrandingChrome = {
  headerLogoSrc: DEFAULT_SITE_HEADER_LOGO_SRC,
  isCustom: false,
  cacheKey: null,
};

const SiteBrandingContext = createContext<SiteBrandingChrome>(DEFAULT_CHROME);

export function SiteBrandingProvider({
  branding,
  children,
}: {
  branding?: PublicSiteBranding | SiteBrandingChrome | null;
  children: ReactNode;
}) {
  const value: SiteBrandingChrome = branding
    ? {
        headerLogoSrc: branding.headerLogoSrc || DEFAULT_SITE_HEADER_LOGO_SRC,
        isCustom: Boolean(branding.isCustom),
        cacheKey: branding.cacheKey ?? null,
      }
    : DEFAULT_CHROME;
  return <SiteBrandingContext.Provider value={value}>{children}</SiteBrandingContext.Provider>;
}

export function useSiteBranding(): SiteBrandingChrome {
  return useContext(SiteBrandingContext);
}

export function useSiteHeaderLogoSrc(): string {
  return useContext(SiteBrandingContext).headerLogoSrc || DEFAULT_SITE_HEADER_LOGO_SRC;
}
