# Automotive Brands — directors' security report

**Date:** 2 November 2026 (Europe/London)
**Website:** https://automotivebrands.co.uk
**Code reviewed:** branch `production/phase-1-auth-rbac` at commit `10e5140`, plus the changes in this security pull request
**What this is:** a plain-English account of what the website already does to protect the business, what was weak, what this project changed, and what still needs a person with access to Cloudflare or the server.

This review looked at the application code, its tests, and the deployment notes in the repository. It did **not** sign in to the live website as an attacker, did **not** scan the live server, and did **not** open the Cloudflare or Coolify dashboards. A protection is described as working in production only where this review actually saw it there. Code on its own is not the same as a live check.

The changes in this pull request are **not deployed**. Until they are released through the normal process, the live website still behaves as it did before this review.

---

## A. Security already in place

These controls were already in the production code before this project. Each one was confirmed by reading the code, and where noted, by an existing automated test.

### Customers and staff sign in through the application

Passwords are not stored in the browser. The application uses Better Auth with the PostgreSQL database. A successful sign-in creates a session record and sends the browser a cookie that JavaScript on the page is not allowed to read (`HttpOnly`).

Evidence: `src/infra/auth/auth.ts`, `src/infra/auth/client.ts`.

In production, that cookie is also marked so that browsers send it only over an encrypted connection (`Secure`), and it is limited to this site (`SameSite=lax`). That production switch depends on `NODE_ENV` being `production`. The live server's cookie was not inspected.

### Passwords are stored as a one-way scramble, not as readable text

Better Auth 1.7.4 scrambles passwords with scrypt before they are saved. This was confirmed in the installed library (`node_modules/better-auth/dist/crypto/password.mjs`) and by the application's own use of `hashPassword` from `better-auth/crypto` when staff reset a password (`src/server/users/service.ts`).

The shortest password allowed by the application is 10 characters and the longest is 128 (`src/infra/auth/auth.ts`). There is no rule requiring a mixture of letters and numbers, and there is no check against lists of passwords that have already been stolen elsewhere.

### A closed account should not keep working

If a user's status is disabled, the application refuses to build their permission profile (`src/server/rbac/access.ts`) and refuses to create a new session (`src/infra/auth/auth.ts`). Switching a staff account off deletes their session rows (`src/server/users/service.ts`). An administrator password reset also deletes those rows.

Before this project, a short-lived copy of the session could still be accepted for up to five minutes after those rows were deleted. That gap is closed in this pull request. See section B.

### Staff and customers only see what their role allows

Permissions are decided on the server. Hiding a button is not treated as the security control. A customer number or company id sent by the browser is checked against that person's company membership, or against a salesperson's assigned accounts (`src/server/rbac/guards.ts`, `requireCompanyAccess`).

Trade customers do not receive internal roles by filling in a form. Those role fields are marked so the browser cannot set them (`input: false` in `src/infra/auth/auth.ts`).

This review read the shared guards and sampled orders, quotes, product documents, and media. It did not re-test every screen by hand. See section F.

### The sign-in pages do not tell an attacker whether an email address exists

A wrong password returns "Invalid email or password". A password reset always returns the same sentence whether or not the address is on file (`src/server/auth/session.ts`). The reset link is not written into the audit log (`src/infra/auth/auth.ts`).

### Security headers are added to pages

Every response gets instructions that make casual browser attacks harder: do not sniff the file type, do not allow the site to be framed, limit powerful browser features, and send a content security policy. On a production process the site also sends a one-year HTTPS instruction for this host only. It deliberately does not force that instruction onto every other name in the domain.

Evidence: `src/start.ts`, `src/domain/transport-security.ts`, `src/infra/auth/auth.security.test.ts`.

The content security policy still allows inline scripts (`unsafe-inline`). That is a weaker setting, kept so the current site can run. It was not changed, because tightening it can break pages.

### Forms that run on the server are checked for cross-site forgery

The application adds a check that server functions really came from this site (`createCsrfMiddleware` in `src/start.ts`). The raw address `/api/auth` is handled by Better Auth's own origin check. This review did not replay a forged browser request against the live site.

### There is an audit trail for important account changes

