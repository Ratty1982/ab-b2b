# Coolify and server checklist

**Date:** 2 November 2026 (Europe/London)
**Scope:** what the repository proves, and what requires a login to the production server.

No production server was accessed. No secret values were printed. No destructive command was run.

The deployment notes are `docs/deployment-coolify.md` and `Dockerfile`. The container installs dependencies, builds the site, then on startup waits for PostgreSQL, runs migrations, bootstraps permissions, and starts the server.

## Confirmed from the repository

| Item | Evidence | Limit of that evidence |
| --- | --- | --- |
| Production is expected to run as Docker under Coolify | `Dockerfile`, `docs/deployment-coolify.md` | Does not prove the live service is healthy |
| `NODE_ENV`, `APP_URL`, `DATABASE_URL`, and `AUTH_SECRET` are required | `docs/deployment-coolify.md`, `src/server/env.ts` | Live values were not read. `AUTH_SECRET` must not be the repository default; the process refuses to start in production if it is |
| SMTP is configured in the admin screen, not as Coolify `SMTP_*` variables | `docs/deployment-coolify.md` | Whether mail works in production was not tested |
| The image does not copy the whole developer toolchain into the running container | `Dockerfile` comments and runner stage | Image contents on the server were not listed |
| A local developer compose file publishes PostgreSQL on port 5432 with user `ab` and password `ab` | `docker-compose.yml` | This is local development. It must not be assumed to be production |
| Redis is an optional environment variable only | `REDIS_URL` in `src/server/env.ts` | No Redis service is defined in the compose file. Production may still have one |
| Microsoft and MFA switches default off when unset | `src/domain/mfa-policy.ts`, `src/domain/microsoft-365-crm.ts` | The live values were not read |
| Security notice email is optional | `SECURITY_ALERT_EMAIL` read only when sending a notice | Unset means no email. The site still runs |

## Needs a person with server access

Record the date and the person. Do not copy secret values into git, tickets, or email.

| Check | What to look for | Why it matters |
| --- | --- | --- |
| Operating system patches | The host has a patching routine and a date of last update | An old host is a way around the application |
| SSH | Password login off, root login off, keys held by named people | A shared password cannot be revoked when someone leaves |
| Host firewall | Only the web ports needed by the proxy are public. PostgreSQL (5432) and Redis (6379) are not | A public database is a direct copy of customers, prices, and passwords |
| Coolify admin | Named administrator accounts, not one shared login. The Coolify port is not open to the whole internet | Coolify can read environment variables and redeploy the site |
| Container isolation | The application container is not running as a privileged container and does not mount the Docker socket | A web bug should not become control of the host |
| PostgreSQL exposure | From a network that is not the server, port 5432 does not connect | Confirms the firewall row |
| Redis exposure | If Redis exists, it has a password and is not public | Sessions are in PostgreSQL, but a public Redis can still be abused if it is introduced later |
| Secrets | `AUTH_SECRET`, `DATABASE_URL`, `MICROSOFT_365_ENCRYPTION_KEY`, and Microsoft client secrets live in Coolify secrets. `INITIAL_ADMIN_PASSWORD` has been removed after the first admin was created | Secrets in a ticket or a git file are already leaked |
| Production environment | `APP_URL` is `https://automotivebrands.co.uk`. `ALLOW_PRODUCTION_SEED` is not set | The seed command creates sample users |
| TLS | The public site responds only over HTTPS. The certificate is current | Matches the cookie and header settings in the application |
| Backup encryption | Backup files are encrypted, and the key is not stored only on the same disk | A stolen disk should not be a readable database |
| Off-server backups | At least one copy is not on the same machine | One fire or one disk should not end the business |
| Restore test | A backup has been restored into an empty database and a sign-in tried. Record the date | An untested backup is a hope, not a plan |
| Disaster recovery | Someone named can rebuild Coolify, the database, and DNS. The steps are written down outside this repository | The application repository is not a recovery plan |
| Monitoring | Someone is told if the site or the database stops | Otherwise the trade desk finds out from a customer |
| Server access logs | SSH and Coolify access are retained and reviewed after an incident | Needed to see whether the host itself was entered |
| Audit log access | Only administrators can read `AuditEvent`. There is no application screen that was confirmed as a complete audit console in this review | The table is the investigation record. It has no automatic expiry in code |
| Optional stock secret | If `POST /api/internal/stock-sync` is used, the secret is sent as a header (`x-autopart-cron-secret` or `Authorization: Bearer`), not in the web address | Addresses are copied into logs |

## Incident investigation, from what the application can support

1. Note the time in Europe/London and what the user saw.
2. In the database, read `AuditEvent` for that time. Useful actions include `LOGIN_FAILED`, `LOGIN_SUCCESS`, `LOGIN_MFA_FAILED`, `PASSWORD_RESET_REQUESTED`, `SECURITY_ALERT`, `CUSTOMER_DATA_EXPORTED`, `ROLE_ASSIGNED`, `USER_CREATED`, `USER_REACTIVATED`, `USER_DEACTIVATED`, and `USER_PERMISSIONS_UPDATED`.
3. Do not expect the row to contain a password, a Microsoft token, or a reset link. Failed sign-in rows store an email domain and a one-way account key, not the full email address.
4. Security notices are also written as `SECURITY_ALERT`. The same event is not written again inside the cooldown (one hour, or six hours for export bursts).
5. If `SECURITY_ALERT_EMAIL` is set and mail is working, one message is sent. The message is a summary only.
6. To remove access: disable the user in staff administration. That deletes session rows. After this pull request is deployed, the next request must sign in again.
7. To rotate Microsoft access: follow the existing revocation steps in `docs/security.md` section O. Do not paste tokens into a ticket.
8. Retention: the application does not delete old `AuditEvent` rows. Agree a retention period with the directors and apply it as an operational job. Until then, assume the rows last as long as the database and its backups.
9. Who can read logs: whoever can open the database or the Coolify log view. Restrict those accounts. This repository cannot show the current list of people.

## Do not do from this checklist

Do not restart production, drop a database, open a firewall, or print environment variables in order to "complete" a row.
