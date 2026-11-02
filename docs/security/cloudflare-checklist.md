# Cloudflare checklist

**Date:** 2 November 2026 (Europe/London)
**Scope:** what the repository can and cannot say about Cloudflare in front of https://automotivebrands.co.uk

No Cloudflare API token, dashboard, or DNS export was available. **Nothing in this file is claimed to be switched on.** A tick below means "a person with the Cloudflare account should confirm this", not "this review saw it enabled".

The application does not contain a `wrangler.toml` or saved firewall rules.

## How to use this list

For each row, record the date, the person, and a screenshot or export kept **outside** this git repository. Do not paste API tokens or firewall secrets into git.

| Item | What good looks like | What this review could see | Status |
| --- | --- | --- | --- |
| DNS proxying | The public names for the website show Cloudflare's proxy, not the raw server address | No DNS zone file in the repository | Needs a person with access |
| Web Application Firewall | A WAF is attached to the zone | No WAF configuration in the repository | Needs a person with access |
| Managed rules | Cloudflare's maintained rule set is on, in block or challenge mode for obvious attacks | Not in the repository | Needs a person with access |
| Login rate limiting | A rule limits `POST` attempts to the sign-in paths, separate from the application's own limit | The application now limits its own sign-in function. That is not a Cloudflare rule | Needs a person with access |
| Bot protection | Bot Fight Mode or Super Bot Fight Mode is on for anonymous traffic | Not in the repository | Needs a person with access |
| Challenge rules | A challenge can be shown to suspicious visitors without blocking the trade desk's normal browsers | Not in the repository | Needs a person with access |
| DDoS protection | The zone uses Cloudflare's network. The plan level decides how much is included | Not visible from code | Needs a person with access |
| TLS | Visitors are offered TLS 1.2 or newer. The old "flexible" SSL mode is not used, because it can talk to the server unencrypted | The application can send an HTTPS-only cookie and an HTTPS header when `NODE_ENV` is production (`src/start.ts`). The edge certificate was not inspected | Needs a person with access |
| Origin address | The server's real address is not the public DNS answer. The server firewall accepts web traffic from Cloudflare's addresses only | Not visible from code | Needs a person with access |
| Admin paths | Optional: `/admin`, `/crm`, and `/sales` can be challenged or limited to known locations if the business wants that. Staff who travel must still be able to work | Routes exist in the application. No edge rule is stored here | Needs a person with access |
| Exceptions | Do not challenge or block `/api/auth`, `/api/microsoft-365/callback`, or a genuine webhook. The optional `POST /api/internal/stock-sync` must keep working if it is in use. The in-application stock scheduler does not need that address (`docs/autopart-stock-sync.md`) | Paths confirmed in code. No Cloudflare exception list exists here | Needs a person with access |
| Logs | Cloudflare security events are retained and someone knows where to read them | Not visible from code | Needs a person with access |

## Do not do automatically

Do not change DNS, the orange-cloud proxy, or firewall rules from a code change. A wrong DNS edit takes the public site offline.