Sign-in success and failure, password reset, role changes, and account closure are written to an `AuditEvent` table. The writer removes values whose names look like passwords, tokens, secrets, or cookies (`src/server/audit/record.ts`). There is no automatic deletion of old audit rows in the code. How long they are kept in backups was not checked.

### Authenticator codes exist, and they are not compulsory

Staff can enrol an authenticator app and receive one-time recovery codes (`src/server/auth/mfa.ts`, page `/admin/security/mfa`). The policy names Super Admin and Accounts as the roles that should use this (`src/domain/mfa-policy.ts`). The switch that actually blocks those roles without an authenticator is `MFA_ENFORCE_PRIVILEGED`. If that variable is missing, the code leaves enforcement **off**, so that staff are not locked out before they have enrolled.

This review did not read the live server's environment, so it cannot say whether production has turned that switch on. From the code alone, authenticator codes are available, not required.

There are no passkeys in this application.

### Microsoft 365 is built, and it stays off until explicitly switched on

The customer-relationship connection to Microsoft is ignored unless `MICROSOFT_365_CRM_ENABLED` is one of `true`, `1`, `on`, or `yes` (`src/domain/microsoft-365-crm.ts`). Task sync and calendar sync have their own extra switches and stay off unless those are also set. This project did not turn any of them on.

Where the code is used, it uses the current recommended sign-in pattern: a one-time code, a secret proof that the code was requested by this server (PKCE), a random `state` and `nonce`, a check of Microsoft's signature on the identity token, and a fixed return address. Refresh tokens are encrypted with a key that is separate from the main application secret (`src/server/microsoft-365/token-cipher.ts`). Messages that might contain a token are scrubbed before they are written to the log (`sanitizeMicrosoftMessage`).

Automated tests cover that flow (`src/server/microsoft-365/flow.test.ts`, `token-cipher.test.ts`, `signing-keys.test.ts`). They do not prove the live Microsoft app registration is correct.

A separate, older connection can read safety-data-sheet PDFs from one Microsoft folder. It is also off unless `SHAREPOINT_SDS_ENABLED` is set. See `docs/security.md`.

### Uploaded files are checked before they are kept

Product documents must be PDFs, must look like a PDF in the file itself, and must be within 20 MB (`src/domain/product-documents.ts`). Public download of a document is refused unless the product is allowed to be shown (`src/server/catalogue/product-documents.ts`). Pictures for the public site and certificate files have their own size limits. Customer price files are capped at 2 MB.

The optional stock-sync web address refuses a missing or wrong secret, using a comparison that does not leak the secret through timing (`src/server/stock/service.ts`). The secret may also be placed in the web address itself. That is weaker, because addresses are often written into logs. This project did not change the stock-sync behaviour.

### Public enquiries already had some abuse limits

Trade applications ignore a hidden field that only a robot would fill in, and they reuse a recent duplicate instead of creating another one (`src/server/applications/service.ts`). Customer surveys allow eight submissions an hour for the same stored address (`src/domain/customer-survey.ts`). Those limits were not replaced.

---

## B. Security improvements completed

These changes are in this pull request. They are tested on the development machine. They are not on the live website until the pull request is released.

### 1. The public "create an account" route is closed

**Original weakness.** Better Auth was allowed to create a user if anyone posted to `/api/auth/sign-up/email`. New users start as invited trade users, and the first sign-in promotes an invited user to active. They would not become a member of staff, and they would not see another customer's prices without a company membership, but they would still be a real account in the database. Staff and customers are supposed to be invited or approved, not self-created. No screen in the application calls that sign-up route.

**What changed.** `disableSignUp` is set. Better Auth 1.7.4 then rejects that route (`sign-up.mjs`).

**Attack this helps stop.** A stranger creating an account and then probing signed-in pages.

**Test.** `src/infra/auth/auth.security.test.ts` checks the setting is present. The library behaviour was read in Better Auth 1.7.4. A live call against production was not made.

**Limitation.** This does nothing until the pull request is deployed. Invitation and approved trade applications still create accounts, which is the intended route.

### 2. Switching someone off takes effect on the next request

**Original weakness.** The session cookie kept a five-minute copy of the session (`cookieCache` enabled, `maxAge` five minutes). Deleting the database session did not, by itself, end that copy.

