/**
 * Meet the Team — public roster + Why Us teaser
 *
 * Public profiles are **not** User or SalesRep records. Staff enter approved
 * marketing content in Website → Team. Authentication users and CRM sales reps
 * remain separate.
 */

# Routes

| Surface | Path |
| --- | --- |
| Public page | `/meet-the-team` |
| Why Us teaser | `/why-automotive-brands` (featured members) |
| Footer | Company → Meet the Team |
| Admin | `/admin/content/team` (Website → Team) |

Primary nav is unchanged (Products, Brands, Trade Solutions, Motorsport, Why Us).

---

# Data model

## `TeamDepartment`

| Field | Notes |
| --- | --- |
| `name`, `slug` | Editable labels — not hard-coded in render |
| `description` | Optional; omitted when empty |
| `sortOrder` | Public section order |
| `isPublic` | Hidden departments (and their members) stay off public pages |

Default seed departments (idempotent bootstrap only — no people):

1. Leadership  
2. Trade Sales & Accounts  
3. Marketing & Administration  
4. Operations & Production  

Names and order can be changed in admin without code.

## `TeamMember`

| Field | Notes |
| --- | --- |
| `firstName`, `lastName` | Required |
| `jobTitle`, `bio` | Optional; bio is short (≤ ~3 sentences) |
| `email`, `phone`, `linkedInUrl` | **Public contact only** — never auto-copied from User |
| `isPublic` | Defaults **false** until staff publish |
| `isFeatured` | Why Us teaser (max 4) |
| `isContactable` | When false, contact fields are omitted from public HTML |
| `departmentId` | Optional FK |
| `photoMediaId` + focal X/Y + alt | CmsMedia / R2 via existing media library |
| `salesRepId` | Optional unique link to CRM `SalesRep` |
| `sortOrder` | Within department |

Public order: department `sortOrder` → member `sortOrder` → name.

Empty public departments (no public members) are not rendered.

---

# Privacy

- Do not expose User emails, phones, roles, permissions, or auth ids.
- Contact actions (`mailto` / `tel` / LinkedIn) only when `isContactable` **and** the field is set.
- LinkedIn opens with `target="_blank"` `rel="noopener noreferrer"`.

---

# Media

- Use Website → Media / MediaPicker (same CmsMedia pipeline).
- Portrait ratio ~4:5, `object-fit: cover`, focal point supported.
- Missing photo → dark navy placeholder with AB mark + initials (never AI faces).
- Below-fold portraits lazy-load.

---

# SalesRep relationship & Account Manager

Optional `TeamMember.salesRepId` prepares:

`Company` → `CompanyAssignment` → `SalesRep` → optional public `TeamMember`

Helper: `getPublicTeamMemberForSalesRep(salesRepId)` in `src/server/team/service.ts`.

If no public profile exists, existing portal Account Manager UI continues unchanged — this task does not redesign the portal.

Do **not** merge TeamMember and SalesRep.

---

# Admin workflow

1. Confirm current staff (do not trust old website blindly).  
2. Website → Team → Add member.  
3. Attach approved photo from media library.  
4. Enter public contact only if approved.  
5. Set Public when ready; Featured for Why Us.  
6. Optionally link SalesRep for future AM presentation.
7. Delete unused departments from the Departments table (or Edit → Delete). Members are unassigned, not deleted.

RBAC: `cms.page.read` (list) / `cms.page.edit` (write). Marketing + Super Admin by default.

Audit actions: `team.member_created|updated|published|hidden|deleted`, `team.department_created|updated|deleted`, SalesRep link changes in metadata.

Default departments are seeded only when the table is empty. Deleting a seed department does not recreate it.

---

# Migration from automotivebrands.co.uk

The legacy Meet the Team page is a **reference only**.

- Do not scrape or iframe the old site.
- Do not seed people automatically.
- Enter verified people via admin; keep `isPublic` false until confirmed.

---

# Files

- Domain: `src/domain/team.ts`
- Service: `src/server/team/service.ts`
- Public UI: `src/routes/meet-the-team.tsx`, `src/components/team/TeamMemberCard.tsx`
- Admin: `src/routes/admin.content.team.tsx`
- Migration: `prisma/migrations/20260924130000_meet_the_team`
