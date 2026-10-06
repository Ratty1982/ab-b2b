# Automotive Brands B2B — Security Overview

Suitable for internal engineering and external IT/security review (Maximum Networks).

**Document reflects controls that are actually implemented.** Where a control is optional or pending cutover, that is stated explicitly.

---

## A. Architecture overview

```
Browser (staff / trade)
  ↓ HTTPS
Automotive Brands B2B (TanStack Start)
  ↓ server-side session (HttpOnly cookies) + RBAC
  ↓ client-credentials (app-only)
Microsoft Graph
  ↓ READ ONLY (list/download PDF)
Authorised SDS resource (configured driveId + folderItemId)
```

There is **no** browser → Graph path. The browser never supplies arbitrary Graph URLs.

---

## B. Authentication

| Control | Status |
| --- | --- |
| Better Auth + PostgreSQL sessions | Implemented |
| HttpOnly cookies | Implemented |
| Secure cookies in production | Implemented |
| SameSite=Lax | Implemented |
| AUTH_SECRET (min 32 chars; prod rejects default) | Implemented |
| Rate limits (sign-in / forgot / reset) | Implemented |
| Disabled-user blocked at session create + profile load | Implemented |
| Session wipe on deactivate / disable / admin password reset | Implemented |
| Password reset tokens never audited | Implemented |
| Safe return URLs (`safeReturnPath`) | Implemented |
| CSRF middleware on server functions | Implemented (`src/start.ts`) |

---

## C. RBAC

- Server-side permission checks are authoritative; UI hiding is not security.
- New permission: `integrations.sharepoint.manage` — Microsoft Graph credentials, source resolve, enable/disable, connection test.
- Granted to: **SUPER_ADMIN** (all) and **MANAGEMENT**.
- Ordinary SDS document upload/replace/scan confirm continues to use `products.edit` (non-trade).
- Viewing SharePoint settings status uses `products.view` (non-trade).
- Trade users cannot access document admin or SharePoint integration APIs.

---

## D. Microsoft Graph integration

**Purpose:** Read product Safety Data Sheet PDFs from one authorised Microsoft 365 folder.

**Auth:** Application-only (client credentials).

**Client surface** (`createMicrosoftGraphClient`): read-only methods only — get drive/item, list children, download content. No write/update/delete. No generic Graph proxy.

**Hosts:** Token host `login.microsoftonline.com`; API host `graph.microsoft.com` only (including `@odata.nextLink` validation).

**App-side allowlist:** Every scan/download validates against persisted `tenantId` / `driveId` / `folderItemId`. Scan sessions that do not match the authorised folder are rejected.

---

## E. Exact Microsoft permission requested

| Item | Value |
| --- | --- |
| **Recommended application permission** | `Files.SelectedOperations.Selected` |
| **Resource role on the SDS folder** | `read` |
| **Legacy (do not newly consent)** | `Files.Read.All` |

Consent alone grants **zero** access. An explicit folder-level resource grant is required.

---

## F. Exact resource scope

Production SDS source (current operations):

- Operator mailbox / OneDrive: `george.parker@automotivebrands.co.uk`
- Configured Power Maxed SDS folder (stable Graph `driveId` + `folderItemId` after resolve)
- Entra app registration: **Automotive Brands B2B**

The B2B app must only list and download PDFs in that folder.

---

## G. Why Files.Read.All is not required

`Files.Read.All` grants tenant-wide read of files. Selected permissions (`Files.SelectedOperations.Selected`) plus a folder `read` grant restrict the app to the authorised driveItem (folder) and its files — matching least privilege.

---

## H. Credential storage

| Source | Policy |
| --- | --- |
| `MICROSOFT_GRAPH_TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` | **Preferred for production** (Coolify secrets) |
| Encrypted DB fallback (`clientSecretEncrypted`) | Allowed for development; env wins when present |
| API/UI responses | `hasClientSecret` / `secretFromEnv` only — never the secret |
| Audit / logs / errors | Never include secret or tokens |

---

## I. SDS ingestion controls

**Supported production workflow is manual / bulk manual upload** (`/admin/products/documents-import`). SharePoint Graph scan is implemented but disabled unless `SHAREPOINT_SDS_ENABLED=true`.

1. Local bulk: DROP/CHOOSE → VALIDATE → MATCH/REVIEW → HUMAN CONFIRM → IMPORT (never auto-assign ambiguous files)
2. PDF only: extension, declared MIME allowlist, `%PDF-` magic bytes, max 20 MB, non-empty
3. Max files per manual bulk: `BULK_SDS_MAX_FILES` (100). SharePoint scan cap remains `SHAREPOINT_SDS_MAX_FILES` (500) when re-enabled
4. Filename sanitisation (no path traversal)
5. Checksum / deduplication retained (same product + current checksum → skip)
6. Resource allowlist on SharePoint download (when enabled)

`SHAREPOINT_SDS_ENABLED` defaults off. Stored Graph settings and secrets are not deleted when disabled.

---

## J. Audit logging

Security-relevant actions include (non-exhaustive):

