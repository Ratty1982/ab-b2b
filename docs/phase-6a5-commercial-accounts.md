# Phase 6A.5 — Customer commercial accounts

Prepares trade Companies for Phase 6B checkout by completing commercial
data: product-specific CustomerPrice management and verified Autopart
customer account mapping.

Does **not** implement checkout, Order creation, or Autopart order
submission.

## Customer-specific pricing

Reuse existing `CustomerPrice` (company + variant + unitPrice + optional
validity window). Precedence remains Phase 4:

1. CustomerPrice (in validity window)
2. Company PriceListItem
3. ProductVariant.tradePrice

Then quantity breaks / promotions / VAT via the central resolver.

### Staff UI

Admin → Customers → workspace → **Commercial**:

- Price list / payment terms / tax / credit (existing)
- **Autopart account** (verified ERP code)
- **Customer-specific prices** table with:
  - Normal price = list item else base trade (without the override)
  - Customer price = negotiated override
- Add / edit / remove via existing `upsertCustomerPrice` /
  `deleteCustomerPrice` (requires `pricing.edit`)
- Price as Customer diagnostic on product Commercial remains the
  resolver verification tool

Public catalogue / PDP / Phase 6A basket automatically pick up
CustomerPrice through `resolveVariantTradePrices`. Basket lines are
re-resolved on load (not frozen until Phase 6B Order snapshots).

### Security

- Company A never receives Company B CustomerPrice
- Anonymous never receives CustomerPrice
- TRADE cannot mutate CustomerPrice / PriceList / Autopart codes
- Sales-scoped actors must pass company assignment checks

## Autopart customer account

| Field | Where | Meaning |
| --- | --- | --- |
| `claimedAutopartCustomerCode` | TradeApplication | Applicant claim — evidence only |
| `autopartCustomerCode` | Company | Staff-managed ERP account code |
| `autopartCustomerCodeVerifiedAt` | Company | Verification timestamp (Europe/London display) |
| `autopartCustomerCodeVerifiedById` | Company | Staff who verified |

### Rules

- Codes stored as TEXT (preserve leading zeros / letters / hyphens)
- Normalization: trim + collapse whitespace only
- Nullable **unique** on `Company.autopartCustomerCode`
- Changing the code clears verification until staff re-verify
- Clearing the code clears verification
- Claimed registration code must **never** auto-set Company fields
- Autopart code is never a password / session id

### Audit actions

- `company.autopart_account.set`
- `company.autopart_account.changed`
- `company.autopart_account.verified`
- `company.autopart_account.cleared`

### Future Phase 6B contract

When Orders are created:

1. Use `Company.autopartCustomerCode` **only if verified**
2. Never use `claimedAutopartCustomerCode` for ERP submission
3. Snapshot the verified code onto the Order
   (e.g. `autopartCustomerCodeSnapshot`) so historical orders keep the
   account they were created under

Checkout may later block if Autopart is unverified — not imposed in 6A.5.

## Registration

Public `/register` asks whether the applicant already has a trade
account. If yes, optional Autopart / account number is stored as
`claimedAutopartCustomerCode` on the TradeApplication.

Admin Trade Applications show the claimed code for review. After
approval, staff set and verify the code on the Company Commercial tab.
