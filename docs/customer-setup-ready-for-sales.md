# Customer Setup — READY FOR SALES

**Repo:** Ratty1982/ab-b2b  
**Date:** 2026-11-10 (Europe/London)  
**Base:** `production/phase-1-auth-rbac`  
**Depends on:** PR #96 sales-history cutover / recovery (merged)

## 1. Root cause of fragmented onboarding

Staff had to leave the customer list into a six-step `CustomerCreationWizard`, then bounce across customer workspace tabs (Commercial, Autopart, Contacts, Addresses) to finish trading readiness. Activation, Autopart verification, and historical cutover were separate actions. Staff order entry only checked `Company.status === ACTIVE`, so a newly verified Active account could receive orders before contacts, addresses, payment terms, or cutover were finished — the SENCO-style gap PR #96 closed for ongoing 504/TRM, but not for a single operational setup surface.

## 2. Backend readiness assessment

`READY_FOR_SALES` is **not** a second `CompanyStatus`. It is a live assessment in `src/domain/customer-sales-readiness.ts`.

Separate concepts:

| Concept | Meaning |
|---------|---------|
| `setupRequirementsComplete` | Live checklist all complete |
| `orderingApproved` | `orderingEnabledAt` stamp from Save & enable ordering |
| `readyForSales` / label `READY_FOR_SALES` | Both complete **and** approved (post-rollout path) |
| `legacyEligible` | Pre-rollout established customer compatibility path |
| `canCreateStaffOrder` | `readyForSales` **or** `legacyEligible` |

Checklist requirements:

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

Staff sales-order entry (`requireOrderableCompany`) calls `assertCompanyReadyForStaffOrders` and rechecks live requirements on start/submit. If requirements later lapse, **new** orders are blocked until corrected; existing orders are unchanged and the approval stamp is retained.

Portal trade checkout still uses Active company checks for existing portal buyers.

## 3. Save semantics

`saveCustomerSetupAndEnableOrdering`:

1. Validates schema, permissions, contact/address ownership, credit limit, and concurrency (`expectedUpdatedAt`) **before** writes.
2. Persists company / contacts / addresses / credit review / optional ordering stamp in **one transaction**.
3. Deduplicates contacts (name+email) and addresses (line1/town/postcode/country) on retry.
4. `enableOrdering: false` → draft mode; response message **Draft saved — ordering not enabled**.
5. `enableOrdering: true` with incomplete checklist → transaction rolls back (no partial commit) and reports that nothing was committed.
6. Autopart verify and historical import remain independent audited operations outside this save.

## 4. Compatibility policy (existing customers)

No production backfill silently changes eligibility.

1. **Pre-enforcement companies** (`createdAt` before `2026-11-10T00:00:00.000Z`) that are Active remain staff-orderable (`LEGACY_ELIGIBLE`) when they have pre-rollout trading evidence (Active established account, pre-rollout orders, completed cutover, or verified Autopart).
2. **Companies created on/after the enforce-from date** never become exempt merely because an order exists. They need checklist completion **and** Save & enable ordering.
3. Completing setup sets `orderingEnabledAt` and keeps re-validating live requirements on later order attempts.
4. `SUSPENDED`, `ON_HOLD`, and `CLOSED` stay blocked.

## 5. Automatic activation on Autopart verify

`linkAndVerifyCompanyAutopartCustomerCode` activates `PROSPECT` / `PENDING_APPROVAL` → `ACTIVE` after unique verification, with audit reason `AUTOPART_VERIFY`. It does **not** override `SUSPENDED`, `ON_HOLD`, or `CLOSED`. Active ≠ READY_FOR_SALES.

## 6. UI

`/admin/customers/setup` renders the single-page `CustomerSetupScreen` (legacy `step` search ignored). Actions:

- **Save draft** — persists fields without approving ordering
- **Save & enable ordering** — transactional save + approval stamp when checklist is complete

Existing customer Edit / workspace tabs remain available. The previous multi-step wizard component is no longer the setup route entry; remove it only after this flow is verified in production.

## 7. Production rollout checklist

- [ ] Deploy migration `20261110120000_customer_ordering_readiness` (additive columns only)
- [ ] Confirm PR #96 cutover/recovery behaviour unchanged
- [ ] Spot-check a legacy Active trading customer can still open staff order entry
- [ ] Spot-check a new post-rollout prospect: verify → Active → incomplete blocks ordering → Save & enable unlocks
- [ ] Spot-check checklist-complete without approval still blocks ordering
- [ ] Train sales on one-screen setup and zero-history vs 561L/SLRB choices
- [ ] Do **not** run a data migration that stamps every Active customer as ready

## 8. Explicit non-goals

- No silent eligibility changes for existing customers
- No new automatic credit holds
- No replacement of Autopart verification / cutover services
- No merge / deploy from this agent
- No production SENCO data changes
