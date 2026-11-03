# Security evidence register

**Review date:** 2 November 2026 (Europe/London)
**Repository:** Ratty1982/ab-b2b
**Base:** `production/phase-1-auth-rbac` at `10e5140`
**Live site:** not inspected. No row below is "Verified in production" on the strength of code alone.

Status meanings:

- **Confirmed in code** — the control is present in the source, and the verification column says how it was checked.
- **Verified in production** — someone saw it on the running production system. None of the rows in this register use this status.
- **Not verified** — the control may exist outside the repository. This review could not see it.
- **Gap identified** — a weakness was confirmed. If this pull request changes it, the outstanding column says that the live site is unchanged until release.

Owners are roles, not named people.

---

### Password storage

- **Threat:** a stolen database reveals usable passwords
- **Evidence:** Better Auth 1.7.4 `dist/crypto/password.mjs` (scrypt). Application calls `hashPassword` from `better-auth/crypto` in `src/server/users/service.ts`
- **Verification:** library file read on 2 November 2026. No production database was opened
- **Status:** Confirmed in code
- **Outstanding:** none for the algorithm. Password length rules are a separate gap
- **Owner:** Development

### Password length

- **Threat:** very short passwords
- **Evidence:** `minPasswordLength: 10`, `maxPasswordLength: 128` in `src/infra/auth/auth.ts`
- **Verification:** code read; `src/infra/auth/auth.security.test.ts`
- **Status:** Confirmed in code
- **Outstanding:** no complexity rule and no check against stolen-password lists. Not changed, because it would reject existing choices without a rollout
- **Owner:** Directors, with Development

### Public self-registration closed

- **Threat:** a stranger creates an account
- **Evidence:** `disableSignUp: true` in `src/infra/auth/auth.ts`. Better Auth 1.7.4 `dist/api/routes/sign-up.mjs` rejects the route when the flag is set. No application screen calls sign-up
- **Verification:** code read; configuration test. Live route not called
- **Status:** Confirmed in code
- **Outstanding:** not on the live site until this pull request is released. Before this change the route was open
- **Owner:** Development to release; Directors to approve release

### Session cookie flags

- **Threat:** a script or an insecure network steals the session cookie
- **Evidence:** `httpOnly: true`, `sameSite: "lax"`, `secure` and `useSecureCookies` when `NODE_ENV` is production, in `src/infra/auth/auth.ts`
- **Verification:** code read; configuration test. Browser cookie on the live site not inspected
- **Status:** Confirmed in code
- **Outstanding:** confirm the live response after release
- **Owner:** Development

### Session lifetime

- **Threat:** a stolen browser stays signed in
- **Evidence:** `expiresIn` 7 days, `updateAge` 1 day, in `src/infra/auth/auth.ts`
- **Verification:** code read
- **Status:** Gap identified
- **Outstanding:** directors to decide if staff sessions should be shorter. Not changed in this project
- **Owner:** Directors

### Session revocation after disable

- **Threat:** a former employee keeps a working session
- **Evidence:** `authSession.deleteMany` on deactivate in `src/server/users/service.ts`. Disabled users fail `loadAccessProfile` in `src/server/rbac/access.ts`. Cookie cache set to `enabled: false` in `src/infra/auth/auth.ts` so a deleted session is not reused from the cookie copy
- **Verification:** code read; configuration test. Not exercised against a database here
- **Status:** Confirmed in code
- **Outstanding:** live until release: the previous code kept a five-minute cookie copy
- **Owner:** Development

### Password reset signs out other browsers

- **Threat:** a stolen browser survives a reset
- **Evidence:** `revokeSessionsOnPasswordReset: true` in `src/infra/auth/auth.ts`. Better Auth 1.7.4 `dist/api/routes/password.mjs` deletes sessions only when this flag is set. Administrator reset already deleted sessions in `src/server/users/service.ts`
- **Verification:** library and configuration test. Full reset flow not run against a database
- **Status:** Confirmed in code
- **Outstanding:** not live until release
- **Owner:** Development

### Sign-in rate limit on the real page

