# Power Maxed Motorsport & commercial partnerships

Public motorsport presence for Automotive Brands — homepage feature, `/motorsport`
landing page, and partnership lead capture. The site remains a B2B ecommerce
platform; motorsport strengthens brand and commercial proposition.

## Architecture

| Surface | Implementation |
| --- | --- |
| Homepage band | CMS section type `MOTORSPORT_FEATURE` on canonical homepage (`PublicHomepage`) |
| Landing page | `/motorsport` — CMS page slug `motorsport` + `MotorsportLanding` |
| Gallery | CMS section type `MEDIA_GALLERY` |
| Partnership form | Client form → `submitMotorsportPartnershipEnquiryFn` → `Lead` |
| Media | Existing CMS Media / R2 pipeline (`CmsMedia`, `/api/cms-media/:id`) |

Do **not** create a second homepage renderer. Motorsport uses Website Builder V2
like other marketing sections.

## Homepage section (`MOTORSPORT_FEATURE`)

Position: after benefits / catalogue blocks, **before** Trade CTA.

CMS fields (Website Builder → Homepage):

- enabled / disabled
- eyebrow, headline, supporting
- background `media` (mediaId, alt, fit, focalX, focalY)
- primary CTA label / URL (default Explore Motorsport → `/motorsport`)
- secondary CTA label / URL (default Partner with the Team → `/motorsport#partnerships`)
- three compact feature items (Racing / Partnerships / Trade Experiences)

Visual: full-bleed photography, left navy gradient, HTML text (not baked into the image).

## `/motorsport` page

CMS seed: `domain/cms-marketing-pages.ts` slug `motorsport`.

Sections:

1. `MOTORSPORT_FEATURE` — photographic hero
2. `IMAGE_TEXT` — Power Maxed Racing about
3. `TEXT_IMAGE` — Our brands on track + Shop Power Maxed / Steel Seal
4. `MEDIA_GALLERY` — responsive gallery
5. `BENEFITS_GRID` — partnership opportunity categories + enquiry form (`#partnerships`)

SEO (CMS page meta, overridable):

- Title: Power Maxed Motorsport & Partnerships | Automotive Brands
- Description: Discover Automotive Brands' involvement with Power Maxed Racing…

External “Visit Power Maxed Racing” URL is CMS `secondaryCtaHref` on the hero.
Leave blank until the official URL is confirmed — the CTA is omitted when empty.
Opens with `rel="noopener noreferrer"` when external.

## Media / image replacement

1. Admin → Content → Media — upload licensed JPEG/WebP (usage CMS_GENERAL).
2. Homepage: edit `MOTORSPORT_FEATURE` → pick background image + focal point.
3. Motorsport page: attach gallery items via Media gallery section settings.
4. Publish the page / homepage draft.

**Licensing warning:** Some preview files may include MEDIA ACTION PHOTOGRAPHY
watermarks. Do **not** crop, blur, paint over, or AI-remove watermarks. Replace
with licensed clean originals in Media before public launch. Production imagery
must be appropriately licensed/approved.

Focal points (`focalX` / `focalY`) keep the car / branding visible on mobile.

## Partnership enquiry → CRM

**Decision:** store as existing `Lead` (no new table, no CRM expansion).

| Field | Value |
| --- | --- |
| `source` | `MOTORSPORT_PARTNERSHIP` |
| `companyName`, `contactName`, `email`, `phone` | Form fields |
| `notes` | Interest, budget, industry, message |
| `status` | `NEW` |
| Opportunity | **Not** created |
| Owner | **Not** assigned |

Audit: `motorsport.partnership_enquiry`.

Security: Zod validation, honeypot `websiteConfirm`, 10-minute duplicate guard
(same company+email), CSRF via server fn middleware. Public users cannot list
leads (CRM Leads UI remains unimplemented).

Future CRM expansion (out of scope): Lead admin UI, opportunity conversion,
verified audience/hospitality packages.

## Navigation

Public header / footer: **Motorsport** → `/motorsport`. Admin and portal nav
unchanged.

## Performance & a11y

- Lazy-load below-fold gallery images; homepage band uses `loading="lazy"` when
  not the page hero
- CMS media served via existing `/api/cms-media` pipeline
- Semantic headings, labelled form fields, focus styles, `prefers-reduced-motion`
  respected by avoiding autoplay/video
- Contrast: white/cyan copy on dark navy gradient over photography

## Related code

- `src/domain/motorsport.ts` — copy defaults, enquiry schema, lead source
- `src/server/motorsport/service.ts` — Lead create
- `src/components/public/MotorsportFeatureSection.tsx`
- `src/components/public/MotorsportLanding.tsx`
- `src/routes/motorsport.tsx`
- `docs/phase-6a-ordering-basket.md` — ordering unchanged by this work
