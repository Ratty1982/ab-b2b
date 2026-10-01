# Product Documents & Safety Data Sheets (SDS)

Reusable catalogue document architecture for Automotive Brands B2B. First active type: **Safety Data Sheet (SDS)**.

## Architecture decision

The existing polymorphic `Document` model (company / application / mixed CRM files) is **not** reused for product SDS.

A dedicated **`ProductDocument`** model owns:

- typed document kinds (`ProductDocumentType`)
- current vs archived status (`ProductDocumentStatus`)
- SHA-256 checksum, revision/date metadata
- R2 (or database-bytes fallback) storage references
- replace/archive lineage (`replacesDocumentId`)

Product documents are product-owned by default. Variant-specific association is optional and unused for typical pack-size SDS sharing.

## Document types

| Internal enum | UI label |
| --- | --- |
| `SAFETY_DATA_SHEET` | Safety Data Sheet (SDS) |
| `TECHNICAL_DATA_SHEET` | Technical Data Sheet |
| `INSTRUCTIONS` | Instructions |
| `CERTIFICATE` | Certificate |
| `DECLARATION` | Declaration |
| `FITTING_GUIDE` | Fitting Guide |
| `OTHER` | Other Document |

UI never exposes enum names.

## Storage (R2)

Uses the existing CMS media storage abstraction (`putMediaObject` / `getMediaObjectBytes`).

Object key convention:

```text
products/{productId}/documents/{documentId}/{safeFilename}
```

Validation:

- PDF magic bytes (`%PDF-`)
- `.pdf` extension after filename sanitisation
- Max 20 MB
- Declared MIME must be PDF-compatible when present (browser MIME is never trusted alone)

Public downloads go through `/api/product-documents/:id` (optional `?download=1`), not a permanent public R2 URL requirement.

## Admin — Product Workspace

Tab: **Documents**

- Current SDS card with View / Download / Replace / Archive
- Empty state: “No Safety Data Sheet attached” + Upload SDS
- Other Documents + Add Document
- Archived list (staff can still view)

Upload fields: type, title, PDF, optional revision/date/notes.

## Replacement / versions

1. Upload + validate new PDF
2. Confirm replacement
3. Transaction: archive previous CURRENT → create new CURRENT
4. Audit `catalogue.document_replaced`
5. If storage or DB fails after upload, object cleanup is attempted and the previous CURRENT SDS remains

Historical SDS rows stay as `ARCHIVED` (no destructive delete by default).

## Bulk import

Route: `/admin/products/documents-import`  
Linked from Products (“Import SDS”) and Product CSV Imports.

### Choose source

1. **Import from SharePoint** — scan the configured Power Maxed SDS folder (150+ PDFs)
2. **Upload PDF files** — local select, up to 40 per preview batch (unchanged)

Both sources share the same validation, SHA-256, matching, R2 storage, `ProductDocument` creation, and audit path.

### Local upload workflow

1. Select up to 40 PDFs
2. Preview matches (no publish yet)
3. Confirm Import / Replace / Skip per row

### SharePoint workflow

1. Configure Microsoft Graph connection (Settings or Connection settings on the import page)
2. Resolve folder → store stable `driveId` + `folderItemId`
3. **Scan SharePoint folder** (server-side list + download + preview; max 500 PDFs)
4. Review paginated preview (50/page)
5. Confirm import — server re-downloads each selected file and runs the normal import service

Statuses: `MATCHED`, `REVIEW`, `NO_MATCH`, `ALREADY_ATTACHED`, `EXISTING_SDS`, `UPDATED_SOURCE`, `SOURCE_MISSING`, `INVALID`, `DOWNLOAD_FAILED`, then `IMPORTED` / `REPLACED` / `FAILED`.

Uncertain matches never auto-import. There is no “Replace all existing SDS” bulk action.

## SharePoint / Microsoft Graph architecture

**Chosen model:** organisation-managed Microsoft Entra **application (client credentials)** calling Microsoft Graph. Production must not depend on George remaining logged into B2B.

| Piece | Detail |
| --- | --- |
| Auth | `client_credentials` → `https://graph.microsoft.com/.default` |
| Secrets | `SharePointSdsSettings.clientSecretEncrypted` (AES via `AUTH_SECRET`) or env `MICROSOFT_GRAPH_CLIENT_SECRET` |
| Also env | `MICROSOFT_GRAPH_TENANT_ID`, `MICROSOFT_GRAPH_CLIENT_ID` |
| Folder identity | Stable Graph `driveId` + `folderItemId` (URL is a one-time helper only) |
| APIs | `/users/{upn}/drive`, drive item by path, children with `@odata.nextLink`, `/content` download |

