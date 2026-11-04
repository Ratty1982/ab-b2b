# Customer onboarding redesign

Audit and design only. This does not change customer creation, imports, emails, invitations, or the database. It was written against `production/phase-1-auth-rbac` at `2a5fc2d` on 4 November 2026 (Europe/London).

Related records that stay in force: `docs/trade-onboarding.md`, `docs/autopart-customer-master.md`, `docs/autopart-customer-history.md`, `docs/autopart-ongoing-sales-feeds.md`, `docs/autopart-order-export.md`.

Pull request #79 (not merged) moves “Establish New Sales Baseline” out of a collapsed control. This design uses that same cutover. It does not add a third history workflow.

## 1. Current customer creation workflow

There is no single onboarding. A company row can be born in four places, then finished on other screens.

### Manual creation

Admin → Customers → Create customer (`/admin/customers`).

The drawer asks for legal name, trading name, email, phone, and a salesperson. It always saves `Company.status = PROSPECT` and leaves the price list empty, which means Default Trade Price. It does not ask for an Autopart account, an address, a contact, a portal user, or sales history.

The service `createCompany` can also store company number, VAT, account number, tax status, website, notes, payment terms, price list, and `externalRef`. The drawer does not send those fields. Staff add them later on the customer workspace.

Permission: `companies.create`.

### Trade application

Public `/register` writes a `TradeApplication`. The claimed Autopart number is stored only as `claimedAutopartCustomerCode`. It is not a verified account.

Staff review at `/admin/applications` (and the CRM applications screen). Approval (`approveTradeApplication`) creates, in one transaction:

- an `ACTIVE` company
- a primary purchasing contact
- a registered address that is also the default billing and delivery address, when the application has a usable trading address
- a primary salesperson, if staff chose one
- an invited `TRADE_ADMIN` user and a portal invitation
- an optional verified Autopart code, only when staff tick verification and type the code

Approval does not import sales history, assign a customer group, or create customer-specific prices. Payment terms and price list are optional fields on the approval form.

A second approval of the same application does not create a second company.

### Prospect from the 407EXP master

Admin → Integrations → Autopart imports, or a one-account action `createCompanyForAutopartAccount`.

Bulk conversion (`executeAutopartProspectConversion`) turns unlinked `TRADE_CANDIDATE` master rows into `PROSPECT` companies. It copies the 407EXP name and account code onto `Company.autopartCustomerCode`, links `AutopartAccount.companyId`, and may assign a salesperson when the 407EXP rep code matches exactly one active `SalesRep.code`. It sets `portalEligible` and historical access off. It does not set `autopartCustomerCodeVerifiedAt`, so the code is present but not verified. It does not create a portal user or import sales.

“Create prospect” for one master account does the same for a single row.

### Linking an existing company to 407EXP

Staff can link a master account to a company that already exists, and can set that code as the company’s Autopart code. That write is not the same as verification. Verification is a separate action on the commercial tab (`linkAndVerifyCompanyAutopartCustomerCode`), which records who verified it and when, and refuses a code held by another company.

### After the company exists

The admin customer page (`/admin/customers/$id`) is eleven tabs: Overview, Contacts, Users, Addresses, Commercial, Autopart, Activity, Documents, Orders, Quotes, Invoices.

Sales staff have a shorter page (`/sales/customers/$id`): Overview, CRM, Contacts, Addresses, Commercial, Activity. It does not host Sales Setup, portal invites, or customer-group editing.

Sales Setup lives only on the admin Autopart tab (`CustomerAutopartWorkspace`). Its four stages are:

1. Verify the Autopart account
2. Establish historical sales
3. Resolve import exceptions
4. View Sales Enquiry

Ongoing 504 and TRM21QC storage waits until the history stage is `COMPLETE`. A verified Active customer with no cutover stays on “Action required” and the primary button says “Import sales history”.

### Portal users

`inviteCompanyUser` runs only for an `ACTIVE` company. It creates or reuses a trade user, a `CompanyUser` in `INVITED`, and a hashed invitation. Prospects cannot be invited. Roles are `TRADE_ADMIN`, `TRADE_BUYER`, `TRADE_ACCOUNTS`, and `TRADE_READ_ONLY`. These are company roles, not staff system roles.

### Orders on behalf of the customer