- **Threat:** password guessing
- **Evidence:** login page calls `signInWithPassword` (`src/routes/login.tsx`). Better Auth's limiter runs in the HTTP router (`dist/api/index.mjs` `onRequest`), which that server function does not use. Application limit is 10 attempts per account in 15 minutes (`src/server/security/policy.ts`, `src/server/security/attempts.ts`). It does not use a forwarding header
- **Verification:** `src/server/security/controls.test.ts`. Changing `CF-Connecting-IP`, `X-Real-IP` or `X-Forwarded-For` does not create a new allowance. Library file read on 2 November 2026
- **Status:** Confirmed in code
- **Outstanding:** each process has its own counter and a restart clears it. Redis was not added. `REDIS_URL` is unused. Cloudflare must limit sign-in volume across all copies. A guess spread across many accounts is not stopped here
- **Owner:** Development for the application limit; hosting administrator for Cloudflare

### Client address headers

- **Threat:** a forged forwarding header is treated as the visitor, or is used to dodge or share a limit
- **Evidence:** `src/server/security/client-address.ts` returns `trusted: false` and `address: null` for every request. No proxy allowlist, hop count, or Cloudflare secret exists in the repository. `docs/deployment-coolify.md` says a reverse proxy exists and does not name it
- **Verification:** unit tests for a forged conflict, a missing header, a non-address, and a header set shaped like Cloudflare plus a proxy
- **Status:** Gap identified
- **Outstanding:** do not teach the application a proxy list until Coolify and, if used, Cloudflare are written down as in `docs/security/coolify-infrastructure-checklist.md`. Audit rows may still store the left-most `X-Forwarded-For` from older login code (`clientMetaFromRequestHeaders`). That stored value is not authenticated
- **Owner:** Hosting administrator for the proxy facts; Development before any later code change that would trust an address

### HTTP auth rate limit (library)

- **Threat:** guessing against `/api/auth/sign-in/email` directly
- **Evidence:** `rateLimit` in `src/infra/auth/auth.ts` (5 sign-ins, 3 forgotten-password, 5 resets per minute). Storage is the library default, which is in-memory unless custom storage is set. No custom storage is set
- **Verification:** configuration test; library rate-limiter file read
- **Status:** Confirmed in code
- **Outstanding:** does not by itself cover the sign-in page. Not shared across more than one server process
- **Owner:** Development

### Public form limits

- **Threat:** form spam, and one sender blocking every other sender
- **Evidence:** `assertPublicFormAllowed` in `src/server/phase2/fns.ts` for trade applications, callbacks, and motorsport. Buckets are the email and the telephone (`src/server/security/public-forms.ts`). There is no site-wide bucket and no forwarding-header bucket. Existing honeypot and duplicate window remain in `src/server/applications/service.ts`. Survey limit remains in `src/domain/customer-survey.ts`
- **Verification:** unit test that one trade-application email cannot exhaust another, that many different callback emails do not close the form, and that a body with no email or telephone does not create a shared block. Survey behaviour not re-run against a database
- **Status:** Confirmed in code
- **Outstanding:** a person who invents a new email for every message is not stopped in the application. Cloudflare rate limiting and bot protection are the compensating control. They were not seen. Server functions return an application error rather than depending on an HTTP 429 from a proxy
- **Owner:** Development; hosting administrator

### CSRF on server functions

- **Threat:** another website submits a signed-in action
- **Evidence:** `createCsrfMiddleware` filtered to `serverFn` in `src/start.ts`
- **Verification:** `src/infra/auth/auth.security.test.ts`. No browser replay
- **Status:** Confirmed in code
- **Outstanding:** independent browser test not done
- **Owner:** Development

### Security response headers

- **Threat:** framing, content sniffing, unexpected browser features
- **Evidence:** `src/start.ts`, `STRICT_TRANSPORT_SECURITY` in `src/domain/transport-security.ts` (`max-age=31536000`, no `includeSubDomains`)
- **Verification:** configuration test
- **Status:** Confirmed in code
- **Outstanding:** content security policy still has `script-src 'self' 'unsafe-inline'`. Not tightened, because it can break pages. Live headers not captured
- **Owner:** Development

### Permission checks and customer isolation

- **Threat:** one customer reads another's orders, prices, or company
- **Evidence:** `requireCompanyAccess` and related guards in `src/server/rbac/guards.ts`. Quote portal path uses `requireCompanyPermission` in `src/server/quotes/service.ts`. Disabled and missing users fail closed in `loadAccessProfile`
- **Verification:** code read. Existing `src/server/rbac/permissions.test.ts` passed. No two-customer browser test in this review
- **Status:** Confirmed in code
- **Outstanding:** not every server function was executed. A penetration test should sample cross-customer ids
- **Owner:** Development; external tester when commissioned

