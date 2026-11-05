# Phase 3A — Customer creation / conversion route audit

Base: `production/phase-1-auth-rbac`. Behaviour was audited before Phase 3B–G changes.

## Paths

| Path | Entry | Service | Permissions | Company created? | Status | Autopart | Invite |
|------|-------|---------|-------------|------------------|--------|----------|--------|
| Guided wizard | `/admin/customers/setup` | `saveCustomerCreationDetails` → `createCompany` | `companies.create` / edit | Yes (PROSPECT) | Optional ACTIVE via confirm | Separate verify step | Separate portal step |
| Quick create | Customers index drawer | `createCompany` | `companies.create` | Yes (PROSPECT) | PROSPECT | None | None |
| Public trade app | `/register` | `submitTradeApplication` | Public | No | Application SUBMITTED | Claim only | No |
| Trade approve | `/admin/applications`, `/crm/applications` | `approveTradeApplication` | `applications.approve` | **Always new ACTIVE** | ACTIVE immediately | Only if staff verifies tick | **Yes** (activation email) |
| Trade reject | Same | `rejectTradeApplication` | `applications.approve` | No | Application REJECTED | Unchanged | No |
| 407EXP single | Customer master imports | `createCompanyForAutopartAccount` | mapping.manage + companies.create | PROSPECT + link | PROSPECT | Code set **unverified** | No |
| 407EXP map create | Map drawer | `createCompanyAndMapAutopartAccount` | mapping.manage | PROSPECT | PROSPECT | Mapping **verifies** | No |
| 407EXP bulk | Conversion panel | `autopart-prospect-conversion` | mapping.manage + companies.create | Many PROSPECTs | PROSPECT | Code set **unverified** | No |
| Edit / activate | Customer workspace | `updateCompany` | `companies.edit` | No | Manual ACTIVE | Save ≠ verify | Invite separate |

## Trade approval side effects (must disclose)

`approveTradeApplication` (`src/server/applications/service.ts`):

1. Creates a **new** `Company` with `status: ACTIVE` (does not merge CRM prospects).
2. Creates primary contact + trading address from the application.
3. Creates/links trade user + `UserInvitation` and attempts activation email.
4. Idempotent when already `APPROVED` with `companyId` (heals PROSPECT→ACTIVE; no second company).
5. Autopart code is written **only** when `confirmAutopartAccountVerified` + verified code are supplied.

## Duplicate risks

- Trade approval vs existing wizard/407EXP prospects: **high** (always creates).
- Application-level `possibleDuplicates` only compares other applications, not Companies.
- Phase 3 adds Company-level match surfacing before approve; does not silently merge.

## Wizard handoff gaps (addressed in Phase 3)

- No post-approve navigation to `/admin/customers/setup?companyId=`.
- No “Continue customer setup” after 407EXP create/bulk.
- No reliable source badge on wizard for trade / Autopart provenance.