Internal staff with `orders.place_for_customer` place orders for any Active customer (`src/server/orders/sales-order-entry.ts`). That does not create the customer and does not use the customer’s login. Collection versus delivery is chosen on the order, not stored as a customer preference.

## 2. Problems and UX issues

- Creation ends on a prospect with no next step. The success path opens a tabbed record and leaves Autopart, pricing, history, and portal access for the operator to discover.
- The same commercial facts are edited in different places. Price list and payment terms are on Commercial. Autopart verification is on Commercial and again inside Sales Setup. Customer group is on Commercial. History is on Autopart. Portal users are on Users.
- Sales and admin see different customer pages. A salesperson who created the account cannot finish Sales Setup from `/sales/customers/$id`.
- “Historical sales” is used for three different things. The customer list filter named `historicalSales` actually filters ongoing 504/TRM21QC documents, and the label says “Ongoing sales”. Sales Setup “Historical sales” is the cutover. Sales Enquiry splits historical and ongoing figures again.
- A new verified account with no purchases still shows “Import sales history”. The zero-history and discarded-baseline actions sit inside a collapsed “Other ways to record history” control under the file upload. An empty file cannot complete the stage, but the screen looks as if a file is required.
- 407EXP linking writes `autopartCustomerCode` without `autopartCustomerCodeVerifiedAt`. The summary can show a code while Sales Setup still says the account is not verified.
- A 407EXP master link and a verified sales account are different relations. One company can have a master row, a verified code, and extra aliases. The directory “Autopart linked” filter treats a master row and a code as the same idea.
- Applicant claims, verified codes, aliases, order snapshots, and 407EXP account codes are easy to treat as one identifier. They are not.
- Manual create cannot capture an address or a contact, while trade approval creates both. The two paths produce different record quality.
- `paymentTerms` is free text. There is no credit limit on the company. Tests assert the portal and orders do not expose `creditLimit`. Staff can still expect a credit step that the product does not have.
- Collection is an order choice. There is no customer-level “collects” flag, so onboarding should not ask for one.
- Company status is doing too much work. `PROSPECT`, `PENDING_APPROVAL`, `ACTIVE`, `ON_HOLD`, `SUSPENDED`, and `CLOSED` do not say whether Autopart is verified, history is decided, a price list is assigned, or a portal user exists.
- There is no saved draft of onboarding. Closing the browser loses nothing that was saved, but nothing guides the operator back to the unfinished part except the Autopart stage list, and only after the company is Active and the account is verified.
- Trade approval jumps straight to Active and sends an invitation before history or pricing are decided. That is correct for portal access, and it is a poor moment to imply the sales record is finished.
- Inviting a portal user does not check that the email belongs to a trade user. Approving a trade application does. The two paths can attach different kinds of people.
- The customer page is a horizontal tab strip of eleven items. On a narrow screen the operator scrolls tabs before they can see what to do next. Sales Setup’s four stages sit in a four-column grid that stacks only at smaller widths, under a long import form.

## 3. Database and service dependencies

Automotive Brands owns the company. Autopart owns the imported account list and the sales files. The join is explicit and staff-confirmed.

| Identifier | Where it lives | What it is for |
| --- | --- | --- |
| `Company.id` | AB | Permanent customer id. Do not replace it. |
| `Company.accountNumber` | AB, optional, unique | Internal account number. Not the Autopart code. |
| `Company.externalRef` | AB, optional, unique | Legacy non-Autopart reference. |
| `Company.autopartCustomerCode` | AB copy of an Autopart code | Sales-account code used for 504, TRM21QC, history matching, and the order export snapshot. |
| `autopartCustomerCodeVerifiedAt` / `VerifiedById` | AB | Staff verification. A code without these is not verified. |
| `AutopartAccount.accountCode` | 407EXP import | Master customer-list row. Link is `AutopartAccount.companyId`. |
| `AutopartCustomerAccountAlias.alias` | AB, staff-verified | Extra codes whose history and ongoing rows belong to this company. |
| `Order.autopartCustomerCodeSnapshot` | Copied onto the order | Export code at order time. Later edits to the company code do not rewrite old orders. |
| `TradeApplication.claimedAutopartCustomerCode` | Applicant | Evidence only. Never a login and never a verified link. |
| `User.email` | AB | Portal and staff login. Not an Autopart id. |
| `SalesRep.code` | AB | Used to match a 407EXP rep code during prospect conversion. |

Fields that come from Autopart, and stay imports:

