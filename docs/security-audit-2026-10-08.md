# Security audit — 8 October 2026

Review branch: `cursor/security-audit-hardening-a052`

Starting production SHA: `47a48a8266abf8523a40e1ea0db9aebf2e533e28`

Scope: authentication, RBAC, customer isolation, Autopart history, uploads, API and database access, trade pricing, and dependencies. No production customer, stock, invoice, or ledger rows were changed. No Autopart import was run. No customer account was activated. No credentials were rotated or printed.

## Findings

### Critical

No confirmed application defect allowed an anonymous or cross-company caller to read another company's orders, prices, or Autopart history.

`bun audit` reports one critical advisory in a runtime dependency:

- `seroval` `1.5.6` (via TanStack Router): GHSA-p6vx-979v-rg4c. Reachability through this app's server functions was not proven. Upgrading it means moving the TanStack packages and retesting the whole app, so it is not included here.

### High — fixed

1. **Session cookie cache skipped revocation.** Better Auth `cookieCache` returned a signed session for up to five minutes without reading `authSession`. Logout and session deletion therefore did not take effect immediately. The cache is now disabled, so `getSession` reads the database. Disabled users were already rejected by `loadAccessProfile` on guarded calls.
2. **Spreadsheet formula injection on staff exports.** Reconciliation, backorder, price-list, and FBA CSV writers quoted commas but did not neutralise a leading `=`, `+`, `-`, `@`, tab, or carriage return. Imported descriptions and references are untrusted. Those cells are now prefixed with an apostrophe. Plain signed numbers such as `-12.50` stay numeric.
3. **Ledger amounts on the document-match reader.** `listAutopartDocumentMatches` returned `ledgerGoods` and `ledgerCount` to anyone with `autopart.history.view`. Sales Representative and Sales Manager have history access and do not have `autopart.ledger.view`. The reconciliation list already hid those fields. The document-match reader now does the same. The reconciliation CSV already omitted ledger columns for sales; that behaviour is covered by a test.

### High — not changed

- `sharp` `0.35.4` (GHSA-wq5f-xc86-pv6w) and other runtime advisories from `bun audit` (18 total: 1 critical, 14 high, 3 moderate). Several are build-tool or dev-tool paths (`eslint`, Vite, PostCSS). A blanket `bun audit fix` can cross major versions, including Prisma, which this project must stay on 6.19.x. Treat upgrades as a separate staging change.

### Medium — fixed

- Autopart list pages are clamped to 1–10,000 so a huge `page` cannot build an unbounded `OFFSET`.
- Autopart uploads reject empty bodies, path separators, `..`, NUL bytes, and PE, ELF, ZIP, and gzip headers. At most two uploads write at once. A rejected write waits for the file handle to close before deleting the temp file. Files stay under the private import directory.
- Cancelling a batch deletes the stored file only when the path is inside that directory.
- Server-function errors no longer return Prisma or other multiline driver messages to the browser.

### Medium — remaining

- Content-Security-Policy still allows `'unsafe-inline'` for scripts and styles. That matches the current TanStack/Vite output.
- `POST /api/internal/stock-sync` accepts the cron secret in the query string as well as a header. Query secrets can be written to access logs. Changing that requires a Coolify caller change.
- Better Auth rate limits are in-process. More than one app replica does not share the login counter.
- An authorised importer can still store repeated files up to the 250 MB cap. Commit and cancel remove the private file. There is no separate disk quota.
- `MFA_ENFORCE_PRIVILEGED` stays opt-in. Privileged staff are not forced onto TOTP until that flag is set.
- Short application errors such as “Brand is required” are still returned. They are not driver output.

### Low

- `GET /api/internal/stock-sync` returns whether a feed and cron secret are configured. It does not return the secret, host, or password.
- Stock-overview CSV already neutralises formula text, including a leading minus, so negative costs there remain text. That writer was left as it was.
- Order export already uses `csvEscapeFormulaSafe`.

## Controls reviewed and left in place

- HttpOnly cookies, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`.
- CSRF middleware on server functions, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, and HSTS in production.
- Sign-in, forgot-password, and reset-password rate limits. Password length 10–128. Reset messages do not store the reset URL.
- Deactivate and disable delete `authSession` rows. A disabled user fails `requireAuthenticatedUser` even if a session row is still present. Role checks load permissions from the database on each guarded call.
- Trade portal orders are loaded with `companyId` from the membership, not from the client. `getPortalOrder` for another company's id is already rejected in `orders.integration.test.ts`.
- Checkout recalculates the unit price on the server. A client `customerUnitPrice` can only mark the line `PRICE_UPDATED`. It does not set the stored price. Anonymous catalogue display sets `trade` to null.
- Import does not create users, does not set `portalEligible`, and does not set `historicalAccessEnabled`.
- Portal history requires `AUTOPART_PORTAL_HISTORY_ENABLED=true`, an active membership, `historicalAccessEnabled`, and classification `TRADE_CANDIDATE`. Turning the flag on does not show another company's lines, and revoke is visible on the next read.
- Sales roles do not include `autopart.ledger.view`. Sales Representative does not include `autopart.import.manage`.
- Production queries use Prisma. `$queryRawUnsafe` appears only in a test.

## Coolify

No new environment variable and no migration. Leave `AUTOPART_PORTAL_HISTORY_ENABLED` unset or `false` until each account has been granted historical access. Keep `AUTH_SECRET` as a strong production secret. Do not put private values in `VITE_*`.

## Tests

Focused additions:

- `src/domain/csv-formula.test.ts`
- `src/server/security/access-control.integration.test.ts`
- `src/infra/auth/auth.security.test.ts` (database session lookup)

`bunx tsc --noEmit` passed. `bun run build` passed. The new security tests, the Autopart master import integration test, order isolation, and the formula-export unit tests passed.
