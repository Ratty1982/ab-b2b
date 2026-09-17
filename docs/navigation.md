# Authenticated navigation

**Authenticated navigation is a stable product contract. Do not reorganise, rename, remove or relocate existing navigation items as part of unrelated feature work.**

## Canonical definition

One tree drives every internal sidebar (Admin, Sales, and CRM layouts):

`src/lib/app-nav.ts` → `BACK_OFFICE_NAV`

Trade customers use a separate tree in the same file:

`TRADE_PORTAL_NAV`

Layouts must not declare their own nav arrays. They call `shellModelFromSession` (`src/lib/nav-permissions.ts`) and pass the result to `AppShell`.

## Adding a feature

1. Add or update **one** item in `BACK_OFFICE_NAV` or `TRADE_PORTAL_NAV`.
2. Set `implemented: true` only when a real route exists.
3. Leave unimplemented IA entries in the tree with `implemented: false` (they stay hidden).
4. Wire permission keys; never rely on the sidebar as a security boundary (routes stay server-guarded).

Do not:

- Duplicate labels/paths in `AppShell`, mobile menus, or page layouts
- Add “Admin / Sales / CRM” cross-links that swap the information architecture
- Bury Website under Settings
- Send every authenticated user to the public homepage from the product logo

## Area home (logo)

| Actor | Logo destination |
| --- | --- |
| SUPER_ADMIN / admin-shell staff | `/admin` |
| Sales (no admin shell) | `/sales` |
| Trade customer | `/portal` |

## Website

Always expose, when permitted:

- Pages → `/admin/content`
- Homepage → `/admin/content/home`
- Media → `/admin/content/media`