### Authenticator setup and staged enforcement

- **Threat:** a stolen password is enough to enter staff or customer areas
- **Evidence:** Better Auth 1.7.4 `twoFactor` plugin in `src/infra/auth/auth.ts`. Enrolment does not set `skipVerificationOnEnable`, so `twoFactorEnabled` stays false until `verifyTOTP` accepts a code. Account security is `/account/security` (`src/routes/account.security.tsx`, `src/server/auth/mfa.ts`). Backup codes are encrypted and replaced as a set when one is used (`backup-codes/index.mjs`). Trusted browsers last 30 days (`trustDeviceMaxAge`). Failed sign-in codes update `twoFactor.failedVerificationCount` and can set `lockedUntil` for 15 minutes after 10 failures. That row is shared by every application copy. A second, process-local limit remains on the sign-in cookie, including setup-code attempts. A password change clears other sessions and trusted browsers. Flags: `MFA_ENFORCE_PRIVILEGED` (Super Admin and Accounts), `MFA_ENFORCE_STAFF` (all internal roles), `MFA_ENFORCE_CUSTOMERS` (trade). All default off (`src/domain/mfa-policy.ts`). `requireAuthenticatedUser` and the route guards refuse business access when a flag applies and setup is unfinished. A Super Admin reset is `resetUserAuthenticator` and does not return secrets. Password reset, disablement, and authenticator disable clear `trust-device-` verification rows
- **Verification:** `src/domain/mfa-policy.test.ts`, `src/domain/totp-window.test.ts`, and `src/infra/auth/auth.security.test.ts` on 3 November 2026 (Europe/London). No database enrolment was run. The live environment was not read. The Account security screen was not clicked in a browser
- **Status:** Confirmed in code. Enforcement is not active
- **Outstanding:** enrol Super Admin and Accounts and store recovery codes before setting `MFA_ENFORCE_PRIVILEGED=true`. Do not set `MFA_ENFORCE_STAFF` until that first stage has been used. Leave `MFA_ENFORCE_CUSTOMERS` unset. Rollback is to set the flag back to false and restart. That does not delete authenticator rows
- **Owner:** Directors for the decision; Super Admin for enrolment and for lost-phone resets

### Staged activation

1. Release this change with all three flags unset.
2. Ask each Super Admin and Accounts user to open Account security, scan the code, and store the recovery codes.
3. Sign in once with a code, once with a recovery code, and once with "Remember this browser".
4. Set only `MFA_ENFORCE_PRIVILEGED=true` and restart. Confirm a Super Admin who has not enrolled can open Account security and cannot open orders.
5. After the trade desk is ready, set `MFA_ENFORCE_STAFF=true` for management and the rest of the staff.
6. Leave customers optional. Do not set `MFA_ENFORCE_CUSTOMERS` in this rollout.
7. If people are locked out, set the flag to false and restart. Do not delete `twoFactor` rows unless a Super Admin reset is intended.

### Passkeys

- **Threat:** phishing of passwords
- **Evidence:** no passkey plugin or routes found
- **Verification:** repository search
- **Status:** Gap identified
- **Outstanding:** not required for this phase. Authenticator codes are the available second factor
- **Owner:** Directors

### Former-employee and suspension path

- **Threat:** a leaver retains access
- **Evidence:** deactivate sets `DISABLED`, deletes sessions, and can deactivate the sales-rep flag (`src/server/users/service.ts`). Reactivation writes `USER_REACTIVATED` and, after this change, a `SECURITY_ALERT`
- **Verification:** code read. Not run against a database in this review
- **Status:** Confirmed in code
- **Outstanding:** operational leavers process (who disables the account, and how fast) is not software. Confirm with the directors
- **Owner:** Directors; Super Admin

### Audit redaction

- **Threat:** passwords or tokens copied into the audit table
- **Evidence:** `scrub` in `src/server/audit/record.ts`. Password reset metadata omits the URL (`src/infra/auth/auth.ts`). Failed sign-in stores a domain and `accountKey`, not the full address (`src/server/auth/session.ts`)
- **Verification:** `src/server/security/controls.test.ts`
- **Status:** Confirmed in code
- **Outstanding:** staff email addresses are still stored on some older user-administration events. That is operational data, not a password
- **Owner:** Development

### Security notices and export watching