- SharePoint settings updated / credential configured / integration enabled|disabled
- Folder resolved / connection tested (ok/fail)
- Scan started (and scan failed)
- SDS import / replace
- Login success/fail, MFA success/fail, MFA enabled/disabled
- Password reset requested/completed (no token/URL)

**Never audited:** client secret, access tokens, passwords, TOTP secrets, recovery codes, Authorization headers.

---

## K. Data storage

- PostgreSQL via Prisma
- Product document bytes via existing media storage abstraction
- Graph credentials: env and/or AES-GCM encrypted DB field keyed from `AUTH_SECRET`

---

## L. Network / transport security

- Production assumes HTTPS termination (Coolify)
- `Strict-Transport-Security` set in production responses
- CSP with `frame-ancestors 'none'`, `object-src 'none'`, plus existing font allowances
- `X-Content-Type-Options: nosniff`, Referrer-Policy, Permissions-Policy, COOP

---

## M. CSRF / input validation

- TanStack Start CSRF middleware active for `serverFn` handlers
- Zod validation on SharePoint settings (tenant/client IDs, folder URL host allowlist, UPN, labels)
- Folder URLs limited to `*.sharepoint.com` HTTPS hosts

---

## N. MFA status

| Item | Status |
| --- | --- |
| Better Auth `twoFactor` plugin (TOTP + backup codes) | Implemented |
| Login second-factor step | Implemented |
| Enrollment UI `/admin/security/mfa` | Implemented |
| Policy: SUPER_ADMIN + ACCOUNTS require MFA | Documented + coded |
| Hard enforcement | **Opt-in** via `MFA_ENFORCE_PRIVILEGED=true` (default off to avoid lockout before enrollment) |
| Trade customers forced MFA | Not in this phase |

**Lost device:** use a recovery code → re-enroll. Privileged lockout: Super Admin password reset (sessions revoked) + assisted re-enrollment. Never email TOTP secrets.

---

## O. Incident / revocation procedure

1. **Revoke Entra admin consent** for Automotive Brands B2B (removes Graph scopes from tokens).
2. **Delete folder resource grant** on the SDS driveItem permissions (selected model).
3. **Rotate** `MICROSOFT_GRAPH_CLIENT_SECRET` in Coolify; remove DB-encrypted secret if present.
4. **Disable** integration in Admin → Settings → Documents & SDS (`enabled=false`).
5. Review `AuditEvent` for SharePoint / MFA / login anomalies.

---

## P. Microsoft administrator setup instructions

See also `docs/microsoft-graph-security-review.md`.

1. Entra → App registrations → **Automotive Brands B2B**
2. API permissions → add **Application** permission `Files.SelectedOperations.Selected`
3. Remove `Files.Read.All` if present (preferred before first consent)
4. Grant admin consent for `Files.SelectedOperations.Selected`
5. As a SharePoint/OneDrive admin with rights to manage permissions on the SDS folder, assign:

```http
POST https://graph.microsoft.com/v1.0/drives/{driveId}/items/{folderItemId}/permissions
Content-Type: application/json

{
  "roles": ["read"],
  "grantedTo": {
    "application": {
      "id": "{ENTRA_APP_CLIENT_ID}",
      "displayName": "Automotive Brands B2B"
    }
  }
}
```

6. Provide Coolify secrets: tenant ID, client ID, client secret
7. In B2B Settings → Documents & SDS: paste drive ID + folder item ID (preferred least-privilege bootstrap) **or** resolve from folder URL if bootstrap access allows
8. Test connection → Scan → Preview → Confirm import

**Note:** `GET /users/{upn}/drive` is broader than selected file permissions. Prefer pasting stable IDs after Maximum Networks resolves them, so the B2B app never needs User/Files.Read.All for daily operation.

---

## Q. How to immediately revoke B2B Microsoft access

1. Entra → Enterprise applications → Automotive Brands B2B → **Revoke admin consent** / remove permissions
2. Delete the driveItem permission grant on the SDS folder
3. Rotate/delete the client secret
4. Disable the integration in B2B settings

---

## OLD → NEW permission cutover

| | |
| --- | --- |
| **OLD** | `Files.Read.All` (requested; admin consent **not** yet granted) |
| **NEW** | `Files.SelectedOperations.Selected` + folder `read` grant |
| **Admin consent** | Required for the new application permission |
| **Resource grant** | Required on the SDS folder |
| **Cutover** | Add selected permission → consent → grant folder read → configure IDs/secrets in B2B → test → remove Files.Read.All if it was added |
| **Rollback** | Re-add previous permission only if selected model fails; revoke selected grants; keep integration disabled until restored |

---

## Remaining recommendations

1. Move SDS PDFs from a personal OneDrive into a **dedicated SharePoint site/library** for clearer ownership and Sites.Selected / folder grants without depending on an individual mailbox.
2. Set `MFA_ENFORCE_PRIVILEGED=true` after SUPER_ADMIN and ACCOUNTS enroll.
3. Self-host fonts to tighten CSP (`unsafe-inline` / Google Fonts).
4. Periodic secret rotation calendar for Graph client secret.
