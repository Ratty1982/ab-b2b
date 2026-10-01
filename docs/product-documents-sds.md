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

Workflow:

1. Select up to 40 PDFs
2. Preview matches (no publish yet)
3. Confirm Import / Replace / Skip per row

Statuses: `MATCHED`, `REVIEW`, `NO_MATCH`, `ALREADY_ATTACHED`, `EXISTING_SDS`, `INVALID`, then `IMPORTED` / `REPLACED` / `FAILED`.

Uncertain matches never auto-import.

## Matching rules (conservative)

Priority:

1. Exact SKU token in filename
2. Normalised SKU (case-insensitive; strips spaces/hyphens/`SDS`/years)
3. Strong normalised product-name containment (min length)

Ambiguous → `REVIEW` (human chooses). None → `NO_MATCH` (manual select).

## Duplicates

SHA-256 checksum stored on every document.

- Same product + type + checksum + CURRENT → `ALREADY_ATTACHED` (no second copy)
- Different current SDS already present → `EXISTING_SDS` (explicit Replace or Skip)

## Public product page

If any CURRENT customer-visible documents exist, render **Safety & Documents**.

- SDS: View SDS / Download PDF
- Other types listed underneath with labels
- No empty section when nothing is attached
- Never expose notes, uploadedBy, storage keys, archive history

## Download security

`getProductDocumentBytes`:

- Anonymous: only `CURRENT` docs on products that are ACTIVE + active + trade-visible
- Staff with `products.view` (non-trade): may access archived
- Trade actors cannot use admin document management APIs
- Hidden products’ documents are not enumerable via public download

## Permissions

| Action | Capability |
| --- | --- |
| View admin documents | `products.view` (internal) |
| Upload / replace / archive / bulk | `products.edit` (internal) |
| Public download | product visibility rules |

## Audit / Activity

| Action | Meaning |
| --- | --- |
| `catalogue.document_uploaded` | New current document |
| `catalogue.document_replaced` | Previous archived, new current |
| `catalogue.document_archived` | Manual archive |
| `catalogue.bulk_document_import` | Bulk confirm summary |

Product Activity includes `ProductDocument` events keyed by `metadata.productId`.

## Intentionally deferred

- Microsoft Graph / SharePoint / OneDrive synchronisation
- Automatic folder watchers
- Customer-facing historical SDS version browser
- Variant-specific SDS UI (schema supports optional `productVariantId` only)

Operational source files may live in OneDrive today; once imported, B2B serves from R2 via ProductDocument records.