- 407EXP: account code, original name, area, rep, classification.
- 561L: historical product lines.
- SLRB: historical documents and payments.
- 504 and TRM21QC: ongoing invoices, credits, and product lines.
- 407P100 credit position is not imported. Do not design a credit balance into onboarding.

Fields Automotive Brands manages:

- Legal and trading name, company number, VAT, phone, email, website, notes.
- Status, tax status, payment terms (free text), price list, customer-specific prices, customer group.
- Contacts, addresses, salesperson assignment.
- Portal users, company roles, invitations.
- Verified sales account, aliases, and the sales-history decision (`CustomerSalesCutover`).

`CustomerSalesCutover.historyStatus` is `NOT_STARTED`, `REVIEW`, or `COMPLETE`. The evidence `kind` distinguishes:

- `NO_HISTORICAL_SALES` — no historical purchases. Label: “No historical purchases”.
- `PRELAUNCH_HISTORY_DISCARDED` — discarded pre-launch history. Label: “New sales baseline”. This is not a claim that the customer never bought.
- `561L_SLRB` — a real history file was published. Label: “History imported”.

Services to keep:

- `createCompany`, `updateCompany` in `src/server/companies/service.ts`
- `approveTradeApplication` in `src/server/applications/service.ts`
- `createCompanyForAutopartAccount`, master link, and `executeAutopartProspectConversion`
- `linkAndVerifyCompanyAutopartCustomerCode` and alias verification
- `completeCustomerSalesCutoverWithoutHistory` and `startCustomerSalesHistoryBaseline` in `src/server/companies/customer-sales-history-import.ts`
- History preview and publish jobs, and the 504/TRM21QC importers
- `inviteCompanyUser` and company-role checks
- Pricing resolution and customer groups
- Sales order entry and `autopartCustomerCodeSnapshot`

No new table is required for the first delivery of onboarding. Progress can be derived from the rows above. A later onboarding-draft table is optional and only worth adding if staff need to save a wizard that has not created the company yet.

## 4. Proposed onboarding workflow

One guided flow, opened from Admin → Customers and from a trade application approval. Sales staff who can create companies get the same flow for the steps they are allowed to edit. Steps they cannot change are visible and read-only.

The company is created at step 1 and remains a prospect until activation. Each later step can be skipped when the information is not known. Skipping stores nothing and leaves that step unfinished. It does not invent an Autopart code, a price, or a zero-history decision.

### 1. Customer details

Legal name is required. Trading name, phone, email, company number, VAT, and notes are optional. Optional primary contact. Optional trading address, which can also be marked as the billing and delivery address. Optional salesperson.

This replaces the short create drawer. Trade approval pre-fills this step from the application and does not ask the applicant’s questions again.

### 2. Autopart account linking

Three choices, one of which may be “not yet”:

- Search the 407EXP master and link this company.
- Type a sales account and verify it, when the code is unambiguous.
- Leave unlinked.

Show the master row and the verified sales code separately. If they differ, say so. Applicant claims appear as evidence, with a control to accept that code only after the uniqueness check. Aliases are an advanced action, not part of the first pass.

### 3. Pricing and trading terms

Price list, or an explicit “Default Trade Price”. Payment terms as the existing free-text field. Customer group, optional. Customer-specific prices stay on the existing price import screen, linked from here, not rebuilt.

Do not add a credit limit. Say that Autopart credit position is not held in Automotive Brands.

### 4. Sales history

Shown when a sales account is verified. Otherwise the step explains that it waits for verification.

Options, using the current services:

- Import historical sales (561L and optional SLRB).
- Confirm no historical purchases.
- Establish new sales baseline, meaning the discarded pre-launch record, only when that is actually what happened.

Details are in section 6.

### 5. Portal users and permissions

Available once the company is, or is about to become, Active. Invite the first user with one of the four company roles. Trade approval can land here with the applicant already invited. Do not send a second email if an invitation is already pending.

Prospects still cannot receive a login.

### 6. Review and activation

A single summary of what is set and what was skipped. Activation sets `ACTIVE` only when staff confirm it. Required to activate:

- legal name
- a decision that the account may trade

Not required to activate:

- Autopart link
- history decision
- price list other than the default
- a portal user

After activation, unfinished items remain on the customer overview as next actions. Ongoing sales import still waits for a completed history decision, as it does today. Activation must not silently mark history complete.

