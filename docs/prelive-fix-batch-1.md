# Pre-Live Fix Batch 1

Status of BLOCKER / HIGH findings from the Automotive Brands B2B pre-live audit.

| ID | Status | Notes |
| --- | --- | --- |
| PL-001 | FIXED | Removed obsolete public mock route `/quote/$id` (`src/routes/quote.$id.tsx`). Real quote UX remains under authenticated portal/staff quote routes. |
| PL-002 | FIXED | Removed obsolete mock route `/sales/order/$id` (`src/routes/sales.order.$id.tsx`). Legitimate order creation remains portal basket → checkout and accepted Quote → Order. |
| PL-003 | FIXED | Client-supplied `companyId` on CRM opportunity/activity lists and SI follow-up task lists now asserts actor company scope (`assertCrmCompanyAccess` / SI equivalent) before narrowing. Cannot expand past authorised companies. |
| PL-004 | FIXED | Admin Settings Trading / Ordering / Notifications non-persisted controls converted to honest read-only displays. |
| PL-005 | FIXED | CMS `BRAND_LOGO_STRIP` uses database `listPublicBrands` (`catalogueBrands` + logos), not mock `lib/data`. |
| PL-006 | FIXED | `/api/cms-media/$id` serves anonymous bytes only when media is publicly eligible (brand/category/product/team/sales-rep binding or published CMS reference). Authorised CMS/product staff may still preview draft media. |
| PL-007 | RESOLVED / BUSINESS CONFIRMED | Free delivery threshold remains **£100.00 ex VAT** goods subtotal; carriage below threshold **£5.95 ex VAT**. Not changed to £150. |
| PL-008 | FIXED | 504C integration test allocates unique `AB-######` numbers via existence check to avoid shared-DB collisions. |

## Dead mock modules

After PL-001 / PL-002 / PL-005:

- `src/lib/data.ts` — **removed** (display helpers moved to `src/lib/format-money.ts` and `src/lib/stock-label.ts`)
- `src/lib/crm-data.ts` — **removed** (no remaining production runtime imports)

## Intentionally deferred (MEDIUM / LOW)

PL-009, PL-010, PL-011, PL-012, PL-013, PL-014, PL-016, PL-017, PL-018, PL-019, PL-020, PL-021, PL-022, PL-023 — not in this batch.
