# Microsoft Graph Security Review — Automotive Brands B2B

**Audience:** Maximum Networks / Microsoft 365 administrators  
**App registration:** Automotive Brands B2B  
**Date context:** October 2026

---

## Purpose

Read product **Safety Data Sheet (SDS) PDF** files from **one authorised Microsoft 365 document location** so Automotive Brands staff can preview and import them into the B2B catalogue.

## Authentication

- **Application-only / server-to-server** (OAuth2 client credentials)
- No signed-in Microsoft user in the B2B app for Graph calls
- Credentials stored **server-side only** (Coolify environment secrets preferred)

## Operations

| Allowed | Not allowed |
| --- | --- |
| Resolve/verify the configured folder | Write / modify / delete any M365 files |
| List files in that folder | Access email, calendar, Teams |
| Read file metadata | Browse unrelated OneDrive/SharePoint content |
| Download PDF file content | Generic Graph “proxy” from the browser |

## Data

- Product SDS PDFs only (validated as PDF by the B2B application)
- No mailbox content, no Teams chat, no calendar

## Writes

**None** via Microsoft Graph.

## Email / Calendar / Teams / Directory

- Email: **None**
- Calendar: **None**
- Teams: **None**
- User directory: **Not required for steady-state operation.** Daily access uses stored `driveId` + `folderItemId`. (Optional one-time bootstrap via user OneDrive path is discouraged under least privilege; prefer admin-supplied IDs.)

## Permission requested (least privilege)

**Application permission:** `Files.SelectedOperations.Selected`

**Resource grant:** `read` role on the specific SDS **folder** driveItem (George Parker OneDrive SDS folder today).

This is **narrower** than `Files.Read.All` (tenant-wide file read), which is **not** required and should **not** be consented for this app.

### Why not Files.Read.All?

`Files.Read.All` would allow the application token to read files across the tenant. Selected permissions grant **no access until** an administrator assigns the app to a specific folder/file with an explicit role.

### Does this work with OneDrive for Business?

**Yes.** OneDrive for Business is SharePoint-backed. Folder-level `Files.SelectedOperations.Selected` + `read` is supported for application access.

### Folder-level restriction

**Yes** — grant on the SDS folder item. Access applies to that folder’s files. Unrelated sites/drives remain inaccessible if no other grants exist.

## Resource grant Maximum Networks must perform

1. Confirm/create Entra app **Automotive Brands B2B** API permission:
   - Application: `Files.SelectedOperations.Selected`
   - Remove `Files.Read.All` if present
2. **Admin consent** the selected permission
3. Identify the SDS folder’s Graph `driveId` and `itemId` (folder)
4. Create application permission on that folder:

```http
POST /drives/{driveId}/items/{folderItemId}/permissions
{
  "roles": ["read"],
  "grantedTo": {
    "application": {
      "id": "{client-id-of-Automotive-Brands-B2B}"
    }
  }
}
```

5. Provide tenant ID, client ID, and client secret to Automotive Brands for Coolify secrets
6. Provide `driveId` + `folderItemId` for B2B configuration (or assist resolve)

## Current SDS location

Associated with **george.parker@automotivebrands.co.uk** OneDrive / SharePoint folder containing Power Maxed SDS PDFs.

### Can personal OneDrive be safely restricted?

**Yes, at folder level**, using the selected permission + `read` grant above.

**Caveat:** Personal OneDrive ownership is tied to a person. If that account is disabled or the folder moves, grants must be re-created.

### Recommended alternative (not automatic)

Move SDS PDFs into a **dedicated SharePoint site/document library** (e.g. “AB Product SDS”) owned by IT/operations. Then apply the same `Files.SelectedOperations.Selected` + folder `read` (or site-scoped `Sites.Selected` if preferred). This improves continuity and review clarity. **Do not migrate files automatically** as part of this review.

## Credential handling (B2B)

- Stored server-side (environment preferred)
- Never returned to browsers, logs, or audit payloads
- Settings UI shows Configured / Not configured only

## User access (B2B)

- RBAC protected
- Changing Graph credentials / source / enablement requires `integrations.sharepoint.manage`
- Trade customers have no access to this integration

## Audit

Security-relevant configuration, connection tests, scans, and imports are recorded without secrets or tokens.

## Revocation (immediate)

1. **Entra:** Revoke admin consent / remove app permissions for Automotive Brands B2B  
2. **Resource:** Delete the folder permission grant (`DELETE .../permissions/{id}`)  
3. **Secret:** Rotate or delete the client secret  
4. **B2B:** Disable the SharePoint SDS integration in Admin Settings  

Either Entra revocation **or** resource-grant deletion is sufficient to stop access; do both in an incident.

## Cutover summary

| Step | Action |
| --- | --- |
| OLD | `Files.Read.All` requested; **consent not yet granted** |
| NEW | `Files.SelectedOperations.Selected` + folder `read` |
| Before consent | Prefer completing selected model first (this document) |
| After grant | Configure secrets + folder IDs in B2B → Test connection → Scan (preview only) → Human confirm import |
| Rollback | Disable B2B integration; remove grants; optionally restore prior permission only if required for emergency ops |