A prospect who is not approved to trade stops at the review step and stays `PROSPECT`. A trade application that is approved can activate and invite in the same confirmation the approval screen uses today, then return the operator to the unfinished history and pricing actions.

## 5. Proposed customer overview

Replace the eleven-tab first view with one overview. The existing tabs remain available as sections, so orders, quotes, invoices, documents, and activity are not rebuilt.

On a wide screen, two columns. On a narrow screen, one column in this order:

1. Identity. Name, status, account number, salesperson, primary contact.
2. Next actions. The first unfinished item only, plus a short list. Examples: “Verify WORSBRO”, “Confirm no historical purchases”, “Invite a portal user”.
3. Onboarding progress. The six steps, each complete, skipped, or not started. This is derived, not a new status enum.
4. Autopart. Master link, verified sales account, aliases, and whether ownership is ambiguous.
5. Trading. Price list or Default Trade Price, payment terms, customer group, tax status. A line that credit balance is not stored here.
6. Sales history. The cutover label, whether exceptions are open, and links to import, Sales Enquiry, and recent 504/TRM activity.
7. Portal. Users, roles, pending invitations. No token is shown.
8. Addresses. Default billing and delivery, or “not set”.
9. Commercial activity. Open orders, quotes, and a link to Sales Enquiry. Counts only. Full lists stay on the existing screens.

The Autopart tab’s Sales Setup stages stay, and they must show the same history state as the overview. Do not maintain two different progress calculations.

## 6. New-customer zero-history handling

WORSBRO MOTOR SPARES LTD is the case this step must make obvious: the company exists, WORSBRO is the verified sales account, the 407EXP master may be unlinked, and the historical export has no rows for that account.

Rules:

- Do not require a spreadsheet.
- Do not treat an empty or non-matching file as proof. Preview of a file with nothing for the verified account cannot be committed, and it must not write `NO_HISTORICAL_SALES`.
- Do not create invoices, credits, payments, or product lines.
- Do not delete or overwrite `AutopartSalesDocument` or `AutopartSalesLine`. Production already refuses zero history when a sales document exists for the company. The redesign must also refuse when a sales line exists without a document, which is the check added in pull request #79. Send the operator to import or exception review.
- Confirm the company name and make the operator type the verified sales account. A different code does not save.
- Record the administrator, timestamp, reason, company name, and verified account on `CustomerSalesCutover` and on the audit event `autopart.customer_sales_cutover_completed`.
- Set `historyStatus` to `COMPLETE` with evidence kind `NO_HISTORICAL_SALES`. The Sales Setup label is “No historical purchases”, and all four setup stages are complete.
- After that, 504 and TRM21QC imports behave as they do for any other completed cutover.
- A later real 561L/SLRB file may replace this decision with kind `561L_SLRB`. That is how missing history is reconciled. Rejected rows still go to review. They are not called zero history.

“Establish new sales baseline” in the product language of the current screen is the other kind, `PRELAUNCH_HISTORY_DISCARDED`. Keep that action for the pre-launch discard only. Label it so it cannot be mistaken for a new customer who never bought. Pull request #79 is the place that wording is being corrected. Fold that change into this step. Do not add another cutover kind.

## 7. Existing features to reuse

- Company, contact, address, and salesperson assignment services.
- Trade application submit, review, and idempotent approval.
- 407EXP import, prospect conversion, and single-account prospect create.
- Sales-account verification and alias verification.
- Price lists, Default Trade Price, customer prices, and customer groups.
- History upload, preview, publish, exception acknowledgement, zero-history cutover, and discarded baseline.
- Ongoing 504/TRM21QC importers and their cutover gate.
- Sales Enquiry and the unified sales figures already on the sales customer page.
- Portal invitation and the four company roles.
- Order entry on behalf of a customer, including collection on the order.
- Audit events already written by those services.

Do not rebuild these behind a new onboarding API that writes the same tables a second way.

## 8. Required backend changes

When implementation starts, keep the changes small.

- Add a read model, `getCustomerOnboarding`, that derives the six steps from company, verification, cutover, price list, and invitations. No migration.
- Teach `createCompany` to accept an optional contact and address in the same transaction the trade approval already uses. Still allow both to be absent.
- Return the derived next action from the company workspace so admin and sales pages share it.
- Extend zero-history confirmation so the reason and typed account are required and stored. That is the PR #79 behaviour. Do not invent a new cutover kind.
- Leave 504/TRM21QC gating on `historyStatus = COMPLETE`.
- Do not add `creditLimit`. Do not copy 407P100.
- Do not change `Company.id`, order snapshots, or invitation token hashes.
- A draft table is out of scope until staff need a wizard before the company row exists. Trade applications already hold that draft for the public path.