- **Threat:** guessing, a new administrator, a quiet permission change, or a bulk export goes unseen
- **Evidence:** `src/server/security/alerts.ts`, called from sign-in, role assignment, user create, reactivation, permission updates, customer price export, sales-enquiry export, survey export, and prize-draw export
- **Verification:** message builder unit test. Email send and database insert not executed here
- **Status:** Confirmed in code
- **Outstanding:** set `SECURITY_ALERT_EMAIL` if email is wanted. Otherwise read `SECURITY_ALERT` rows. Cooldown prevents a flood. Ordinary permission denials are intentionally not emailed
- **Owner:** Directors for the mailbox; Development for the code

### File upload checks

- **Threat:** a script or a huge file is stored and served
- **Evidence:** `PRODUCT_DOCUMENT_MAX_BYTES` and PDF checks in `src/domain/product-documents.ts`. Public bytes refused for non-public products in `src/server/catalogue/product-documents.ts`. CMS and certificate limits in `src/domain/cms.ts` and `src/domain/certifications.ts`
- **Verification:** existing `src/domain/product-documents.test.ts` passed. No malware sample was uploaded
- **Status:** Confirmed in code
- **Outstanding:** no antivirus product is in the application
- **Owner:** Development

### SQL injection

- **Threat:** a crafted request changes a query
- **Evidence:** database access is Prisma. `$queryRawUnsafe` appears in `src/server/maintenance/imported-sales-reset.ts` with a timeout taken from a code constant, and in a test. Public request values were not found interpolated there
- **Verification:** repository search. Maintenance tool not executed
- **Status:** Confirmed in code
- **Outstanding:** the maintenance statement still uses the unsafe API with a constant. Left unchanged because that tool is outside this project's business scope
- **Owner:** Development

### Microsoft 365 flags and token handling

- **Threat:** tokens leak, or sync runs when the business has not asked for it
- **Evidence:** `isMicrosoft365CrmEnabled` is false unless the flag is an explicit on-value. Task and calendar flags are separate. PKCE, state hash, nonce, ID token checks, and redirect checks are in `src/domain/microsoft-365-crm.ts` and `src/server/microsoft-365/flow.ts`. Encryption uses `MICROSOFT_365_ENCRYPTION_KEY` (`src/server/microsoft-365/token-cipher.ts`). Callback redirects only to a same-site path (`src/routes/api/microsoft-365/callback.ts`)
- **Verification:** `flow.test.ts`, `token-cipher.test.ts`, `signing-keys.test.ts`, and `src/domain/microsoft-graph-security.test.ts` passed on 2 November 2026. Live flags not read. Sync not enabled
- **Status:** Confirmed in code
- **Outstanding:** production flag values and the Entra app registration need a person with Azure access before anyone claims the live connection is safe. Do not enable sync as part of this work
- **Owner:** Directors for whether sync is wanted; hosting administrator for the secrets

### Graph host restriction

- **Threat:** the server is tricked into calling an attacker's web address
- **Evidence:** `resolveMicrosoftGraphUrl` allows only `https://graph.microsoft.com` (`src/domain/microsoft-graph-security.ts`)
- **Verification:** `src/domain/microsoft-graph-security.test.ts` passed
- **Status:** Confirmed in code
- **Outstanding:** none in application code
- **Owner:** Development

### Unauthenticated and privileged HTTP routes

- **Threat:** a hidden administration address
- **Evidence:** API routes under `src/routes/api/`. Auth catch-all requires Better Auth. Uploads require a session (`autopart-imports/upload.ts`, `customer-sales-uploads.ts`). Microsoft callback requires the signed-in user inside the service. `GET /api/build` is public and returns revision and `NODE_ENV` only. `GET /api/internal/stock-sync` is public and returns schedule status only. `POST` requires the cron secret
- **Verification:** code read. Routes not called on the live site
- **Status:** Confirmed in code
- **Outstanding:** move the cron secret out of query strings if that optional POST is used. Do not log the secret while checking
- **Owner:** Hosting administrator if the optional endpoint is used

### Request size

- **Threat:** a huge body exhausts the server
- **Evidence:** per-feature caps (product PDF 20 MB, CMS media 8 MB, customer prices 2 MB, stock feed 15 MB, Autopart master import default 250 MB). No single cap in front of every server function, because staff imports are large
- **Verification:** code read. Oversized PDF case is in `src/domain/product-documents.test.ts`, which passed
- **Status:** Gap identified
- **Outstanding:** a proxy-level maximum, with an exception for the known staff import addresses, needs the hosting administrator. A small global cap would break legitimate imports
- **Owner:** Hosting administrator

