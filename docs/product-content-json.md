# Automotive Brands Product Content JSON v1.0

ChatGPT (or any researcher) generates this object **outside** Automotive Brands.
A catalogue editor pastes it into **Admin → Products → Content → Import product JSON**.
Automotive Brands validates, previews a merge, and applies only after an explicit **Apply changes**.

There is no OpenAI/ChatGPT API, scraper, or bulk importer in this workflow.

## Schema version

`schemaVersion` is required and must be `"1.0"`. Other versions are rejected.

## Complete example

```json
{
  "schemaVersion": "1.0",
  "identity": {
    "sku": "GCRTU",
    "name": "Power Maxed Glass Cleaner 1 Litre",
    "brand": "Power Maxed",
    "category": "Vehicle Cleaning",
    "subcategory": "Glass Cleaning",
    "status": "ACTIVE",
    "tradeVisible": true
  },
  "content": {
    "shortDescription": "Ready-to-use automotive glass cleaner for fast, streak-free cleaning of vehicle glass and mirrors.",
    "description": "<p>Full product description...</p>",
    "keyBenefits": [
      "Ready-to-use formula",
      "Helps deliver a streak-free finish",
      "Removes dirt, grease and fingerprints"
    ],
    "features": ["1 litre trigger spray bottle", "Ready to use"],
    "applications": ["Windscreens", "Side windows", "Mirrors", "Automotive glass"],
    "directions": null,
    "warnings": null
  },
  "specifications": {
    "size": "1 Litre",
    "productType": "Glass Cleaner",
    "form": "Liquid",
    "containerType": "Trigger Spray",
    "ean": null,
    "mpn": null,
    "additional": {
      "Colour": "Blue",
      "Dilution": "Ready to use"
    }
  },
  "commercial": {
    "rrp": 10.99,
    "baseTradePrice": 4.60,
    "vatRate": 20,
    "packQty": 1,
    "caseQty": null,
    "minimumOrderQty": 1,
    "orderIncrement": 1
  },
  "media": {
    "primaryImage": null,
    "gallery": [],
    "imageAlt": "Power Maxed Glass Cleaner 1 Litre"
  },
  "seo": {
    "metaTitle": "Power Maxed Glass Cleaner 1 Litre | Automotive Brands",
    "metaDescription": "Trade supply of Power Maxed Glass Cleaner 1 Litre from Automotive Brands.",
    "slug": "power-maxed-glass-cleaner-1-litre",
    "keywords": ["Power Maxed Glass Cleaner", "automotive glass cleaner"]
  },
  "merchandising": {
    "featured": false,
    "newProduct": false,
    "relatedSkus": [],
    "crossSellSkus": []
  },
  "source": {
    "manufacturerUrl": null,
    "supplierUrl": null,
    "notes": null
  }
}
```

## Required / optional

| Field | Required |
| --- | --- |
| `schemaVersion` | Yes (`"1.0"`) |
| All other sections and keys | Optional |

The open product in the workspace is the matching key. `identity.sku` is recommended so the importer can refuse a paste meant for a different SKU.

## Merge semantics (v1.0)

- **Omitted field** → leave the database value unchanged.
- **`null`** → leave unchanged (ChatGPT could not verify; do not erase).
- **`[]` or `{}`** → leave unchanged. v1.0 has no destructive clear.
- Editors delete content in the normal product forms.

## SKU safety

If `identity.sku` is present and does not match the product being edited (case-insensitive), import is **blocked**. The importer never changes SKU.

## Brand and category

Names are matched case-insensitively against existing Brand / Category records.

- Category + subcategory uses parent/child taxonomy when both are supplied.
- Unknown or ambiguous names are **blocking**. Brands and categories are **not** created from JSON.

## Description HTML

`content.description` is sanitised server-side. Allowed tags: `p`, `br`, `strong`, `em`, `ul`, `ol`, `li`, `h2`, `h3` (`b`/`i` mapped to strong/em). Scripts, styles, iframes, event handlers and `javascript:` URLs are stripped.

## Media

The Media Library remains authoritative.

- External `http(s)` URLs are reported as unresolved and **not** downloaded.
- Existing CmsMedia ids may be attached; existing product images are never removed because media fields are omitted or null.
- `imageAlt` can update the current primary image alt text.

## Commercial data

Optional mapping onto the **default ProductVariant** only: RRP, base trade price, VAT (20 or 0), pack/case/MOQ/increment.

Does **not** write PriceList, CustomerPrice, QuantityBreak, Promotions, Inventory, or Autopart stock. Price diffs are highlighted in preview.

## SEO

Maps `metaTitle`, `metaDescription`, `slug` onto Product SEO fields. Slug clashes with another product are blocking. `keywords` are stored privately on the specifications document and are **not** emitted as a meta keywords tag.

## Related / cross-sell

`relatedSkus` / `crossSellSkus` are validated (unknown SKUs listed) and **deferred** — v1 does not invent relationship tables.

## Source / provenance

`manufacturerUrl`, `supplierUrl`, `notes` are stored on the specifications JSON document as internal provenance. They are not rendered on the public product page.

## Versioning

Bump `schemaVersion` for breaking merge rules. This importer accepts `1.0` only.

Canonical modules: `src/domain/product-content-json.ts`, `src/domain/product-content-html.ts`, `src/server/catalogue/product-content-json.ts`.
