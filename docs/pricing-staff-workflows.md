# Staff commercial pricing workflows

Operational guide for Automotive Brands staff. The Phase 4A resolver contract in
`docs/trade-price-resolution.md` is unchanged.

Permissions: **pricing.view** inspects commercial data. **pricing.edit** mutates it.
Trade customers never access `/admin/pricing` or these services.

## Price lists

Catalogue → **Price Lists** (`/admin/pricing`).

Compact counts show lists, customer overrides, active promotions, and products with
volume breaks. The table lists name, status (Default / Live), product count, assigned
customers, and last updated.

Price lists have no activate/deactivate flag in the schema. Default is a label only;
companies do not inherit it automatically.

Open a list for the workspace: products, bulk prices, assignment, CSV, and audit.

## Price list workspace

Header actions: Add Products, Assign Customers, Edit Details.

Product table: SKU, product, brand, base trade, list price, difference vs base
(absolute and percent, scaled-integer display math), status.

Search by SKU/name and brand. Edits stay local until **Save changes**.

Add products via search (SKU, name, brand). Duplicate `(priceListId, variantId)` rows
are skipped, not duplicated.

Removing a product requires confirmation. The product remains in the catalogue.

## Company assignment

Assignment writes `Company.priceListId` through the existing company update path when
the actor also has `companies.edit`. A company has one list.

## Customer overrides

Customer workspace → Commercial.

Shows assigned list and negotiated price count. Table: SKU, product, base, list,
customer price, valid from/until, status (Scheduled / Active / Expired) using the same
`inValidityWindow` rule as the resolver.

Start and end are independently optional.

Overrides never appear on another company’s price-list export.

## Quantity breaks

Product → Commercial.

Thresholds display ascending. `minQty = 1` is the catalogue mirror and is hidden as a
volume break. Case quantity notes (for example first orderable 12 units for a stored
break of 10 when `caseQty` is 6) are informational only and do not change stored
thresholds or the resolver.

## Promotions

Price Lists → Promotions tab.

Supported create types: **Percent off** and **Fixed amount off per unit**.
`QUANTITY_DEAL` cannot be created. Existing quantity-deal records remain visible as
“not currently applied”.

Scope: entire catalogue, or selected products (stored as `metadata.skus` /
`metadata.variantIds`). Validity uses the resolver window plus the Active toggle
(Disabled / Scheduled / Active / Expired).

Preview on the form is illustrative. Live prices still come from the engine.

## Price as customer

Product → Commercial diagnostic. Search a company, set quantity, resolve.

Breakdown is the Phase 4A explanation plus VAT percent. Quantity is not rewritten for
case multiples; a non-blocking orderability note may appear.

## Import / export

Export CSV: `sku,productName,baseTradePrice,priceListPrice`.

Import: `sku,price` → validate → preview → confirm. Unknown SKUs, duplicates, and
invalid prices are flagged. Products are never created from this file.

## Audit

Recent `pricing.*` (and company price-list assignment) events appear on the price list,
customer Commercial tab, and product Commercial tab.
