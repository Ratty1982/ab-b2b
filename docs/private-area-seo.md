# Private area SEO cleanup

**Date:** 2026-11-10 (Europe/London)  
**Base:** `production/phase-1-auth-rbac`

## robots.txt

`public/robots.txt` already disallows `/admin`, `/crm`, `/sales`, `/portal`, `/purchasing`, `/login`, password/activate flows, and internal API prefixes. Those rules are preserved without duplicates. Public catalogue and marketing paths stay allowed.

## noindex metadata

Authenticated layout routes set TanStack Router `head` robots tags so nested pages inherit them through `HeadContent`:

| Area | Directive |
|------|-----------|
| `/admin`, `/crm`, `/sales`, `/portal`, `/purchasing` | `noindex, nofollow` |
| `/login` | `noindex, follow` |
| `/forgot-password`, `/reset-password`, `/activate`, `/account/security` | `noindex, nofollow` |

Existing page titles and descriptions are preserved.

## Login shortcuts

Production `src/routes/login.tsx` has no “Prototype shortcuts”, demo login buttons, or hardcoded credentials. Repository search found no production UI for those strings. Seed/test emails remain in tests and local seed only.

## Sitemap

This repository currently has **no** `sitemap.xml` / sitemap route. When a sitemap is introduced it must omit authenticated prefixes from `ROBOTS_TXT_DISALLOW_PREFIXES` in `src/domain/private-route-seo.ts`.

## Crawler follow-up

`Disallow` in robots.txt can prevent a crawler from fetching HTML and reading a page’s `noindex` tag. That combination does **not** guarantee deindexing of URLs already listed by Google or Bing. For stale indexed private URLs, use Search Console / Bing Webmaster removal or inspect-URL tools after deploy.
