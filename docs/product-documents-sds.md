# Product Documents & Safety Data Sheets (SDS)

Reusable catalogue document architecture for Automotive Brands B2B. First active type: **Safety Data Sheet (SDS)**.

## Supported production SDS workflow

**Manual upload / bulk manual upload.**

SharePoint / Microsoft Graph SDS import is **implemented but disabled** and is **not currently used**. Do not configure Microsoft credentials expecting staff to scan SharePoint in production.

| Path | Status |
| --- | --- |
| Operations → Documents (`/admin/products/documents-import`) | **Supported** — Bulk SDS Upload |
| Product workspace → Documents tab | **Supported** — single upload, current/archived SDS, other document types |
| Settings → Documents & SDS | **Supported** — explains the manual workflow and links to Bulk SDS Upload |
| SharePoint scan / Graph import | Implemented, **disabled** unless `SHAREPOINT_SDS_ENABLED=true` |

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

UI never exposes enum names. The bulk SDS workspace always uses **SDS** — administrators do not re-select type per file.

## Storage (R2)

Uses the existing CMS media storage abstraction (`putMediaObject` / `getMediaObjectBytes`).

Object key convention:

```text
products/{productId}/documents/{documentId}/{safeFilename}
```

Validation (always server-side; client MIME is never trusted alone):

- PDF magic bytes (`%PDF-`)
- `.pdf` extension after filename sanitisation
- Max 20 MB
- Declared MIME must be PDF-compatible when present

Public downloads go through `/api/product-documents/:id` (optional `?download=1`), not a permanent public R2 URL requirement.

## Admin — Product Workspace

Tab: **Documents**

- Current SDS card with View / Download / Replace / Archive
- Empty state: “No Safety Data Sheet attached” + Upload SDS
- Other Documents + Add Document
- Archived list (staff can still view)

Upload fields: type, title, PDF, optional revision/date/notes.

Bulk upload does **not** replace this tab. Use it for one product at a time, archived history, and non-SDS files.

## Replacement / versions

1. Upload + validate new PDF
2. Confirm replacement
3. Transaction: archive previous CURRENT → create new CURRENT
4. Audit `catalogue.document_replaced`
5. If storage or DB fails after upload, object cleanup is attempted and the previous CURRENT SDS remains

Historical SDS rows stay as `ARCHIVED` (no destructive delete by default). Archived SDS is never the public current download.

## Bulk SDS Upload (supported)

Route: `/admin/products/documents-import`  
Also: Operations → Documents, Products → Bulk SDS Upload, Settings → Documents & SDS.

Designed for **30–100 PDFs** in one review (hard cap `BULK_SDS_MAX_FILES` = 100).

1. Drop or choose PDF files only
2. Server validates PDF magic, size, and filename
3. Batch product matching (one catalogue load + one current-SDS load — not N+1)
4. Administrator reviews the table (file, product, SKU, match method, existing SDS, action, status)
5. Correct **Needs review** / **No match** rows with in-row SKU/name search
6. Preview the import summary
7. **Confirm import** — only then writes to R2 / `ProductDocument`
8. New SDS becomes **current**; previous current SDS is **archived** when Replace is confirmed
9. Partial failure is reported per file (other rows still import)

### Matching rules (conservative)

Never fuzzy-auto-assigns ambiguous files.

1. Exact SKU token in filename (e.g. `PMAPC500 Safety Data Sheet.pdf` → SKU `PMAPC500` if unique)
2. Normalised SKU (case-insensitive; strips spaces/hyphens/`SDS`/years)
3. Strong normalised product-name containment (min length 8)
4. Otherwise **Needs review** (multiple candidates) or **No match**

Unresolved rows cannot import until a product is selected or the row is skipped. A skipped file stays visible and is not written. One unmatched PDF does not fail the rest of the batch.

### Existing SDS / duplicates

- Product already has a current SDS with **different** bytes → **Replacement** (default action: replace current; previous row archived, not deleted)
- Same product + type + SHA-256 already CURRENT → **Duplicate** (default: skip; no second identical version)
- Same checksum on a **different** product is not treated as a duplicate of that other product