### Required Entra configuration (human steps)

See **`docs/microsoft-graph-security-review.md`** and **`docs/security.md`** for the authoritative Maximum Networks review pack.

1. Entra app **Automotive Brands B2B** → Microsoft Graph **Application** permission:
   - `Files.SelectedOperations.Selected` (preferred; **not** `Files.Read.All`)
2. Admin consent for that permission, **plus** a folder-level `read` grant on the SDS driveItem.
3. Prefer Coolify env secrets: `MICROSOFT_GRAPH_TENANT_ID`, `MICROSOFT_GRAPH_CLIENT_ID`, `MICROSOFT_GRAPH_CLIENT_SECRET`.
4. In B2B **Settings → Documents & SDS**:
   - Paste stable `driveId` + `folderItemId` (preferred least-privilege bootstrap), or resolve from a SharePoint folder URL when bootstrap access allows
   - **Test connection** → Scan → Preview → Confirm import

Configuration changes require `integrations.sharepoint.manage`. Ordinary SDS upload/import confirm uses `products.edit`.

### Source metadata (internal)

On import, `ProductDocument.sourceMetadata` stores:

```json
{
  "source": "SHAREPOINT",
  "driveId": "…",
  "itemId": "…",
  "filename": "…",
  "lastModified": "…",
  "eTag": "…",
  "cTag": "…",
  "folderItemId": "…",
  "importedAt": "…"
}
```

Never exposed on public APIs. Enables later update detection.

### Update detection readiness (manual)

- Same SharePoint `itemId` + different checksum → preview `UPDATED_SOURCE` (Review / Replace; no silent replace)
- SharePoint file gone → preview `SOURCE_MISSING`; **B2B SDS stays CURRENT** until a human archives/replaces it

**Automatic unattended sync remains deferred.**

## Matching rules (conservative)

Priority:

1. Exact SKU token in filename
2. Normalised SKU (case-insensitive; strips spaces/hyphens/`SDS`/years)
3. Strong normalised product-name containment (min length)

Ambiguous → `REVIEW` (human chooses). None → `NO_MATCH` (manual select).

SharePoint does **not** weaken matching.

## Duplicates

SHA-256 checksum stored on every document.

- Same product + type + checksum + CURRENT → `ALREADY_ATTACHED` (no second copy)
- Different current SDS already present → `EXISTING_SDS` (explicit Replace or Skip)
- Same SharePoint item, changed bytes → `UPDATED_SOURCE`

## Public product page

If any CURRENT customer-visible documents exist, render **Safety & Documents**.

- SDS: View SDS / Download PDF
- Other types listed underneath with labels
- No empty section when nothing is attached
- Never expose notes, uploadedBy, storage keys, archive history, SharePoint URLs, or source metadata

SharePoint-sourced SDS behaves identically to a manually uploaded SDS for customers.

## Download security

`getProductDocumentBytes`:

- Anonymous: only `CURRENT` docs on products that are ACTIVE + active + trade-visible
- Staff with `products.view` (non-trade): may access archived
- Trade actors cannot use admin document management APIs
- Hidden products’ documents are not enumerable via public download
- Trade/public cannot browse SharePoint, trigger scans, or see tokens/source IDs

## Permissions

| Action | Capability |
| --- | --- |
| View admin documents / SharePoint settings | `products.view` (internal) |
| Upload / replace / archive / bulk / SharePoint scan | `products.edit` (internal) |
| Public download | product visibility rules |

## Audit / Activity

| Action | Meaning |
| --- | --- |
| `catalogue.document_uploaded` | New current document |
| `catalogue.document_replaced` | Previous archived, new current |
| `catalogue.document_archived` | Manual archive |
| `catalogue.bulk_document_import` | Local bulk confirm summary |
| `catalogue.sharepoint_sds_scan` | SharePoint folder scan preview |
| `catalogue.sharepoint_document_import` | SharePoint confirm import summary |
| `catalogue.sharepoint_sds_settings_updated` | Connection settings changed |
| `catalogue.sharepoint_sds_connection_tested` | Test connection result |

Audit metadata never includes access tokens, refresh tokens, client secrets, or PDF bytes.

Product Activity includes `ProductDocument` events keyed by `metadata.productId`.

## Intentionally deferred

- Unattended automatic SharePoint → B2B SDS synchronisation
- Silent replacement on remote change
- Automatic archive when SharePoint file is deleted
- Customer-facing historical SDS version browser
- Variant-specific SDS UI (schema supports optional `productVariantId` only)
- Narrower Graph permission model (`Sites.Selected`) if tenant policy requires it

**SharePoint is the SOURCE. R2 / `ProductDocument` is the website copy.**
