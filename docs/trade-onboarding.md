# Trade application & customer onboarding

This document describes the production trade-customer journey:

**Public website → Open Trade Account → Application → Staff review → Approve → Activate → Login → Portal → Pricing / basket**

It builds on existing `TradeApplication`, `Company`, `CompanyUser`, `User`, Better Auth, and Phase 6A.5 commercial-account fields. It does **not** introduce a parallel CRM or auth system.

---

## Lifecycle

| Status | Meaning |
| --- | --- |
| `SUBMITTED` | Application received from `/register` |
| `UNDER_REVIEW` | Staff opened / flagged for review |
| `MORE_INFO_REQUIRED` | Staff asked the applicant for more information (customer-facing message stored; email deferred until outbound mail is configured) |
| `APPROVED` | Company + invite created; applicant must activate |
| `REJECTED` | Closed without trade access |
| `DRAFT` / `WITHDRAWN` | Reserved; not used by public submit today |

References are customer-friendly: `APP-YYYYMMDD-NNNN` (unique; not a database id).

---

## Public registration (`/register`)

Sections:

1. Your business  
2. Business address  
3. Your details  
4. Existing Automotive Brands account  
5. Trade information  
6. Submission (consent)

Key rules:

- Business type is a controlled list (`Motor Factor`, `Garage / Workshop`, …, `Other`).
- Estimated spend uses ranges only (never a self-selected price list).
- Existing account claim (`yes` / `no` / `not_sure`) and optional account number populate **`TradeApplication.claimedAutopartCustomerCode` only**.
- Consent is required; `consentAcceptedAt` is stored on submit.
- Soft duplicate protection: same company name + email within 10 minutes returns the existing reference (`duplicate: true`) without creating spam rows.

Legal pages (privacy / terms) are not yet published in CMS — the consent copy acknowledges this gap rather than inventing policies.

---

## Claimed vs verified Autopart account

| Field | Owner | Meaning |
| --- | --- | --- |
| `TradeApplication.claimedAutopartCustomerCode` | Applicant claim | Evidence for staff. **Never** grants pricing/orders/basket access. |
| `Company.autopartCustomerCode` + verifiedAt/By | Staff after verify | Authoritative Autopart link (Phase 6A.5). |

Approval **does not** copy the claim onto the Company. Staff use the Customer Commercial tab: set → verify → change/clear with audit.

---

## Admin review (`/admin/applications`)

Workspace sections: business, contact, address, existing account, trade info, duplicate/identity warnings, internal commercial setup, actions.

Staff can **Edit details** on open applications (submitted / under review / more info) to correct applicant data without creating a Company.

Commercial setup before approve (optional unless business requires them):

- Sales rep  
- Price list  
- Payment terms  
- Internal notes  

Actions:

- Under review  
- Request info (requires customer-facing message; **email deferred**)  
- Approve (transactional)  
- Reject (requires internal notes; optional customer message — never auto-emailed)  
- Delete — permanent remove when no Company is linked; otherwise **Withdraw** (`WITHDRAWN`) to soft-delete  

**View customer** opens the existing Customer workspace after approval.

---

## Approval transaction

On approve (idempotent if already approved with `companyId`):

1. Validate identity warnings (blocks internal staff emails; requires confirm for ambiguous trade emails)  
2. Create Company (`ACTIVE`) with optional price list / payment terms  
3. Create primary Contact + registered Address  
4. Optional sales-rep assignment  
5. Create or link TRADE User (`INVITED`)  
6. Upsert `CompanyUser` (`TRADE_ADMIN`, `INVITED`)  
7. Create `UserInvitation` (token hashed; raw token returned once; `emailDeferred: true`)  
8. Mark application `APPROVED`  
9. Audit `application.approved` + `application.activation_initiated`

Rollback: all steps run in a Prisma transaction. Failure leaves the application reviewable.

Double approve does **not** create duplicate companies/users.

---

## Activation (`/activate?token=…`)

1. Preview invitation (email + company name)  
2. Applicant sets password (≥10 chars)  
3. Server hashes password into Better Auth `AuthAccount`  
4. User + CompanyUser become `ACTIVE`  
5. Invitation `ACCEPTED`  
6. Applicant logs in → `/portal`

No temporary passwords are emailed. When outbound email is configured, send the same `/activate?token=` link; do not invent a second auth stack.

---

## Email capability / gap

| Event | Behaviour today |
| --- | --- |
| Application submitted | Audit only |
| More info / reject messages | Stored; **not sent** |
| Activation invite | Token shown to staff; **emailDeferred** |
| Password reset | Better Auth path; depends on email adapter |

Dev/test may log mail via the email adapter. Production without a provider fails closed for transactional mail.

---

## Security

- Company scope always resolves from authenticated `CompanyUser` membership — never from browser-supplied `companyId`.  
- Claimed Autopart codes never unlock another customer’s data.  
- Application admin APIs require `applications.view` / `review` / `approve`.  
- Application reference alone does not expose application data publicly.

---

## Customer workspace handoff

After approval, staff continue commercial management on the Customer record:

- Autopart verify  
- Price list / payment terms / credit  
- Contacts  
- Invites  

Do not duplicate that surface inside Trade Applications.

---

## Future email work

When a provider is attached:

1. Send activation link on approve  
2. Optionally notify on more-info / rejection using stored `customerMessage`  
3. Keep `emailDeferred` false only when send succeeds  
4. Preserve hashed invite tokens and activation route
