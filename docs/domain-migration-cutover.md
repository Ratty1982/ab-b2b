# Domain cutover — b2b.automotivebrands.co.uk to automotivebrands.co.uk

Preparation only. This document does not change DNS, Coolify, environment variables, or data. Production at the time of writing is commit `9be25996` on `production/phase-1-auth-rbac`, confirmed by `https://b2b.automotivebrands.co.uk/api/build`.

The same Coolify application, the same `DATABASE_URL`, and the same `/data/autopart-imports` volume stay in place. Do not create a second service, a new database, or a copy of customer data. Do not run a seed. Do not set `ALLOW_PRODUCTION_SEED` or `INITIAL_ADMIN_PASSWORD`.

## What this change already does

- Production HSTS is `max-age=31536000` for the responding host only. It does not send `includeSubDomains` or `preload`.
- `APP_URL` is the origin for Better Auth, password resets, invitations, order and quote links, survey links, email logos, and the email signature. Cookies stay host-only. There is no `Domain` attribute and no cross-subdomain cookie.
- `www.{APP_URL host}` 301s (308 for non-GET) to the `APP_URL` origin, keeping path and query.
- `/our-story` and `/our-story/` 301 to `/why-automotive-brands`, keeping the query string.
- `/sample-page` 301s to `/`.
- Trailing-slash WordPress URLs for `/brands`, `/customer-survey`, `/free-prize-draw-terms-conditions`, and `/us-incorporation-documents` 301 to the slashless path.
- `/wp-login.php`, `/wp-admin`, `/wp-json`, `/wp-content`, `/xmlrpc.php`, `/feed`, and `/author` return 410. `/wp-login.php` is not sent to `/login`.
- GET and HEAD pages on `b2b.{APP_URL host}` return a temporary 302 to the same path and query on the `APP_URL` origin. `/api` (including auth callbacks, webhooks, and `/api/internal/stock-sync`), other methods, and static files stay on the request host. Set `B2B_LEGACY_REDIRECT=off` to remove that redirect. See [Temporary b2b redirect](#temporary-b2b-redirect).
- The three PDFs from the WordPress incorporation page are served at `/us-incorporation-documents`.
- Indexable public pages emit an absolute canonical and `og:url` from the `APP_URL` origin. Staff, portal, and API paths do not.

## Blocker — privacy policy

No approved privacy policy exists in the repository or the CMS seeds. `docs/trade-onboarding.md` already records that legal pages are unpublished. `https://automotivebrands.co.uk/privacy-policy` is a 404 on the current WordPress site as well.

The prize-draw terms link to `/privacy-policy`. That route is intentionally not implemented. Legal must supply the approved text before launch. Do not invent it.

## Blocker — WordPress backup

This repository does not contain a backup of the SiteGround WordPress site. Treat that site as the only copy until an operator proves otherwise. The incorporation PDFs in `public/company-documents/` are a copy of the three public files only. They are not a site backup.

## Verified preflight

Do all of these before any DNS edit.

1. Export the full SiteGround DNS zone. Confirm the export includes every A, AAAA, CNAME, MX, TXT, and SRV record.
2. Back up WordPress files, especially `wp-content/uploads`, and the WordPress database. Restore that database onto a non-production server and open the three incorporation PDFs from the file backup.
3. Take a Coolify Postgres backup and restore it onto a different database. Confirm a customer, an order, and a price are present. Do not restore over production.
4. Confirm the Coolify volume is mounted at `/data/autopart-imports` on this same application. A marker file must survive a container replacement. Historical ALL files are not inside the database backup.
5. In Admin → Settings → Email, note the SMTP host, port, From, and reply-to. Do not copy the password into a ticket. Outbound mail uses that stored SMTP account. SPF already authorises Microsoft 365 and the SiteGround smart host. DMARC policy is `p=reject`.
6. Record the live `/api/build` SHA and the current A records: apex and www `35.214.96.205`, b2b `82.180.154.141`.
7. Deploy this branch to the existing b2b service first, while the apex still points at WordPress. Confirm `/api/build` and that the HSTS header on b2b has no `includeSubDomains`.
8. Confirm one replica. Do not deploy during a customer-sales import, or in the minutes after 09:15, 12:15, 13:15, 15:15, or 18:15 Europe/London. Stock imports are due at 09:15, 12:15, 15:15, and 18:15 every day. Ongoing sales polling, when enabled, is 13:15 and 18:15 on working days.

## DNS records that must stay as they are

Change only the apex and www A records, and only at cutover. Nameservers stay `ns1.siteground.net` and `ns2.siteground.net`.

| Record | Leave it |
| --- | --- |
| MX | Microsoft 365 (`automotivebrands-co-uk.mail.protection.outlook.com`) |
| TXT SPF | Outlook plus the SiteGround smart host, `-all` |
| TXT DMARC | `p=reject` |
| autodiscover | Microsoft 365 |
| A `mail` | `35.214.96.205` |
| A `ftp` | `35.214.96.205` |

Do not add an AAAA record unless Coolify is serving IPv6. Do not point `mail` or `ftp` at the Coolify address just because they share the website IP today.

## Coolify

On the existing application:

1. Keep the current database, volume, and replica count.
2. Add domains `automotivebrands.co.uk` and `www.automotivebrands.co.uk` beside `b2b.automotivebrands.co.uk`. Do not remove b2b.
3. Issue the certificate for the apex and www on this proxy. The SiteGround certificate does not move.
4. Confirm the proxy does not add its own HSTS policy. The application header is the one that must be visible, and it must not contain `includeSubDomains`.
5. Leave `APP_URL` as `https://b2b.automotivebrands.co.uk` until the moment of cutover described below.
6. No Coolify scheduled task is required for Autopart. The in-process scheduler stays on.

## APP_URL

At cutover, on the same service:

```text
APP_URL=https://automotivebrands.co.uk
```

No trailing slash. Restart the process. `APP_URL` is read when the process starts. Better Auth, reset links, invitations, and new order mail then use the apex. Cookies remain host-only, so existing b2b sessions are not sent to the apex. Customers sign in again. That is expected.

Do not set a cookie `Domain` of `.automotivebrands.co.uk`. That would send the trade session to a future virtual-warehouse site on b2b.

## DNS cutover

1. At least a day ahead, lower the TTL on the apex and www A records to 300 seconds.
2. Complete the preflight list, including the WordPress backup.
3. Deploy the prepared release on b2b and confirm it healthy.
4. Change only these records to the Coolify address (`82.180.154.141` at the time of the audit):
   - `automotivebrands.co.uk` A
   - `www.automotivebrands.co.uk` A
5. Wait for the proxy to obtain the apex and www certificates. HTTP on the new host must 301 to HTTPS.
6. The application 301s `www` to the apex. It does not 301 the b2b host.

## SSL verification

```bash
curl -sI https://automotivebrands.co.uk/ | grep -i strict-transport
curl -sI https://www.automotivebrands.co.uk/ | grep -i -E 'HTTP/|location:|strict-transport'
curl -sI https://b2b.automotivebrands.co.uk/ | grep -i strict-transport
```

Expect `strict-transport-security: max-age=31536000` and no `includeSubDomains`. Expect www `location` to be the apex. The certificate names must cover the apex and www.

### Browsers that already cached HSTS

Responses from b2b before this change included `includeSubDomains`. That cached policy applies to `b2b.automotivebrands.co.uk` and names under it. It does not apply to the parent apex, `mail`, or `ftp`. After this release, the next visit to b2b replaces that host's stored policy with the host-only header. Browsers that never come back keep the old b2b policy until it expires, up to a year from their last visit. That still does not cover the apex.

The first HTTPS response from the apex must already be the host-only policy. Do not submit the apex to the HSTS preload list.

## Customer login and order smoke tests

On the apex, after DNS:

1. Open `/`, `/brands`, `/products`, `/contact`, `/register`, `/customer-survey`, `/why-automotive-brands`, and `/us-incorporation-documents`. Download each of the three PDFs.
2. Open `/our-story/` and confirm a 301 to `/why-automotive-brands`.
3. Open `/wp-login.php` and confirm 410 with no redirect to `/login`.
4. Sign in a trade account at `/login`. Open an existing order. Prices and lines must match the pre-cutover order.
5. Sign in a staff account. Open the same customer in admin. Do not place a test order unless the business has agreed to it.
6. From b2b, open `/portal` and `/api/build`. They must still be this application. b2b must not 301 to the apex.

## Autopart scheduler verification

After the restart, Coolify logs should show the stock scheduler started. Do not trigger a manual import as part of the cutover. At the next London window outside the deploy, confirm a scheduled run is recorded in admin and that stock quantities moved only because of that feed. Ongoing sales polling stays at its existing enabled flag. A failed or skipped window is an incident. It is not a reason to reseed or to start a second replica.

## Email delivery tests

1. Admin → Settings → Email, send the diagnostic template to an internal mailbox.
2. Confirm the message arrives, the logo URL is on `https://automotivebrands.co.uk`, and the From address is unchanged.
3. Do not send a customer password reset or invitation until that test succeeds. A reset link issued after the `APP_URL` change points at the apex.
4. Confirm an external message still arrives at a Microsoft 365 mailbox. MX, SPF, and DMARC must be unchanged.

## Rollback

1. Set `APP_URL` back to `https://b2b.automotivebrands.co.uk` and restart the same container.
2. Point the apex and www A records back to `35.214.96.205`.
3. Do not restore the database over production. Orders and accounts created during the window stay in the same database and remain usable on b2b.
4. Do not detach `/data/autopart-imports`.
5. Password resets and invitations sent while `APP_URL` was the apex will open WordPress again after this rollback. Reissue those links. Freeze resets and invitations across the window if a rollback is likely.
6. Sessions started on the apex are not valid on b2b. People sign in again.

## Temporary b2b redirect

The production application answers on `https://automotivebrands.co.uk`. `APP_URL` must remain that origin. While `b2b.automotivebrands.co.uk` still reaches this same application, ordinary page navigations on that old hostname are sent to the apex.

- Method is GET or HEAD, and the path is a normal public, customer, or staff page: HTTP 302 to `https://automotivebrands.co.uk` plus the same path and query string. This is temporary. It is not a 301.
- `/our-story` on b2b goes to `https://automotivebrands.co.uk/why-automotive-brands` in that same response. On the apex, `/our-story` stays a 301.
- `/wp-login.php` and the other WordPress paths that are gone still return 410. They are not sent to `/login`.
- Never redirected: `/api` and `/api/*` (auth callbacks, webhooks, stock sync, imports, media, `/api/build`), any method other than GET or HEAD, and static or machine-readable resources (`/assets/`, `/brand/`, `/company-documents/`, `/favicon.png`, `/robots.txt`, and paths with a static file extension).
- The request host is compared with the hostname of `APP_URL`. A request that is already on that hostname is not redirected, so the rule cannot loop. If `APP_URL` itself is the b2b host, the redirect does not run.
- Session cookies stay host-only. This redirect does not set a `Domain` attribute.

The redirect is on when `B2B_LEGACY_REDIRECT` is unset. `off`, `false`, `0`, and `no` disable it. Any other value leaves it on. Restart the process after changing it.

## Releasing b2b for the Virtual Warehouse

Do this before `b2b.automotivebrands.co.uk` is assigned to the Virtual Warehouse Portal. Do not change DNS or Coolify domains from the application repository.

1. On this application, set `B2B_LEGACY_REDIRECT=off` and restart the same container. `APP_URL` stays `https://automotivebrands.co.uk`.
2. While this app still answers the b2b host, confirm `GET https://b2b.automotivebrands.co.uk/` and `GET https://b2b.automotivebrands.co.uk/login` are no longer 302 responses. Confirm `GET https://automotivebrands.co.uk/` is unchanged.
3. Move any external caller of `/api/internal/stock-sync` or other `/api` routes to the apex before the b2b host stops reaching this app. The in-process Autopart scheduler does not call that URL. Do not change import, order, or stock behaviour as part of turning the redirect off.
4. Keep cookies host-only. Do not add a `Domain` attribute. The warehouse must not receive the trade session.
5. Remove `b2b.automotivebrands.co.uk` from this Coolify service only when the warehouse is ready to own that hostname. After that, the flag on this app no longer affects the hostname.

With the flag off, the www redirect and the explicit WordPress path rules still apply. There is no permanent blanket redirect from the b2b host.