Manual bulk source metadata is `{ "source": "MANUAL_UPLOAD" }` (never pretended to be SharePoint).

### Audit

| Action | Meaning |
| --- | --- |
| `catalogue.document_uploaded` | New current document |
| `catalogue.document_replaced` | Previous archived, new current |
| `catalogue.document_archived` | Manual archive |
| `catalogue.bulk_document_import` | Bulk confirm summary (`filesSelected`, `created`, `replaced`, `duplicates`, `skipped`, `failed`, `source`) |

Preview/matching does not write audit rows.

## SharePoint / Microsoft Graph (implemented, not currently used)

**Do not delete this integration.** Schema, settings, Graph client, scan/confirm services, and security review remain in the repo so it can be re-enabled later.

### Disable mechanism

`SHAREPOINT_SDS_ENABLED` defaults to **off**. Only `true` / `1` / `yes` enables scan, test-connection, folder resolve, and confirm-import.

When disabled:

- Production UI hides SharePoint connection/scan/import controls (Bulk SDS Upload and Settings → Documents & SDS)
- Server actions reject execution (`DISABLED` / 403), including hidden URL calls
- Stored `SharePointSdsSettings`, encrypted secrets, and scan history are **untouched**
- Dashboard does not show a SharePoint SDS health card

### How to re-enable later

1. Confirm Entra + Graph least-privilege is still valid (`docs/microsoft-graph-security-review.md`, `docs/security.md`)
2. Set Coolify env `SHAREPOINT_SDS_ENABLED=true` (plus existing Graph tenant/client/secret if used)
3. Redeploy — Settings → Documents & SDS shows the connection panel again; Bulk SDS Upload offers an advanced SharePoint section
4. Test connection → Scan → Preview → Confirm import (same ProductDocument / R2 path as manual upload)

### Chosen model (when enabled)

Organisation-managed Microsoft Entra **application (client credentials)** calling Microsoft Graph.

| Piece | Detail |
| --- | --- |
| Auth | `client_credentials` → `https://graph.microsoft.com/.default` |
| Secrets | `SharePointSdsSettings.clientSecretEncrypted` (AES via `AUTH_SECRET`) or env `MICROSOFT_GRAPH_CLIENT_SECRET` |
| Also env | `MICROSOFT_GRAPH_TENANT_ID`, `MICROSOFT_GRAPH_CLIENT_ID` |
| Folder identity | Stable Graph `driveId` + `folderItemId` (URL is a one-time helper only) |
| APIs | `/users/{upn}/drive`, drive item by path, children with `@odata.nextLink`, `/content` download |

Configuration changes require `integrations.sharepoint.manage`. Ordinary SDS upload/import confirm uses `products.edit`.

SharePoint-sourced rows store internal `sourceMetadata.source = "SHAREPOINT"` (never on public APIs).

**Automatic unattended sync remains deferred.**

## Public product page

If any CURRENT customer-visible documents exist, render **Safety & Documents**.

- SDS: View SDS / Download PDF
- Other types listed underneath with labels
- No empty section when nothing is attached
- Never expose notes, uploadedBy, storage keys, archive history, SharePoint URLs, or source metadata

A manually uploaded SDS and a (future) SharePoint-sourced SDS behave identically for customers. Only **CURRENT** documents on visible products are public.

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
| Upload / replace / archive / bulk SDS | `products.edit` (internal, non-TRADE) |
| SharePoint connection settings | `integrations.sharepoint.manage` |
| Public download | product visibility rules |

Trade users: no access. Public users: no access to bulk/admin APIs.

## Intentionally deferred

- Unattended automatic SharePoint → B2B SDS synchronisation
- Silent replacement on remote change
- Automatic archive when SharePoint file is deleted
- Customer-facing historical SDS version browser
- Variant-specific SDS UI (schema supports optional `productVariantId` only)
- Narrower Graph permission model (`Sites.Selected`) if tenant policy requires it

**Manual upload is the SOURCE in production. R2 / `ProductDocument` is the website copy.** SharePoint remains a dormant alternative source.
