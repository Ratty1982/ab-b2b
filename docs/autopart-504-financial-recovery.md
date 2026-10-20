# 504 financial recovery

Production investigation found 123 Autopart documents dated 6–19 October 2026 where stored 504 goods NET + VAT does not equal gross value: 105 invoices and 18 credit notes.

The 19 October report `504_20261019.txt` has 60 document rows, including two credit notes. Its footer is goods NET 2958.30, VAT 591.54, total 3549.84. Eight of those rows were stored with a truncated goods amount because the fixed-width parser started at the Goods heading (column 71) and dropped a leading digit or minus sign at column 70:

| Reference | Verified goods NET | Truncated stored goods |
| --- | ---: | ---: |
| SC506126 | -44.16 | 44.16 |
| SC506127 | -31.66 | 31.66 |
| SS306549 | 107.48 | 7.48 |
| SS306576 | 187.01 | 87.01 |
| SS306579 | 237.12 | 37.12 |
| SS306591 | 399.20 | 99.20 |
| SS306594 | 657.60 | 57.60 |
| SS306595 | 231.60 | 31.60 |

Do not correct production until a backup has been verified by a restore test and a dry-run report has been approved. Do not merge this change as a data fix. The parser correction stops new imports from storing truncated amounts. Existing rows stay unchanged until the authorised recovery below is run.

## Why the imbalance is not the correction

Goods NET + VAT − value shows that a stored triple is wrong. It does not show the original goods amount. VAT or value can also be shifted, and a later edit can unbalance a row for another reason. The recovery proposes a write only when every supplied original 504 report contains the same verified triple for that document reference.

Rows with no report, a malformed report line, or two reports that disagree stay on the manual-review list.

## Dry-run

1. Collect the original 504 files that cover 6–19 October 2026, plus any later file that may contain the same document references. Keep the bytes that were imported. Do not replay them through the normal 504 import.
2. Confirm a restorable backup of the production database.
3. Call `runAutopart504FinancialRecovery` as an admin with `authorise: true` and `dryRun: true` (the default), passing those report texts.
4. Review the plan:
   - affected document count, invoice/credit split, and date range
   - stored amounts against verified amounts and the source filename and line
   - customer, company, AB order, document type, and historical source, which the apply step does not change
   - sales-reporting delta (goods, VAT, gross) for proposed corrections only
   - expected 504↔TRM reconciliation after the goods correction
   - documents already fulfilled, which need a separate fulfilment review
   - manual-review rows, including unbalanced documents with no source report

The dry-run writes an audit event `autopart.504_financial_recovery_previewed`. It does not change document amounts.

## Authorised apply

Apply only after the dry-run is approved.

- `authorise: true`
- `dryRun: false`
- `confirmation: "CORRECT_504_FINANCIAL_AMOUNTS"`

For each `APPLY` row the writer updates only `goodsNet`, `vat`, `grossTotal`, and the derived reconciliation fields `reconciliationStatus`, `linesNetSum`, and `valueMismatchMinor`. It then writes `autopart.504_financial_amounts_corrected` with the previous and new amounts.

The write is skipped when the stored amounts already match, or when the document identity or stored amounts changed after the plan was built. Running it again is a no-op for corrected rows.

The apply does not:

- trigger 504/TRM fulfilment
- change order statuses
- consume or release stock reservations
- generate invoices
- queue customer despatch emails
- replay older reports through the importer
- modify documents that do not have 504 provenance

Unmapped customers stay unmapped. Historical source and AB order links stay as they are.

## After the amounts are corrected

Fulfilment is a separate authorised step. Documents flagged `postCorrectionFulfilmentReview` were already considered by fulfilment. Review despatch, stock, and customer email for those AB orders before any further fulfilment run. Do not assume the corrected goods total by itself is a reason to despatch or to send mail.