## 9. Required frontend changes

- Replace the create drawer with the six-step flow. Step 1 creates the prospect and continues.
- Put the same progress and next action on `/admin/customers/$id` and `/sales/customers/$id`.
- Move “Confirm no historical purchases” and the discarded-baseline action above the file upload, outside a collapsed region. Point the primary button at the real missing decision, not always at “Import sales history”.
- On the overview, stack sections in one column under 768px. Keep tap targets at least 44px. Do not hide the next action inside a tab.
- Keep orders, quotes, invoices, documents, CRM, and the history file preview as they are. Link to them.
- Approval of a trade application opens the review step with the application fields filled, instead of dropping the operator on a blank commercial tab.

## 10. Security and data-integrity risks

- Verifying the wrong Autopart code would attach another customer’s 504, TRM21QC, and history. The uniqueness check and the typed-account confirmation exist to prevent that. Do not weaken them in the wizard.
- Marking zero history while sales rows exist would hide real purchases from the “not started” state. The cutover must keep refusing when documents or lines exist.
- Activating a company is not the same as completing history. If activation also completed the cutover, ongoing files could import with no staff decision.
- Prospect conversion writes a code that is not verified. The new flow must not display that as a verified sales account.
- Invitations contain a secret token. The overview shows status only.
- Trade approval refuses an applicant email that belongs to an internal user. `inviteCompanyUser` does not. It will attach that user to the company. The portal step must use the same refusal before it creates an invitation.
- Portal role changes and company status changes already revoke or block access in the current services. The wizard must call those services, not update `CompanyUser` on its own.
- Price list changes affect live trade prices. The review step should show the list name before activation, and the existing audit on company update should still run.
- No migration in the first implementation. If a later migration adds an onboarding table, it must be additive, nullable, and reversible by dropping that table without touching companies, mappings, sales lines, prices, applications, orders, users, or audit rows.

## 11. Recommended implementation phases

1. Sales history clarity. Ship the PR #79 baseline action, including the audit fields, before the wider wizard. This removes the blank-spreadsheet confusion for customers such as WORSBRO.
2. Read-only onboarding summary on the admin and sales customer pages, derived from existing rows. No writes.
3. Guided create that reuses `createCompany`, then deep-links into the existing verify, price, history, and invite screens.
4. Fold trade approval into the same review step, still calling `approveTradeApplication`.
5. Only if staff still lose unfinished work, add an optional draft record. Review that migration on its own.

Each phase is usable without the later ones.

## 12. Test and rollout strategy

Tests before any phase is released:

- Manual create still makes one prospect and does not send email.
- Trade approval still creates one company, is idempotent, and does not verify an Autopart code unless staff confirm it.
- Prospect conversion still creates a prospect, links the master row, and does not set verifiedAt or send email.
- A verified account with no sales can record `NO_HISTORICAL_SALES` without a file. An empty file does not. A wrong typed account does not. Existing sales rows stay. A later TRM21QC row imports. A later 561L file replaces the evidence kind and keeps the ongoing row.
- The discarded-baseline kind still cannot be overwritten by the zero-history action, and the reverse is also refused.
- Portal invite still refuses a prospect. It must also refuse an internal staff email, matching trade approval. Today only the approval path has that check.
- Order export still uses the order snapshot, not a code typed during a later edit.
- Admin and sales overviews show the same next action.
- Narrow viewport: the next action is visible without horizontal tab scrolling.

Rollout:

- Deploy with no data change. Existing companies keep their ids, mappings, prices, groups, applications, orders, users, and sessions.
- Do not run prospect conversion, a 407EXP import, a history import, or an invitation send as part of the release.
- Watch the audit actions `company.created`, `application.approved`, `company.autopart_account.linked_verified`, and `autopart.customer_sales_cutover_completed`.
- Rollback of the first phases is a code rollback. There is no migration to reverse.

## What this document does not do

It does not implement the wizard, change a screen, or add a migration. Staff should keep using the current customer, application, and Autopart screens until a later change is reviewed.
