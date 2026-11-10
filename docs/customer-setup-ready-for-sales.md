# Customer Setup — READY FOR SALES

**Repo:** Ratty1982/ab-b2b  
**Date:** 2026-11-10 (Europe/London)  
**Base:** `production/phase-1-auth-rbac`  
**Depends on:** PR #96 sales-history cutover / recovery (merged)

## 1. Root cause of fragmented onboarding

Staff had to leave the customer list into a six-step `CustomerCreationWizard`, then bounce across customer workspace tabs (Commercial, Autopart, Contacts, Addresses) to finish trading readiness. Activation, Autopart verification, and historical cutover were separate actions. Staff order entry only checked `Company.status === ACTIVE`, so a newly verified Active account could receive orders before contacts, addresses, payment terms, or cutover were finished — the SENCO-style gap PR #96 closed for ongoing 504/TRM, but not for a single operational setup surface.

## 2. Backend readiness assessment

`READY_FOR_SALES` is **not** a second `CompanyStatus`. It is a live assessment in `src/domain/customer-sales-readiness.ts`, stamped when Save succeeds:

| Requirement | Source |
|-------------|--------|
| Active status | `Company.status` |
| Autopart uniquely verified | verified code + no ownership conflict |
| Historical cutover COMPLETE | `CustomerSalesCutover` (incl. `NO_HISTORICAL_SALES`) |
| Primary contact | `Contact.isPrimary` |
| Billing + delivery addresses | default billing / delivery flags |
| Payment terms | `Company.paymentTerms` |
| Credit limit reviewed | `creditLimitReviewedAt` (blank/unlimited allowed) |

Optional stamps on `Company`: `orderingEnabledAt`, `orderingEnabledById`, `creditLimitReviewedAt`, `creditLimitReviewedById`.

Staff sales-order entry (`requireOrderableCompany`) calls `assertCompanyReadyForStaffOrders`. Portal trade checkout still uses Active company checks for existing portal buyers.

## 3. Compatibility policy (existing customers)

No production backfill silently changes eligibility.

1. **Pre-enforcement companies** (`createdAt` before `2026-11-10T00:00:00.000Z`) that are Active remain staff-orderable (`LEGACY_ELIGIBLE`) even if the new checklist is incomplete.
2. **Companies with existing orders** remain staff-orderable under the same legacy path.
3. **Companies created on/after the enforce-from date** must pass the live checklist (or complete Save & enable ordering) before staff order entry.
4. Completing setup sets `orderingEnabledAt` and keeps re-validating live requirements on later order attempts.

## 4. Automatic activation on Autopart verify

`linkAndVerifyCompanyAutopartCustomerCode` activates `PROSPECT` / `PENDING_APPROVAL` → `ACTIVE` after unique verification, with audit reason `AUTOPART_VERIFY`. It does **not** override `SUSPENDED`, `ON_HOLD`, or `CLOSED`. Active ≠ READY_FOR_SALES.

## 5. UI

`/admin/customers/setup` renders the single-page `CustomerSetupScreen` (legacy `step` search ignored). Existing customer Edit / workspace tabs remain available. The previous multi-step wizard component is no longer the setup route entry; remove it only after this flow is verified in production.

## 6. Production rollout checklist

- [ ] Deploy migration `20261110120000_customer_ordering_readiness` (additive columns only)
- [ ] Confirm PR #96 cutover/recovery behaviour unchanged
- [ ] Spot-check a legacy Active trading customer can still open staff order entry
- [ ] Spot-check a new post-rollout prospect: verify → Active → incomplete blocks ordering → Save & enable unlocks
- [ ] Train sales on one-screen setup and zero-history vs 561L/SLRB choices
- [ ] Do **not** run a data migration that stamps every Active customer as ready

## 7. Explicit non-goals

- No silent eligibility changes for existing customers
- No new automatic credit holds
- No replacement of Autopart verification / cutover services
- No merge / deploy from this agent
- No production SENCO data changes
