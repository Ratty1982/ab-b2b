# Microsoft 365 CRM connection

This release connects a salesperson's own Microsoft 365 work account. It does not synchronise tasks or create calendar events. Both stay off until a later release and an operator turns the integration on.

The CRM `Task` record remains the authority for customer, opportunity, assignment, and permissions. Microsoft To Do is not a second task system.

## What already exists

- `Task` is the only CRM task. Sales Intelligence follow-ups, activity follow-ups, and callback requests all create that row. Status is `OPEN`, `IN_PROGRESS`, `DONE`, or `CANCELLED`. Priority is `LOW`, `NORMAL`, or `HIGH`.
- Creating a task requires `tasks.manage` or permission to log CRM activity, plus access to the customer. Completing and rescheduling require `tasks.manage`. A salesperson without manage-all access can open a task only when they are the assignee or creator.
- There is no Microsoft To Do or Outlook calendar code on the production branch. The existing Graph client is application-only and read-only, used for Safety Data Sheet files. It must stay that way.
- Schedulers already run inside this process for stock and sales feeds. This change does not start another scheduler.
- Staff sessions are host-only Better Auth cookies. Trade users are not CRM users.

## This schema

Additive tables, all empty until someone connects an account:

| Table | Purpose |
| --- | --- |
| `MicrosoftAccountConnection` | One row per CRM user. Encrypted access and refresh tokens. Microsoft tenant id and object id. Per-user task and calendar switches, default off. |
| `MicrosoftOAuthTransaction` | Single-use PKCE state. Stores a hash of `state` and an encrypted code verifier. |
| `MicrosoftTaskMapping` | Future CRM task to Microsoft To Do task link. Unique per user and task, and unique per Microsoft task. |
| `MicrosoftSyncCursor` | Future delta link, encrypted. |
| `MicrosoftSyncJob` | Future leased job row. No worker reads it yet. |
| `MicrosoftSyncEvent` | Connection audit. Messages are scrubbed of tokens. |
| `MicrosoftCalendarMapping` | Future optional Outlook event. Not created automatically. |

`activeIdentityKey` is set only while the connection is `CONNECTED`. That stops two CRM users from holding the same Microsoft account. Disconnect clears the key and the tokens.

No existing task, order, price, or stock row is rewritten.

## Entra application

Register a new single-tenant app. Do not reuse the SDS app **Automotive Brands B2B**, and do not add task or calendar permissions to it.

1. Entra ID → App registrations → New registration.
2. Supported account types: this organisational directory only.
3. Redirect URI (Web): `https://automotivebrands.co.uk/api/microsoft-365/callback`
4. Certificates & secrets → New client secret. Store it in Coolify as `MICROSOFT_365_CLIENT_SECRET`. Do not commit it and do not paste it into the database.
5. API permissions → Microsoft Graph → Delegated:
   - `openid`
   - `profile`
   - `offline_access`
   - `User.Read`
   - `Tasks.ReadWrite`
   - `Calendars.ReadWrite` only if staff will be allowed to add Outlook appointments later
6. Do not grant `Mail.Read`, `Mail.Send`, `Tasks.ReadWrite.All`, or any application permission.
7. Grant admin consent for the delegated permissions above if staff should not each see a consent screen for the base scopes. Calendar consent is still requested only when a user opts in.

The tenant id and client id are the GUID values on the app registration overview. They are not secrets, but they are still environment variables, not source code.

## Environment

Leave the flag unset or `false` until the app registration exists and a pilot is approved.

```
MICROSOFT_365_CRM_ENABLED=false
MICROSOFT_365_TENANT_ID=
MICROSOFT_365_CLIENT_ID=
MICROSOFT_365_CLIENT_SECRET=
MICROSOFT_365_REDIRECT_URI=
MICROSOFT_365_ENCRYPTION_KEY=
```

`MICROSOFT_365_REDIRECT_URI` is optional. When unset, the app uses `{APP_URL}/api/microsoft-365/callback`. A value on any other origin or path is rejected. `APP_URL` stays `https://automotivebrands.co.uk`.

The flag accepts only `true`, `1`, `on`, or `yes`. Anything else, including an empty value, keeps the integration off. While it is off, connect, token refresh, and Microsoft API calls do not run. Restart the process after changing it.

`MICROSOFT_365_ENCRYPTION_KEY` is required before the integration can be considered configured. Generate it with `openssl rand -base64 48` and keep it at least 32 characters. New access tokens, refresh tokens, and PKCE verifiers are AES-256-GCM ciphertext prefixed `v2:`, keyed from this value. It is separate from `AUTH_SECRET`, so rotating the session secret does not invalidate Microsoft connections. Rotating `MICROSOFT_365_ENCRYPTION_KEY` does. Ciphertext written as `v1:` by the shared secret helper can still be read with `AUTH_SECRET`. The gate stays not configured when this key is missing or shorter than 32 characters.

The callback accepts an ID token only from Microsoft's token endpoint, and only after an RS256 signature check against the tenant's signing keys. The issuer, tenant id, audience (this app's client id), expiry, and the nonce stored with the OAuth transaction must all match. Unsigned tokens and tokens whose claims were altered are rejected. A token response that includes mailbox or tenant-wide task scopes is not stored.

## Staff behaviour

CRM → Microsoft 365, for internal users with `tasks.view`. Connecting requires `tasks.manage`, `crm.activities.create`, `crm.manage`, or `admin.access`.

- Connect Microsoft 365 starts the authorisation-code flow with PKCE. The browser returns to the fixed callback. It is not an open redirect.
- The page shows the Microsoft display name, email, and connection status. It does not show tokens.
- Task and calendar switches are saved only. They do not export tasks or create events in this release.
- Outlook Calendar permission is requested only when the user opts in.
- Disconnect deletes the stored tokens and marks the row revoked. It does not sign the user out of Microsoft 365.
- Administrators with `admin.access` or `crm.manage` see connection health: staff email, Microsoft email, status, flags, and the last error. Task titles and descriptions are not included.

## Not in this release

- Creating or updating Microsoft To Do tasks
- Delta sync, conflict handling, or reassignment sync
- Outlook appointments
- A bulk export of existing tasks
- A second background scheduler
- Changes to DNS, Coolify domains, Autopart, orders, invoices, or pricing

Do not set `MICROSOFT_365_CRM_ENABLED=true` until the Entra app is registered and a named pilot group is agreed. Connecting an account still does not copy CRM tasks.