**What changed.** The cookie copy is turned off. Each request reads the session from the database.

**Attack this helps stop.** A former employee, or someone using a stolen signed-in browser, continuing for a few minutes after the account is switched off or the password is reset.

**Test.** `src/infra/auth/auth.security.test.ts` checks the cookie cache is disabled.

**Limitation.** The database is asked for the session more often. If that load is ever a problem, the rollback is to turn the cookie cache on again, accepting the five-minute gap. Rollback steps are at the end of this report.

### 3. A password reset signs out other browsers

**Original weakness.** Better Auth only deletes other sessions after a reset when `revokeSessionsOnPasswordReset` is set. It was not set. An administrator reset already deleted sessions. A person using "forgotten password" did not.

**What changed.** The flag is set to true. Confirmed in Better Auth 1.7.4 `password.mjs`: when the flag is true, that user's sessions are deleted.

**Attack this helps stop.** Someone who stole a signed-in browser keeping access after the real user has changed the password.

**Test.** The configuration test checks the flag. A full reset was not run against a database in this review.

**Limitation.** The person will need to sign in again on every device. That is the intended result.

### 4. Guessing and form spam are limited on the paths people actually use

**Original weakness.** Better Auth's own limit applies to the HTTP sign-in route (`onRequest` in Better Auth 1.7.4 `dist/api/index.mjs`). The website's sign-in page does not use that route. It calls a server function, `signInWithPassword` (`src/routes/login.tsx`). Password guessing through the real page was not covered by that HTTP limit. The public trade-application, callback, and motorsport forms also had no general rate limit.

**What changed.** The server functions now count attempts before the password is checked:

- 10 sign-in attempts per account in 15 minutes
- 80 sign-in attempts per network address in 15 minutes, and only when a real address is present
- 10 authenticator attempts in 10 minutes
- 5 password-reset requests per account in an hour, and 12 per address
- 10 attempts to finish a reset per token and per address in an hour
- Trade applications: 5 an hour per address, 3 an hour per email, and 30 in 10 minutes for the whole site
- Callback requests: 8 an hour per address, and 40 in 10 minutes for the whole site
- Motorsport enquiries: 5 an hour per address, and 20 in 10 minutes for the whole site

A blocked password reset still shows the normal sentence, so it does not reveal whether the email exists. A blocked public form asks the person to wait.

The counters are in `src/server/security/policy.ts` and `src/server/security/attempts.ts`.

**Attack this helps stop.** Repeated password guessing, repeated authenticator guessing, and a flood of public forms.

**Test.** `src/server/security/controls.test.ts`.

**Limitation.** The counters live in the memory of each running copy of the website. A restart clears them. Two copies do not share them. If the hosting proxy does not replace the visitor address header, a forged address could dodge the address limit. The per-account limit still applies, and it does not depend on that header. A missing address is **not** treated as one bucket for every visitor, because that could lock out the whole company.

### 5. Serious events can raise a notice, without flooding the inbox

**Original weakness.** Failures were stored one by one. Nothing grouped "the same account is being attacked" or "a new Super Admin appeared" into a single notice.

**What changed.** The application writes a `SECURITY_ALERT` audit row, at most once an hour for the same event (six hours for export bursts). It can also send one email when `SECURITY_ALERT_EMAIL` is a single address **and** the existing email settings already have a working mail server. If the variable is empty, which it is today, no email is sent and the audit row is still written.

Notices cover:

- sign-in attempts blocked by the new limit
- authenticator attempts blocked by the new limit
- password-reset requests blocked by the new limit
- a new Super Admin, or the Super Admin role being granted
- a disabled staff account being switched back on
- a change to sensitive staff permissions
- one staff member exporting customer information 30 or more times in an hour

Customer price exports, customer sales-enquiry exports, survey exports, and prize-draw exports now write a `CUSTOMER_DATA_EXPORTED` row with a count, not the spreadsheet itself.

The email text does not include passwords, tokens, or customer email addresses (`src/server/security/alert-message.ts`).

**Attack this helps stop.** An attack or a quiet privilege change going unnoticed.

