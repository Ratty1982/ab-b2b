import type { ReactNode } from "react";
import { PublicLayout, PublicPageBreadcrumbs } from "@/components/ab/PublicLayout";
import { CmsPageView } from "@/components/cms/CmsSectionRenderer";
import type { CmsSectionTypeKey } from "@/domain/cms";
import type { HomepageJson } from "@/domain/homepage";
import type { ClientSession } from "@/server/auth/session";

export type PublicCmsPageData = {
  slug: string;
  title: string;
  seoTitle: string | null;
  metaDescription: string | null;
  ogImageSrc: string | null;
  sections: Array<{
    id: string;
    type: CmsSectionTypeKey;
    config: { [key: string]: HomepageJson };
  }>;
};

export function PublicCmsPage({
  page,
  breadcrumbs,
  trailing,
  requestSession,
  kinetic = false,
}: {
  page: PublicCmsPageData;
  breadcrumbs?: Array<{ label: string; to?: string | undefined }>;
  /** Optional route chrome below CMS sections (e.g. contact form, catalogue brand cards). */
  trailing?: ReactNode;
  requestSession?: ClientSession;
  kinetic?: boolean;
}) {
  return (
    <PublicLayout kinetic={kinetic} {...(requestSession ? { requestSession } : {})}>
      {breadcrumbs?.length ? <PublicPageBreadcrumbs items={breadcrumbs} /> : null}
      <CmsPageView
        sections={page.sections.map((section) => ({
          id: section.id,
          type: section.type,
          config: section.config as Record<string, unknown>,
        }))}
      />
      {trailing}
    </PublicLayout>
  );
}