### Error detail shown to visitors

- **Threat:** an internal message helps an attacker
- **Evidence:** `src/start.ts` returns a generic HTML error page for unexpected failures and logs the error on the server. `toError` in `src/server/phase2/fns.ts` can return `error.message` for an ordinary `Error`
- **Verification:** code read
- **Status:** Gap identified
- **Outstanding:** not changed. Many functions use that message as the sentence the user should see. A blanket hide would break forms. A later pass can separate staff-facing sentences from unexpected failures
- **Owner:** Development

### Cloudflare

- **Threat:** volumetric attacks and common web exploits before they reach the application
- **Evidence:** no Cloudflare configuration in the repository. Checklist: `docs/security/cloudflare-checklist.md`
- **Verification:** repository search only
- **Status:** Not verified
- **Outstanding:** a person with the Cloudflare account completes the checklist
- **Owner:** Hosting administrator; Directors

### Server, firewall, database exposure, backups

- **Threat:** the database or the host is reached directly
- **Evidence:** deployment description in `docs/deployment-coolify.md` and `Dockerfile`. Local compose publishes PostgreSQL. Checklist: `docs/security/coolify-infrastructure-checklist.md`
- **Verification:** files read. Server not accessed
- **Status:** Not verified
- **Outstanding:** hosting administrator completes the checklist, especially public database ports and a tested restore
- **Owner:** Hosting administrator; Directors

### Log retention and who can read logs

- **Threat:** no record after an incident, or too many people can edit the record
- **Evidence:** `AuditEvent` in `prisma/schema.prisma` has indexes and no deletion job. Application logs go to the process output, which Coolify would display. No retention setting is in the repository
- **Verification:** schema and deployment notes read
- **Status:** Gap identified
- **Outstanding:** agree retention and name who can open the database and Coolify. Procedure is in the infrastructure checklist
- **Owner:** Directors

---

## Tests run on 2 November 2026 (Europe/London)

Commands, from the security branch:

- `bunx vitest run` on `src/server/security/controls.test.ts`, `src/infra/auth/auth.security.test.ts`, `src/domain/microsoft-graph-security.test.ts`, `src/server/microsoft-365/flow.test.ts`, `src/server/microsoft-365/token-cipher.test.ts`, `src/server/microsoft-365/signing-keys.test.ts`, `src/domain/product-documents.test.ts` and `src/server/rbac/permissions.test.ts` — 8 files, 67 tests, passed on 2 November 2026 (Europe/London). This run includes forged, conflicting and missing forwarding headers, a proxy-shaped header set, and separate public-form identities.
- `NODE_OPTIONS='--max-old-space-size=6144' bunx tsc --noEmit` — passed
- `NODE_OPTIONS='--max-old-space-size=6144' bun run build` — passed (`vite build` / Nitro output)

Not run: the database integration suite, a browser pass, and any request to the live website.

## Tests run on 3 November 2026 (Europe/London)

Commands, from `cursor/two-factor-completion-c11b`:

- `bunx vitest run` on `src/domain/mfa-policy.test.ts`, `src/domain/totp-window.test.ts`, `src/infra/auth/auth.security.test.ts`, `src/server/security/controls.test.ts`, and `src/server/rbac/permissions.test.ts` — 5 files, 43 tests, passed at 11:03 Europe/London.
- `NODE_OPTIONS='--max-old-space-size=6144' bunx tsc --noEmit` — passed
- `NODE_OPTIONS='--max-old-space-size=6144' bun run build` — passed (`vite build` / Nitro output)

Not run: a PostgreSQL enrolment, a browser pass of Account security, concurrent-session sign-in, or any request to the live website. Incorrect and expired authenticator codes were checked with the same `@better-auth/utils/otp` helper Better Auth 1.7.4 uses. Recovery-code single use was pinned to the installed plugin source (`codes.filter` plus a conditional `incrementOne`) and was not executed against a database.

## Deployment note

No new migration for authenticator setup. The existing `twoFactor` table is reused. Optional flags, all off unless set to true, 1, or on: `MFA_ENFORCE_PRIVILEGED`, `MFA_ENFORCE_STAFF`, `MFA_ENFORCE_CUSTOMERS`. Optional `SECURITY_ALERT_EMAIL`. Rollback is to set the flag back to false and restart. That does not delete authenticator rows. See `docs/security/directors-security-report.md`.