**Test.** The wording and the one-address rule are unit tested. Sending a real email was not tested, because that needs the live mail settings. Database writes for alerts were not run here, because this environment had no production database.

**Limitation.** Nobody receives an email until a director sets `SECURITY_ALERT_EMAIL` and the site can already send mail. Alerts do not page a phone. Ordinary "access denied" clicks are not alerted, because staff hit those during normal navigation and the inbox would fill up.

### 6. Audit lines are harder to poison

**What changed.** The address and browser name stored on an audit row are trimmed, line breaks are removed, and the length is capped (`src/server/audit/record.ts`). Secret-looking fields were already blanked out. A unit test checks both.

**Limitation.** This does not encrypt the audit table. Anyone who can read the database can read the audit.

---

## C. Protection against hacking

### Someone tries to guess a password

The sign-in page does not say whether the email is on file. After this release, the same account can be tried 10 times in 15 minutes, and then the application stops checking the password and can record one security notice. The notice does not contain the password. A long list of different accounts from one address is also slowed, when the visitor address can be trusted.

This is not a guarantee against a slow guess spread over many days, or against guessing from many different addresses. A firewall in front of the site (Cloudflare) should add its own limit. That firewall was not confirmed.

### Someone steals a staff sign-in

They still need the password. If that staff member has chosen to enrol an authenticator, they also need the six-digit code or a recovery code. Super Admins and Accounts staff are **not forced** to enrol unless the enforcement switch is on. This review could not see that switch in production, and the code default is off.

After this release, changing the password signs out other browsers, and switching the account off signs it out on the next request. Until this release, a stolen browser could keep working for up to five minutes after the account was switched off, and a forgotten-password reset did not sign out other browsers.

### Someone tries to open another customer's information

The server is supposed to ignore a company id, order id, or user id that the person is not allowed to see. The shared rule is in `requireCompanyAccess`. Sampled quote, order, and document paths use that style of check. This review did not click through every screen as two different customers. That is listed under independent testing.

### Someone tries to misuse an API address

Signed-in administration routes check the session and a permission. The optional stock import address requires a secret on POST. Its GET address is public and only says whether stock import is configured and what the schedule hours are. It does not return prices or customers. The build address returns the software version and whether the process thinks it is production. It does not return secrets.

Public forms are validated and, after this release, rate limited. There is no single cap on the size of every request, because some staff imports are legitimately large (the Autopart import cap defaults to 250 MB, and only a signed-in member of staff with permission can use it). Public form fields have their own length limits.

### Someone uploads a malicious file

Product documents must be PDFs within 20 MB, including a check of the file contents, not only the file name. Public pages do not serve a document for a hidden product. File names used on download are reduced to a safe character set. This project did not add a new virus scanner. None is present in the application.

### Someone tries to reach the database

The application talks to PostgreSQL with parameterised queries. A search of the application found one maintenance statement that builds a timeout from a fixed number in the code, not from a visitor. It was not changed, because that maintenance tool is outside this project's allowed business changes, and the value is not taken from the public site.

Whether the database port is open on the internet cannot be seen from the repository. The local developer file `docker-compose.yml` does publish the database on port 5432 with a simple password. That file is for local development. It is not evidence of how production is configured. If the production database is reachable from the internet, that would be serious. It needs a check by whoever runs the server.

### Someone tries to steal the Microsoft connection

The Microsoft feature is off unless the flags are set. Tokens are encrypted with their own key. They are not returned to the browser. Log messages are scrubbed. Each staff member's connection is stored against that person. This project did not turn synchronisation on, and it did not read live tokens.

If the flags are later switched on, the requested Microsoft permissions include the ability to read and write that person's tasks, and optionally their calendar. Mailbox access is explicitly refused in code. A future switch-on should be a separate, deliberate decision.

### Someone tries to delete business records

Deleting a staff user with history is blocked unless ownership is transferred (`docs/authentication-rbac.md`). The last effective Super Admin cannot be removed. Orders and audit rows are kept when a user is removed. This review did not attempt to delete live records.

There is no application feature that lets a customer delete another customer's orders. A person who already has administrator rights can still do damage. That is why new Super Admin assignments now raise a security notice, and why compulsory authenticator codes for those people matter.

---

