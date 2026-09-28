# Sales Team (Operations)

## Purpose

**Operations → Sales Team** (`/crm/manager`) manages real `SalesRep` records: customer-facing contact profiles and company assignments.

It is **not** a sales analytics dashboard. The prototype “Sales Manager Dashboard” (fake MTD/YTD, targets, pipeline, conversion, and hard-coded representatives) has been removed from this route.

## User vs SalesRep

| Concern | Owned by |
| --- | --- |
| Login, password, sessions, system role, user status | **User** (Operations → Users) |
| Sales assignments, job title, business email/phone/mobile, profile photo, customer-contact visibility | **SalesRep** |

Every production `SalesRep` is linked to an internal `User` via `SalesRep.userId` (required unique FK). Matching by name or email string is not used.

Creating a SalesRep **links an existing staff user**. It does not invent login credentials.

## Customer-facing profile

Fields on `SalesRep`:

- `displayName` (falls back to User name)
- `jobTitle` (default display “Account Manager”)
- `businessEmail` (falls back to User email when blank)
- `phone` / `mobile` (strings — leading zeroes preserved)
- `photoMediaId` (+ alt / focal) via existing CmsMedia / R2
- `customerContactEnabled`
- `active`

When `customerContactEnabled` is false, the portal/quotes resolver still may show name/title/photo but **must not** expose email/phone/mobile; CTAs fall back to the configured trade-team contact.

## Company assignments

Assignments use the existing `CompanyAssignment` model (`companyId`, `salesRepId`, `isPrimary`).

Authorised staff can assign, reassign (moves primary ownership), or unassign companies from a SalesRep. Duplicate assignment rows are not created.

Customer counts on the Sales Team list are calculated from real assignments to **ACTIVE** companies.

## Portal integration

Trade Portal **Your account manager**:

`Company → primary CompanyAssignment → SalesRep → customer-safe fields`

Same resolver as Quotes “Prepared by” and Request a Callback routing (`resolveAccountManagerForCompany` / `resolveSalesRepAssignmentRoute`).

## Meet the Team

Optional `TeamMember.salesRepId` may enrich public website profiles. Public `isPublic` / `isContactable` flags stay **separate** from account-manager visibility for assigned trade customers.

## RBAC

| Action | Permission |
| --- | --- |
| View Sales Team list/detail | `sales.view_team_accounts`, `sales.view_all_accounts`, `reports.management`, `users.manage`, or `admin.access` |
| Create / edit SalesRep, manage assignments, toggle contact visibility | `users.manage` (server-side) |

Trade customers cannot access this admin surface. Being a SalesRep does not by itself grant management rights.

## Audit

Meaningful changes are audited, including:

- `sales_rep.created`
- `sales_rep.profile_updated` (title, email, phone, mobile, photo, contact visibility, active)
- `sales_rep.company_assigned` / `company_reassigned` / `company_unassigned`

Actor and timestamp are recorded. Authentication secrets are never logged.

## Why prototype analytics were removed

The former dashboard used hard-coded demo people and fabricated figures (`src/lib/crm-data.ts` `salesTeam` / `managerTotals`). Those numbers were not backed by Orders, Quotes, or agreed target definitions.

## Future analytics boundary

A real Sales Manager Dashboard may later use authoritative:

- Orders
- Quotes
- Opportunities (when production CRM data exists)
- Companies / assignments
- Explicitly configured targets

Until those definitions and data exist, unfinished metrics must stay **hidden** — never show £0 placeholders or invented values. Operational facts already backed by the DB (assigned customers, open callback tasks, open quotes) may appear on the SalesRep workspace.
