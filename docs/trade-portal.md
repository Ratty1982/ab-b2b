# Trade Portal

Customer-facing B2B portal for authenticated trade companies.

## Company scoping

Every portal data loader resolves Company **server-side**:

authenticated User → active `CompanyUser` membership → Company

Client-supplied `companyId` is never authoritative. Orders, basket, and dashboard queries are always filtered by that membership company (IDOR-safe).

## Dashboard (`/portal`)

Loader: `getPortalDashboard` in `src/server/portal/dashboard.ts`.

| Widget | Source | Notes |
| --- | --- | --- |
| Welcome / company name | `Company.name` | Live |
| Account status | `Company.status` | Live |
| Payment terms | `Company.paymentTerms` | Live; shows “Not set” when null |
| Autopart account code | `Company.autopartCustomerCode` **only if verified** | Claimed application codes never shown |
| Credit limit | `Company.creditLimit` when set | No invented default; available credit / outstanding balance **hidden** (no accounting integration) |
| Basket | Phase 6A `getBasketSummary` | Live OPEN company basket |
| Open / recent orders | `Order` model (non-DRAFT) | Historical snapshots; empty states when none |
| Account manager | Primary `CompanyAssignment` → `SalesRep` → User | No hard-coded fallback person |
| Quotes / invoices / credit notes | — | **Removed** from dashboard until production-backed |

## Live portal navigation

- Dashboard
- Shop (`/products`)
- Basket
- Orders
- Support

## Intentionally hidden (prototype / future)

Sidebar items marked `implemented: false` (routes may still show a Coming Soon shell if opened directly):

- Quick Order (mock SKU path retired)
- Quotes
- Invoices & Statements
- Favourites / Order Lists
- Downloads
- Company & Users

## Empty-state UX

A new activated account correctly shows **zero** orders and an empty basket, with CTAs to Shop / Basket — not fabricated financial or order rows.

## Related

- Ordering: `docs/phase-6b-checkout-orders.md`
- Onboarding: `docs/trade-onboarding.md`
- Email: `docs/transactional-email.md`