## D. Cloudflare and server protection

### Confirmed from the repository

- The application sends HTTPS-only cookie flags when it is running as production.
- The application sends a one-year HTTPS header for this host only, not for every subdomain.
- Deployment is described as Coolify and Docker (`docs/deployment-coolify.md`, `Dockerfile`).
- The container runs database migrations and a permission bootstrap on startup.
- Secrets such as `AUTH_SECRET` are expected to be set in Coolify, not committed.
- The local compose file publishes PostgreSQL. That is a developer file.
- No Cloudflare configuration file (no `wrangler.toml`, no saved firewall rules) is in the repository.

### Not confirmed, because nobody opened the live dashboards

Everything in `docs/security/cloudflare-checklist.md` and `docs/security/coolify-infrastructure-checklist.md` that is marked "needs a person with access" is unverified. In particular this review cannot say that any of the following are on:

- Cloudflare proxy (orange cloud)
- Web Application Firewall or managed rules
- Cloudflare rate limiting or bot fights
- DDoS settings beyond what Cloudflare provides by default on a plan this review could not see
- TLS version at the edge
- A rule that hides the server's real address
- A rule that limits the admin area to the office
- Firewall rules on the server
- Whether PostgreSQL or Redis can be reached from the internet
- Whether backups are encrypted, stored off the server, and have ever been restored

Do not treat this report as a statement that those products are configured.

---

## E. Outstanding risks

### Critical

No critical hole was confirmed in the application code at the end of this review.

Two things would be critical **if** a server check finds them. They are not confirmed:

- The production database can be reached from the internet.
- The real server address can be used to bypass Cloudflare, if Cloudflare is supposed to be the only front door.

Those checks are in the infrastructure checklist. They need someone with server access. They should be done before they are assumed to be fine.

### High

| Risk | Business impact |
| --- | --- |
| This pull request is not released | The live site still allows the public account route, can keep a switched-off session for up to five minutes, and does not apply the new sign-in limits. |
| Authenticator codes are not compulsory for Super Admin and Accounts | A stolen staff password is enough to enter the administration area, unless production has already set `MFA_ENFORCE_PRIVILEGED` to true. This review could not see that setting. |
| Cloudflare and the server firewall were not inspected | A large share of attacks against a public website are stopped at the edge, or are not. The business cannot yet show a director that this layer exists. |
| Sign-in limits are inside each running copy of the website | A restart, or more than one copy, weakens the new guessing limit. The edge firewall should carry the durable limit. |
| Backups and restore have not been demonstrated from this repository | If the database were damaged, this review cannot say how quickly, or how completely, it could be recovered. |

### Medium

| Risk | Business impact |
| --- | --- |
| Sessions last seven days | A stolen signed-in browser remains useful for up to a week, unless the account is switched off or the password is reset (after this release). |
| Passwords only have to be 10 characters | A short, common password can still be chosen. Tightening this can lock out real customers, so it was not changed. |
| The content security policy allows inline scripts | If an attacker ever managed to store a script in page content, the browser policy would not block it as strongly as a stricter policy would. No such bug was confirmed. |
| The optional stock-sync secret can be put in the web address | If that optional recovery address is used, the secret can end up in logs. The normal stock import does not need this address. |
| The stock-sync status page is public | It reveals the schedule and whether a secret is configured. It does not reveal customer data. |
| Visitor address headers are only trustworthy if the proxy overwrites them | A forged header can dodge the address-based limit. The per-account limit remains. |
| Audit rows are kept until someone deletes them, and there is no separate audit login | An investigator can use them, but there is no agreed retention period, and anyone with the database can read or delete them. |
| Security emails are not switched on | Until `SECURITY_ALERT_EMAIL` is set, notices exist only in the audit table. Someone has to look. |
| Microsoft synchronisation can be turned on later by environment flags | The code is capable of writing tasks and calendar entries. It is off unless the flags are set. Turning it on is a business decision, not part of this project. |

### Low

| Risk | Business impact |
| --- | --- |
| `/api/build` is public | It shows the software revision. That helps confirm a deployment. It does not show secrets. |
| The developer compose file uses a simple database password | This matters only if that file is what production runs. The Coolify notes describe a separate production database. Confirm that with the person who hosts the site. |
| HTTPS is not forced onto other names in the domain | This was a deliberate choice so that a policy on the main site does not break other hostnames. It should stay a conscious choice. |

---

## F. Independent verification

| Area | Independently tested? |
| --- | --- |
| Application code and the new unit tests | Yes, in this review, on 2 November 2026. |
| TypeScript check and a production build | Yes, in this review. Both completed. |
| Existing Microsoft, permission, and product-document unit tests | Yes, re-run in this review. |
| Full automated suite against a database | No. This environment did not run the database integration suite. |
| Live website at automotivebrands.co.uk | No. No penetration test and no intrusive scan. |
| Production environment variables, including the MFA switch and Microsoft flags | No. |
| Cloudflare dashboard | No. |
| Coolify server, firewall, database exposure, backups | No. |
| A second security firm or an external penetration test | No. This report is an internal code review by the development agent, not an independent certificate. |

---

## G. Directors' action plan

### Do now

1. Read this report and decide who owns the server checks. Suggested roles: a director for the decision, and the person who administers Coolify for the evidence.
2. When you are ready, release this pull request through the normal Coolify process. Do not treat this document as a deployment.
3. After release, ask one staff member to sign in, sign out, and submit a normal callback request, to confirm everyday use still works.
4. Choose a mailbox for security notices that more than one person reads. Set `SECURITY_ALERT_EMAIL` to that single address only after normal site email is known to work. Leave it unset if you want audit rows only.
5. Do **not** set `MFA_ENFORCE_PRIVILEGED=true` until every Super Admin and Accounts user has enrolled an authenticator and stored the recovery codes somewhere the business can reach. If that switch locks people out, set it back to `false` and restart. That is the rollback.
6. Ask the hosting administrator to answer the two checklists. The first answers to get are: is the database reachable from the internet, and is Cloudflare actually in front of the site?

### Within 30 days

1. Enrol Super Admin and Accounts users in authenticator codes, test a recovery code, then turn enforcement on.
2. Work through the Cloudflare checklist with whoever holds that account. Do not change DNS until that person understands the effect.
3. Confirm PostgreSQL and any Redis service are only reachable from the application, not from the public internet.
4. Confirm backups are encrypted, copied off the server, and that a restore has been tried on a spare database. Record the date of the last successful restore.
5. Decide whether staff sessions should be shorter than seven days. That is a behaviour change and was not made here.

### Within 90 days

1. Commission a penetration test against a **copy** of the site, not against the live shop. Give the tester the evidence register so they do not repeat settled checks.
2. Agree how long audit rows and backups are kept, and who is allowed to read them.
3. Review Microsoft 365 only if the business still wants task or calendar synchronisation. Leave the flags off until that decision. This project did not enable them.
4. Revisit password rules only with a plan for customers who would be rejected. Do not surprise the trade desk with a sudden lockout.

---

## Deployment and rollback

**Deploy.** Merge this pull request into `production/phase-1-auth-rbac` only when the business is ready, then use the existing Coolify deployment. There is no database migration. No environment variable is required for the site to start. `SECURITY_ALERT_EMAIL` is optional.

**What staff and customers will notice.**

- Forgotten-password resets sign the person out of other browsers.
- Ten wrong passwords on one account in 15 minutes produces "Too many sign-in attempts. Please wait and try again."
- A burst of public forms produces "Please wait a few minutes before sending another message."
- Everyday ordering, pricing, Autopart import, and Microsoft synchronisation behaviour are unchanged. Microsoft synchronisation is not switched on by this release.

**Rollback.** Revert this pull request and redeploy the previous release.

Reverting turns public self-registration back on, brings back the five-minute session gap, and stops signing other browsers out after a forgotten-password reset. Prefer not to revert the whole change if the only problem is a limit that is too tight. Raise the numbers in `src/server/security/policy.ts` and redeploy that smaller change instead.

If authenticator enforcement is turned on later and a Super Admin is locked out: set `MFA_ENFORCE_PRIVILEGED=false`, redeploy or restart, and use the existing administrator password reset, which already deletes sessions. Do not email authenticator secrets.

**Stop.** This work does not merge or deploy itself.
